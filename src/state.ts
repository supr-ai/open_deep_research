import { z } from 'zod'
import { BaseMessage } from '@langchain/core/messages'

export const ConductResearchSchema = z.object({
	research_topic: z
		.string()
		.describe(
			'The topic to research. Should be a single topic, and should be described in high detail (at least a paragraph).'
		)
})

export type ConductResearch = z.infer<typeof ConductResearchSchema>

export const ResearchCompleteSchema = z.object({})
export type ResearchComplete = z.infer<typeof ResearchCompleteSchema>

export const SummarySchema = z.object({
	summary: z.string(),
	key_excerpts: z.string()
})

export type Summary = z.infer<typeof SummarySchema>

export const ClarifyWithUserSchema = z.object({
	need_clarification: z
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

export type ClarifyWithUser = z.infer<typeof ClarifyWithUserSchema>

export const ResearchQuestionSchema = z.object({
	research_brief: z
		.string()
		.describe(
			'A research question that will be used to guide the research.'
		)
})

export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>

export type OverrideValue<T> = T | { type: 'override'; value: T }

export const isOverrideValue = <T>(
	value: OverrideValue<T>
): value is { type: 'override'; value: T } =>
	typeof value === 'object' &&
	value !== null &&
	'type' in value &&
	value.type === 'override'

export const getOverrideValue = <T>(value: OverrideValue<T>): T =>
	isOverrideValue(value) ? value.value : value

export const reduceOverrideValue = <T>(
	currentValue: OverrideValue<T[]>,
	newValue: OverrideValue<T[]>
) =>
	isOverrideValue(newValue)
		? newValue.value
		: [...getOverrideValue(currentValue), ...newValue]

export interface AgentInputState {
	messages: BaseMessage[]
}

export interface AgentState {
	messages: BaseMessage[]
	supervisor_messages: OverrideValue<BaseMessage[]>
	research_brief?: string
	raw_notes: OverrideValue<string[]>
	notes: OverrideValue<string[]>
	final_report?: string
}

export interface SupervisorState {
	supervisor_messages: OverrideValue<BaseMessage[]>
	research_brief: string
	notes: OverrideValue<string[]>
	research_iterations: number
	raw_notes: OverrideValue<string[]>
}

export interface ResearcherState {
	researcher_messages: BaseMessage[]
	tool_call_iterations: number
	research_topic: string
	compressed_research?: string
	raw_notes: OverrideValue<string[]>
}

export interface ResearcherOutputState {
	compressed_research: string
	raw_notes: OverrideValue<string[]>
}
