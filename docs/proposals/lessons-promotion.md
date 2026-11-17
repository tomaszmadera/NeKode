---
status: draft
project: NeKode
kanban: HARNESS-126
origin: Lessons review session, 2026-11-16
---

# Rekomendacje promocji lekcji ze sklepu NeKode do stałych komponentów Harnessu

Dokument analityczny przedstawiający wyniki przeglądu 113 lekcji zapisanych w selektywnym sklepie NeKode (`.agents/lessons/index.json`). Zgodnie z zasadami Harnessu ([README.md](file:///F:/projects/NeKode/.agents/lessons/README.md#L49-L56)) lekcje mają charakter prowizoryczny: trwała reguła lub procedura powinna zostać włączona do właściwego dokumentu zasad, środowiska, skryptu lub umiejętności, a powiązany wpis lekcji powinien zostać wycofany ze sklepu.

---

## 1. Natychmiastowe usunięcie lekcji już skodyfikowanych

Te lekcje zostały w przeszłości włączone do plików konfiguracyjnych, reguł lub środowiska wykonawczego, lecz ich wpisy nadal figurują w `.agents/lessons/items/` oraz `index.json`. Należy je usunąć ze sklepu:

- `reply-in-user-language` (`.agents/lessons/items/reply-in-user-language.md`):
  - Włączona do [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md#L7) (wymóg odpowiedzi w języku użytkownika od pierwszej wiadomości).
- `no-pull-requests` (`.agents/lessons/items/no-pull-requests.md`):
  - Włączona do [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md#L159-L162) oraz [.agents/safety.md](file:///F:/projects/NeKode/.agents/safety.md#L7) (zakaz tworzenia PR-ów bez wyraźnego polecenia).
- `ask-before-task-branch` (`.agents/lessons/items/ask-before-task-branch.md`):
  - Włączona do [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md#L28) (tworzenie gałęzi i worktree wymaga decyzji użytkownika).
- `kanban-get-console-encoding` (`.agents/lessons/items/kanban-get-console-encoding.md`):
  - Włączona do [.agents/environments/windows.md](file:///F:/projects/NeKode/.agents/environments/windows.md#L13) (`$env:PYTHONIOENCODING='utf-8'`).
- `shell-inline-script-backticks` (`.agents/lessons/items/shell-inline-script-backticks.md`):
  - Włączona do [.agents/environments/windows.md](file:///F:/projects/NeKode/.agents/environments/windows.md#L15) (pisanie skryptów do plików scratch zamiast inlinowania w powłoce).
- `windows-bounded-file-discovery` oraz `source-paths-before-content-search`:
  - Włączone do [.agents/environments/windows.md](file:///F:/projects/NeKode/.agents/environments/windows.md#L11) (błąd Win 123 przy wildcardach w ścieżce pozycyjnej, filtrowanie przez `-g`) oraz [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md#L32).
- `ci-remote-ref-preflight` (`.agents/lessons/items/ci-remote-ref-preflight.md`):
  - Włączona do [.agents/safety.md](file:///F:/projects/NeKode/.agents/safety.md#L45) (weryfikacja stanu zdalnej gałęzi przed pushem).
- `native-deps-prebuilt-binaries` (`.agents/lessons/items/native-deps-prebuilt-binaries.md`):
  - Włączona do [.agents/skills/electron-native/SKILL.md](file:///F:/projects/NeKode/.agents/skills/electron-native/SKILL.md).
- `windows-gui-launchers-powershell` (`.agents/lessons/items/windows-gui-launchers-powershell.md`):
  - Włączona do [.agents/skills/electron-native/SKILL.md](file:///F:/projects/NeKode/.agents/skills/electron-native/SKILL.md) i [.agents/skills/electron-e2e/SKILL.md](file:///F:/projects/NeKode/.agents/skills/electron-e2e/SKILL.md).

---

## 2. Włączenie kluczowych zasad do AGENTS.md

Zasady uniwersalne dotyczące interakcji z użytkownikiem, granic decyzyjnych oraz konwencji projektowych:

- **Dostępność jako jawny non-goal** (`no-accessibility-scope`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Project rules*.
  - **Treść reguły**: Dostępność (a11y/ARIA) jest trwałym non-goalem w NeKode. Zakaz proponowania, implementowania i audytowania ARIA/a11y.
- **Podawanie widocznego skutku przed prośbą o zatwierdzenie** (`card-requirement-effect-before-approval`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Core rules* / *Decisions*.
  - **Treść reguły**: Przed przedstawieniem użytkownikowi wymagania do zatwierdzenia agent musi podać jego realny, widoczny skutek. Jeśli zmiana to no-op (np. `line-height`, który nic nie przesuwa), agent ma to otwarcie nazwać i zarekomendować wycofanie wymogu zamiast prosić o zgodę na pustą zmianę.
- **Bezwzględne progi podane przez użytkownika jako ścisły kontrakt** (`absolute-threshold-user-goal`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Precedence* / *Requirements*.
  - **Treść reguły**: Gdy użytkownik podaje wartość bezwzględną (np. limit 180k tokenów), stanowi ona ścisły kontrakt; nie wolno jej przeliczać na wartości względne ani procenty okna modelu.
- **Weryfikacja historii wskaźnika przed redefinicją semantyki** (`existing-indicator-history-before-semantics`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Core rules*.
  - **Treść reguły**: Przed pytaniem użytkownika o semantykę lub zachowanie wskaźnika/funkcji należy sprawdzić w historii Gita (`git log`/`git show`), jak dane zachowanie działało wcześniej.
- **Dosłowne określenia zamiast metafor dla operacji Gita** (`git-commit-plain-terms`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Prose and documents*.
  - **Treść reguły**: Zakaz stosowania metafor dla miejsc docelowych zmian w Gicie (używać precyzyjnych określeń: commit na gałęzi X, gałąź, drugi worktree zamiast np. "landing spot").
- **Wymóg wskazania producenta przed propozycją czekania** (`blocked-dependency-needs-producer`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Core rules*.
  - **Treść reguły**: Przed zarekomendowaniem czekania na brakujący artefakt agent musi wskazać jego konkretnego producenta (kartę, plan, wykonawcę). Jeśli nikt go nie tworzy, nie wolno oferować czekania jako opcji.
- **Jawne autorstwo kodu tworzonego przez agentów** (`kanban-adapter-actions-from-host-code`):
  - **Miejsce**: [AGENTS.md](file:///F:/projects/NeKode/AGENTS.md) -> sekcja *Prose and documents*.
  - **Treść reguły**: Gdy agent opisuje defekt w kodzie powstałym w poprzedniej sesji agentowej, nie może opisywać autora jako zewnętrznej osoby trzeciej; ma wprost wskazać, że kod napisał agent w repozytorium.

---

## 3. Włączenie reguł środowiskowych do .agents/environments/windows.md

Reguły wykonawcze eliminujące powtarzające się błędy powłoki PowerShell i narzędzi na Windowsie:

- **Cytowanie kroków taskctl w PowerShellu** (`powershell-taskctl-step-quoting`):
  - W PowerShellu spacje nie są escapowane backslashem (`\ `). Argumenty ze spacjami (np. `'Phase 0.1'`) muszą być przekazywane w pełnych cudzysłowach.
- **Interpolacja zmiennej przed dwukropkiem** (`powershell-variable-colon`):
  - W napisach w podwójnych cudzysłowach należy używać `${variable}:`, gdy bezpośrednio po nazwie zmiennej występuje dwukropek (inaczej parser traktuje to jako modyfikator zakresu).
- **Formatowanie potoków w pętlach PowerShell** (`powershell-loop-pipeline`):
  - Instrukcja `foreach (...) { ... }` nie może być bezpośrednio spięta z potokiem `|`. Należy przypisać wynik do zmiennej lub użyć `ForEach-Object`. Przy StrictMode wyniki zwracające pojedynczy obiekt należy opakować w `@(...)` przed wywołaniem `.Count`.
- **Unikanie zmiennej automatycznej Matches jako licznika** (`powershell-matches-automatic-variable`):
  - Zakaz używania `$matches` jako licznika w pętli zawierającej operator `-match` (PowerShell nadpisuje zmienną automatyczną `$Matches` tabelą skrótów).
- **Weryfikacja kodów wyjścia procesów natywnych** (`powershell-preserve-native-exit-code`):
  - W sekwencjach poleceń natywnych należy sprawdzać `$LASTEXITCODE` po każdym wywołaniu, ponieważ `$ErrorActionPreference = 'Stop'` nie przerywa wykonania po niezerowym kodzie procesu natywnego.
- **Cudzysłowy dla argumentów natywnych w PowerShell 7** (`powershell-native-arg-double-quotes`):
  - W PowerShell 7 dla poleceń natywnych (`gh`, `jq`) całe wyrażenie należy ująć w pojedyncze cudzysłowy, a wewnętrzne podwójne cudzysłowy pisać bez ucieczki backslashem (`"` a nie `\"`).
- **Uruchamianie pnpm przez cmd na Windowsie** (`windows-pnpm-through-cmd`):
  - Wrapper Pythona uruchamiający `pnpm` przez `CreateProcess` musi wywoływać `cmd /c pnpm` lub `pnpm.cmd` (rozwiązanie problemu braku bezpośredniego uruchamiania skryptu `.ps1` i błędu WinError 2).
- **Przywracanie CRLF przez checkout na autocrlf=true** (`git-checkout-reintroduces-crlf`):
  - Przy `core.autocrlf=true` operacja `git checkout --` lub `git restore` przywraca pliki z CRLF, co wywołuje błędy Biome. Przywracanie należy weryfikować przez `git ls-files --eol` lub pobierać bajty bezpośrednio z bloba Gita.
- **Pobieranie strumieni binarnych w procesach Windows** (`github-asset-binary-download-process-stream`):
  - Pobieranie assetów binarnych przez `gh api` na Windowsie powinno odbywać się bezpośrednio ze strumienia procesu (`BaseStream`), aby uniknąć uszkodzenia bajtów przez przekierowania powłoki.

---

## 4. Włączenie standardów inżynierskich do .agents/engineering.md

Standardy inżynierskie, wzorce testowe i reguły unikania pułapek wykonawczych:

- **Mockowanie eksportów systemu plików w Vitest ESM** (`vitest-esm-filesystem-mock`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tests and verification*.
  - **Treść reguły**: W Vitest pod ESM `vi.spyOn` nie może nadpisać eksportu przestrzeni nazw `node:fs/promises` (`Module namespace is not configurable`). Należy użyć fabryki `vi.mock` z `importOriginal` i opakować docelową funkcję w `vi.fn`.
- **Asercja stanu DOM dla modułów importowanych dynamicznie** (`vitest-mock-dynamic-import-concurrent`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tests and verification*.
  - **Treść reguły**: Przy mockowaniu modułów importowanych dynamicznie w komponentach renderera montowanych współbieżnie nie należy asertować liczników wywołań mocka, lecz stan DOM.
- **Oczekiwanie na fokus w oknach dialogowych** (`rtl-findby-passive-focus-race`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tests and verification*.
  - **Treść reguły**: Po `findBy*` dla okna dialogowego przesuwającego fokus w pasywnym `useEffect` należy poczekać na faktyczny fokus (`waitFor(() => expect(...))`) przed asercją fokusu lub wysłaniem klawiszy.
- **Synchroniczny zapis stdout w fixture przed exit** (`test-fixture-sync-stdout-before-exit`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tests and verification*.
  - **Treść reguły**: Fixtury CLI muszą zapisywać stdout synchronicznie (`fs.writeSync(1, text)`) przed natychmiastowym `process.exit()`, aby zapobiec obcięciu bufora potoku przy równoległym obciążeniu.
- **Rozszerzenie zakresu testów przy odwróceniu kontraktu** (`contract-widening-test-scope`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tests and verification*.
  - **Treść reguły**: Gdy zmiana odwraca dotychczasowy kontrakt (np. ze stanu nieobsługiwanego na obsługiwany), zakres testów musi objąć wszystkie pliki testujące stare odrzucenie w całym projekcie.
- **Wspólny deadline zamiast kumulacji timeoutów** (`stop-budget-shared-deadline`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Design*.
  - **Treść reguły**: Dodanie czasu karencji lub ponowień przed timeoutem musi pomniejszać istniejący wspólny budżet czasowy (deadline), a nie dokładać kolejny timer.
- **Zachowanie ogona przy dzieleniu łańcuchów w JS** (`js-split-limit-truncates-fields`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tool use* / *Design*.
  - **Treść reguły**: `String.split(sep, limit)` w JavaScript obcina resztę ciągu, zamiast zachować ogon jak `maxsplit` w Pythonie. Przy parsowaniu rekordów o stałym prefiksie i zmiennym ogonie (np. git porcelain) należy używać `indexOf` i brać resztę linii.
- **Zachowanie rzucania błędów w miejscach wywołań klasyfikatorów** (`total-classifier-keeps-throwing-call-site`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Design*.
  - **Treść reguły**: Zastąpienie rzucającego parsera całkowitym klasyfikatorem wymaga zachowania rzucania błędu we wszystkich dotychczasowych miejscach wywołań.
- **Weryfikacja podwójnych ukośników w payloadach JSON** (`patch-json-backslash-escape-drift`):
  - **Miejsce**: [.agents/engineering.md](file:///F:/projects/NeKode/.agents/engineering.md) -> sekcja *Tool use*.
  - **Treść reguły**: Unikanie podwójnego uciekania ukośników (`\`) przy edycjach w payloadach JSON narzędzi; weryfikacja zapisanych bajtów.

---

## 5. Włączenie reguł do dedykowanych umiejętności (.agents/skills/)

### A. Umiejętność `ci` ([SKILL.md](file:///F:/projects/NeKode/.agents/skills/ci/SKILL.md))
- `ci-commit-files-single-flag`: Flaga `-f` w `ci commit` musi przyjmować wszystkie pliki naraz (`-f A B C`), a nie powtórzone flagi `-f A -f B` (gdyż powtórzona flaga nadpisuje poprzednie).
- `ci-commit-no-hunk-scope`: `ci commit -f` stage'uje całe pliki. Przy współdzielonych modyfikacjach commit wciąga obce hunki; w takiej sytuacji wymagany jest patch i stage'owanie selektywne.
- `ci-commit-scope-includes-rename-sources`: `git diff HEAD --name-only` przy rename pokazuje tylko nową ścieżkę. Zakres commita musi być budowany z opcją `--no-renames`, aby uwzględnić skasowanie starej ścieżki po `git mv`.
- `ci-push-does-not-set-upstream`: Pomocnik `ci push` nie konfiguruje upstream tracking (`--set-upstream`).

### B. Umiejętności `task-record` ([SKILL.md](file:///F:/projects/NeKode/.agents/skills/task-record/SKILL.md)) i `task-close` ([SKILL.md](file:///F:/projects/NeKode/.agents/skills/task-close/SKILL.md))
- `taskctl-stage-steps-before-advance`: Dodawanie kroków fazy w planie przez `semantic-update` przed przejściem do kroku.
- `taskctl-resume-state-order`: Kolejność sprawdzania stanu: unblock przed preflight; wznowienie etapu po recenzji wymaga `correction:<stage>`; budżet max 2 rund poprawek; autoryzacja dodatkowej rundy wymaga przejścia block -> unblock.
- `task-record-heading-anchors`: Kotwiczenie edycji semantycznych do pełnych nagłówków; przekazywanie do `semantic-update --section` wyłącznie treści sekcji bez nagłówka.
- `timing-rows-append-chronological`: Wiersze Timing muszą tworzyć jedną ciągłą tabelę chronologiczną bez pustych linii; dopisywanie zawsze na końcu.
- `timing-suffix-only-staged-elements`: Dopuszczalne elementy w kolumnie Element (tylko schema-4: approval, implement, review, correction, verify, handoff, blocked); tylko implement/review/correction przyjmują sufix `:<N>`.
- `active-record-keeps-current-step`: Aktywny rekord zachowuje bieżący krok (nigdy `current_step: none` w stanie aktywnym).
- `record-rename-keeps-immutable-subjects`: Zmiana nazwy rekordu nie może dotykać bloków `### Verification subject N`.
- `complete-requires-changed-files`: `taskctl complete` wymaga wpisów w `Changed files`; rejestracja przez `taskctl own`.
- `commit-order-vs-verification-subject`: Commit PRZED przechwyceniem verification subject, nigdy między verify-pass a complete.
- `record-dir-text-only`: Katalogi `.agents/tasks/<id>/` przechowują wyłącznie pliki markdown; duże zrzuty/profile trafiają do `tmp/`.
- `resume-section-reads-not-whole-files`: Przy resume czytanie konkretnych sekcji (`--section`), filtrowanie wyjścia `taskctl list --json`.
- `taskctl-intake-only-skeleton-completes-unchecked`: Pozostawienie pojedynczego kroku `Phase 0.1` w analizie/debugu do automatycznego odznaczenia przez `taskctl complete`.

### C. Umiejętność `git-worktrees` ([SKILL.md](file:///F:/projects/NeKode/.agents/skills/git-worktrees/SKILL.md))
- `worktree-script-absolute-root`: Wiązanie skryptów masowych do bezwzględnego katalogu głównego worktree (`git -C <root>`).
- `worktree-record-root`: Walidacja rekordu zadania w jego macierzystym checkoutcie.
- `cleanup-preserves-existing-checkout`: Czyszczenie worktree na Windowsie: odpinanie punktów reparse/junctions przed rekurencyjnym usuwaniem; obsługa długich ścieżek i atrybutu read-only na obiektach fixture Gita.
- `parallel-agent-worktree-baseline`: Filtrowanie błędów lintera/typecheckera do własnych plików w środowisku równoległych agentów; niedotykanie cudzych zmian.
- `worktree-gitignored-host-adapters`: Worktree pomija gitignored adaptery (`.claude`, `.codex`); skopiowanie lub wygenerowanie przed walidacją.
- `remove-worktree-and-branches-after-integration`: Po integracji do main, usunięcie worktree, lokalnej gałęzi i zdalnej gałęzi w jednym przepływie closeoutu po jednorazowej zgodzie użytkownika.

### D. Umiejętność `kanban` ([SKILL.md](file:///F:/projects/NeKode/.agents/skills/kanban/SKILL.md))
- `kanban-work-item-lifecycle`: Ścisłe zachowanie cyklu życia kart (Todo -> In Progress -> Done); sprawdzanie komentarzy przed diagnozowaniem przerwanego zadania.
- `kanban-helper-reference-order`: Krotka zwracana przez `resolve_issue_ref` w `kanban_cli.py` to `(uuid, project_id, ref_string)`.
- `plane-ui-links-use-issues-route`: Ścieżki UI w Plane używają `/issues/`, a nie `/work-items/`.

### E. Umiejętności domenowe NeKode (`electron-e2e`, `electron-native`, `terminal-lifecycle`)
- [terminal-lifecycle](file:///F:/projects/NeKode/.agents/skills/terminal-lifecycle/SKILL.md): `conpty-probe-teardown` (czyszczenie timerów na onExit), `powershell-psreadline-key-chords-self-insert` (brak mapowania Ctrl+D/Ctrl+U na Windowsie pod PSReadLine).
- [electron-e2e](file:///F:/projects/NeKode/.agents/skills/electron-e2e/SKILL.md): `electron-cdp-smoke-isolation` (flagi Chromium dla uśpionych okien, dispatchKeyEvent z `text: '\r'`, obsługa asynchronicznego schowka), `cdp-quote-testid-attribute-values` (cudzysłowy w selektorach testid), `seeded-sessions-need-selected-project`, `windows-smoke-cleanup-policy`.
- [electron-native](file:///F:/projects/NeKode/.agents/skills/electron-native/SKILL.md): `windows-packaged-asar-verification` (weryfikacja asar na natywnych separatorach), `electron-dev-binary-from-cache` (instalacja z lokalnego zipa cache pnpm bez sieci).

---

## 6. Wady narzędzi Harnessu (do zgłoszenia w projekcie agent-harness upstream)

Te lekcje wynikają z ograniczeń i błędów w skryptach szablonu harnessu:

- `ci-push-is-not-atomic`: `git_ops.py:execute_push` wykonuje push per gałąź i per tag w osobnych wywołaniach zamiast jednego atomic push.
- `ci-commit-files-single-flag`: `ci.py` używa `nargs='+'` bez `action='append'` dla flagi `-f`.
- `taskctl-check-argument-order`: `taskctl check` używa `argparse.REMAINDER` bezpośrednio po `task_id`, przez co flagi podane po identyfikatorze stają się poleceniem potomnym.
- `timing-suffix-only-staged-elements`: Niespójność między `task_record.py` (który dopuszcza `user-gate`) a `task-status` (który to odrzuca).
- `harness-update-retired-skill-adapters`: Updater harnessu nie usuwa pustych katalogów po wycofanych adapterach umiejętności.

---

## 7. Lekcje produktowe (pozostające w .agents/lessons/)

Lekcje specyficzne dla kodu, architektury i środowiska uruchomieniowego NeKode (niebędące częścią ogólnego Harnessu):

- `opencode-v2-credentials-in-db` (lokalizacja bazy danych OpenCode v2).
- `adapter-directory-no-picker` (jednolity brak wyboru katalogu dla adapterów w UI NeKode).
- `usage-adapter-runtime-check-live-read` (odczyt live konta przez adapter Codex w NeKode).
- `usage-refresh-current-deadline` (obsługa odliczania w toolbarze NeKode).
- `external-dictation-paste-focus` (routing wklejania xterm vs HTML input w NeKode).
- `nekode-harness-independent-applications` (niezależność aplikacji NeKode od Agent Harness).
- `kanban-adapter-runtime-copy` (struktura katalogów `<userData>/kanban-adapters` w NeKode).
- `windows-scratch-probe-visible-launch` i `windows-scratch-probe-take-budget` (badanie modułu OpenWhispr).
