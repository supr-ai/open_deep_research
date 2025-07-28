import researchCompleteTool from './researchComplete'
import searchTool from './search'

const tools = Promise.all([researchCompleteTool, searchTool])

export default tools
