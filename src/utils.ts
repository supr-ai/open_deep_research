import { z } from 'zod'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
	HumanMessage,
	ToolMessage,
	BaseMessage,
	MessageContent
} from '@langchain/core/messages'
import { summarizeWebpagePrompt } from './prompts.js'
import { ResearchCompleteSchema } from './state.js'
import { initChatModel } from 'langchain/chat_models/universal'

export const configurableModel = initChatModel(undefined, {
	configurableFields: ['model', 'maxTokens', 'apiKey']
})

export const messageContentToString = (content: MessageContent) => {
	// If it’s already a string, just return it
	if (typeof content === 'string') {
		return content
	}

	// Otherwise it’s an array of “complex” items
	return content
		.map<string>(part => {
			// strings inside the array
			if (typeof part === 'string') {
				return part
			}

			// Handle our known shapes
			switch (part.type) {
				case 'text': {
					return part.text
				}
				case 'image_url': {
					const urlField = part.image_url

					// image_url might be string or {url: string; detail?}
					return typeof urlField === 'string'
						? urlField
						: urlField.url
				}
				default: {
					// Fallback: maybe it has a `.text`, or just JSON‐ify it
					return typeof part === 'object' &&
						part !== null &&
						'text' in part &&
						typeof part.text === 'string'
						? part.text
						: JSON.stringify(part)
				}
			}
		})
		.join('')
}

interface TavilySearchResult {
	title: string
	url: string
	content: string
	raw_content?: string
}

interface TavilySearchResponse {
	query: string
	results: TavilySearchResult[]
}

const TAVILY_SEARCH_DESCRIPTION = `
A search engine optimized for comprehensive, accurate, and trusted results. \
Useful for when you need to answer questions about current events.
`.trim()

export async function tavilySearchAsync(
	searchQueries: string[],
	maxResults: number = 5,
	topic: 'general' | 'news' | 'finance' = 'general',
	includeRawContent: boolean = true
): Promise<TavilySearchResponse[]> {
	const searchTasks = searchQueries.map(
		async (query): Promise<TavilySearchResponse> => {
			const response = await fetch('https://api.tavily.com/search', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${process.env.TAVILY_API_KEY!}`
				},
				body: JSON.stringify({
					query,
					max_results: maxResults,
					include_raw_content: includeRawContent,
					topic
				})
			})

			if (!response.ok) {
				throw new Error(`Tavily search failed: ${response.statusText}`)
			}

			const data = await response.json()
			return {
				query,
				results: data.results || []
			}
		}
	)

	return Promise.all(searchTasks)
}

export async function summarizeWebpage(
	model: BaseChatModel,
	webpageContent: string
): Promise<string> {
	try {
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error('Timeout')), 60000)
		})

		const summaryPromise = model.invoke([
			new HumanMessage({
				content: summarizeWebpagePrompt({
					webpageContent,
					date: new Date()
				})
			})
		])

		const summary = await Promise.race([summaryPromise, timeoutPromise])

		// Assuming the model returns a structured Summary object
		const summaryData = summary.content as any
		return `<summary>\n${summaryData.summary}\n</summary>\n\n<key_excerpts>\n${summaryData.key_excerpts}\n</key_excerpts>`
	} catch (error) {
		console.error(`Failed to summarize webpage: ${error}`)
		return webpageContent
	}
}

//########################
// Tool Utils
//########################

export async function createTavilySearchTool(): Promise<DynamicStructuredTool> {
	return new DynamicStructuredTool({
		name: 'tavily_search',
		description: TAVILY_SEARCH_DESCRIPTION,
		schema: z.object({
			queries: z
				.array(z.string())
				.describe(
					'List of search queries, you can pass in as many queries as you need.'
				),
			max_results: z
				.number()
				.default(5)
				.describe('Maximum number of results to return'),
			topic: z
				.enum(['general', 'news', 'finance'])
				.default('general')
				.describe('Topic to filter results by')
		}),
		func: async (input: {
			queries: string[]
			max_results?: number
			topic?: 'general' | 'news' | 'finance'
		}) => {
			const { queries, max_results = 5, topic = 'general' } = input

			const searchResults = await tavilySearchAsync(
				queries,
				max_results,
				topic,
				true
			)

			// Format the search results and deduplicate results by URL
			let formattedOutput = 'Search results: \n\n'
			const uniqueResults: Record<
				string,
				TavilySearchResult & { query: string }
			> = {}

			for (const response of searchResults) {
				for (const result of response.results) {
					const url = result.url
					if (!(url in uniqueResults)) {
						uniqueResults[url] = {
							...result,
							query: response.query
						}
					}
				}
			}

			const maxCharToInclude = 50_000

			const summarizedResults: Record<
				string,
				{ title: string; content: string }
			> = {}

			for (const [url, result] of Object.entries(uniqueResults)) {
				summarizedResults[url] = {
					title: result.title,
					content:
						result.content ||
						result.raw_content?.slice(0, maxCharToInclude) ||
						''
				}
			}

			let i = 0
			for (const [url, result] of Object.entries(summarizedResults)) {
				i++
				formattedOutput += `\n\n--- SOURCE ${i}: ${result.title} ---\n`
				formattedOutput += `URL: ${url}\n\n`
				formattedOutput += `SUMMARY:\n${result.content}\n\n`
				formattedOutput += '\n\n' + '-'.repeat(80) + '\n'
			}

			if (Object.keys(summarizedResults).length > 0) {
				return formattedOutput
			} else {
				return 'No valid search results found. Please try different search queries or use a different search API.'
			}
		}
	})
}

export async function createResearchCompleteTool(): Promise<DynamicStructuredTool> {
	return new DynamicStructuredTool({
		name: 'ResearchComplete',
		description:
			'Call this tool to indicate that the research is complete.',
		schema: ResearchCompleteSchema,
		func: async () => 'Research completed'
	})
}

export const getAllTools = async () => [
	await createResearchCompleteTool(),
	await createTavilySearchTool()
]

export function getNotesFromToolCalls(messages: BaseMessage[]): string[] {
	return messages
		.filter((msg): msg is ToolMessage => msg.getType() === 'tool')
		.map(msg => msg.content as string)
}

//########################
// Token Limit Exceeded Utils
//########################

export function isTokenLimitExceeded(
	exception: unknown,
	modelName?: string
): boolean {
	if (!(exception instanceof Error)) {
		return false
	}

	const errorStr = exception.message.toLowerCase()
	let provider: string | null = null

	if (modelName) {
		const modelStr = modelName.toLowerCase()
		if (modelStr.startsWith('openai:')) {
			provider = 'openai'
		} else if (modelStr.startsWith('anthropic:')) {
			provider = 'anthropic'
		} else if (
			modelStr.startsWith('gemini:') ||
			modelStr.startsWith('google:')
		) {
			provider = 'gemini'
		}
	}

	if (provider === 'openai') {
		return checkOpenAITokenLimit(exception, errorStr)
	} else if (provider === 'anthropic') {
		return checkAnthropicTokenLimit(exception, errorStr)
	} else if (provider === 'gemini') {
		return checkGeminiTokenLimit(exception, errorStr)
	}

	return (
		checkOpenAITokenLimit(exception, errorStr) ||
		checkAnthropicTokenLimit(exception, errorStr) ||
		checkGeminiTokenLimit(exception, errorStr)
	)
}

function checkOpenAITokenLimit(exception: Error, errorStr: string): boolean {
	const exceptionType = exception.constructor.name
	const isBadRequest = ['BadRequestError', 'InvalidRequestError'].includes(
		exceptionType
	)

	if (isBadRequest) {
		const tokenKeywords = [
			'token',
			'context',
			'length',
			'maximum context',
			'reduce'
		]
		if (tokenKeywords.some(keyword => errorStr.includes(keyword))) {
			return true
		}
	}

	// Check for specific error properties
	const errorObj = exception as any
	if (
		errorObj.code === 'context_length_exceeded' ||
		errorObj.type === 'invalid_request_error'
	) {
		return true
	}

	return false
}

function checkAnthropicTokenLimit(exception: Error, errorStr: string): boolean {
	const exceptionType = exception.constructor.name
	const isBadRequest = exceptionType === 'BadRequestError'

	if (isBadRequest && errorStr.includes('prompt is too long')) {
		return true
	}

	return false
}

function checkGeminiTokenLimit(exception: Error, errorStr: string): boolean {
	const exceptionType = exception.constructor.name
	const isResourceExhausted = [
		'ResourceExhausted',
		'GoogleGenerativeAIFetchError'
	].includes(exceptionType)

	if (isResourceExhausted) {
		return true
	}

	if (errorStr.includes('google.api_core.exceptions.resourceexhausted')) {
		return true
	}

	return false
}

export const MODEL_TOKEN_LIMITS: Record<string, number> = {
	'openai:gpt-4.1-mini': 1047576,
	'openai:gpt-4.1-nano': 1047576,
	'openai:gpt-4.1': 1047576,
	'openai:gpt-4o-mini': 128000,
	'openai:gpt-4o': 128000,
	'openai:o4-mini': 200000,
	'openai:o3-mini': 200000,
	'openai:o3': 200000,
	'openai:o3-pro': 200000,
	'openai:o1': 200000,
	'openai:o1-pro': 200000,
	'anthropic:claude-opus-4': 200000,
	'anthropic:claude-sonnet-4': 200000,
	'anthropic:claude-3-7-sonnet': 200000,
	'anthropic:claude-3-5-sonnet': 200000,
	'anthropic:claude-3-5-haiku': 200000,
	'google:gemini-1.5-pro': 2097152,
	'google:gemini-1.5-flash': 1048576,
	'google:gemini-pro': 32768,
	'cohere:command-r-plus': 128000,
	'cohere:command-r': 128000,
	'cohere:command-light': 4096,
	'cohere:command': 4096,
	'mistral:mistral-large': 32768,
	'mistral:mistral-medium': 32768,
	'mistral:mistral-small': 32768,
	'mistral:mistral-7b-instruct': 32768,
	'ollama:codellama': 16384,
	'ollama:llama2:70b': 4096,
	'ollama:llama2:13b': 4096,
	'ollama:llama2': 4096,
	'ollama:mistral': 32768
}

export function removeUpToLastAIMessage(
	messages: BaseMessage[]
): BaseMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].getType() === 'ai') {
			return messages.slice(0, i)
		}
	}
	return messages
}

export function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	})
}

export function getApiKeyForModel(modelName: string): string {
	const modelStr = modelName.toLowerCase()

	if (modelStr.startsWith('openai:')) {
		return process.env.OPENAI_API_KEY!
	} else if (modelStr.startsWith('anthropic:')) {
		return process.env.ANTHROPIC_API_KEY!
	} else if (modelStr.startsWith('google')) {
		return process.env.GOOGLE_API_KEY!
	}

	throw new Error(`Unsupported model: ${modelName}`)
}

export function getBufferString(messages: BaseMessage[]): string {
	return messages.map(msg => `${msg.getType()}: ${msg.content}`).join('\n')
}
