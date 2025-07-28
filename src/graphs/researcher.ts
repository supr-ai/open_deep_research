import {
	HumanMessage,
	SystemMessage,
	ToolMessage,
	BaseMessage,
	isAIMessage,
	isToolMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import {
	compressResearchSimpleHumanMessage,
	compressResearchSystemPrompt,
	researchSystemPrompt
} from '../lib/prompts.js'
import {
	reduceOverrideValue,
	OptionalOverrideValue
} from '../lib/overrideValue.js'
import messageContentToString from '../lib/messageContentToString.js'
import { researchOptionsFromRunnableConfig } from '../lib/options.js'
import tools, { toolsByName } from '../tools/index.js'
import { getChatModel } from '../lib/model.js'
import runToolSafely from '../lib/runToolSafely.js'
import isTokenLimitExceeded from '../lib/isTokenLimitExceeded.js'
import removeAfterLastAiMessage from '../lib/removeAfterLastAiMessage.js'
import researchCompleteTool from '../tools/researchComplete.js'

const ResearcherAnnotation = Annotation.Root({
	researcherMessages: Annotation<BaseMessage[]>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	toolCallIterations: Annotation<number>({
		reducer: (_current, update) => update,
		default: () => 0
	}),
	researchTopic: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	compressedResearch: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	rawNotes: Annotation<OptionalOverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	})
})

type ResearcherNodeHandler = (
	state: typeof ResearcherAnnotation.State,
	config: RunnableConfig
) => Promise<
	Command<
		'researcher' | 'researcherTools' | 'compressResearch' | typeof END,
		Partial<typeof ResearcherAnnotation.State>
	>
>

const researcher: ResearcherNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	const response = await getChatModel(options.researchModel)
		.bindTools(tools)
		.withRetry({
			stopAfterAttempt: options.maxStructuredOutputRetries
		})
		.invoke([
			new SystemMessage({ content: researchSystemPrompt({}) }),
			...state.researcherMessages
		])

	return new Command({
		goto: 'researcherTools',
		update: {
			researcherMessages: [response],
			toolCallIterations: state.toolCallIterations + 1
		}
	})
}

const researcherTools: ResearcherNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	const lastMessage = state.researcherMessages.at(-1)
	if (!lastMessage) throw new Error('No messages in state')

	if (!isAIMessage(lastMessage))
		throw new Error('Most recent message is not an AI message')

	// No tool calls were made by the researcher

	const toolCalls = lastMessage.tool_calls
	if (!toolCalls?.length) return new Command({ goto: 'compressResearch' })

	// Otherwise, execute tools and gather results.

	const observations = await Promise.all(
		toolCalls.map(toolCall =>
			runToolSafely(toolsByName[toolCall.name], toolCall.args, config)
		)
	)

	const toolOutputs = observations.map((observation, index) => {
		const toolCall = toolCalls[index]
		if (!toolCall.id) throw new Error('Missing tool call ID')

		return new ToolMessage({
			tool_call_id: toolCall.id,
			name: toolCall.name,
			content: observation
		})
	})

	const didExceedToolCallIterations =
		state.toolCallIterations >= options.maxReactToolCalls

	const didCallResearchCompleteTool = toolCalls.some(
		toolCall => toolCall.name === researchCompleteTool.name
	)

	return new Command({
		goto:
			didExceedToolCallIterations || didCallResearchCompleteTool
				? 'compressResearch'
				: 'researcher',
		update: {
			researcherMessages: toolOutputs
		}
	})
}

const compressResearch: ResearcherNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	const model = getChatModel(options.compressionModel).withRetry({
		stopAfterAttempt: options.maxStructuredOutputRetries
	})

	let researcherMessages = [
		...state.researcherMessages,
		new HumanMessage({ content: compressResearchSimpleHumanMessage })
	]

	const getNote = () =>
		researcherMessages
			.filter(message => isToolMessage(message) || isAIMessage(message))
			.map(message => messageContentToString(message.content))
			.join('\n')

	for (let synthesisAttempt = 0; synthesisAttempt < 3; synthesisAttempt++) {
		try {
			const response = await model.invoke([
				new SystemMessage({
					content: compressResearchSystemPrompt({})
				}),
				...researcherMessages
			])

			return new Command({
				goto: END,
				update: {
					compressedResearch: messageContentToString(
						response.content
					),
					rawNotes: {
						type: 'override',
						value: [getNote()]
					}
				}
			})
		} catch (error) {
			if (
				error instanceof Error &&
				isTokenLimitExceeded(error, options.compressionModel)
			) {
				researcherMessages =
					removeAfterLastAiMessage(researcherMessages)

				console.error(
					`Token limit exceeded while synthesizing: ${error}. Pruning the messages to try again.`
				)
			} else {
				console.error(`Error synthesizing research report: ${error}`)
			}
		}
	}

	return new Command({
		goto: END,
		update: {
			compressedResearch:
				'Error synthesizing research report: Maximum retries exceeded',
			rawNotes: {
				type: 'override',
				value: [getNote()]
			}
		}
	})
}

const researcherGraph = new StateGraph(ResearcherAnnotation)
	.addNode('researcher', researcher)
	.addNode('researcherTools', researcherTools)
	.addNode('compressResearch', compressResearch)
	.addEdge(START, 'researcher')
	.addEdge('researcher', 'researcherTools')
	.addEdge('researcherTools', 'compressResearch')
	.addEdge('researcherTools', 'researcher')
	.addEdge('compressResearch', END)
	.compile()

export default researcherGraph
