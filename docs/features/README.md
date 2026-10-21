# Feature contracts

One directory per feature, each with the feature's behavioral contract at `<slug>/spec.md`. The [public project contract](../development/project-contract.md) owns the source map that names the canonical owner of every concern and defines how a specification ranks in the authority order.

A specification records its own scope and accepted decisions. Its existence alone does not prove that the feature is delivered: the status line of each specification, reflected in the table below, states the delivery state.

## Specification metadata

Every `spec.md` opens with the title, a `Status:` line, and a `Path:` line:

```markdown
# Feature title

Status: Delivered (one-line statement of the delivery state).
Path: `docs/features/<slug>/spec.md`.

... the rest of the document
```

Keep the status line and the table row in sync: when a delivery state changes, update both in the same edit and name the parts that are still open.

## Status values

- `Delivered`: the surface the contract describes exists in the application.
- `Delivered in part`: the named parts are live and the row lists what is still open.
- `Not delivered`: the file contracts later work; nothing from it is in the application yet.

## Contracts

| Feature | Title | Status |
|---|---|---|
| [attention-alert-settings](attention-alert-settings/spec.md) | Attention alert settings | Delivered |
| [bottom-auxiliary-terminal](bottom-auxiliary-terminal/spec.md) | Bottom auxiliary terminal | Delivered |
| [center-layout-tabs-actions](center-layout-tabs-actions/spec.md) | Center Layout: Tab Strip, Action Row, and Status Bar | Delivered |
| [chat-attention-badge](chat-attention-badge/spec.md) | Chat attention badge | Delivered |
| [chat-terminal-activity](chat-terminal-activity/spec.md) | Chat terminal activity | Delivered |
| [ci-pipeline](ci-pipeline/spec.md) | CI: automatyczna weryfikacja na GitHub Actions | Delivered |
| [dictation-provider-architecture](dictation-provider-architecture/spec.md) | Dictation provider architecture | Not delivered (parent contract); the OpenWhispr specialization ships desktop V1 |
| [global-agent-profiles](global-agent-profiles/spec.md) | Globalne profile agentów i opt-in w projektach | Delivered |
| [handoff-resume-flow](handoff-resume-flow/spec.md) | Handoff/Resume flow | Delivered |
| [kanban-adapter-interface](kanban-adapter-interface/spec.md) | Kanban adapter interface | Delivered (adapter-backed board); drag-and-drop and the UX-UI 26-30 visual design remain later work |
| [markdown-mermaid-diagrams](markdown-mermaid-diagrams/spec.md) | Markdown preview: Mermaid diagrams | Delivered |
| [mvp-core-shell](mvp-core-shell/spec.md) | NeKode MVP Core Shell - first vertical slice | Delivered |
| [new-chat-agent-menu](new-chat-agent-menu/spec.md) | New chat agent profile menu | Delivered |
| [openwhispr-dictation](openwhispr-dictation/spec.md) | OpenWhispr dictation integration | Delivered for desktop V1; the public Cloud API stays deferred (backlog item NEKODE-37) |
| [project-environments](project-environments/spec.md) | Project environments: opening WSL projects | Delivered (WSL opening and the add-project UI extension) |
| [project-files-view](project-files-view/spec.md) | Project Files: File Tree and Read-Only Preview | Delivered |
| [project-shell-selection](project-shell-selection/spec.md) | Per-project terminal shell selection with system shell detection | Delivered |
| [public-documentation-contract](public-documentation-contract/spec.md) | Public documentation contract independent of the local harness | Delivered |
| [session-labels](session-labels/spec.md) | Session labels and agent badges | Delivered |
| [terminal-font-settings](terminal-font-settings/spec.md) | Terminal font settings | Delivered |
| [test-suite-simplification](test-suite-simplification/spec.md) | Test suite audit and simplification | Delivered |
| [usage-quota](usage-quota/spec.md) | Usage quota | Delivered (Stages 1-3 implemented, reviewed and fully verified; live provider reads not run) |
