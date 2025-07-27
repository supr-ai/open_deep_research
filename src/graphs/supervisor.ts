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
import { Configuration } from '../configuration.js'
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
	configurableModel
} from '../utils.js'
import researcherGraph from './researcher.js'

const SupervisorAnnotation = Annotation.Root({
	supervisor_messages: Annotation<OverrideValue<BaseMessage[]>>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	research_brief: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	notes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	research_iterations: Annotation<number>({
		reducer: (_current, update) => update,
		default: () => 0
	}),
	raw_notes: Annotation<OverrideValue<string[]>>({
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
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model)
	}

	const leadResearcherTools = [ConductResearchSchema, ResearchCompleteSchema]
	const researchModel = (await configurableModel)
		.bindTools(leadResearcherTools)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.withConfig({ configurable: researchModelConfig })

	const supervisorMessages = getOverrideValue(state.supervisor_messages)
	const response = await researchModel.invoke(supervisorMessages)

	return new Command({
		goto: 'supervisor_tools',
		update: {
			supervisor_messages: [response],
			research_iterations: (state.research_iterations || 0) + 1
		}
	})
}

const supervisorTools = async (
	state: typeof SupervisorAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const supervisorMessages = getOverrideValue(state.supervisor_messages)
	const researchIterations = state.research_iterations || 0
	const mostRecentMessage = supervisorMessages[supervisorMessages.length - 1]

	if (!isAIMessage(mostRecentMessage)) {
		throw new Error('Most recent message is not an AI message')
	}

	// Exit Criteria
	const exceededAllowedIterations =
		researchIterations >= configurable.max_researcher_iterations
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
				research_brief: state.research_brief
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
			configurable.max_concurrent_research_units
		)
		const overflowConductResearchCalls = allConductResearchCalls.slice(
			configurable.max_concurrent_research_units
		)

		const researchPromises = conductResearchCalls.map(async toolCall => {
			return researcherGraph.invoke(
				{
					researcher_messages: [
						new HumanMessage({
							content: toolCall.args.research_topic
						})
					],
					research_topic: toolCall.args.research_topic,
					tool_call_iterations: 0,
					raw_notes: { type: 'override', value: [] }
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
						observation.compressed_research ||
						'Error synthesizing research report: Maximum retries exceeded',
					name: toolCall.name,
					tool_call_id: toolCall.id
				})
			)
		})

		// Handle any tool calls made > max_concurrent_research_units
		overflowConductResearchCalls.forEach(overflowToolCall => {
			if (!overflowToolCall.id) {
				throw new Error('Missing tool call ID')
			}

			toolMessages.push(
				new ToolMessage({
					content: `Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with ${configurable.max_concurrent_research_units} or fewer research units.`,
					name: 'ConductResearch',
					tool_call_id: overflowToolCall.id
				})
			)
		})

		const rawNotesConcat = toolResults
			.map(observation =>
				getOverrideValue(observation.raw_notes).join('\n')
			)
			.join('\n')

		return new Command({
			goto: 'supervisor',
			update: {
				supervisor_messages: toolMessages,
				raw_notes: [rawNotesConcat]
			}
		})
	} catch (error) {
		if (isTokenLimitExceeded(error, configurable.research_model)) {
			console.error(`Token limit exceeded while reflecting: ${error}`)
		} else {
			console.error(`Other error in reflection phase: ${error}`)
		}

		return new Command({
			goto: END,
			update: {
				notes: getNotesFromToolCalls(supervisorMessages),
				research_brief: state.research_brief
			}
		})
	}
}

const supervisorGraph = new StateGraph(SupervisorAnnotation)
	.addNode('supervisor', supervisor)
	.addNode('supervisor_tools', supervisorTools)
	.addEdge(START, 'supervisor')
	.addEdge('supervisor', 'supervisor_tools')
	.addEdge('supervisor_tools', 'supervisor')
	.addEdge('supervisor_tools', END)
	.compile()

export default supervisorGraph
