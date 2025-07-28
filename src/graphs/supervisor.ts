import {
	HumanMessage,
	ToolMessage,
	BaseMessage,
	isAIMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import isTokenLimitExceeded from '../lib/isTokenLimitExceeded.js'
import researcherGraph from './researcher.js'
import {
	getOverrideValue,
	OptionalOverrideValue,
	reduceOverrideValue
} from '../lib/overrideValue.js'
import { z } from 'zod'
import researchCompleteTool, {
	ResearchCompleteSchema
} from '../tools/researchComplete.js'
import { researchOptionsFromRunnableConfig } from '../lib/options.js'
import { getChatModel } from '../lib/model.js'
import getNotesFromToolCalls from '../lib/getNotesFromToolCalls.js'
import conductResearchTool, {
	ConductResearchSchema
} from '../tools/conductResearch.js'

const SupervisorAnnotation = Annotation.Root({
	supervisorMessages: Annotation<OptionalOverrideValue<BaseMessage[]>>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	researchBrief: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	notes: Annotation<OptionalOverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	researchIterations: Annotation<number>({
		reducer: (_current, update) => update,
		default: () => 0
	}),
	rawNotes: Annotation<OptionalOverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	})
})

type SupervisorNodeHandler = (
	state: typeof SupervisorAnnotation.State,
	config: RunnableConfig
) => Promise<
	Command<
		'supervisor' | 'supervisorTools' | typeof END,
		Partial<typeof SupervisorAnnotation.State>
	>
>

const supervisor: SupervisorNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	const response = await getChatModel(options.researchModel)
		.bindTools([conductResearchTool, researchCompleteTool])
		.withRetry({
			stopAfterAttempt: options.maxStructuredOutputRetries
		})
		.invoke(getOverrideValue(state.supervisorMessages))

	return new Command({
		goto: 'supervisorTools',
		update: {
			supervisorMessages: [response],
			researchIterations: state.researchIterations + 1
		}
	})
}

const supervisorTools: SupervisorNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	const supervisorMessages = getOverrideValue(state.supervisorMessages)

	const lastMessage = supervisorMessages.at(-1)
	if (!lastMessage) throw new Error('No messages in supervisorMessages')

	if (!isAIMessage(lastMessage))
		throw new Error('Last message is not an AI message')

	const toolCalls = lastMessage.tool_calls

	if (
		state.researchIterations >= options.maxResearcherIterations ||
		!toolCalls?.length ||
		toolCalls.some(toolCall => toolCall.name === researchCompleteTool.name)
	) {
		return new Command({
			goto: END,
			update: {
				notes: getNotesFromToolCalls(supervisorMessages),
				researchBrief: state.researchBrief
			}
		})
	}

	try {
		const allConductResearchCalls = toolCalls.filter(
			toolCall => toolCall.name === conductResearchTool.name
		)

		const conductResearchCalls = allConductResearchCalls.slice(
			0,
			options.maxConcurrentResearchUnits
		)

		const overflowConductResearchCalls = allConductResearchCalls.slice(
			options.maxConcurrentResearchUnits
		)

		const toolResults = await Promise.all(
			conductResearchCalls.map(async toolCall => {
				const { researchTopic } = ConductResearchSchema.parse(
					toolCall.args
				)

				return researcherGraph.invoke(
					{
						researcherMessages: [
							new HumanMessage({ content: researchTopic })
						],
						researchTopic,
						toolCallIterations: 0,
						rawNotes: { type: 'override', value: [] }
					},
					config
				)
			})
		)

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

		for (const overflowToolCall of overflowConductResearchCalls) {
			if (!overflowToolCall.id) {
				throw new Error('Missing tool call ID')
			}

			toolMessages.push(
				new ToolMessage({
					content: `Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with ${options.maxConcurrentResearchUnits} or fewer research units.`,
					name: overflowToolCall.name,
					tool_call_id: overflowToolCall.id
				})
			)
		}

		const joinedRawNotes = toolResults
			.map(observation =>
				getOverrideValue(observation.rawNotes).join('\n')
			)
			.join('\n')

		return new Command({
			goto: 'supervisor',
			update: {
				supervisorMessages: toolMessages,
				rawNotes: [joinedRawNotes]
			}
		})
	} catch (error) {
		if (
			error instanceof Error &&
			isTokenLimitExceeded(error, options.researchModel)
		) {
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
