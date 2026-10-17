# Agent instructions

## Releasing

The release workflow (`.github/workflows/release.yml`) runs only when a tag is pushed, not on a push to `main`. Tags are plain versions without a `v` prefix (e.g. `1.2.0`).

1. Bump the version: `npm version <major|minor|patch> --no-git-tag-version` (runs `version-bump.mjs`, which updates `manifest.json` and `versions.json`).
2. Commit all changes and push to `main`.
3. Tag and push the tag: `git tag X.Y.Z && git push origin X.Y.Z`.

The workflow sets the version from the tag, runs `pnpm run build`, and publishes a GitHub Release with `main.js`, `manifest.json`, `styles.css`, `README.md` and `LICENSE.md`.

## Build

- `pnpm build` type-checks (`tsc -noEmit`) and bundles with esbuild.
- `styles.css` at the repo root is the stylesheet that ships; the CSS files under `src/ui/` are not bundled.
