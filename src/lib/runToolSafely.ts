import { DynamicStructuredTool } from '@langchain/core/tools'
import { RunnableConfig } from '@langchain/core/runnables'

const runToolSafely = async (
	tool: DynamicStructuredTool,
	args: unknown,
	config: RunnableConfig
) => {
	try {
		const result = await tool.invoke(args, config)

		if (typeof result !== 'string') {
			throw new Error('Tool returned non-string result')
		}

		return result
	} catch (error) {
		return `Error executing tool: ${error}`
	}
}

export default runToolSafely
