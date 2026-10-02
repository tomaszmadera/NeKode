# Mockup Prompt — Project Files + Read-only Preview

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show Project-level Files view for `gerde.pl`.

Top Action Bar remains visible with project actions.

Left panel is in **Project File Tree mode**, replacing the normal Projects/Tasks list. At the top show a subtle back affordance `← Projects` and Project name `gerde.pl`.

File tree:
- app/
  - Http/
  - Models/
  - Services/
    - selected `MetaPixelService.php`
- resources/
- routes/
  - web.php
- composer.json
- package.json

Center context header:
`gerde.pl`
`D:\Projects\gerde.pl · PHP 8.5 · Node 24 · Docker · main · clean`

Below it show project tabs:
`Files` active, `Kanban` inactive.

Main Surface:
- breadcrumb `app / Services / MetaPixelService.php`
- large read-only Monaco-like code preview with line numbers and tasteful PHP syntax highlighting
- no edit/save controls

Right and bottom panels hidden. The File Tree transition should be visually compatible with a subtle horizontal slide from the Projects/Tasks navigation.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.
