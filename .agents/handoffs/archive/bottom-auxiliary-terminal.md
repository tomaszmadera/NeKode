---
task_id: bottom-auxiliary-terminal
created: 2026-09-27T22:10:21Z
schema_version: 2
from: Main (Grok, sesja 2026-09-27)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: 587dcc75d27cfe07100021ca062e676771b529b7+sha256:0f471d180e94b7e6680e61aa42b8d15c5033f5ddc5918346dd3a489eae8c9b2c
current_step: Phase 2.2
next_action: Re-review the Stage 1 correction with code-review. Do not start Stage 2.
blockers: none
---

# Handoff: Bottom auxiliary terminal

## Repository snapshot

Task record: `.agents/tasks/bottom-auxiliary-terminal/task.md` (status active, current_step Phase 2.2). Rola: Main do Main (kolejna sesja). Powod: user stop. Spec: `docs/features/bottom-auxiliary-terminal/spec.md`. Plan: `.agents/tasks/bottom-auxiliary-terminal/plan.md` (approved 2026-09-27, Large, 2 etapy).

**Working** (HEAD przed tym checkpointem `587dcc75d27cfe07100021ca062e676771b529b7`):

- Etap 1 (panel i zakladki, AC1-AC8) jest w commicie `587dcc7`. Formularz akcji nadal ma tylko `Background` i `New terminal`. Brak migracji `run_mode` i brak wykonania `bottom-terminal`.
- Review:1 (niezalezny subagent, baza `d84c2a2`) wrocil 2026-09-27T21:36:53Z z dwoma warningami. Oba blokuja.
- Korekta 1 wrocila 2026-09-27T22:01:53Z w `src/renderer/src/App.tsx` i `src/renderer/src/BottomPanel.test.tsx`. Straznik usunietego projektu jest ustawiany przed pierwszym await. `createBottomTab` sprawdza go przed `shellName`, po nim i przy odrzuceniu `shellName`. Updater `setBottomTabs` sprawdza go jeszcze raz. Ukrycie panelu wola `focus()` na zapisanym elemencie, a gdy element nie jest wyrenderowany albo nie jest `document.activeElement`, fokus idzie na powierzchnie srodkowa. `ChatTerminal` cleanup bez zmian. Hide nie odmontowuje widokow dolnych.
- Czerwone testy przed poprawka, exit 1: fokus zostawal na ukrytym canvasie terminala; dwa przyciski PowerShell, gdy `projects.remove` jeszcze trwal. Trzeci czerwony bieg zlapal czyszczenie tombstone po nieudanym usunieciu. Po poprawce: vitest `BottomPanel.test.tsx` i `App.test.tsx` 69 passed; potem sam `BottomPanel.test.tsx` 17 passed. Biome tych dwoch plikow: brak findingow. Koordynator: `cmd /c pnpm run typecheck:web` exit 0.
- Diagnoza hookow z obrazka `Read 2 skills [hooks: 4 ok, 4 failed]` jest zamknieta. Shell to pwsh (`GROK_SHELL` nieustawione). Cztery OK: `.grok/hooks/quota.json` PreToolUse i `.grok/hooks/task-report.json` PostToolUse, exit 0, stdout `{}`. Cztery FAIL: `.claude/settings.json` PreToolUse i PostToolUse, bashowy one-liner `PY="$(command -v python3 || command -v python || echo py -3)"`, pwsh exit 1, ParserError, nieoczekiwany token `"$DIR/.agents/hooks/dispatch.py"`. Zielone `Skill handoff [hooks: 2/2]` to tylko hooki Grok.

**Broken**:

- Review:2 korekty wystartowal 2026-09-27T22:01:53Z (subagent `01a0e4e5-4698-7ea3-83c6-2518c6fda69d`) i zostal zatrzymany 2026-09-27T22:10:21Z na user stop, zanim wrocil z findingami. To nie jest zaliczenie. Nie wznow tego subagenta jako wyniku review.
- Etap 2 nie wystartowal. Etap 1 nie jest zaakceptowany.
- `pnpm run typecheck` (projekt node) i `pnpm run build` koordynator nie powtorzyl po korekcie.
- `pnpm run lint` calego drzewa nadal exit 1 na CRLF `package.json` w worktree. HEAD ma 0 CR i 63 LF. `git status` nie pokazuje `package.json`. To lekcja `windows-biome-package-json-eol`, nie diff tego zadania.

## Decisions

- 2026-09-27 uzytkownik: wiele zakladek, nie jeden terminal. Plan zatwierdzony tego samego dnia.
- Zakladki naleza do projektu paska (`filesProjectId ?? selectedProjectId`). Nie sa czatami i nie wchodza do drzewka. Nazwa to nazwa shella. Duplikaty dozwolone. Lista zyje tylko do zamkniecia aplikacji.
- Id zakladki: `bottom:<projectId>:<uuid>`. `terminals:terminate` przyjmuje tylko taki id. Quit wola `terminateAll` i nie usuwa czatow.
- Nazwa shella: `terminals:shellName`. Nie tworzyc czatu, zeby ja poznac.
- `region.bottom.open` to `1` albo `0`. Wysokosc zostaje przy `region.bottom.height`, limity 160, 220, 560. Uchwyt jest gorna krawedzia regionu.
- `Ctrl + Backquote` (Ctrl, bez Shift i Alt) jest polykany i nie idzie do PTY. Dolny terminal uzywa `ChatTerminal`, wiec Ctrl+D i Ctrl+U zostaja przy kontrakcie czatu.
- `Handoff`, `Resume`, `Stop` i `Continue` pisza tylko do aktywnego czatu.
- Tryb `bottom-terminal` zawsze utworzy nowa zakladke i nie zmieni zaznaczonego czatu. To etap 2.
- Tombstone usunietego projektu zostaje, gdy choc jedno usuniecie tego id sie powiedzie. Czysci go dopiero ponowne dodanie projektu. Nieudane usuniecie czysci tombstone tylko wtedy, gdy kazde trwajace usuniecie tego id padlo.
- "Wyrenderowany" przy fokusu oznacza, ze element i przodkowie nie maja `hidden`, a obliczone `display` / `visibility` nie jest `none`, `hidden` ani `collapse`. `getClientRects()` odpadlo: jsdom zwraca pusta liste takze dla widocznych wezlow.

## Failed approaches

- Traktowanie bledu lint w `package.json` jako 63 CR w blobie HEAD. Nie powtarzac. HEAD ma LF. CRLF jest tylko w worktree przy `core.autocrlf`. Nie commituj `package.json` w tym zadaniu, zeby "naprawic" lint.
- Ustawianie straznika usunietego projektu dopiero po pierwszym await. Review:1 to zablokowal. Nie wracac do tego ukladu.
- Traktowanie kazdego `isConnected` jako fokusu, ktory da sie przywrocic. Review:1 to zablokowal.
- Liczenie wystartowanego review:2 jako zaliczenia. Zostal przerwany i nie oddal findingow.

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/bottom-auxiliary-terminal/task.md` exit 0 przed tym snapshotem.
- Koordynator, 2026-09-27T21:00:01Z, etap 1: `pnpm run typecheck` exit 0, `pnpm run test` exit 0 (314/314, 24 pliki), `pnpm run lint` exit 1 (tylko CRLF `package.json`).
- Resume 2026-09-27T21:17:01Z: `python .agents/scripts/preflight` exit 0.
- Korekta 1: czerwone vitest exit 1 przed poprawka; po poprawce 69 passed (`BottomPanel.test.tsx` + `App.test.tsx`) i pozniej 17 passed (`BottomPanel.test.tsx`). Biome dwoch plikow: brak findingow. `cmd /c pnpm run typecheck:web` exit 0 (koordynator, po powrocie implementera).
- Review:2: brak wyniku.
- checkpoint_subject liczony przed zapisem tego pliku, bez sciezki snapshotu. Przepis: staged = sha256(`git diff --cached --binary --no-ext-diff -- <paths>`), unstaged = sha256(`git diff --binary --no-ext-diff -- <paths>`), untracked = sha256(canonical JSON posortowanej listy `{kind, path, sha256}`) albo sha256 pustego wejscia, gdy kategorii nie ma. Digest = sha256(canonical JSON `{head, paths, staged_diff_sha256, unstaged_diff_sha256, untracked_files_sha256}`), klucze posortowane, separatory bez spacji, ASCII. Wartosci: head `587dcc75d27cfe07100021ca062e676771b529b7`, paths task.md + `App.tsx` + `BottomPanel.test.tsx`, staged len 0, unstaged len 20097 (`995bacc2dc0b466b22fefef1d25c258abb0eb41749e42ee0004d712710eaa2a8`), untracked 0, digest `0f471d180e94b7e6680e61aa42b8d15c5033f5ddc5918346dd3a489eae8c9b2c`.

## Open product invariants

- `inv-bottom-tabs-not-chats`. Status: open, egzekwowane id `bottom:` i brakiem wiersza w `chats`. Impact: quit i zamkniecie zakladki nie usuwaja czatu. Evidence do zmiany: decyzja uzytkownika i zmiana spec.
- `inv-hide-keeps-pty`. Status: open. Ukrycie panelu i zmiana zakladki nie zabija PTY. Korekta 1 tego nie zmienila swiadomie. Evidence do zmiany: review:2 albo pozniejszy review ma to potwierdzic na diffie korekty.
- `inv-bottom-tabs-session-only`. Status: open. Lista zakladek nie jest w SQLite. Po restarcie wraca tylko otwarcie i wysokosc. Evidence do zmiany: decyzja uzytkownika i zmiana spec.
- `inv-fixed-buttons-chat-only`. Status: open. Przyciski stale pisza do czatu, nie do zakladki dolnej. Evidence do zmiany: brak w tym zadaniu.
- `inv-bottom-terminal-mode-reserved`. Status: open do etapu 2. Formularz nie oferuje `bottom-terminal`. Evidence do zmiany: implementacja etapu 2 i aktualizacja zdan rezerwujacych w spec center-layout.

## Unresolved assumptions

- Review:2 nie oddal findingow. Konsekwencja: w korekcie moga zostac blokerow. Rozstrzyga: swiezy re-review diffa `587dcc7`..checkpoint dla `App.tsx` i `BottomPanel.test.tsx`. Nie wystarczy self-review implementera.
- `pnpm run typecheck` node i `pnpm run build` po korekcie nie sa przeliczone przez koordynatora. Konsekwencja: review moze ich zazadac. Rozstrzyga: odpalenie, gdy diff budzi watpliwosc.
- Hooki Claude w `.claude/settings.json` dalej padaja pod pwsh. Konsekwencja: licznik przy odczycie skilli nadal pokaze porazki. Rozstrzyga: osobne zlecenie. Nie ruszac `.agents/hooks.json` ani `dispatch.py` z tego powodu.
- Brak odchylenia modelu. Implementer i recenzenci byli subagentami tej samej sesji, bez wskazanego innego modelu.

## Resume instructions

1. Pierwsza akcja: swiezy niezalezny re-review korekty 1. Skill: `code-review`. Tryb: implementation gate. Baza: `587dcc75d27cfe07100021ca062e676771b529b7`. Zakres: `src/renderer/src/App.tsx` i `src/renderer/src/BottomPanel.test.tsx` oraz dwa warningi z review:1 (straznik usunietego projektu; fokus po ukryciu, AC4, PTY zyje po hide). Nie reviewuj calego etapu 1 od nowa i nie reviewuj planowania. Oczekiwane evidence: lista findingow albo `No significant issues found.` Nie traktuj przerwanego subagenta `01a0e4e5-4698-7ea3-83c6-2518c6fda69d` jako wyniku.
2. Zamknij wiersz Timing `handoff` (otwarty 2026-09-27T22:10:21Z) i otworz `review:3`. Nie ruszaj zamknietego `review:2`.
3. Bez blokerow nastepny skill to `implement` etapu 2, osobny implementer (Large). Przy blokerach: korekta 2, ostatnia dozwolona runda, potem re-review. Nie zaczynaj etapu 2 przed przejsciem review.
4. Przed edycja produktu: `git status` i `python .agents/scripts/task-status --check .agents/tasks/bottom-auxiliary-terminal/task.md`.
5. Nie commituj `package.json` ani `.gitattributes` razem z ta praca. Lint CRLF zostaw poza zakresem, chyba ze uzytkownik osobno zleci lekcje.
6. Nie powtarzaj falszywego twierdzenia o 63 CR w blobie HEAD `package.json`.
