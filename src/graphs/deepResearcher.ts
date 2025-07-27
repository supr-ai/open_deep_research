import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	BaseMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import { Configuration } from '../configuration.js'
import {
	clarifyWithUserInstructions,
	generateFinalReportPrompt,
	leadResearcherPrompt,
	transformMessagesIntoResearchTopicPrompt
} from '../prompts.js'
import {
	ClarifyWithUserSchema,
	getOverrideValue,
	reduceOverrideValue,
	OverrideValue,
	ResearchQuestionSchema
} from '../state.js'
import {
	getApiKeyForModel,
	isTokenLimitExceeded,
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
	supervisorMessages: Annotation<OverrideValue<BaseMessage[]>>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	researchBrief: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	rawNotes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	notes: Annotation<OverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	finalReport: Annotation<string>({
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
		return new Command({ goto: 'write_researchBrief' })
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
			goto: 'write_researchBrief',
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
		goto: 'researchSupervisor',
		update: {
			researchBrief: response.researchBrief,
			supervisorMessages: {
				type: 'override',
				value: [
					new SystemMessage({
						content: leadResearcherPrompt({
							maxConcurrentResearchUnits:
								configurable.max_concurrent_research_units
						})
					}),
					new HumanMessage({ content: response.researchBrief })
				]
			}
		}
	})
}

const generateFinalReport = async (
	state: typeof DeepResearcherAnnotation.State,
	config: RunnableConfig
) => {
	const clearedState = { notes: { type: 'override' as const, value: [] } }
	const configurable = Configuration.fromRunnableConfig(config)

	const writerModelConfig = {
		model: configurable.finalReport_model,
		maxTokens: configurable.finalReport_model_max_tokens,
		apiKey: getApiKeyForModel(configurable.research_model)
	}

	let findings = getOverrideValue(state.notes).join('\n')
	const maxRetries = 3
	let currentRetry = 0

	while (currentRetry <= maxRetries) {
		const finalReportPrompt = generateFinalReportPrompt({
			researchBrief: state.researchBrief,
			messages: state.messages,
			findings
		})

		try {
			const finalReport = await (await configurableModel)
				.withConfig({ configurable: writerModelConfig })
				.invoke([new HumanMessage({ content: finalReportPrompt })])

			return {
				finalReport: messageContentToString(finalReport.content),
				messages: [finalReport],
				...clearedState
			}
		} catch (error) {
			if (
				isTokenLimitExceeded(
					error as Error,
					configurable.finalReport_model
				)
			) {
				if (currentRetry === 0) {
					const modelTokenLimit =
						MODEL_TOKEN_LIMITS[configurable.finalReport_model]
					if (!modelTokenLimit) {
						return {
							finalReport: `Error generating final report: Token limit exceeded, however, we could not determine the model's maximum context length. Please update the model map in deepResearcher/utils.ts with this information. ${error}`,
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
					finalReport: `Error generating final report: ${error}`,
					...clearedState
				}
			}
		}
	}

	return {
		finalReport: 'Error generating final report: Maximum retries exceeded',
		...clearedState
	}
}

const deepResearcherGraph = new StateGraph(DeepResearcherAnnotation)
	.addNode('clarifyWithUser', clarifyWithUser)
	.addNode('write_researchBrief', writeResearchBrief)
	.addNode('researchSupervisor', supervisorGraph)
	.addNode('generateFinalReport', generateFinalReport)
	.addEdge(START, 'clarifyWithUser')
	.addEdge('clarifyWithUser', 'write_researchBrief')
	.addEdge('clarifyWithUser', END)
	.addEdge('write_researchBrief', 'researchSupervisor')
	.addEdge('researchSupervisor', 'generateFinalReport')
	.addEdge('generateFinalReport', END)
	.compile()

export default deepResearcherGraph
