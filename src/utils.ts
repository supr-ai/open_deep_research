import {
	ToolMessage,
	BaseMessage,
	MessageContent
} from '@langchain/core/messages'

export const messageContentToString = (content: MessageContent) => {
	// If it’s already a string, just return it
	if (typeof content === 'string') {
		return content
	}

	// Otherwise it’s an array of “complex” items
	return content
		.map<string>(part => {
			// strings inside the array
			if (typeof part === 'string') {
				return part
			}

			// Handle our known shapes
			switch (part.type) {
				case 'text': {
					return part.text
				}
				case 'image_url': {
					const urlField = part.image_url

					// image_url might be string or {url: string; detail?}
					return typeof urlField === 'string'
						? urlField
						: urlField.url
				}
				default: {
					// Fallback: maybe it has a `.text`, or just JSON‐ify it
					return typeof part === 'object' &&
						part !== null &&
						'text' in part &&
						typeof part.text === 'string'
						? part.text
						: JSON.stringify(part)
				}
			}
		})
		.join('')
}

export function getNotesFromToolCalls(messages: BaseMessage[]): string[] {
	return messages
		.filter((msg): msg is ToolMessage => msg.getType() === 'tool')
		.map(msg => msg.content as string)
}

export function removeUpToLastAIMessage(
	messages: BaseMessage[]
): BaseMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].getType() === 'ai') {
			return messages.slice(0, i)
		}
	}
	return messages
}

export function formatDate(date: Date): string {
	return date.toLocaleDateString('en-US', {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	})
}

export function getBufferString(messages: BaseMessage[]): string {
	return messages.map(msg => `${msg.getType()}: ${msg.content}`).join('\n')
}
