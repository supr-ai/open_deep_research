import { DynamicStructuredTool } from '@langchain/core/tools'
import z from 'zod'

export const ConductResearchSchema = z.strictObject({
	researchTopic: z
		.string()
		.describe(
			'The topic to research. Should be a single topic, and should be described in high detail (at least a paragraph).'
		)
})

const conductResearchTool = new DynamicStructuredTool({
	name: 'conductResearch',
	description:
		'Given a researchTopic, produce a detailed plan of attack for research.',
	schema: ConductResearchSchema,
	func: async () => 'Research conducted'
})

export default conductResearchTool
