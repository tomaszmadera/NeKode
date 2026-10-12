# Your own AGENTS.md

This repository develops NeKode with coding agents, but it does not ship agent
instructions. `AGENTS.md`, local harnesses, and tool-specific agent
configuration are personal working files and stay git-ignored (see
`.gitignore`). The public documentation is the canonical reference for project
rules; a personal agent guide must never become a second contract.

## Why your own AGENTS.md

- The repository is public and the maintainer's harness is not published: a
  clean clone must be enough to build, test, change, and release NeKode without
  it (see the [public project contract](project-contract.md)).
- Contributors use different agents and tools. Your guide adapts the canonical
  rules to your setup instead of prescribing a workflow for everyone.
- Most coding agents load `AGENTS.md` automatically, so it is the right place to
  surface the canonical rules for your agent.

## How to create it

1. Create `AGENTS.md` in the repository root. It is already git-ignored, so it
   stays yours and never enters a commit.
2. Copy the "Canonical rules" template below into it. Keep that block in sync
   with its linked owners; the links are the rules, the block is their index.
3. Add a "Personal preferences" section for your tools, workflow, and style.
4. When a rule and this guide disagree, the public documentation wins. Update
   your guide from the documentation, never the other way round.

## Template

```markdown
# AGENTS.md (personal, git-ignored)

This file is personal working configuration for this clone. The public
documentation is canonical: docs/development/project-contract.md owns
contribution rules and its source map names the owner of every concern.
If this file and the documentation disagree, the documentation wins.

## Canonical rules (keep in sync with the docs)

- Architecture and boundaries: preserve module boundaries, contracts, and
  layer separation; keep privileged APIs minimal. Owner:
  docs/architecture/sdd.md (Current implementation obligations).
- Quality and reliability: meaningful tests and verified non-breaking
  behavior; never report an unrun check as passed. Owner:
  docs/development/ci.md.
- Maintainability and simplicity: proven, readable solutions over speculative
  abstractions; fix root causes; preserve unrelated work. Owner:
  docs/development/project-contract.md (Implementation discipline).
- Product scope and terminology: docs/product/requirements.md. Feature
  behavior: docs/features/<slug>/spec.md.
- UI is English-only; follow the language of the document you edit. Owner:
  docs/development/project-contract.md (Documentation and local configuration).
- Branching: docs/operations/branching-model.md. Releases:
  docs/operations/releases.md.
- Verification: run the checks that your change can affect, per
  docs/development/ci.md; package.json scripts own the exact commands.
- Publication and destructive actions need an explicit maintainer decision.
  Owner: docs/development/project-contract.md (Authorization and publication).

## Personal preferences

- (your tools, workflow, and communication style: optional, local)
```
