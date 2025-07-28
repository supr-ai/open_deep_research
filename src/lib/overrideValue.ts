export interface OverrideValue<T> {
	type: 'override'
	value: T
}

export type OptionalOverrideValue<T> = T | OverrideValue<T>

export const isOverrideValue = <T>(
	value: OptionalOverrideValue<T>
): value is OverrideValue<T> =>
	typeof value === 'object' &&
	value !== null &&
	'type' in value &&
	value.type === 'override'

export const getOverrideValue = <T>(value: OptionalOverrideValue<T>): T =>
	isOverrideValue(value) ? value.value : value

export const reduceOverrideValue = <T>(
	currentValue: OptionalOverrideValue<T[]>,
	newValue: OptionalOverrideValue<T[]>
) =>
	isOverrideValue(newValue)
		? newValue.value
		: [...getOverrideValue(currentValue), ...newValue]
