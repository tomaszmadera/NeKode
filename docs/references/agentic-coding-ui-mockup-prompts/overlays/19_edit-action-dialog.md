# Mockup Prompt — Add / Edit Action Dialog

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a compact action-configuration modal over Project Settings → Actions.

Title: `Add Action`
Fields:
- Title: `Docker Up`
- Icon selector: simple play icon
- Command: `docker compose up -d` in monospace
- Working Directory: `Project Root`
- Run In segmented/dropdown control: `Bottom Terminal` selected, alternatives `Background`, `New Terminal`
- checkbox `Ask for confirmation`

Buttons: `Cancel`, primary `Save`.

Make command input visually important but keep the modal compact.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.
