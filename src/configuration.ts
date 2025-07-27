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
	max_structured_output_retries: z.number().default(3),
	allow_clarification: z.boolean().default(true),
	max_concurrent_research_units: z.number().default(5),

	// Research Configuration
	max_researcher_iterations: z.number().default(3),
	max_react_tool_calls: z.number().default(5),

	// Model Configuration
	summarization_model: z.string().default('openai:gpt-4.1-nano'),
	summarization_model_max_tokens: z.number().default(8192),
	research_model: z.string().default('openai:gpt-4.1'),
	research_model_max_tokens: z.number().default(10000),
	compression_model: z.string().default('openai:gpt-4.1-mini'),
	compression_model_max_tokens: z.number().default(8192),
	finalReport_model: z.string().default('openai:gpt-4.1'),
	finalReport_model_max_tokens: z.number().default(10000)
})

export type ConfigurationType = z.infer<typeof ConfigurationSchema>

export class Configuration {
	// General Configuration
	max_structured_output_retries: number = 3
	allow_clarification: boolean = true
	max_concurrent_research_units: number = 5

	// Research Configuration
	max_researcher_iterations: number = 3
	max_react_tool_calls: number = 5

	// Model Configuration
	summarization_model: string = 'openai:gpt-4.1-nano'
	summarization_model_max_tokens: number = 8192
	research_model: string = 'openai:gpt-4.1'
	research_model_max_tokens: number = 10000
	compression_model: string = 'openai:gpt-4.1-mini'
	compression_model_max_tokens: number = 8192
	finalReport_model: string = 'openai:gpt-4.1'
	finalReport_model_max_tokens: number = 10000

	constructor(config?: Partial<ConfigurationType>) {
		if (config) {
			Object.assign(this, config)
		}
	}

	static fromRunnableConfig(config?: RunnableConfig): Configuration {
		const configurable = config?.configurable ?? {}

		const fieldNames = [
			'max_structured_output_retries',
			'allow_clarification',
			'max_concurrent_research_units',
			'max_researcher_iterations',
			'max_react_tool_calls',
			'summarization_model',
			'summarization_model_max_tokens',
			'research_model',
			'research_model_max_tokens',
			'compression_model',
			'compression_model_max_tokens',
			'finalReport_model',
			'finalReport_model_max_tokens'
		]

		const values: Record<string, any> = {}

		for (const fieldName of fieldNames) {
			const envValue = process.env[fieldName.toUpperCase()]
			const configurableValue = configurable[fieldName]
			const value = envValue ?? configurableValue

			if (value !== undefined && value !== null) {
				// Convert string values to appropriate types
				if (
					fieldName.includes('_retries') ||
					fieldName.includes('_iterations') ||
					fieldName.includes('_calls') ||
					fieldName.includes('_units') ||
					fieldName.includes('_tokens')
				) {
					values[fieldName] =
						typeof value === 'string' ? parseInt(value, 10) : value
				} else if (fieldName === 'allow_clarification') {
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
		max_structured_output_retries: {
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
		allow_clarification: {
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
		max_concurrent_research_units: {
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
		max_researcher_iterations: {
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
		max_react_tool_calls: {
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
		summarization_model: {
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
		summarization_model_max_tokens: {
			default: 8192,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 8192,
					description: 'Maximum output tokens for summarization model'
				}
			}
		},
		research_model: {
			default: 'openai:gpt-4.1',
			metadata: {
				x_oap_ui_config: {
					type: 'text',
					default: 'openai:gpt-4.1',
					description: 'Model for conducting research.'
				}
			}
		},
		research_model_max_tokens: {
			default: 10000,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 10000,
					description: 'Maximum output tokens for research model'
				}
			}
		},
		compression_model: {
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
		compression_model_max_tokens: {
			default: 8192,
			metadata: {
				x_oap_ui_config: {
					type: 'number',
					default: 8192,
					description: 'Maximum output tokens for compression model'
				}
			}
		},
		finalReport_model: {
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
		finalReport_model_max_tokens: {
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
