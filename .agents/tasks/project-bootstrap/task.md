---
id: project-bootstrap
schema_version: 2
status: active
intent: bootstrap
complexity: small
durability: recorded
current_phase: Phase 0
current_step: Phase 0.2
updated: 2026-09-22
branch: main
worktree: current
next_action: Resume project bootstrap in native Windows PowerShell environment
blockers: none
---

# Project Bootstrap and Readiness Preparation

## Objective

Przygotowanie projektu NeKode do pracy deweloperskiej: skompletowanie kanonicznej dokumentacji produktu, usuniecie bledow walidacji harnessa oraz przygotowanie srodowiska pod natywny rozwoj w Windows 11 (Electron, React, Vite, TypeScript, SQLite, node-pty).

## Scope

Inicjalizacja dokumentacji produktu (docs/product/requirements.md) i konfiguracji deweloperskiej (docs/development/setup.md), synchronizacja adapterow harnessa oraz przekazanie stanu do natywnego srodowiska Windows 11.

## Phase 0 - Intake and Preparation

- [x] Phase 0.1 - Audyt dokumentacji, stosu technologicznego i skilli agenta
- [ ] Phase 0.2 - Inicjalizacja konfiguracji projektu w srodowisku Windows (package.json, tsconfig, vite, biome, test runner)
- [ ] Phase 0.3 - Konfiguracja profilu projektu .agents/project-profile.yaml i weryfikacja bramek jakosci

## Decisions

- Architektura MVP oraz stos technologiczny opieraja sie o Electron + React + TypeScript + Tailwind CSS + Vite + better-sqlite3 + node-pty zgodnie z SDD.md.
- Kompilacja modulow natywnych C++ (node-pty, better-sqlite3), instalacja zaleznosci oraz uruchamianie aplikacji musza odbywac sie natywnie w Windows 11 (PowerShell), a nie w WSL, ze wzgledu na wymagania ConPTY API oraz binaria DLL.
- Menedzer pakietow: pnpm, linter/formatter: Biome, model wersjonowania: linear z SemVer.

## Changed files

- `.claude/skills/kanban/SKILL.md`
- `.grok/skills/kanban/SKILL.md`
- `docs/product/requirements.md`
- `docs/development/setup.md`
- `.agents/tasks/project-bootstrap/task.md`

## Verification

| Check | Result | Notes |
|---|---|---|
| `validate_agent_config` | pass | Spojnosc 18 skilli i adapterow w .agents/scripts/validate-config |
| `preflight` | pass | Poprawny odczyt repozytorium w WSL |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-22T16:20:00Z | 2026-09-22T16:30:00Z |
| work | work | 2026-09-22T16:30:00Z | 2026-09-22T16:35:00Z |
| handoff | wait | 2026-09-22T16:35:00Z | |

## Risks and blockers

- Proba budowania lub uruchamiania node-pty i better-sqlite3 w WSL wygeneruje binaria ELF niekompatybilne z Windows 11. Dalsze prace instalacyjne i weryfikacyjne nalezy wykonywac w PowerShell na Windows.

## Resume instructions

Otworz terminal PowerShell w systemie Windows w katalogu F:\projects\NeKode. Uruchom sesje agenta lub wykonaj instrukcje wznowienia z .agents/handoffs/project-bootstrap.md.
