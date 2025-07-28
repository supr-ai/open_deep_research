import z from 'zod'
import { ModelSchema } from './model'

const checkOpenAITokenLimit = (error: Error) => {
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

const checkAnthropicTokenLimit = (error: Error) =>
	error.constructor.name === 'BadRequestError' &&
	error.message.toLowerCase().includes('prompt is too long')

const checkGeminiTokenLimit = (error: Error) => {
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
			return checkOpenAITokenLimit(error)
		case 'anthropic':
			return checkAnthropicTokenLimit(error)
		case 'gemini':
			return checkGeminiTokenLimit(error)
	}
}

export default isTokenLimitExceeded
