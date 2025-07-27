import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	BaseMessage,
	isAIMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import { Configuration } from '../configuration.js'
import {
	compressResearchSimpleHumanMessage,
	compressResearchSystemPrompt,
	researchSystemPrompt
} from '../prompts.js'
import { reduceOverrideValue, OverrideValue } from '../state.js'
import {
	getAllTools,
	getApiKeyForModel,
	isTokenLimitExceeded,
	removeUpToLastAIMessage,
	configurableModel,
	messageContentToString,
	splitModel
} from '../utils.js'
import { DynamicStructuredTool } from '@langchain/core/tools.js'

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
	rawNotes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	})
})

const researcher = async (
	state: typeof ResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const researcherMessages = state.researcherMessages
	const tools = await getAllTools()

	const researcherSystemPrompt = researchSystemPrompt({})

	const researchModel = (await configurableModel)
		.bindTools(tools)
		.withRetry({
			stopAfterAttempt: configurable.maxStructuredOutputRetries
		})
		.withConfig({
			configurable: {
				...splitModel(configurable.researchModel),
				maxTokens: configurable.researchModelMaxTokens,
				apiKey: getApiKeyForModel(configurable.researchModel)
			}
		})

	const response = await researchModel.invoke([
		new SystemMessage({ content: researcherSystemPrompt }),
		...researcherMessages
	])

	return new Command({
		goto: 'researcherTools',
		update: {
			researcherMessages: [response],
			toolCallIterations: (state.toolCallIterations || 0) + 1
		}
	})
}

const executeToolSafely = async (
	tool: DynamicStructuredTool,
	args: unknown,
	config: RunnableConfig
) => {
	try {
		const result = await tool.invoke(args, config)

		if (typeof result !== 'string') {
			throw new Error('Tool returned non-string result')
		}

		return result
	} catch (error) {
		return `Error executing tool: ${error}`
	}
}

const researcherTools = async (
	state: typeof ResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const researcherMessages = state.researcherMessages
	const mostRecentMessage = researcherMessages[researcherMessages.length - 1]

	if (!isAIMessage(mostRecentMessage)) {
		throw new Error('Most recent message is not an AI message')
	}

	// Early Exit Criteria: No tool calls were made by the researcher
	if (
		!mostRecentMessage.tool_calls ||
		mostRecentMessage.tool_calls.length === 0
	) {
		return new Command({ goto: 'compressResearch' })
	}

	// Otherwise, execute tools and gather results.
	const tools = await getAllTools()

	const toolsByName = tools.reduce<Record<string, DynamicStructuredTool>>(
		(acc, tool) => {
			acc[tool.name] = tool
			return acc
		},
		{}
	)

	const toolCalls = mostRecentMessage.tool_calls
	const observations = await Promise.all(
		toolCalls.map(toolCall =>
			executeToolSafely(toolsByName[toolCall.name], toolCall.args, config)
		)
	)

	const toolOutputs = observations.map((observation, index) => {
		const toolCall = toolCalls[index]

		if (!toolCall.id) {
			throw new Error('Missing tool call ID')
		}

		return new ToolMessage({
			content: observation,
			name: toolCall.name,
			tool_call_id: toolCall.id
		})
	})

	// Late Exit Criteria
	const exceededToolCallIterations =
		(state.toolCallIterations || 0) >= configurable.maxReactToolCalls
	const researchCompleteToolCall = toolCalls.some(
		toolCall => toolCall.name === 'ResearchComplete'
	)

	if (exceededToolCallIterations || researchCompleteToolCall) {
		return new Command({
			goto: 'compressResearch',
			update: { researcherMessages: toolOutputs }
		})
	}

	return new Command({
		goto: 'researcher',
		update: { researcherMessages: toolOutputs }
	})
}

const compressResearch = async (
	state: typeof ResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	let synthesisAttempts = 0

	const synthesizerModel = (await configurableModel)
		.withConfig({
			configurable: {
				...splitModel(configurable.compressionModel),
				maxTokens: configurable.compressionModelMaxTokens,
				apiKey: getApiKeyForModel(configurable.compressionModel)
			}
		})
		.withRetry({
			stopAfterAttempt: configurable.maxStructuredOutputRetries
		})

	let researcherMessages = [...state.researcherMessages]
	researcherMessages.push(
		new HumanMessage({ content: compressResearchSimpleHumanMessage })
	)

	while (synthesisAttempts < 3) {
		try {
			const response = await synthesizerModel.invoke([
				new SystemMessage({
					content: compressResearchSystemPrompt({})
				}),
				...researcherMessages
			])

			const filteredMessages = researcherMessages.filter(
				msg => msg.getType() === 'tool' || msg.getType() === 'ai'
			)

			return {
				compressedResearch: messageContentToString(response.content),
				rawNotes: {
					type: 'override',
					value: [
						filteredMessages
							.map(m => messageContentToString(m.content))
							.join('\n')
					]
				}
			}
		} catch (error) {
			synthesisAttempts += 1
			if (isTokenLimitExceeded(error, configurable.researchModel)) {
				researcherMessages = removeUpToLastAIMessage(researcherMessages)
				console.error(
					`Token limit exceeded while synthesizing: ${error}. Pruning the messages to try again.`
				)
				continue
			}
			console.error(`Error synthesizing research report: ${error}`)
		}
	}

	const filteredMessages = researcherMessages.filter(
		msg => msg.getType() === 'tool' || msg.getType() === 'ai'
	)

	return {
		compressedResearch:
			'Error synthesizing research report: Maximum retries exceeded',
		rawNotes: {
			type: 'override',
			value: [
				filteredMessages
					.map(m => messageContentToString(m.content))
					.join('\n')
			]
		}
	}
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
