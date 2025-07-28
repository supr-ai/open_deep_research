import { ResearchOptionsSchema } from './lib/options.js'
import { HumanMessage } from '@langchain/core/messages'
import deepResearcherGraph from './graphs/deepResearcher.js'
import z from 'zod'

const runResearch = async (
	query: string,
	options: z.input<typeof ResearchOptionsSchema>
) => {
	const result = await deepResearcherGraph.invoke(
		{ messages: [new HumanMessage({ content: query })] },
		{ configurable: ResearchOptionsSchema.parse(options) }
	)

	return result
}

runResearch(process.argv[2], {
	summarizationModel: {
		provider: 'openai',
		name: 'gpt-4.1-nano',
		maxTokens: 8192,
		apiKey: process.env.OPENAI_API_KEY!
	},
	researchModel: {
		provider: 'openai',
		name: 'gpt-4.1',
		maxTokens: 10000,
		apiKey: process.env.OPENAI_API_KEY!
	},
	compressionModel: {
		provider: 'openai',
		name: 'gpt-4.1-mini',
		maxTokens: 8192,
		apiKey: process.env.OPENAI_API_KEY!
	},
	finalReportModel: {
		provider: 'openai',
		name: 'gpt-4.1',
		maxTokens: 10000,
		apiKey: process.env.OPENAI_API_KEY!
	}
})
	.then(result => {
		console.log(result.finalReport)
	})
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
