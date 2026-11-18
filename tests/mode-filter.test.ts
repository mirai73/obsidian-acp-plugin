import {
	compileModeFilter,
	filterModes,
	validateModeFilter,
} from '../src/utils/mode-filter';

const modes = [
	{ id: 'kiro_default', name: 'Default' },
	{ id: 'kiro_planner', name: 'Planner' },
	{ id: 'my-writer', name: 'Writer' },
	{ id: 'reviewer', name: 'Code Reviewer' },
];

describe('mode filter', () => {
	it('returns all modes when the filter is empty', () => {
		expect(filterModes(modes, undefined)).toEqual(modes);
		expect(filterModes(modes, '   ')).toEqual(modes);
	});

	it('hides modes whose id or name matches, case-insensitively', () => {
		expect(filterModes(modes, '^kiro_').map((m) => m.id)).toEqual([
			'my-writer',
			'reviewer',
		]);
		expect(filterModes(modes, 'code rev').map((m) => m.id)).toEqual([
			'kiro_default',
			'kiro_planner',
			'my-writer',
		]);
	});

	it('never hides the current mode', () => {
		expect(
			filterModes(modes, '^kiro_', 'kiro_default').map((m) => m.id)
		).toEqual(['kiro_default', 'my-writer', 'reviewer']);
	});

	it('ignores an invalid expression', () => {
		expect(filterModes(modes, '(')).toEqual(modes);
		expect(validateModeFilter('(')).not.toBeNull();
		expect(validateModeFilter('^ok$')).toBeNull();
		expect(compileModeFilter('')).toBeNull();
	});
});
