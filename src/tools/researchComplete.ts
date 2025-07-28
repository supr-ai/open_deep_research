import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

export const ResearchCompleteSchema = z.object({})
export type ResearchComplete = z.infer<typeof ResearchCompleteSchema>

const researchCompleteTool = new DynamicStructuredTool({
	name: 'ResearchComplete',
	description: 'Call this tool to indicate that the research is complete.',
	schema: ResearchCompleteSchema,
	func: async () => 'Research completed'
})

export default researchCompleteTool
