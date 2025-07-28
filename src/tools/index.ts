import researchCompleteTool from './researchComplete.js'
import searchTool from './search.js'

const tools = [researchCompleteTool, searchTool]

export default tools

export const toolsByName = tools.reduce<Record<string, (typeof tools)[number]>>(
	(toolsByName, tool) => {
		toolsByName[tool.name] = tool
		return toolsByName
	},
	{}
)
