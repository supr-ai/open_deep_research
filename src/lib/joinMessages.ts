import { BaseMessage } from '@langchain/core/messages'

const joinMessages = (messages: BaseMessage[]) =>
	messages
		.map(message => `${message.getType()}: ${message.content}`)
		.join('\n')

export default joinMessages
