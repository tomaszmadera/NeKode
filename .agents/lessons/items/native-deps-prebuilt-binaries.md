### Native deps on Windows need prebuilt binaries, not VS Build Tools

**Lesson:** Prefer dependency versions that ship prebuilt binaries for the host Node ABI (better-sqlite3 >= 12 for Node 24, node-pty N-API prebuilds). Treat `pnpm-workspace.yaml` (`allowBuilds`, `onlyBuiltDependencies`) as the standing gate for install-time build scripts; add every new native dependency there.

**Reason:** This host has no Visual Studio C++ Build Tools, so `node-gyp rebuild` fails ("Could not find any Visual Studio installation"). better-sqlite3 11.x has no prebuilt binary for Node 24 and broke `pnpm install`; upgrading to 12.x fixed it without a multi-GB toolchain install.
