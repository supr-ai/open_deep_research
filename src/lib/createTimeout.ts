const createTimeout = (ms: number) =>
	new Promise<never>((_resolve, reject) =>
		setTimeout(() => {
			reject(new Error('Timeout'))
		}, ms)
	)

export default createTimeout
