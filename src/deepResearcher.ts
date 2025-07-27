import { initChatModel } from 'langchain/chat_models/universal'
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	BaseMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'

import { Configuration } from './configuration.js'
import {
	clarifyWithUserInstructions,
	compressResearchSimpleHumanMessage,
	compressResearchSystemPrompt,
	finalReportGenerationPrompt,
	leadResearcherPrompt,
	researchSystemPrompt,
	transformMessagesIntoResearchTopicPrompt
} from './prompts.js'
import {
	AgentInputState,
	AgentState,
	ClarifyWithUser,
	ClarifyWithUserSchema,
	ConductResearch,
	ConductResearchSchema,
	ResearchComplete,
	ResearchCompleteSchema,
	ResearcherOutputState,
	ResearcherState,
	ResearchQuestion,
	ResearchQuestionSchema,
	SupervisorState
} from './state.js'
import {
	getAllTools,
	getApiKeyForModel,
	getModelTokenLimit,
	getNotesFromToolCalls,
	getTodayStr,
	isTokenLimitExceeded,
	removeUpToLastAIMessage,
	getBufferString
} from './utils.js'

// Initialize a configurable model that we will use throughout the agent
const configurableModel = initChatModel(undefined, {
	configurableFields: ['model', 'maxTokens', 'apiKey']
})

export async function clarifyWithUser(
	state: AgentState,
	config: RunnableConfig
): Promise<Command<'write_research_brief' | '__end__'>> {
	const configurable = Configuration.fromRunnableConfig(config)
	if (!configurable.allow_clarification) {
		return new Command('write_research_brief', {})
	}

	const messages = state.messages
	const modelConfig = {
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model, config)
	}

	const model = configurableModel
		.withStructuredOutput(ClarifyWithUserSchema)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.bind(modelConfig)

	const response = await model.invoke([
		new HumanMessage({
			content: clarifyWithUserInstructions
				.replace('{messages}', getBufferString(messages))
				.replace('{date}', getTodayStr())
		})
	])

	if (response.need_clarification) {
		return new Command('__end__', {
			messages: [new AIMessage({ content: response.question })]
		})
	} else {
		return new Command('write_research_brief', {
			messages: [new AIMessage({ content: response.verification })]
		})
	}
}

export async function writeResearchBrief(
	state: AgentState,
	config: RunnableConfig
): Promise<Command<'research_supervisor'>> {
	const configurable = Configuration.fromRunnableConfig(config)
	const researchModelConfig = {
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model, config)
	}

	const researchModel = configurableModel
		.withStructuredOutput(ResearchQuestionSchema)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.bind(researchModelConfig)

	const response = await researchModel.invoke([
		new HumanMessage({
			content: transformMessagesIntoResearchTopicPrompt
				.replace('{messages}', getBufferString(state.messages || []))
				.replace('{date}', getTodayStr())
		})
	])

	return new Command('research_supervisor', {
		research_brief: response.research_brief,
		supervisor_messages: {
			type: 'override',
			value: [
				new SystemMessage({
					content: leadResearcherPrompt
						.replace('{date}', getTodayStr())
						.replace(
							'{max_concurrent_research_units}',
							configurable.max_concurrent_research_units.toString()
						)
				}),
				new HumanMessage({ content: response.research_brief })
			]
		}
	})
}

export async function supervisor(
	state: SupervisorState,
	config: RunnableConfig
): Promise<Command<'supervisor_tools'>> {
	const configurable = Configuration.fromRunnableConfig(config)
	const researchModelConfig = {
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model, config)
	}

	const leadResearcherTools = [ConductResearchSchema, ResearchCompleteSchema]
	const researchModel = configurableModel
		.bindTools(leadResearcherTools)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.bind(researchModelConfig)

	const supervisorMessages = state.supervisor_messages
	const response = await researchModel.invoke(supervisorMessages)

	return new Command('supervisor_tools', {
		supervisor_messages: [response],
		research_iterations: (state.research_iterations || 0) + 1
	})
}

export async function supervisorTools(
	state: SupervisorState,
	config: RunnableConfig
): Promise<Command<'supervisor' | '__end__'>> {
	const configurable = Configuration.fromRunnableConfig(config)
	const supervisorMessages = state.supervisor_messages
	const researchIterations = state.research_iterations || 0
	const mostRecentMessage = supervisorMessages[
		supervisorMessages.length - 1
	] as AIMessage

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
		return new Command('__end__', {
			notes: getNotesFromToolCalls(supervisorMessages),
			research_brief: state.research_brief
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
			return researcherSubgraph.invoke(
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
			toolMessages.push(
				new ToolMessage({
					content: `Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with ${configurable.max_concurrent_research_units} or fewer research units.`,
					name: 'ConductResearch',
					tool_call_id: overflowToolCall.id
				})
			)
		})

		const rawNotesConcat = toolResults
			.map(observation => observation.raw_notes?.join('\n') || '')
			.join('\n')

		return new Command('supervisor', {
			supervisor_messages: toolMessages,
			raw_notes: [rawNotesConcat]
		})
	} catch (error) {
		if (isTokenLimitExceeded(error as Error, configurable.research_model)) {
			console.error(`Token limit exceeded while reflecting: ${error}`)
		} else {
			console.error(`Other error in reflection phase: ${error}`)
		}

		return new Command('__end__', {
			notes: getNotesFromToolCalls(supervisorMessages),
			research_brief: state.research_brief
		})
	}
}

export async function researcher(
	state: ResearcherState,
	config: RunnableConfig
): Promise<Command<'researcher_tools'>> {
	const configurable = Configuration.fromRunnableConfig(config)
	const researcherMessages = state.researcher_messages
	const tools = await getAllTools(config)

	if (tools.length === 0) {
		throw new Error(
			'No tools found to conduct research: Please configure either your search API or add MCP tools to your configuration.'
		)
	}

	const researchModelConfig = {
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model, config)
	}

	const researcherSystemPrompt = researchSystemPrompt
		.replace('{mcp_prompt}', configurable.mcp_prompt || '')
		.replace('{date}', getTodayStr())

	const researchModel = configurableModel
		.bindTools(tools)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.bind(researchModelConfig)

	const response = await researchModel.invoke([
		new SystemMessage({ content: researcherSystemPrompt }),
		...researcherMessages
	])

	return new Command('researcher_tools', {
		researcher_messages: [response],
		tool_call_iterations: (state.tool_call_iterations || 0) + 1
	})
}

export async function executeToolSafely(
	tool: any,
	args: any,
	config: RunnableConfig
): Promise<string> {
	try {
		return await tool.invoke(args, config)
	} catch (error) {
		return `Error executing tool: ${error}`
	}
}

export async function researcherTools(
	state: ResearcherState,
	config: RunnableConfig
): Promise<Command<'researcher' | 'compress_research'>> {
	const configurable = Configuration.fromRunnableConfig(config)
	const researcherMessages = state.researcher_messages
	const mostRecentMessage = researcherMessages[
		researcherMessages.length - 1
	] as AIMessage

	// Early Exit Criteria: No tool calls were made by the researcher
	if (
		!mostRecentMessage.tool_calls ||
		mostRecentMessage.tool_calls.length === 0
	) {
		return new Command('compress_research', {})
	}

	// Otherwise, execute tools and gather results.
	const tools = await getAllTools(config)
	const toolsByName = tools.reduce((acc, tool) => {
		acc[tool.name] = tool
		return acc
	}, {} as Record<string, any>)

	const toolCalls = mostRecentMessage.tool_calls
	const observations = await Promise.all(
		toolCalls.map(toolCall =>
			executeToolSafely(toolsByName[toolCall.name], toolCall.args, config)
		)
	)

	const toolOutputs = observations.map((observation, index) => {
		const toolCall = toolCalls[index]
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
		return new Command('compress_research', {
			researcher_messages: toolOutputs
		})
	}

	return new Command('researcher', {
		researcher_messages: toolOutputs
	})
}

export async function compressResearch(
	state: ResearcherState,
	config: RunnableConfig
): Promise<ResearcherOutputState> {
	const configurable = Configuration.fromRunnableConfig(config)
	let synthesisAttempts = 0

	const synthesizerModel = configurableModel.bind({
		model: configurable.compression_model,
		maxTokens: configurable.compression_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.compression_model, config)
	})

	let researcherMessages = [...state.researcher_messages]
	researcherMessages.push(
		new HumanMessage({ content: compressResearchSimpleHumanMessage })
	)

	while (synthesisAttempts < 3) {
		try {
			const response = await synthesizerModel.invoke([
				new SystemMessage({
					content: compressResearchSystemPrompt.replace(
						'{date}',
						getTodayStr()
					)
				}),
				...researcherMessages
			])

			const filteredMessages = researcherMessages.filter(
				msg => msg.getType() === 'tool' || msg.getType() === 'ai'
			)

			return {
				compressed_research: response.content as string,
				raw_notes: {
					type: 'override',
					value: [
						filteredMessages
							.map(m => m.content as string)
							.join('\n')
					]
				}
			}
		} catch (error) {
			synthesisAttempts += 1
			if (
				isTokenLimitExceeded(
					error as Error,
					configurable.research_model
				)
			) {
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
			value: [filteredMessages.map(m => m.content as string).join('\n')]
		}
	}
}

export async function finalReportGeneration(
	state: AgentState,
	config: RunnableConfig
): Promise<Partial<AgentState>> {
	const notes = state.notes || []
	const clearedState = { notes: { type: 'override' as const, value: [] } }
	const configurable = Configuration.fromRunnableConfig(config)

	const writerModelConfig = {
		model: configurable.final_report_model,
		maxTokens: configurable.final_report_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model, config)
	}

	let findings = notes.join('\n')
	const maxRetries = 3
	let currentRetry = 0

	while (currentRetry <= maxRetries) {
		const finalReportPrompt = finalReportGenerationPrompt
			.replace('{research_brief}', state.research_brief || '')
			.replace('{messages}', getBufferString(state.messages || []))
			.replace('{findings}', findings)
			.replace('{date}', getTodayStr())

		try {
			const finalReport = await configurableModel
				.bind(writerModelConfig)
				.invoke([new HumanMessage({ content: finalReportPrompt })])

			return {
				final_report: finalReport.content as string,
				messages: [finalReport],
				...clearedState
			}
		} catch (error) {
			if (
				isTokenLimitExceeded(
					error as Error,
					configurable.final_report_model
				)
			) {
				if (currentRetry === 0) {
					const modelTokenLimit = getModelTokenLimit(
						configurable.final_report_model
					)
					if (!modelTokenLimit) {
						return {
							final_report: `Error generating final report: Token limit exceeded, however, we could not determine the model's maximum context length. Please update the model map in deepResearcher/utils.ts with this information. ${error}`,
							...clearedState
						}
					}
					let findingsTokenLimit = modelTokenLimit * 4
					findings = findings.slice(0, findingsTokenLimit)
				} else {
					const findingsTokenLimit = Math.floor(findings.length * 0.9)
					findings = findings.slice(0, findingsTokenLimit)
				}
				console.log('Reducing the chars to', findings.length)
				currentRetry += 1
			} else {
				return {
					final_report: `Error generating final report: ${error}`,
					...clearedState
				}
			}
		}
	}

	return {
		final_report: 'Error generating final report: Maximum retries exceeded',
		...clearedState
	}
}

// Create researcher subgraph
const researcherBuilder = new StateGraph<
	ResearcherState,
	ResearcherOutputState
>({
	channels: {
		researcher_messages: {
			value: (current: BaseMessage[], update: BaseMessage[]) => [
				...current,
				...update
			],
			default: () => []
		},
		tool_call_iterations: {
			value: (current: number, update: number) => update,
			default: () => 0
		},
		research_topic: {
			value: (current: string, update: string) => update,
			default: () => ''
		},
		compressed_research: {
			value: (current: string, update: string) => update,
			default: () => ''
		},
		raw_notes: {
			value: (current: string[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		}
	}
})

researcherBuilder.addNode('researcher', researcher)
researcherBuilder.addNode('researcher_tools', researcherTools)
researcherBuilder.addNode('compress_research', compressResearch)
researcherBuilder.addEdge(START, 'researcher')
researcherBuilder.addEdge('compress_research', END)

const researcherSubgraph = researcherBuilder.compile()

// Create supervisor subgraph
const supervisorBuilder = new StateGraph<SupervisorState>({
	channels: {
		supervisor_messages: {
			value: (current: BaseMessage[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		},
		research_brief: {
			value: (current: string, update: string) => update,
			default: () => ''
		},
		notes: {
			value: (current: string[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		},
		research_iterations: {
			value: (current: number, update: number) => update,
			default: () => 0
		},
		raw_notes: {
			value: (current: string[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		}
	}
})

supervisorBuilder.addNode('supervisor', supervisor)
supervisorBuilder.addNode('supervisor_tools', supervisorTools)
supervisorBuilder.addEdge(START, 'supervisor')

const supervisorSubgraph = supervisorBuilder.compile()

// Create main deep researcher graph
const deepResearcherBuilder = new StateGraph<AgentState, AgentInputState>({
	channels: {
		messages: {
			value: (current: BaseMessage[], update: BaseMessage[]) => [
				...current,
				...update
			],
			default: () => []
		},
		supervisor_messages: {
			value: (current: BaseMessage[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		},
		research_brief: {
			value: (current: string, update: string) => update,
			default: () => ''
		},
		raw_notes: {
			value: (current: string[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		},
		notes: {
			value: (current: string[], update: any) => {
				if (
					typeof update === 'object' &&
					update !== null &&
					'type' in update &&
					update.type === 'override'
				) {
					return update.value
				} else {
					return [...current, ...update]
				}
			},
			default: () => []
		},
		final_report: {
			value: (current: string, update: string) => update,
			default: () => ''
		}
	}
})

deepResearcherBuilder.addNode('clarify_with_user', clarifyWithUser)
deepResearcherBuilder.addNode('write_research_brief', writeResearchBrief)
deepResearcherBuilder.addNode('research_supervisor', supervisorSubgraph)
deepResearcherBuilder.addNode('final_report_generation', finalReportGeneration)
deepResearcherBuilder.addEdge(START, 'clarify_with_user')
deepResearcherBuilder.addEdge('research_supervisor', 'final_report_generation')
deepResearcherBuilder.addEdge('final_report_generation', END)

export const deepResearcher = deepResearcherBuilder.compile()
