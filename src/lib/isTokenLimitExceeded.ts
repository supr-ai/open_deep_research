import z from 'zod'
import { ModelSchema } from './model.js'

const isOpenAITokenLimitExceeded = (error: Error) => {
	const isBadRequest = ['BadRequestError', 'InvalidRequestError'].includes(
		error.constructor.name
	)

	if (isBadRequest) {
		const tokenKeywords = [
			'token',
			'context',
			'length',
			'maximum context',
			'reduce'
		]

		if (
			tokenKeywords.some(keyword =>
				error.message.toLowerCase().includes(keyword)
			)
		) {
			return true
		}
	}

	return (
		(error as any).code === 'context_length_exceeded' ||
		(error as any).type === 'invalid_request_error'
	)
}

const isAnthropicTokenLimitExceeded = (error: Error) =>
	error.constructor.name === 'BadRequestError' &&
	error.message.toLowerCase().includes('prompt is too long')

const isGeminiTokenLimitExceeded = (error: Error) => {
	const isResourceExhausted = [
		'ResourceExhausted',
		'GoogleGenerativeAIFetchError'
	].includes(error.constructor.name)

	if (isResourceExhausted) return true

	return error.message
		.toLowerCase()
		.includes('google.api_core.errors.resourceexhausted')
}

const isTokenLimitExceeded = (
	error: Error,
	model: z.infer<typeof ModelSchema>
) => {
	switch (model.provider) {
		case 'openai':
			return isOpenAITokenLimitExceeded(error)
		case 'anthropic':
			return isAnthropicTokenLimitExceeded(error)
		case 'gemini':
			return isGeminiTokenLimitExceeded(error)
	}
}

export default isTokenLimitExceeded
