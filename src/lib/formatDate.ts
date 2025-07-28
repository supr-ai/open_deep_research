const formatDate = (date: Date) =>
	date.toLocaleDateString('en-US', {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	})

export default formatDate
