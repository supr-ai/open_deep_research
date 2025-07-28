import { MessageContent } from '@langchain/core/messages'

const messageContentToString = (content: MessageContent) => {
	// If it's already a string, just return it
	if (typeof content === 'string') {
		return content
	}

	// Otherwise it's an array of "complex" items
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
					// Fallback: maybe it has a `.text`, or just JSON-ify it
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

export default messageContentToString
