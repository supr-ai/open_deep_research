import {
	AIMessage,
	HumanMessage,
	ToolMessage,
	BaseMessage,
	isAIMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import { Configuration } from '../options.js'
import {
	ConductResearchSchema,
	getOverrideValue,
	reduceOverrideValue,
	OverrideValue,
	ResearchCompleteSchema
} from '../state.js'
import {
	getApiKeyForModel,
	getNotesFromToolCalls,
	isTokenLimitExceeded,
	configurableModel,
	splitModel
} from '../utils.js'
import researcherGraph from './researcher.js'

const SupervisorAnnotation = Annotation.Root({
	supervisorMessages: Annotation<OverrideValue<BaseMessage[]>>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	researchBrief: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	notes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	researchIterations: Annotation<number>({
		reducer: (_current, update) => update,
		default: () => 0
	}),
	rawNotes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	})
})

const supervisor = async (
	state: typeof SupervisorAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const researchModelConfig = {
		...splitModel(configurable.researchModel),
		maxTokens: configurable.researchModelMaxTokens,
		apiKey: getApiKeyForModel(configurable.researchModel)
	}

	const researchModel = (await configurableModel)
		.bindTools([ConductResearchSchema, ResearchCompleteSchema])
		.withRetry({
			stopAfterAttempt: configurable.maxStructuredOutputRetries
		})
		.withConfig({ configurable: researchModelConfig })

	const supervisorMessages = getOverrideValue(state.supervisorMessages)
	const response = await researchModel.invoke(supervisorMessages)

	return new Command({
		goto: 'supervisorTools',
		update: {
			supervisorMessages: [response],
			researchIterations: (state.researchIterations || 0) + 1
		}
	})
}

const supervisorTools = async (
	state: typeof SupervisorAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const supervisorMessages = getOverrideValue(state.supervisorMessages)
	const researchIterations = state.researchIterations || 0
	const mostRecentMessage = supervisorMessages[supervisorMessages.length - 1]

	if (!isAIMessage(mostRecentMessage)) {
		throw new Error('Most recent message is not an AI message')
	}

	// Exit Criteria
	const exceededAllowedIterations =
		researchIterations >= configurable.maxResearcherIterations
	const noToolCalls =
		!mostRecentMessage.tool_calls ||
		mostRecentMessage.tool_calls.length === 0
	const researchCompleteToolCall = mostRecentMessage.tool_calls?.some(
		toolCall => toolCall.name === 'ResearchComplete'
	)

	if (exceededAllowedIterations || noToolCalls || researchCompleteToolCall) {
		return new Command({
			goto: END,
			update: {
				notes: getNotesFromToolCalls(supervisorMessages),
				researchBrief: state.researchBrief
			}
		})
	}

	// Otherwise, conduct research and gather results.
	try {
		const allConductResearchCalls =
			mostRecentMessage.tool_calls?.filter(
				toolCall => toolCall.name === 'ConductResearch'
			) || []

		const conductResearchCalls = allConductResearchCalls.slice(
			0,
			configurable.maxConcurrentResearchUnits
		)
		const overflowConductResearchCalls = allConductResearchCalls.slice(
			configurable.maxConcurrentResearchUnits
		)

		const researchPromises = conductResearchCalls.map(async toolCall => {
			return researcherGraph.invoke(
				{
					researcherMessages: [
						new HumanMessage({
							content: toolCall.args.researchTopic
						})
					],
					researchTopic: toolCall.args.researchTopic,
					toolCallIterations: 0,
					rawNotes: { type: 'override', value: [] }
				},
				config
			)
		})

		const toolResults = await Promise.all(researchPromises)
		const toolMessages: ToolMessage[] = []

		toolResults.forEach((observation, index) => {
			const toolCall = conductResearchCalls[index]

			if (!toolCall.id) {
				throw new Error('Missing tool call ID')
			}

			toolMessages.push(
				new ToolMessage({
					content:
						observation.compressedResearch ||
						'Error synthesizing research report: Maximum retries exceeded',
					name: toolCall.name,
					tool_call_id: toolCall.id
				})
			)
		})

		// Handle any tool calls made > maxConcurrentResearchUnits
		overflowConductResearchCalls.forEach(overflowToolCall => {
			if (!overflowToolCall.id) {
				throw new Error('Missing tool call ID')
			}

			toolMessages.push(
				new ToolMessage({
					content: `Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with ${configurable.maxConcurrentResearchUnits} or fewer research units.`,
					name: 'ConductResearch',
					tool_call_id: overflowToolCall.id
				})
			)
		})

		const rawNotesConcat = toolResults
			.map(observation =>
				getOverrideValue(observation.rawNotes).join('\n')
			)
			.join('\n')

		return new Command({
			goto: 'supervisor',
			update: {
				supervisorMessages: toolMessages,
				rawNotes: [rawNotesConcat]
			}
		})
	} catch (error) {
		if (isTokenLimitExceeded(error, configurable.researchModel)) {
			console.error(`Token limit exceeded while reflecting: ${error}`)
		} else {
			console.error(`Other error in reflection phase: ${error}`)
		}

		return new Command({
			goto: END,
			update: {
				notes: getNotesFromToolCalls(supervisorMessages),
				researchBrief: state.researchBrief
			}
		})
	}
}

const supervisorGraph = new StateGraph(SupervisorAnnotation)
	.addNode('supervisor', supervisor)
	.addNode('supervisorTools', supervisorTools)
	.addEdge(START, 'supervisor')
	.addEdge('supervisor', 'supervisorTools')
	.addEdge('supervisorTools', 'supervisor')
	.addEdge('supervisorTools', END)
	.compile()

export default supervisorGraph
