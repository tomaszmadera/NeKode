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


---

# All View Prompts


---

# Mockup Prompt — Welcome / No Projects

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the first-run empty state of the application.

Layout:
- top custom Windows title area and an otherwise mostly empty Project Action Bar; no project-specific actions yet
- left panel titled `Projects` with a compact `+ Add Project` control
- center is a calm empty state, not a marketing landing page
- right and bottom panels hidden

Center content:
- heading: `No projects yet`
- supporting sentence: `Add a local project to start working.`
- primary button: `Add Project`
- small secondary hint below: `Projects, tasks, terminals and handoffs stay organized in one workspace.`

Keep the empty state small and centered within the main work area. No illustration larger than a tiny abstract folder/code icon. Make this look ready for daily professional use.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

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


---

# Mockup Prompt — Task Not Started

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a Task that exists but has no active terminal session yet.

Use the same normal Projects/Tasks left panel and project Action Bar as the main screen. Select `SEO Cleanup` under `gerde.pl`.

Center context header:
- Task title `SEO Cleanup`
- Project path/runtime/Git context
- `Agent: Codex ▾`

Main Surface should be sparse and purposeful:
- title `SEO Cleanup`
- status `No active session`
- compact agent selector with `Codex` selected
- primary button `Start`
- subtle secondary action `Open Project Files`

Optionally show a compact planned checkpoint sequence beneath the title: `Inspect · Implement · Verify · Review`, all pending.

Do not show chat bubbles or a fake conversation. The screen should clearly communicate that starting the Task will launch the configured console agent in its terminal workspace.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Ended Session with Handoff Available

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a Task workspace after its terminal session ended, with a useful Handoff available.

Select `Fix Meta Pixel` in the left Task tree.

Center header preserves Project, runtime, branch and Git/worktree status.
Checkpoint strip shows `Plan`, `Inspect`, `Implement` completed; `Test` is the current checkpoint; `Review` pending.

Main Surface:
- muted terminal history still visible in the background
- a compact inline state panel near the top of the terminal area, not a giant modal
- label: `Session ended`
- label: `Handoff available`
- short Handoff preview: `Currency handling was normalized. Next: rerun checkout tracking test and verify the browser event.`
- primary button `Resume from Handoff`
- secondary button `Restart`
- agent selector `Codex ▾`

The design should make Resume the obvious next action without turning the screen into an error state.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

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


---

# Mockup Prompt — Project Kanban

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the Project Kanban for `gerde.pl` as a first-class work surface.

Left panel uses the normal Projects/Tasks navigation, with `gerde.pl` selected/expanded.
Top Action Bar shows project actions.
Center context header shows project path, PHP 8.5, Node 24, Docker, Git branch `main`, and `3 changes`.
Tabs: `Files` inactive, `Kanban` active.

Kanban occupies the main center surface with four columns:
`Backlog`, `Todo`, `In Progress`, `Done`.

Use realistic cards:
- Backlog: `SEO Audit` with primary `Implement`
- Todo: `Fix Meta Pixel` with `Implement`
- Todo: `PHPStan Cleanup` with `Implement`
- In Progress: `Auth Cleanup`, agent `Codex`, compact progress `3/5 · Implementing`, `Handoff available`, primary `Resume`
- Done: `Docker Setup`, subtle completed state

Cards should be compact, not Trello-like oversized white boxes. Dark surfaces, minimal metadata, understated column headings. No analytics. Make `Implement` and `Resume` clearly interactive but not huge.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Global Kanban — Future

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the future global Kanban across multiple Projects while preserving the same app shell and visual language.

Top-level navigation should make it clear the user is in a global `Kanban` area rather than a single Project. Keep this subtle; do not invent a large dashboard sidebar.

Columns:
`Backlog`, `Todo`, `In Progress`, `Review`, `Done`.

Each card must include a small Project identity because multiple Projects are mixed:
- `gerde.pl` / `Fix Meta Pixel`
- `knajpy` / `Authentication`
- `game` / `Terrain Spike`
- `vrchat-bot` / `Idle Animation Integration`

Use a mixture of `Implement`, `Resume`, progress like `2/4`, agent labels, and Handoff availability.

The screen should still feel like the same coding workspace, not Jira. No charts, sprint metrics, avatars, story points, or enterprise PM clutter.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Active Task + Auxiliary Bottom Terminal

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the canonical active Task workspace, but with the auxiliary bottom terminal opened using Ctrl + `.

Use the same selected Task `Fix Meta Pixel`, same header, agent selector, checkpoint strip and primary terminal as the Active Task Workspace.

Split the center vertically:
- upper ~70%: primary Task terminal where Codex is working
- lower ~30%: auxiliary terminal with a slim header `Terminal`, a small close/collapse icon and realistic command `php artisan test`

The bottom terminal must look like a secondary tool, not a second equal workspace. Show a subtle draggable separator. Preserve the hidden right panel.

Add a tiny shortcut hint `Ctrl + `` in the bottom panel header, visually secondary.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Active Task + Right Browser

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show an active frontend-oriented Task with the right secondary panel open as a Browser.

Left: normal Projects/Tasks navigation.
Center: active Task terminal with compact Task checkpoint strip and agent `Codex`.
Right panel ~420 px wide:
- header `Browser`
- simple address field showing `http://localhost:3000`
- refresh/open-externally controls
- embedded clean preview of a web application page

The Browser is a supporting tool and should not dominate. The center Task terminal remains primary. Use a subtle vertical divider and allow the center to compress naturally.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Active Task + Second Right Terminal

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show an active Task with the right secondary panel opened as a second terminal.

Center remains the primary Task terminal with Codex.
Right panel header: `Terminal 2` with small controls.
Right terminal content runs `docker compose logs -f app` with realistic log output.

Keep bottom panel hidden. The right terminal is secondary and narrower; no equal 50/50 split. Maintain project context header and checkpoint strip in the center.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Project Settings — General

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show `Project Settings` for `gerde.pl`, General section.

Keep the application shell visible but let Settings occupy the center Main Surface. Left project navigation remains present.

Inside Settings use a compact local settings navigation:
`General` active, `Agent`, `Actions`.

General form:
- Project Name: `gerde.pl`
- Path: `D:\Projects\gerde.pl` with `Reveal in Explorer`
- detected runtimes displayed read-only: `PHP 8.5`, `Node 24`, `Docker`
- Git repository: `Detected`
- Default working directory: `Project root`

Use restrained form controls, not huge settings cards. Buttons: `Save Changes` only if needed and a subtle `Remove Project…` danger action near the bottom.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Project Settings — Agent

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show `Project Settings` → `Agent` for `gerde.pl`.

Compact settings side navigation: `General`, `Agent` active, `Actions`.

Content:
- section title `Preferred Agent`
- dropdown currently `Use global default (Codex)`
- alternatives listed or implied: Codex, Claude Code, OpenCode, agy, Gemini CLI
- explanatory secondary text: `Used when a Task does not define its own agent.`
- compact read-only summary of effective command: `codex`
- small link/button `Manage Agents…`

Optionally include `Task overrides` explanation, but keep the page sparse.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Project Settings — Actions

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show `Project Settings` → `Actions` for `gerde.pl`.

Settings navigation: `General`, `Agent`, `Actions` active.

Main list contains compact configurable action rows:
1. `Docker Up` — `docker compose up -d` — `Bottom Terminal`
2. `Tests` — `php artisan test` — `Bottom Terminal`
3. `Deploy` — `bash scripts/deploy.sh` — `Bottom Terminal` — confirmation enabled

Each row has a small icon, title, command in monospace, execution target, and overflow menu. Provide a compact `Add Action` button.

At the bottom show a subtle note that repository-defined actions may be supported later. Do not create giant cards.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Manage Console Agents

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a global `Manage Agents` settings view.

List configured console agents in compact rows:
- Codex — command `codex` — badge `Default`
- Claude Code — command `claude`
- OpenCode — command `opencode`
- agy — command `agy`
- Gemini CLI — command `gemini`

Selected `Codex` details appear in a right-side section within the center surface:
- Name
- Command
- Arguments (optional)
- Working Directory behavior: `Task Workspace`
- Environment: `Inherit`
- checkbox/action `Set as Default` shown as already active

Buttons: `Add Agent`, `Save` where appropriate. No provider API keys or model pricing; these are console-agent launch definitions.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Task Handoff History

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a Task-focused Handoff history surface for `Fix Meta Pixel`.

Keep Project/Task navigation on the left and the Task context header above.

Main Surface is split into:
- a narrow Handoff history list with entries `Today 10:11`, `Yesterday 22:48`, `Yesterday 18:30`
- a larger Handoff detail panel for the newest entry

Detail content:
- `Summary`: `Normalized Meta Pixel currency handling in checkout tracking.`
- `Current State`: test still needs to be rerun in browser
- `Next Steps`: verify Purchase event, then review diff
- `Relevant Files`: `MetaPixelService.php`, `CheckoutTracker.php`
- Branch: `feature/meta-pixel`
- Agent: `Codex`
- Current checkpoint: `Test`

Primary action: `Resume`
Secondary actions: `Copy`, `Create New Handoff`

This should feel like a continuation tool, not a notes app.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

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


---

# Mockup Prompt — Add Project Dialog

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the normal application shell dimmed subtly behind a compact centered modal.

Modal title: `Add Project`
Fields/content:
- Local Directory input showing `D:\Projects\new-project`
- `Browse…` button
- detected preview area: `Git repository detected`, `PHP`, `Docker`
- optional Project Name prefilled from folder

Buttons: `Cancel`, primary `Add Project`.

The modal is compact and technical, not a setup wizard. Keep the underlying Projects left panel visible enough to establish context.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — New Task Dialog

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a compact modal over the Project Kanban or Project workspace.

Title: `New Task`
Fields:
- Title: `Fix Meta Pixel`
- Status dropdown: `Todo`
- Agent dropdown: `Use project default (Codex)`
- optional Description textarea, visibly optional and small

Buttons: `Cancel`, primary `Create Task`.

Keep the flow fast; no multi-step wizard and no mandatory technical metadata.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

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


---

# Mockup Prompt — Create Handoff Dialog

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show `Create Handoff` as a focused modal over an active Task terminal.

Fields:
- Summary — prefilled realistic concise text
- Current State — multiline
- Next Steps — multiline
- Agent — `Codex`, read-only or selector
- Branch — `feature/meta-pixel`, read-only
- Current checkpoint — `Test`, compact selector/status

Optional small collapsed section `Relevant Files` listing two files.

Buttons: `Cancel`, primary `Save Handoff`.

This should feel optimized for quickly pausing work, not like writing a project report.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Resume Handoff Preview

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show an optional lightweight `Resume Task` modal/popover before resuming from a Handoff.

Content:
- Task: `Fix Meta Pixel`
- Project: `gerde.pl`
- Agent: `Codex ▾`
- Branch: `feature/meta-pixel`
- Handoff preview: `Currency handling is normalized. Next: rerun checkout tracking test and verify Purchase event.`
- checkpoint summary: `3/5 · Test`

Primary action `Resume`.
Secondary `Cancel`.

Make clear that normal fast Resume can be one click; this preview is compact and optional, not a mandatory wizard.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Original Agent Unavailable

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a small recovery dialog triggered while resuming a Handoff.

Title: `Original agent is unavailable`
Supporting text: `This handoff was created with Claude Code. Choose another configured console agent to continue.`
Dropdown: `Codex ▾`
Small effective command preview: `codex`

Buttons: `Cancel`, primary `Resume`.

The underlying Task/Handoff screen remains visible. This is a recoverable state, not a scary error page.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Dangerous Project Action Confirmation

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a confirmation modal after clicking the Project Action `Deploy`.

Title: `Run Deploy?`
Command block in monospace:
`bash scripts/deploy.sh`

Secondary details:
- Project: `gerde.pl`
- Working Directory: `D:\Projects\gerde.pl`

Buttons: `Cancel`, primary `Run` with a restrained warning treatment.

Do not use alarming red unless the action is destructive. This is explicit confirmation, not an error.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Task Context Menu

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show the normal Projects/Tasks left panel with a context menu opened on `Fix Meta Pixel`.

Menu items, grouped logically:
- Open
- Resume (if applicable)
- Rename
- Change Agent
- Create Handoff
- separator
- Open Project Files
- Open Kanban
- Reveal Workspace
- separator
- Terminate Terminal
- Delete Task

Use a compact dark menu with keyboard-friendly spacing. `Delete Task` is subtly destructive. Do not show irrelevant disabled items.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Missing Project Directory State

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a selected Project whose local directory is unavailable.

The app shell remains normal; center shows a concise actionable state:

`Project directory is unavailable`
`D:\Projects\gerde.pl`

Primary action: `Locate Directory`
Secondary: `Remove Project`

Left Projects list still includes gerde.pl with a subtle warning indicator.
Do not use a full-screen fatal error treatment.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Agent Command Not Found State

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Show a Task start/resume attempt that failed because the configured console command does not exist.

Center inline error panel or compact modal:
`Could not start Codex`
`Command: codex`
`The command was not found.`

Actions:
- primary `Configure Agent`
- secondary `Open Terminal`

Keep the Task context, checkpoint strip and Project information visible behind/around the error so the user remains oriented.

## Output

Generate one high-fidelity desktop UI mockup. Output the mockup only.


---

# Mockup Prompt — Checkpoint Progress Component Study

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a **UI component study board**, not a full application screen, using the same dark visual system. Show the Task checkpoint progress component in four realistic variants:

A. Compact header strip:
`Plan` ✓ — `Inspect` ✓ — `Implement` active — `Test` ○ — `Review` ○

B. Collapsed summary:
`Progress: 3/5 · Implementing`

C. Failure/recovery state:
`Plan` ✓ — `Inspect` ✓ — `Implement` active — `Test` failed — `Review` pending

D. Unknown/dynamic progress:
`Plan` ✓ — `Inspect` ✓ — `Implement` ✓ — `Investigating…` active, without a percentage

Use small connected checkpoint markers, clear accessible icons, restrained accent colors, and no continuous glowing/pulsing. Include tiny labels for state semantics. The component must look suitable for placement in a Task header or immediately above a terminal.

## Output

Generate one high-fidelity component study board with the four variants, consistent with the application visual system.


---

# Mockup Prompt — Kanban Card State Study

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a component study board showing the same compact Kanban Task card in six states:

1. Backlog — `SEO Audit` — `Implement`
2. Todo — `Fix Meta Pixel` — agent `Codex` — `Implement`
3. In Progress — `Auth Cleanup` — `3/5 · Implementing` — `Resume`
4. Handoff available — `Auth Cleanup` — `Handoff available` — `Resume`
5. Review — `Checkout Tracking` — `Tests passed` — `Open`
6. Done — `Docker Setup` — completed, visually quiet

Cards should be dense, dark, subtle and clearly from the same Kanban system. Do not make them look like white Trello cards. Show hover-revealed overflow control on one example.

## Output

Generate one high-fidelity component study board containing all six Kanban card states.


---

# Mockup Prompt — Project Action Bar State Study

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a component study for the configurable Project Action Bar.

Show a compact horizontal bar with actions:
`Docker Up`, `Docker Down`, `Tests`, `Deploy`.

Demonstrate states:
- idle action
- hover action
- running: `◌ Tests`
- success: `✓ Docker Up`
- failure: `✕ Deploy`
- long-running: `● Dev Server`

Also show a compact overflow state when horizontal space is limited: visible frequent actions plus `More ▾`.

Buttons must look like integrated developer-tool controls, not pill-shaped SaaS chips.

## Output

Generate one high-fidelity component study board for Project Action Bar states.


---

# Mockup Prompt — Motion Storyboard — Projects/Tasks → File Tree

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a **three-frame motion storyboard** showing the subtle transition of the left navigation from Projects/Tasks mode to Project File Tree mode.

Frame 1 — Before:
left panel shows Projects with `gerde.pl` and Tasks; center is Project surface.

Frame 2 — Transition:
old inner content shifted about 12–16 px left with slightly reduced opacity; new File Tree content entering from the right; panel width remains fixed; no whole-window movement.

Frame 3 — After:
left panel shows `← Projects`, `gerde.pl`, then its file tree; center shows read-only file preview.

Annotate tiny motion hints such as `~180 ms ease-out`, but keep the storyboard itself production-quality. No bounce, no scale pop, no parallax.

## Output

Generate one high-fidelity three-frame UX motion storyboard.


---

# Mockup Prompt — Motion Storyboard — One-click Resume from Handoff

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a **four-frame motion storyboard** showing one-click Resume from a Kanban Handoff.

Frame 1: Project Kanban card `Auth Cleanup`, `Handoff available`, button `Resume`.
Frame 2: immediately after click, card button becomes `Resuming…`; target Task starts to highlight in the left Project tree.
Frame 3: center surface transitions into the Task workspace; checkpoint strip restores to `Test` active; terminal surface appears.
Frame 4: terminal launches `Codex`, with a subtle temporary label `Resumed from Handoff` and realistic continuation context ready.

Transitions should imply ~150–300 ms UI motion before process startup. No loading-screen takeover and no mandatory modal.

## Output

Generate one high-fidelity four-frame UX motion storyboard.


---

# Mockup Prompt — Motion Storyboard — Bottom Terminal Toggle

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a **three-frame motion storyboard** for `Ctrl + `` toggling the auxiliary bottom terminal.

Frame 1: active Task terminal fills center; bottom panel hidden.
Frame 2: bottom panel is halfway expanded upward with the primary terminal smoothly resizing; subtle horizontal separator visible.
Frame 3: bottom terminal fully open at ~250 px height, focused, showing `php artisan test`; primary terminal remains above.

Annotate `Ctrl + `` and `~200 ms ease-out`. No bounce. Hiding should be understood as the exact reverse and must not terminate the process.

## Output

Generate one high-fidelity three-frame UX motion storyboard.


---

# Mockup Prompt — Motion Storyboard — Project / Task Switching

MANDATORY SHARED VISUAL CONTRACT: Windows 11 dark desktop app, high-fidelity production UI, original ZCode-inspired calm technical aesthetic; graphite/blue-black surfaces (#0D0F12, #12151A, #171B21), subtle #262C35 separators, near-white text, muted gray secondary text, restrained #7C8CFF accent; compact 13–14 px developer-tool density; 6 px radii; no glassmorphism, neon, gradients, huge cards, macOS styling, VS Code activity bar, AI avatars or dashboard charts. Full front-facing app window, roughly 16:10, no device frame. English UI only. Left panel ~280 px, center dominant, right panel hidden unless explicitly requested, bottom panel hidden unless explicitly requested. Top Project Action Bar remains compact. Use realistic developer content, not lorem ipsum.

## Screen to generate

Create a **three-frame motion storyboard** demonstrating spatially stable switching from a Project Kanban to a Task workspace.

Frame 1: `gerde.pl` Kanban with `Fix Meta Pixel` card.
Frame 2: user selects the Task; left selection changes immediately; center content is in a very short crossfade / ~8 px horizontal transition; top Action Bar and left-panel width do not jump.
Frame 3: active Task terminal appears with context header, agent `Codex` and checkpoint strip.

Annotate motion guidance: `Task switch 80–140 ms`, `preserve spatial memory`, `do not animate terminal text`.

## Output

Generate one high-fidelity three-frame UX motion storyboard.
