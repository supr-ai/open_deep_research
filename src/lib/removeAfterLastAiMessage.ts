import { BaseMessage, isAIMessage } from '@langchain/core/messages'

/** Removes all messages after the last AI message including the AI message. */
const removeAfterLastAiMessage = (messages: BaseMessage[]) => {
	for (let i = messages.length - 1; i >= 0; i--)
		if (isAIMessage(messages[i])) return messages.slice(0, i)

	return messages
}

export default removeAfterLastAiMessage
