import z from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

export const ModelSchema = z.strictObject({
	provider: z.enum(['openai', 'anthropic', 'gemini']),
	name: z.string(),
	apiKey: z.string(),
	maxTokens: z.number()
})

export const getChatModel = (
	model: z.infer<typeof ModelSchema>
): BaseChatModel => {
	const options = { model: model.name, apiKey: model.apiKey }

	switch (model.provider) {
		case 'openai':
			return new ChatOpenAI(options)
		case 'anthropic':
			return new ChatAnthropic(options)
		case 'gemini':
			return new ChatGoogleGenerativeAI(options)
	}
}
