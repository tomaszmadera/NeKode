# Mockup Prompt — Task Progress Expanded

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the active Task workspace with the checkpoint progress component expanded directly under the Task header, demonstrating the richer progress state without overwhelming the terminal.

Task: `Fix Meta Pixel`, agent `Codex`.

Expanded timeline:
- `Plan` — completed
- `Inspect` — completed
- `Implement` — completed
- `Test` — active
- `Review` — pending

For the active `Test` checkpoint, show a small expanded detail row beneath the timeline:
`Running checkout event verification`
`Last update: 10:42`

Below this component, the terminal continues normally. The component should be easy to collapse to a compact `3/5 · Test` state.

Do not turn progress into a productivity metric; no ETA and no fake precise percentage.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.
