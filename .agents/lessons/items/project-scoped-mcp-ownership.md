# Check MCP ownership before changing server availability

When `codex doctor` reports an unavailable MCP server, check where its configuration is defined and which project owns it before proposing to disable it. A user-level `~/.codex/config.toml` entry makes the server available in unrelated repositories. For a server owned by one trusted project, place its entry in that project's `.codex/config.toml` and remove the user-level entry.

The `unityMCP` entry was global while `F:\projects\vrc-meido\AGENTS.md` assigns Unity avatar work to `vrc-meido`. After moving the entry to `F:\projects\vrc-meido\.codex\config.toml`, `codex mcp list` showed `unityMCP` in `vrc-meido` and not in NeKode.
