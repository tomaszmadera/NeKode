# Keep package.json at LF for Biome on Windows

When `pnpm run lint` reports formatting errors on an otherwise unchanged `package.json`, compare its worktree bytes with `git show HEAD:package.json` before treating it as a product diff. In this repository, `core.autocrlf=true` and `.gitattributes` had only `* text=auto` for JSON. The worktree had 63 CRLF endings while HEAD had 63 LF endings. Writing LF made Biome pass, but Git still reported a modified worktree path with an empty content diff.

Set `package.json text eol=lf` in `.gitattributes` to keep future Windows checkouts compatible with Biome. Verify with `pnpm run lint` and a byte comparison; do not infer success from an empty Git diff alone.
