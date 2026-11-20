/**
 * Filtering of the agents/modes advertised by an ACP server.
 *
 * The filter is an exclusion regular expression tested against each mode's id
 * and name: a mode is hidden when either matches. An empty or invalid
 * expression disables filtering. The currently active mode is never hidden so
 * the selector keeps reflecting the real session state.
 */

export interface FilterableMode {
	id: string;
	name?: string;
}

/**
 * Compile a filter expression. Returns null for empty input and throws a
 * descriptive error for an invalid expression.
 */
export function compileModeFilter(expression?: string | null): RegExp | null {
	const source = expression?.trim();
	if (!source) return null;
	return new RegExp(source, 'i');
}

/** Returns an error message when the expression is invalid, otherwise null. */
export function validateModeFilter(expression?: string | null): string | null {
	try {
		compileModeFilter(expression);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function filterModes<T extends FilterableMode>(
	modes: T[],
	expression?: string | null,
	currentModeId?: string | null
): T[] {
	let regex: RegExp | null;
	try {
		regex = compileModeFilter(expression);
	} catch {
		return modes;
	}
	if (!regex) return modes;

	return modes.filter(
		(mode) =>
			mode.id === currentModeId ||
			!(
				regex!.test(mode.id) ||
				(mode.name !== undefined && regex!.test(mode.name))
			)
	);
}
