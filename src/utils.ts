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
import { initChatModel } from 'langchain/chat_models/universal.js'

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

export function getNotesFromToolCalls(messages: BaseMessage[]): string[] {
	return messages
		.filter((msg): msg is ToolMessage => msg.getType() === 'tool')
		.map(msg => msg.content as string)
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
