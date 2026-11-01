import * as path from 'path';

export interface ExternalAccessConfig {
	absoluteAllowedPaths: string[];
}

/** Absolute paths must start with "/". */
export function isAbsolutePath(p: string): boolean {
	return p.startsWith('/');
}

/** True if `target` equals `root` or lies inside it. */
export function isPathInside(root: string, target: string): boolean {
	const rel = path.relative(path.resolve(root), path.resolve(target));
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** True if `target` is inside one of the absolute allowed roots (empty list allows nothing). */
export function isExternalPathAllowed(
	target: string,
	config: ExternalAccessConfig
): boolean {
	if (!isAbsolutePath(target)) {
		return false;
	}
	return config.absoluteAllowedPaths
		.filter(isAbsolutePath)
		.some((root) => isPathInside(root, target));
}
