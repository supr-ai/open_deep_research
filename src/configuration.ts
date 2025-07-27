import { z } from 'zod'
import { RunnableConfig } from '@langchain/core/runnables'

export interface UIConfigMetadata {
	type: string
	default: any
	min?: number
	max?: number
	step?: number
	description: string
}

export interface ConfigField {
	default: any
	metadata?: {
		x_oap_ui_config?: UIConfigMetadata
	}
}

export const ConfigurationSchema = z.object({
	// General Configuration
	maxStructuredOutputRetries: z.number().default(3),
	allowClarification: z.boolean().default(true),
	maxConcurrentResearchUnits: z.number().default(5),

	// Research Configuration
	maxResearcherIterations: z.number().default(3),
	maxReactToolCalls: z.number().default(5),

	// Model Configuration
	summarizationModel: z.string().default('openai:gpt-4.1-nano'),
	summarizationModelMaxTokens: z.number().default(8192),
	researchModel: z.string().default('openai:gpt-4.1'),
	researchModelMaxTokens: z.number().default(10000),
	compressionModel: z.string().default('openai:gpt-4.1-mini'),
	compressionModelMaxTokens: z.number().default(8192),
	finalReportModel: z.string().default('openai:gpt-4.1'),
	finalReportModelMaxTokens: z.number().default(10000)
})

export type ConfigurationType = z.infer<typeof ConfigurationSchema>

export class Configuration {
	// General Configuration
	maxStructuredOutputRetries: number = 3
	allowClarification: boolean = true
	maxConcurrentResearchUnits: number = 5

	// Research Configuration
	maxResearcherIterations: number = 3
	maxReactToolCalls: number = 5

	// Model Configuration
	summarizationModel: string = 'openai:gpt-4.1-nano'
	summarizationModelMaxTokens: number = 8192
	researchModel: string = 'openai:gpt-4.1'
	researchModelMaxTokens: number = 10000
	compressionModel: string = 'openai:gpt-4.1-mini'
	compressionModelMaxTokens: number = 8192
	finalReportModel: string = 'openai:gpt-4.1'
	finalReportModelMaxTokens: number = 10000

	constructor(config?: Partial<ConfigurationType>) {
		if (config) {
			Object.assign(this, config)
		}
	}

	static fromRunnableConfig(config?: RunnableConfig): Configuration {
		const configurable = config?.configurable ?? {}

		const fieldNames = [
			'maxStructuredOutputRetries',
			'allowClarification',
			'maxConcurrentResearchUnits',
			'maxResearcherIterations',
			'maxReactToolCalls',
			'summarizationModel',
			'summarizationModelMaxTokens',
			'researchModel',
			'researchModelMaxTokens',
			'compressionModel',
			'compressionModelMaxTokens',
			'finalReportModel',
			'finalReportModelMaxTokens'
		]

		const values: Record<string, any> = {}

		for (const fieldName of fieldNames) {
			const envValue = process.env[fieldName.toUpperCase()]
			const configurableValue = configurable[fieldName]
			const value = envValue ?? configurableValue

			if (value !== undefined && value !== null) {
				// Convert string values to appropriate types
				if (
					fieldName.endsWith('Retries') ||
					fieldName.endsWith('Iterations') ||
					fieldName.endsWith('Calls') ||
					fieldName.endsWith('Units') ||
					fieldName.endsWith('Tokens')
				) {
					values[fieldName] =
						typeof value === 'string' ? parseInt(value, 10) : value
				} else if (fieldName === 'allowClarification') {
					values[fieldName] =
						typeof value === 'string'
							? value.toLowerCase() === 'true'
							: value
				} else {
					values[fieldName] = value
				}
			}
		}

		return new Configuration(values)
	}

	// Static field definitions for UI metadata (equivalent to Python's model_fields)
	static readonly modelFields: Record<string, ConfigField> = {
		maxStructuredOutputRetries: {
			default: 3,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 3,
					min: 1,
					max: 10,
					description:
						'Maximum number of retries for structured output calls from models'
				}
			}
		},
		allowClarification: {
			default: true,
			metadata: {
				x_oap_ui_config: {
					type: 'boolean',
					default: true,
					description:
						'Whether to allow the researcher to ask the user clarifying questions before starting research'
				}
			}
		},
		maxConcurrentResearchUnits: {
			default: 5,
			metadata: {
				x_oap_ui_config: {
					type: 'slider',
					default: 5,
					min: 1,
					max: 20,
					step: 1,
					description:
						'Maximum number of research units to run concurrently. This will allow the researcher to use multiple sub-agents to conduct research. Note: with more concurrency, you may run into rate limits.'
				}
			}
		},
		maxResearcherIterations: {
			default: 3,
			metadata: {
				x_oap_ui_config: {
					type: 'slider',
					default: 3,
					min: 1,
					max: 10,
					step: 1,
					description:
						'Maximum number of research iterations for the Research Supervisor. This is the number of times the Research Supervisor will reflect on the research and ask follow-up questions.'
				}
			}
		},
		maxReactToolCalls: {
			default: 5,
			metadata: {
				x_oap_ui_config: {
					type: 'slider',
					default: 5,
					min: 1,
					max: 30,
					step: 1,
					description:
						'Maximum number of tool calling iterations to make in a single researcher step.'
				}
			}
		},
		summarizationModel: {
			default: 'openai:gpt-4.1-nano',
			metadata: {
				x_oap_ui_config: {
					type: 'text',
					default: 'openai:gpt-4.1-nano',
					description:
						'Model for summarizing research results from search results'
				}
			}
		},
		summarizationModelMaxTokens: {
			default: 8192,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 8192,
					description: 'Maximum output tokens for summarization model'
				}
			}
		},
		researchModel: {
			default: 'openai:gpt-4.1',
			metadata: {
				x_oap_ui_config: {
					type: 'text',
					default: 'openai:gpt-4.1',
					description: 'Model for conducting research.'
				}
			}
		},
		researchModelMaxTokens: {
			default: 10000,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 10000,
					description: 'Maximum output tokens for research model'
				}
			}
		},
		compressionModel: {
			default: 'openai:gpt-4.1-mini',
			metadata: {
				x_oap_ui_config: {
					type: 'text',
					default: 'openai:gpt-4.1-mini',
					description:
						'Model for compressing research findings from sub-agents.'
				}
			}
		},
		compressionModelMaxTokens: {
			default: 8192,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 8192,
					description: 'Maximum output tokens for compression model'
				}
			}
		},
		finalReportModel: {
			default: 'openai:gpt-4.1',
			metadata: {
				x_oap_ui_config: {
					type: 'text',
					default: 'openai:gpt-4.1',
					description:
						'Model for writing the final report from all research findings'
				}
			}
		},
		finalReportModelMaxTokens: {
			default: 10000,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 10000,
					description: 'Maximum output tokens for final report model'
				}
			}
		}
	}
}
