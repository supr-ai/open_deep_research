import { BaseMessage, isToolMessage } from '@langchain/core/messages'
import messageContentToString from './messageContentToString.js'

const getNotesFromToolCalls = (messages: BaseMessage[]) =>
	messages
		.filter(isToolMessage)
		.map(message => messageContentToString(message.content))

export default getNotesFromToolCalls
