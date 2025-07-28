import { z } from 'zod'
import { RunnableConfig } from '@langchain/core/runnables'

export const ModelSchema = z.strictObject({
	provider: z.string(),
	name: z.string(),
	maxTokens: z.number()
})

export type Model = z.infer<typeof ModelSchema>

export const ResearchOptionsSchema = z.strictObject({
	maxStructuredOutputRetries: z.number().default(3),
	allowClarification: z.boolean().default(true),
	maxConcurrentResearchUnits: z.number().default(5),

	maxResearcherIterations: z.number().default(3),
	maxReactToolCalls: z.number().default(5),

	summarizationModel: ModelSchema.default({
		provider: 'openai',
		name: 'gpt-4.1-nano',
		maxTokens: 8192
	}),
	researchModel: ModelSchema.default({
		provider: 'openai',
		name: 'gpt-4.1',
		maxTokens: 10000
	}),
	compressionModel: ModelSchema.default({
		provider: 'openai',
		name: 'gpt-4.1-mini',
		maxTokens: 8192
	}),
	finalReportModel: ModelSchema.default({
		provider: 'openai',
		name: 'gpt-4.1',
		maxTokens: 10000
	})
})

export type ResearchOptions = z.infer<typeof ResearchOptionsSchema>

export const researchOptionsFromRunnableConfig = (config: RunnableConfig) =>
	ResearchOptionsSchema.parse(config.configurable ?? {})
