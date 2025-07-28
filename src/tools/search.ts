import { DynamicStructuredTool } from '@langchain/core/tools'
import z from 'zod'

const SearchSchema = z.strictObject({
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
	topic: z
		.enum(['general', 'news', 'finance'])
		.default('general')
		.describe('Topic to filter results by')
})

type Search = z.infer<typeof SearchSchema>

const searchTool = new DynamicStructuredTool({
	name: 'search',
	description:
		'A search engine optimized for comprehensive, accurate, and trusted results. Useful for when you need to answer questions about current events.',
	schema: SearchSchema,
	func: async ({ queries, maxResults, topic }: Search) => {
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

export default searchTool
