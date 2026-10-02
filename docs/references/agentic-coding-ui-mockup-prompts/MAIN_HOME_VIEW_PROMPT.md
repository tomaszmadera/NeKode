# Main Home View Mockup Prompt

Use the following single prompt to generate **one flagship mockup** that captures the overall feel of the application before generating the rest of the interface set.

---

## Prompt

Design a high-fidelity desktop application mockup for **Windows 11** of an **agent-first coding workspace**.  
The application is **English-only** and should feel like a calm, premium, dark-first developer tool inspired by the UI philosophy of ZCode, but it must still look original and like its own product.

### Core product identity
This application is for:
- managing software projects,
- managing coding tasks,
- running coding agents in terminal sessions,
- switching between tasks,
- viewing project files,
- resuming work from handoffs,
- and organizing work through Kanban.

The mockup should represent the **main/home view** of the app in a way that communicates the entire product direction at a glance.

### Visual direction
The UI should feel:
- dark-first,
- modern,
- clean,
- compact,
- calm,
- highly usable,
- premium,
- technical,
- and visually quieter than VS Code.

Avoid making it look like:
- a generic SaaS dashboard,
- Jira,
- Trello,
- Notion,
- or a clone of VS Code.

Use:
- subtle contrast,
- compact spacing,
- restrained borders,
- very light accent usage,
- refined typography,
- minimal visual noise,
- and a strong sense of hierarchy.

### Window and layout
Show the full desktop app window.

The app should have this structure:

1. **Top Action Bar**
   - compact project action buttons such as:
     - Docker Up
     - Down
     - Tests
     - Deploy
   - a small Settings icon on the right

2. **Left Panel**
   - titled **Projects**
   - show a project-and-task tree
   - include at least two projects
   - example project names:
     - gerde.pl
     - knajpy
   - under the currently active project, show a few tasks
   - the currently active task should be clearly selected
   - use subtle status indicators for tasks such as active / completed / resumable

3. **Center Header**
   - show current project/workspace context
   - include:
     - project name
     - path
     - runtime badges such as PHP 8.5, Node 24, Docker
     - Git branch
     - worktree / change status
   - it should feel compact and information-dense without looking cluttered

4. **Main Center Surface**
   - this should show the primary active task workspace
   - the active task should be something like **Fix Meta Pixel**
   - show the task title prominently
   - show a compact agent selector such as:
     - Agent: Codex
   - include a compact Handoff control or dropdown
   - include a compact progress / checkpoint component that suggests a task lifecycle, for example:
     - Plan
     - Inspect
     - Implement
     - Test
     - Review
   - show the center content mainly as a **terminal-first workspace**
   - the terminal should contain a coding-agent session already in progress
   - example terminal content should suggest real work, such as:
     - PS D:\Projects\gerde.pl> codex
     - a short prompt or task instruction
     - ongoing reasoning/workflow output
     - commands or agent steps related to fixing a Meta Pixel currency warning
   - the terminal should feel integrated into the app, not like a random embedded widget

5. **Bottom Panel**
   - show the auxiliary terminal open
   - it should look collapsible and clearly secondary
   - show a realistic command such as:
     - php artisan test
   - the bottom-right or panel edge may hint at the shortcut:
     - Ctrl + `

6. **Right Panel**
   - keep it hidden in this mockup
   - but the layout should imply that a right-side secondary tools panel exists in the product

### Task progress / checkpoint feel
Include a compact checkpoint progress strip for the active task.
It should visually communicate:
- what stages are done,
- what stage is current,
- what remains.

Do not make it oversized.
It should feel like a helpful orientation tool, not a gamified progress bar.

### Handoff feel
The screen should subtly communicate that this app supports handoffs and resume workflows.
Do not make handoffs the dominant feature, but show enough that the idea is visible in the product identity.

### Important copy and labels
All visible UI text must be in English.

Recommended labels include:
- Projects
- Files
- Kanban
- Agent: Codex
- Handoff
- Resume
- Implement
- Docker Up
- Tests
- Deploy
- Fix Meta Pixel

### Mood and quality bar
The final image should feel like:
- a polished product mockup,
- something a startup could use in a product deck,
- coherent enough that the viewer immediately understands the app is for managing coding tasks and AI coding sessions.

The composition should communicate the product’s **entire feel** in one screen:
- project navigation,
- task focus,
- agent terminal,
- project actions,
- progress,
- and calm, premium UX.

### Constraints
- English only.
- No browser page chrome outside the application window.
- No unrealistic glossy marketing effects.
- No exaggerated neon cyberpunk styling.
- No cartoon styling.
- No light theme.
- No cluttered enterprise dashboard look.
- Keep the interface believable and implementable.

### Deliverable
Generate **one single polished main/home screen mockup** that best expresses the visual identity and UX direction of the app.

---

## Suggested usage

Use this prompt first to validate:
- overall mood,
- spacing,
- density,
- hierarchy,
- and whether the product feels like the right kind of agentic coding workspace.

Only after approving this flagship view should the rest of the mockup set be generated.
