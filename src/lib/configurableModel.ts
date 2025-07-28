import { initChatModel } from 'langchain/chat_models/universal'

const configurableModel = initChatModel(undefined, {
	configurableFields: ['provider', 'model', 'maxTokens', 'apiKey']
})

export default configurableModel
