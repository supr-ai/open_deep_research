import { DynamicStructuredTool } from '@langchain/core/tools'
import { HumanMessage } from '@langchain/core/messages'
import z from 'zod'
import {
	researchOptionsFromRunnableConfig,
	ResearchOptionsSchema
} from '../lib/options.js'
import { ChatModel, getChatModel } from '../lib/model.js'
import { summarizeWebpagePrompt } from '../lib/prompts.js'
import { tavily } from '@tavily/core'
import createTimeout from '../lib/createTimeout.js'

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY! })

export const SearchTopicSchema = z.enum(['general', 'news', 'finance'])

interface SearchResult {
	title: string
	url: string
	content: string
	rawContent?: string
	score: number
	publishedDate: string
}

const search = ({
	queries,
	maxResults,
	topic,
	includeRawContent
}: {
	queries: string[]
	maxResults: number
	topic: z.infer<typeof SearchTopicSchema>
	includeRawContent: boolean
}): Promise<{ query: string; results: SearchResult[] }[]> =>
	Promise.all(
		queries.map(async query => {
			try {
				const { results } = await tavilyClient.search(query, {
					maxResults: maxResults,
					includeRawContent: includeRawContent && 'markdown',
					topic
				})

				return { query, results }
			} catch (error) {
				throw new Error(
					`Tavily search failed for query "${query}": ${error}`
				)
			}
		})
	)

const SummarySchema = z.strictObject({
	summary: z
		.string()
		.trim()
		.min(1)
		.describe(
			'Your summary here, structured with appropriate paragraphs or bullet points as needed'
		),
	keyExcerpts: z
		.string()
		.trim()
		.min(1)
		.describe(
			'First important quote or excerpt, Second important quote or excerpt, Third important quote or excerpt, ...Add more excerpts as needed, up to a maximum of 5'
		)
})

const summarizeWebpage = async (
	model: ChatModel,
	content: string,
	options: z.infer<typeof ResearchOptionsSchema>
) => {
	try {
		const { summary, keyExcerpts } = await Promise.race([
			model
				.withStructuredOutput(SummarySchema)
				.withRetry({
					stopAfterAttempt: options.maxStructuredOutputRetries
				})
				.invoke([
					new HumanMessage({
						content: summarizeWebpagePrompt({ content })
					})
				]),
			createTimeout(60000)
		])

		return `<summary>\n${summary}\n</summary>\n\n<key_excerpts>\n${keyExcerpts}\n</key_excerpts>`
	} catch (error) {
		console.error(`Failed to summarize webpage: ${error}`)
		return content
	}
}

const searchAndSummarize = async ({
	queries,
	maxResults,
	topic,
	options
}: {
	queries: string[]
	maxResults: number
	topic: z.infer<typeof SearchTopicSchema>
	options: z.infer<typeof ResearchOptionsSchema>
}): Promise<Record<string, { title: string; content: string }>> => {
	// 1) fetch everything
	const responses = await search({
		queries,
		maxResults,
		topic,
		includeRawContent: true
	})

	// 2) dedupe + flatten
	const uniqueMap = new Map<string, SearchResult & { query: string }>()

	for (const { query, results } of responses) {
		for (const r of results) {
			if (!uniqueMap.has(r.url)) {
				uniqueMap.set(r.url, { ...r, query })
			}
		}
	}

	const uniqueResults = Array.from(uniqueMap.values())

	// 3) kick off all summaries (or fall back to original content)
	const maxChars = 50_000
	const model = getChatModel(options.summarizationModel)

	const allContents = await Promise.all(
		uniqueResults.map(res =>
			res.rawContent
				? summarizeWebpage(
						model,
						res.rawContent.slice(0, maxChars),
						options
				  )
				: Promise.resolve(res.content)
		)
	)

	// 4) build final lookup
	return uniqueResults.reduce<
		Record<string, { title: string; content: string }>
	>((acc, res, i) => {
		acc[res.url] = {
			title: res.title,
			content: allContents[i]
		}

		return acc
	}, {})
}

export const SearchSchema = z.strictObject({
	queries: z
		.array(z.string())
		.min(1)
		.describe(
			'List of search queries, you can pass in as many queries as you need.'
		),
	maxResults: z
		.number()
		.default(5)
		.describe('Maximum number of results to return'),
	topic: SearchTopicSchema.default('general').describe(
		'Topic to filter results by'
	)
})

const searchTool = new DynamicStructuredTool({
	name: 'search',
	description:
		'A search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about current events.',
	schema: SearchSchema,
	func: async ({ queries, maxResults, topic }, _runManager, config) => {
		if (!config) throw new Error('No config provided')
		const options = researchOptionsFromRunnableConfig(config)

		const summarizedResults = await searchAndSummarize({
			queries,
			maxResults,
			topic,
			options
		})

		let formattedOutput = 'Search results:\n\n'

		for (let i = 0; i < Object.keys(summarizedResults).length; i++) {
			const [url, result] = Object.entries(summarizedResults)[i]
			formattedOutput += `\n\n--- SOURCE ${i + 1}: ${result.title} ---\n`
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

export default searchTool
