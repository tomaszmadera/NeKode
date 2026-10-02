# Mockup Prompt — Active Task Workspace

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the default daily-work screen with an active Task running a console coding agent.

Left panel:
`Projects`
- expanded `gerde.pl`
  - selected task `Fix Meta Pixel` with a subtle running indicator
  - `SEO Cleanup`
  - `Hero Redesign`
- collapsed/partially expanded `knajpy`
  - `Authentication`
  - `Reviews`

Top Action Bar for gerde.pl:
`Docker Up`, `Docker Down`, `Tests`, `Deploy`, plus a compact Settings icon at the far right before window controls.

Center context header:
- title `Fix Meta Pixel`
- secondary context: `gerde.pl · D:\Projects\gerde.pl · PHP 8.5 · Node 24 · Docker`
- Git: `feature/meta-pixel`
- worktree status: `3 changes`
- compact agent selector: `Agent: Codex ▾`
- compact `Handoff ▾` action

Directly below the Task context, include a compact checkpoint strip:
`Plan` completed → `Inspect` completed → `Implement` active → `Test` pending → `Review` pending.
Use a thin connected progress line and small checkpoint markers; do not make it look like a wizard.

Main Surface:
- large integrated terminal, minimal chrome
- realistic PowerShell prompt: `PS D:\Projects\gerde.pl> codex`
- realistic agent output about inspecting Meta Pixel currency handling and modifying PHP files
- terminal should dominate the center

Bottom terminal hidden. Right panel hidden. This should feel like the canonical main screen of the product.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.
