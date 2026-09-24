# Skille agentów (agent-skills)

Wspólne, projektowe źródło skilli dla Codexa i Hermesa: `.agents/skills/<name>/SKILL.md`.
Format wg https://agentskills.io/specification (frontmatter `name`/`description`,
`name` = nazwa katalogu). Opis to metadana odkrywania: ma podawać wyzwalacze
("Use when ..."), w jednej linii (płaski parser metadanych harnessu
i generatory adapterów nie obsługują składni wielolinijkowej).

Skille nie powielają polityk nadrzędnych (`AGENTS.md`, `.agents/engineering.md`,
`.agents/safety.md`); linkują je i dodają wyłącznie wiedzę dziedzinową. Routing:
opisy skilli + krótka wzmianka w `AGENTS.md`; nie wczytywać wszystkich skilli
przy starcie.

## Skille vendored (pobrane, bez zmian merytorycznych)

| Skill | Źródło | Katalog źródłowy | Commit | Licencja |
|---|---|---|---|---|
| vercel-react-best-practices | https://github.com/vercel-labs/agent-skills | `skills/react-best-practices/` | 063bee94c3f4df8453406c830b0a7df0f2860278 | MIT (pole `license` w SKILL.md) |
| vercel-composition-patterns | https://github.com/vercel-labs/agent-skills | `skills/composition-patterns/` | 063bee94c3f4df8453406c830b0a7df0f2860278 | MIT (pole `license` w SKILL.md) |
| web-design-guidelines | https://github.com/vercel-labs/agent-skills | `skills/web-design-guidelines/` | 063bee94c3f4df8453406c830b0a7df0f2860278 | brak deklaracji w SKILL.md i pliku LICENSE w repoźródle; sąsiednie skille tego repo deklarują MIT |
| frontend-design | https://github.com/anthropics/skills | `skills/frontend-design/` | 33375500bcea98d610eb30ce10ac4e59b89c390d | Apache License 2.0 (`LICENSE.txt` w katalogu skilla) |

Instalacja: `npx skills add <repo> -a codex -s <name> --copy` (kopia, nie
dowiązanie: Windows/WSL; zakres projektowy, nigdy `-g`). Identyfikatory
katalogów odpowiadają polom `name` w SKILL.md. `skills-lock.json` w korzeniu
repozytorium zapisuje źródła i sumy SHA-256 SKILL.md dla aktualizacji.

Żaden pobrany skill nie zawiera katalogu `scripts/` ani plików wykonywalnych
(sprawdzone przy instalacji). Modyfikacje vendored są zakazane poza koniecznością
techniczną; jedyna taka zmiana: opis `vercel-composition-patterns` złożony do
jednej linii (płaski parser metadanych harnessu), treść identyczna.

## Skille własne

| Skill | Zakres | Podstawa w kodzie |
|---|---|---|
| electron-ipc | kontrakt IPC, preload bridge, walidacja payloadu i nadawcy, transport błędów | `src/shared/ipc-contract.ts`, `src/shared/ipc-error.ts`, `src/preload/app-api.ts`, `src/main/ipc/*`, `src/main/security/sender-guard.ts` |
| electron-native | ABI modułów natywnych, prebuildy, `allowBuilds`, pakowanie, instalatory | `package.json`, `pnpm-workspace.yaml`, `electron-builder.yml`, `docs/development/setup.md`, `.agents/lessons/items/` |
| terminal-lifecycle | cykle życia widoku xterm, PTY, sesji agenta i aplikacji, ConPTY, buforowanie | `src/shared/ipc-contract.ts` (kanały terminals), `src/main/ipc/*` (stub Stage 3), `docs/features/mvp-core-shell/spec.md` |
| database | SQLite: schemat, migracje, transakcje, serwisy, app_state | `src/main/db/*`, `src/main/services/*`, `src/main/services/create-services.ts` |
| electron-e2e | smoke i regresje w prawdziwym Electronie, izolacja userData, buildy Windows | `vitest.config.ts` (warstwa jednostkowa), `docs/development/setup.md` (CDP, instalator) |
| git-worktrees | izolacja agentów w worktrees, własność branchy, zamykanie | Git worktree + `.agents/tasks/`, `.agents/handoffs/` (bez nowego systemu handoff) |

## Adaptery dla agentów zewnętrznych

Kanoniczny katalog to `.agents/skills/`. Claude Code i Grok Build czytają cienkie
adaptery (sam frontmatter + wskaźnik) w `.claude/skills/<name>/SKILL.md` i
`.grok/skills/<name>/SKILL.md`, generowane przez `render_skill_wrapper` z
`.agents/scripts/common.py`. `.agents/scripts/validate-config` wymaga dokładnie
jednego adaptera na skill i wykrywa adaptery przestarzałe. Po dodaniu skilla
lub zmianie jego `name`/`description` wygeneruj adaptery ponownie tym samym
szablonem i uruchom walidator. Nie twórz drugich kopii treści skilli.

## Decyzje (co pominięto i dlaczego)

- `skill-creator` (anthropics/skills): pominięty. Codex ma wbudowany
  skill-creator, Hermes ma własne narzędzia autorstwa skilli; kopia
  projektowa tworzyłaby konflikt nazw bez nowej możliwości.
- `playwright-cli` (skill, microsoft/playwright-cli) i pakiet `@playwright/cli`:
  pominięte. NeKode to aplikacja okna Electron bez ścieżki testów
  przeglądarkowych (renderera testuje się w jsdom przez Vitest); instalacja CLI
  zmieniłaby `package.json` i lockfile bez bieżącego użycia. Testy e2e obejmuje
  skill `electron-e2e` (Playwright `_electron` jako przyszły harness, dodany
  przy pierwszym zadaniu e2e, z kontrolą `allowBuilds`).
- `frontend-design` (anthropics/skills): dołączony opcjonalnie, bo roadmapa
  obejmuje budowę nowych ekranów. Pierwszeństwo ma design system NeKode:
  `docs/references/NeKode-Design-System.md` i `docs/UX-UI.md`; skill nie może
  go zmieniać, służy tylko jakości warsztatu nowych ekranów.

## Aktualizacja skilli vendored

1. `npx skills update -p -y` z katalogu głównego (aktualizuje wg
   `skills-lock.json`).
2. Przejrzeć diff SKILL.md i `rules/`; przed użyciem obejrzeć każdy nowy
   skrypt (obecnie brak). Nie uruchamiać dostarczonego kodu bez przeglądu.
3. Zaktualizować tabelę pochodzenia wyżej (commit, licencja) oraz
   zregenerować adaptery (sekcja Adaptery) i uruchomić
   `python .agents/scripts/validate-config`.
4. Przy nowym źródle: `npx skills add <repo> --list`, potem `-s <name> --copy`,
   nigdy `--all`.

## Udostępnienie agentom

- Codex: czyta `.agents/skills/` natywnie. Po dodaniu skilli otwórz nową sesję, jeśli bieżąca ich nie widzi. Weryfikacja 2026-09-24 przez `codex exec` nieudana z powodu limitu użycia konta (ponowna próba po 2026-09-26); status w sesji Codexa: niezweryfikowany. Gdy zewnętrzny agent jest niedostępny (limit użycia, login), niezależny review i weryfikacje wykonuje świeży subagent tego samego agenta co main, z zapisem podmiany w dowodach review (fallback: `.agents/workflows/references/extra-session.md`).
- Hermes: wspiera `<repo>/.agents/skills/` po zaufaniu repozytorium:

  ```bash
  hermes skills trust
  hermes skills list
  ```

  Weryfikacja 2026-09-24: sesja Hermesa w tym repozytorium wyświetliła
  wszystkie skille projektowe (repozytorium było już zaufane). Dla nowego
  checkoutu wykonaj oba polecenia powyżej i potwierdź listę przed pracą.
  `skills.external_dirs` w `~/.hermes/config.yaml` jest tylko awaryjną opcją
  przy niedziałającym wykrywaniu projektowym; nie prowadź dwóch kopii.

## Konflikty nazw

Przed dodaniem sprawdź `name` wobec skilli projektowych i wbudowanych agentów
(`npx skills add <repo> --list`, `hermes skills list`). Nazwa musi być
unikalna i zgodna z nazwą katalogu; zajęta nazwa oznacza pominięcie lub
przemyślane zastąpienie, nigdy duplikat.
