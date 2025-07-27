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
	messageContentToString
} from '../utils.js'
import { DynamicStructuredTool } from '@langchain/core/tools.js'

const ResearcherAnnotation = Annotation.Root({
	researcher_messages: Annotation<BaseMessage[]>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	tool_call_iterations: Annotation<number>({
		reducer: (_current, update) => update,
		default: () => 0
	}),
	research_topic: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	compressed_research: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	raw_notes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	})
})

const researcher = async (
	state: typeof ResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const researcherMessages = state.researcher_messages
	const tools = await getAllTools()

	const researcherSystemPrompt = researchSystemPrompt({})

	const researchModel = (await configurableModel)
		.bindTools(tools)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.withConfig({
			configurable: {
				model: configurable.research_model,
				maxTokens: configurable.research_model_max_tokens,
				apiKey: getApiKeyForModel(configurable.research_model)
			}
		})

	const response = await researchModel.invoke([
		new SystemMessage({ content: researcherSystemPrompt }),
		...researcherMessages
	])

	return new Command({
		goto: 'researcher_tools',
		update: {
			researcher_messages: [response],
			tool_call_iterations: (state.tool_call_iterations || 0) + 1
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
	const researcherMessages = state.researcher_messages
	const mostRecentMessage = researcherMessages[researcherMessages.length - 1]

	if (!isAIMessage(mostRecentMessage)) {
		throw new Error('Most recent message is not an AI message')
	}

	// Early Exit Criteria: No tool calls were made by the researcher
	if (
		!mostRecentMessage.tool_calls ||
		mostRecentMessage.tool_calls.length === 0
	) {
		return new Command({ goto: 'compress_research' })
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
		(state.tool_call_iterations || 0) >= configurable.max_react_tool_calls
	const researchCompleteToolCall = toolCalls.some(
		toolCall => toolCall.name === 'ResearchComplete'
	)

	if (exceededToolCallIterations || researchCompleteToolCall) {
		return new Command({
			goto: 'compress_research',
			update: { researcher_messages: toolOutputs }
		})
	}

	return new Command({
		goto: 'researcher',
		update: { researcher_messages: toolOutputs }
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
				model: configurable.compression_model,
				maxTokens: configurable.compression_model_max_tokens,
				apiKey: getApiKeyForModel(configurable.compression_model)
			}
		})
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})

	let researcherMessages = [...state.researcher_messages]
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
				compressed_research: messageContentToString(response.content),
				raw_notes: {
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
			if (isTokenLimitExceeded(error, configurable.research_model)) {
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
		compressed_research:
			'Error synthesizing research report: Maximum retries exceeded',
		raw_notes: {
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
	.addNode('researcher_tools', researcherTools)
	.addNode('compress_research', compressResearch)
	.addEdge(START, 'researcher')
	.addEdge('researcher', 'researcher_tools')
	.addEdge('researcher_tools', 'compress_research')
	.addEdge('researcher_tools', 'researcher')
	.addEdge('compress_research', END)
	.compile()

export default researcherGraph
