import { z } from 'zod'
import { RunnableConfig } from '@langchain/core/runnables'
import { ModelSchema } from './model.js'

export const ResearchOptionsSchema = z.strictObject({
	maxStructuredOutputRetries: z.number().default(3),
	allowClarification: z.boolean().default(true),
	maxConcurrentResearchUnits: z.number().default(5),
	maxResearcherIterations: z.number().default(3),
	maxReactToolCalls: z.number().default(5),
	summarizationModel: ModelSchema,
	researchModel: ModelSchema,
	compressionModel: ModelSchema,
	finalReportModel: ModelSchema
})

export const researchOptionsFromRunnableConfig = (config: RunnableConfig) =>
	ResearchOptionsSchema.parse(config.configurable ?? {})
