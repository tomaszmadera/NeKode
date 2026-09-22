# Master Visual System Prompt

Use this visual system for **every mockup in this set**. The goal is strong cross-screen consistency.

## Product
A Windows 11 desktop application for agentic software development. It is an **agent-first coding workspace**, not a VS Code clone and not a chat app. The product model is **Project → Task → Workspace**. In the MVP, coding agents run in terminals as console applications. The interface is English-only.

## Visual direction
Create a polished, production-ready, high-fidelity desktop UI inspired by the calm density and dark technical character of ZCode, but **do not copy ZCode literally**. Make the design original and coherent.

- dark-first, graphite / blue-black surfaces
- restrained cool blue-violet accent
- crisp Windows desktop feel, not macOS
- compact developer-tool density
- minimal visual noise
- subtle separators instead of boxes around everything
- no decorative gradients, glassmorphism, neon glow, cyberpunk styling, or oversized cards
- 4–8 px corner radius, mostly 6 px
- 4 / 8 / 12 / 16 / 24 px spacing rhythm
- main UI typography: clean Geist/Inter/Segoe-like sans, 13–14 px
- code/terminal: JetBrains Mono-like monospace, 13–14 px
- primary text near-white, secondary text muted cool gray
- semantic colors are restrained and used only where meaningful

Suggested palette for consistency:
- app background: #0D0F12
- primary surface: #12151A
- raised surface: #171B21
- hover/selection: #1D222A
- separator: #262C35
- primary text: #E7E9ED
- secondary text: #969EAA
- accent: #7C8CFF
- success: #6BC59A
- warning: #D3A24B
- error: #DB6B75

## Window and composition
Generate a **front-facing desktop application mockup**, approximately 16:10, ideally 1600×1000 or equivalent. Show the application window directly — no laptop, monitor, desk, hands, perspective, or marketing scene.

Use a minimal Windows-style custom title area with normal minimize/maximize/close controls at the top-right. The product UI itself follows this shell:

1. **Top Action Bar** — configurable project actions such as Docker Up, Tests, Deploy.
2. **Left navigation** — normally Projects → Tasks; may contextually transform into a Project File Tree.
3. **Center context header** — Project name, path, runtimes, Git branch, worktree/Git status.
4. **Center Main Surface** — terminal, file preview, Kanban, settings, etc.
5. **Bottom auxiliary panel** — hidden by default; terminal toggled with Ctrl + `.
6. **Right secondary panel** — hidden by default; future Browser or second Terminal.

Default dimensions:
- left panel: ~280 px
- center: flexible and dominant
- right panel when open: ~420 px
- bottom panel when open: ~250 px

## Core UI language
Use only English labels. Use realistic, short developer content. No lorem ipsum. Avoid unnecessary brand logos.

Default example project can be `gerde.pl`; secondary project can be `knajpy`. Example task names:
- Fix Meta Pixel
- SEO Cleanup
- Hero Redesign
- Authentication
- Reviews

Default console agent: **Codex**. Alternative agents may include Claude Code, OpenCode, agy, Gemini CLI.

## Persistent product behaviors reflected visually
- Task is the central work object.
- A Kanban card and a Task in the left tree are the same underlying entity.
- Task workspace is terminal-first in MVP.
- Current Project context should expose path, runtime, branch and worktree/Git status.
- Handoffs belong to Tasks and can be resumed with one click.
- Kanban uses `Implement` for new coding work and `Resume` for active/handed-off work.
- Active Tasks may show a compact checkpoint progress strip.
- Default Console Agent can be overridden per Project, Task, or action.

## Motion implication in static mockups
Even in a still image, design elements so subtle animations are plausible: stable panel widths, clear hierarchy, lightweight selection states, no layouts that would require dramatic movement.

## Negative constraints
Do not make it look like:
- VS Code with a chat panel
- JetBrains IDE
- Trello/Jira dashboard
- a consumer SaaS analytics dashboard
- a futuristic game HUD
- macOS

Do not add features not requested. Do not fill empty space with random metrics, charts, AI avatars, assistant bubbles, or decorative panels.

## Output rule
Produce only the requested high-fidelity UI mockup. Do not add an explanation outside the mockup unless the specific prompt requests a storyboard or component study.
