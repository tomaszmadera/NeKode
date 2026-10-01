### Read CSS source directly in renderer token tests

**Lesson:** For a test comparing theme token declarations, read the repository
CSS files with `node:fs` and repository-relative paths. Keep file reads in the
test, not in renderer product code.

**Reason:** In the renderer Vitest project, CSS imports with `?raw` yielded
empty strings. Vite also transformed a `new URL` expression for a CSS asset to
a non-file URL, which `readFileSync` rejected. Direct file reads let the theme
clone test compare the actual token declarations.
