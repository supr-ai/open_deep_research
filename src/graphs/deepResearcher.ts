import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	BaseMessage
} from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { StateGraph, END, START, Annotation } from '@langchain/langgraph'
import { Command } from '@langchain/langgraph'
import { researchOptionsFromRunnableConfig } from '../lib/options.js'
import {
	clarifyWithUserInstructions,
	generateFinalReportPrompt,
	leadResearcherPrompt,
	transformMessagesIntoResearchTopicPrompt
} from '../lib/prompts.js'
import {
	getOverrideValue,
	reduceOverrideValue,
	OptionalOverrideValue
} from '../lib/overrideValue.js'
import messageContentToString from '../lib/messageContentToString.js'
import isTokenLimitExceeded from '../lib/isTokenLimitExceeded.js'
import supervisorGraph from './supervisor.js'
import { z } from 'zod'
import { getChatModel } from '../lib/model.js'

const DeepResearcherAnnotation = Annotation.Root({
	messages: Annotation<BaseMessage[]>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	supervisorMessages: Annotation<OptionalOverrideValue<BaseMessage[]>>({
		reducer: reduceOverrideValue,
		default: (): BaseMessage[] => []
	}),
	researchBrief: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	}),
	rawNotes: Annotation<OptionalOverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	notes: Annotation<OptionalOverrideValue<string[]>>({
		reducer: reduceOverrideValue,
		default: (): string[] => []
	}),
	finalReport: Annotation<string>({
		reducer: (_current, update) => update,
		default: () => ''
	})
})

type DeepResearcherNodeHandler = (
	state: typeof DeepResearcherAnnotation.State,
	config: RunnableConfig
) => Promise<
	Command<
		| 'clarifyWithUser'
		| 'writeResearchBrief'
		| 'researchSupervisor'
		| 'generateFinalReport'
		| typeof END,
		Partial<typeof DeepResearcherAnnotation.State>
	>
>

const ClarifyWithUserSchema = z.strictObject({
	needsClarification: z
		.boolean()
		.describe('Whether the user needs to be asked a clarifying question.'),
	question: z
		.string()
		.describe('A question to ask the user to clarify the report scope'),
	verification: z
		.string()
		.describe(
			'Verify message that we will start research after the user has provided the necessary information.'
		)
})

const clarifyWithUser: DeepResearcherNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	if (!options.allowClarification)
		return new Command({ goto: 'writeResearchBrief' })

	const response = await getChatModel(options.researchModel)
		.withStructuredOutput(ClarifyWithUserSchema)
		.withRetry({
			stopAfterAttempt: options.maxStructuredOutputRetries
		})
		.invoke([
			new HumanMessage({
				content: clarifyWithUserInstructions({
					messages: state.messages
				})
			})
		])

	return response.needsClarification
		? new Command({
				goto: END,
				update: {
					messages: [new AIMessage({ content: response.question })]
				}
		  })
		: new Command({
				goto: 'writeResearchBrief',
				update: {
					messages: [
						new AIMessage({ content: response.verification })
					]
				}
		  })
}

const ResearchQuestionSchema = z.strictObject({
	researchBrief: z
		.string()
		.describe(
			'A research question that will be used to guide the research.'
		)
})

const writeResearchBrief: DeepResearcherNodeHandler = async (state, config) => {
	const options = researchOptionsFromRunnableConfig(config)

	const response = await getChatModel(options.researchModel)
		.withStructuredOutput(ResearchQuestionSchema)
		.withRetry({
			stopAfterAttempt: options.maxStructuredOutputRetries
		})
		.invoke([
			new HumanMessage({
				content: transformMessagesIntoResearchTopicPrompt({
					messages: state.messages
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
								options.maxConcurrentResearchUnits
						})
					}),
					new HumanMessage({ content: response.researchBrief })
				]
			}
		}
	})
}

const generateFinalReport: DeepResearcherNodeHandler = async (
	state,
	config
) => {
	const options = researchOptionsFromRunnableConfig(config)

	let findings = getOverrideValue(state.notes).join('\n')

	for (let currentRetry = 0; currentRetry < 3; currentRetry++) {
		const finalReportPrompt = generateFinalReportPrompt({
			researchBrief: state.researchBrief,
			messages: state.messages,
			findings
		})

		try {
			const finalReport = await getChatModel(
				options.finalReportModel
			).invoke([new HumanMessage({ content: finalReportPrompt })])

			return new Command({
				goto: END,
				update: {
					finalReport: messageContentToString(finalReport.content),
					messages: [finalReport]
				}
			})
		} catch (error) {
			if (
				error instanceof Error &&
				isTokenLimitExceeded(error, options.finalReportModel)
			) {
				findings = findings.slice(
					0,
					currentRetry === 0
						? options.finalReportModel.maxTokens * 4
						: Math.floor(findings.length * 0.9)
				)

				console.log('Reducing the chars to', findings.length)
			} else {
				return new Command({
					goto: END,
					update: {
						finalReport: `Error generating final report: ${error}`
					}
				})
			}
		}
	}

	return new Command({
		goto: END,
		update: {
			finalReport:
				'Error generating final report: Maximum retries exceeded'
		}
	})
}

const deepResearcherGraph = new StateGraph(DeepResearcherAnnotation)
	.addNode('clarifyWithUser', clarifyWithUser)
	.addNode('writeResearchBrief', writeResearchBrief)
	.addNode('researchSupervisor', supervisorGraph)
	.addNode('generateFinalReport', generateFinalReport)
	.addEdge(START, 'clarifyWithUser')
	.addEdge('clarifyWithUser', 'writeResearchBrief')
	.addEdge('clarifyWithUser', END)
	.addEdge('writeResearchBrief', 'researchSupervisor')
	.addEdge('researchSupervisor', 'generateFinalReport')
	.addEdge('generateFinalReport', END)
	.compile()

export default deepResearcherGraph
