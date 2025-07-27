import { Configuration } from './configuration.js'
import { HumanMessage } from '@langchain/core/messages'
import deepResearcherGraph from './graphs/deepResearcher.js'

async function runResearch(query: string, config?: Partial<Configuration>) {
	const configuration = new Configuration(config)

	const result = await deepResearcherGraph.invoke(
		{
			messages: [new HumanMessage({ content: query })]
		},
		{
			configurable: configuration
		}
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
