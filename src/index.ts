import { ResearchOptions } from './options.js'
import { HumanMessage } from '@langchain/core/messages'
import deepResearcherGraph from './graphs/deepResearcher.js'

const runResearch = async (
	query: string,
	options?: Partial<ResearchOptions>
) => {
	const result = await deepResearcherGraph.invoke(
		{ messages: [new HumanMessage({ content: query })] },
		{ configurable: options }
	)

	return result
}

runResearch(process.argv[2])
	.then(result => {
		console.log(result.finalReport)
	})
	.catch(error => {
		console.error(error)
		process.exit(1)
	})
