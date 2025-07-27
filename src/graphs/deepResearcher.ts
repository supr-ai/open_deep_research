import { initChatModel } from 'langchain/chat_models/universal'
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	BaseMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'

import { Configuration } from '../configuration.js'
import {
	clarifyWithUserInstructions,
	compressResearchSimpleHumanMessage,
	compressResearchSystemPrompt,
	finalReportGenerationPrompt,
	leadResearcherPrompt,
	researchSystemPrompt,
	transformMessagesIntoResearchTopicPrompt
} from '../prompts.js'
import {
	AgentInputState,
	AgentState,
	ClarifyWithUser,
	ClarifyWithUserSchema,
	ConductResearch,
	ConductResearchSchema,
	getOverrideValue,
	reduceOverrideValue,
	OverrideValue,
	ResearchComplete,
	ResearchCompleteSchema,
	ResearcherOutputState,
	ResearcherState,
	ResearchQuestion,
	ResearchQuestionSchema,
	SupervisorState
} from '../state.js'
import {
	getAllTools,
	getApiKeyForModel,
	getNotesFromToolCalls,
	isTokenLimitExceeded,
	removeUpToLastAIMessage,
	getBufferString,
	configurableModel,
	MODEL_TOKEN_LIMITS,
	messageContentToString
} from '../utils.js'
import supervisorGraph from './supervisor.js'

const DeepResearcherAnnotation = Annotation.Root({
	messages: Annotation<BaseMessage[]>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	supervisor_messages: Annotation<OverrideValue<BaseMessage[]>>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	research_brief: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	raw_notes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	notes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	final_report: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	})
})

const clarifyWithUser = async (
	state: typeof DeepResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	if (!configurable.allow_clarification) {
		return new Command({ goto: 'write_research_brief' })
	}

	const messages = state.messages
	const modelConfig = {
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model)
	}

	const model = (await configurableModel)
		.withStructuredOutput(ClarifyWithUserSchema)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.withConfig({ configurable: modelConfig })

	const response = await model.invoke([
		new HumanMessage({
			content: clarifyWithUserInstructions({ messages })
		})
	])

	if (response.need_clarification) {
		return new Command({
			goto: END,
			update: {
				messages: [new AIMessage({ content: response.question })]
			}
		})
	} else {
		return new Command({
			goto: 'write_research_brief',
			update: {
				messages: [new AIMessage({ content: response.verification })]
			}
		})
	}
}

const writeResearchBrief = async (
	state: typeof DeepResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const configurable = Configuration.fromRunnableConfig(config)
	const researchModelConfig = {
		model: configurable.research_model,
		maxTokens: configurable.research_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model)
	}

	const researchModel = (await configurableModel)
		.withStructuredOutput(ResearchQuestionSchema)
		.withRetry({
			stopAfterAttempt: configurable.max_structured_output_retries
		})
		.withConfig({ configurable: researchModelConfig })

	const response = await researchModel.invoke([
		new HumanMessage({
			content: transformMessagesIntoResearchTopicPrompt({
				messages: state.messages || []
			})
		})
	])

	return new Command({
		goto: 'research_supervisor',
		update: {
			research_brief: response.research_brief,
			supervisor_messages: {
				type: 'override',
				value: [
					new SystemMessage({
						content: leadResearcherPrompt({
							maxConcurrentResearchUnits:
								configurable.max_concurrent_research_units
						})
					}),
					new HumanMessage({ content: response.research_brief })
				]
			}
		}
	})
}

const finalReportGeneration = async (
	state: typeof DeepResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const clearedState = { notes: { type: 'override' as const, value: [] } }
	const configurable = Configuration.fromRunnableConfig(config)

	const writerModelConfig = {
		model: configurable.final_report_model,
		maxTokens: configurable.final_report_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model)
	}

	let findings = getOverrideValue(state.notes).join('\n')
	const maxRetries = 3
	let currentRetry = 0

	while (currentRetry <= maxRetries) {
		const finalReportPrompt = finalReportGenerationPrompt({
			researchBrief: state.research_brief,
			messages: state.messages,
			findings
		})

		try {
			const finalReport = await (await configurableModel)
				.withConfig({ configurable: writerModelConfig })
				.invoke([new HumanMessage({ content: finalReportPrompt })])

			return {
				final_report: messageContentToString(finalReport.content),
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
					const modelTokenLimit =
						MODEL_TOKEN_LIMITS[configurable.final_report_model]
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

const deepResearcherGraph = new StateGraph(DeepResearcherAnnotation)
	.addNode('clarify_with_user', clarifyWithUser)
	.addNode('write_research_brief', writeResearchBrief)
	.addNode('research_supervisor', supervisorGraph)
	.addNode('final_report_generation', finalReportGeneration)
	.addEdge(START, 'clarify_with_user')
	.addEdge('research_supervisor', 'final_report_generation')
	.addEdge('final_report_generation', END)
	.compile()

export default deepResearcherGraph
