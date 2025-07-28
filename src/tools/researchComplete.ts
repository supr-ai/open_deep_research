import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const ResearchCompleteSchema = z.strictObject({})

const researchCompleteTool = new DynamicStructuredTool({
	name: 'researchComplete',
	description: 'Call this tool to indicate that the research is complete.',
	schema: ResearchCompleteSchema,
	func: async () => 'Research completed'
})

export default researchCompleteTool
