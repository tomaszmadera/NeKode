---
task_id: bottom-auxiliary-terminal
created: 2026-09-27T21:00:01Z
schema_version: 2
from: Main (Grok, sesja 2026-09-27)
to: Main (kolejna sesja)
branch: main
worktree: current
checkpoint_subject: d84c2a29237f1bac16b35994f4b66f32959c0240+sha256:0b16dedc22f8c6a096355c40d59860525cc7aa8d2b820f3c0386c8ea6573b20d
current_step: Phase 2.2
next_action: Independent review of Stage 1 with code-review. Do not start Stage 2.
blockers: none
---

# Handoff: Bottom auxiliary terminal

## Repository snapshot

Task record: `.agents/tasks/bottom-auxiliary-terminal/task.md` (status active, current_step Phase 2.2). Rola: Main (koordynator) do Main (kolejna sesja). Powod: user stop. Po zakonczeniu implementera etapu 1 napisac handoff i dokonczyc w innej sesji. Spec: `docs/features/bottom-auxiliary-terminal/spec.md`. Plan: `.agents/tasks/bottom-auxiliary-terminal/plan.md` (approved 2026-09-27, Large, 2 etapy).

**Working** (kod etapu 1 w worktree, jeszcze bez review; HEAD przed checkpointem `d84c2a29237f1bac16b35994f4b66f32959c0240`):

- Spec i plan sa zatwierdzone. Preflight przed edycja: `python .agents/scripts/preflight` exit 0. Baseline przed etapem 1: `pnpm run test` 296/296 w 23 plikach, `pnpm run typecheck` exit 0.
- Etap 1 (panel i zakladki) wrocil od implementera. Main nie recenzowal diffa. Koordynator przeliczyl: `pnpm run typecheck` exit 0, `pnpm run test` exit 0, 314/314 w 24 plikach (2026-09-27T21:00:01Z). `pnpm run build` koordynator nie powtorzyl. Implementer zglosil build exit 0 i czerwony test `BottomPanel.test.tsx` przed implementacja (region zostawal `display: none`).
- Formularz akcji nadal ma tylko `Background` i `New terminal`. Brak migracji `run_mode` i brak wykonania `bottom-terminal`. Zdania rezerwujace tryb w `docs/features/center-layout-tabs-actions/spec.md` nietkniete.
- `git status` przed checkpointem obejmuje tylko pliki tego zadania (spec, plan, rekord, src etapu 1). `package.json` nie jest na tej liscie.

**Broken**:

- Niezalezny review etapu 1 nie wystartowal. Etap 2 nie wystartowal.
- `pnpm run lint` exit 1. Jedyny finding Biome: `package.json` format, konce CRLF w worktree. Worktree: 63 CR i 63 LF. `git show HEAD:package.json`: 0 CR i 63 LF. `git status` nie pokazuje `package.json`. To lekcja `windows-biome-package-json-eol`, nie diff etapu 1. Twierdzenie implementera, ze blob HEAD ma 63 CR, jest falszywe.

## Decisions

- 2026-09-27 uzytkownik: wiele zakladek, nie jeden terminal. Plan zatwierdzony tego samego dnia.
- Zakladki naleza do projektu paska (`filesProjectId ?? selectedProjectId`). Nie sa czatami i nie wchodza do drzewka. Nazwa to nazwa shella. Duplikaty dozwolone. Lista zyje tylko do zamkniecia aplikacji.
- Id zakladki: `bottom:<projectId>:<uuid>`. `terminals:terminate` przyjmuje tylko taki id. Quit woła `terminateAll` i nie usuwa czatow.
- Nazwa shella: `terminals:shellName`. Nie tworzyc czatu, zeby ja poznac.
- `region.bottom.open` to `1` albo `0`. Wysokosc zostaje przy `region.bottom.height`, limity 160, 220, 560. Uchwyt jest gorna krawedzia regionu.
- `Ctrl + Backquote` (Ctrl, bez Shift i Alt) jest polykany i nie idzie do PTY. Dolny terminal uzywa `ChatTerminal`, wiec Ctrl+D i Ctrl+U zostaja przy kontrakcie czatu.
- `Handoff`, `Resume`, `Stop` i `Continue` pisza tylko do aktywnego czatu.
- Tryb `bottom-terminal` zawsze utworzy nowa zakladke i nie zmieni zaznaczonego czatu. To etap 2.

## Failed approaches

- Traktowanie bledu lint w `package.json` jako 63 CR w blobie HEAD. Nie powtarzac. HEAD ma LF. CRLF jest tylko w worktree przy `core.autocrlf`. Nie commituj `package.json` w tym zadaniu, zeby "naprawic" lint.

## Verification

- `python .agents/scripts/task-status --check .agents/tasks/bottom-auxiliary-terminal/task.md` exit 0 przed tym snapshotem.
- Koordynator, 2026-09-27T21:00:01Z: `pnpm run typecheck` exit 0, `pnpm run test` exit 0 (314/314, 24 pliki), `pnpm run lint` exit 1 (tylko CRLF `package.json`, jak wyzej).
- Build: nieprzeliczony przez koordynatora. Implementer zglosil exit 0.
- Review etapu 1: nie wykonany.
- checkpoint_subject liczony przed zapisem tego pliku, bez sciezki snapshotu. Przepis: staged = sha256(`git diff --cached --binary --no-ext-diff -- <paths>`), unstaged = sha256(`git diff --binary --no-ext-diff -- <paths>`), untracked = sha256(canonical JSON posortowanej listy `{kind, path, sha256}` dla `git ls-files --others --exclude-standard -- <paths>`; sha256 pliku to surowe bajty). Pusta kategoria = sha256 pustego wejscia `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Digest = sha256(canonical JSON `{head, paths, staged_diff_sha256, unstaged_diff_sha256, untracked_files_sha256}`), klucze posortowane, separatory bez spacji, ASCII. Wartosci: head `d84c2a29237f1bac16b35994f4b66f32959c0240`, staged len 0, unstaged len 46117 (`2c8397b61a823fddeb631a6cc01b5dea2c86cb8f0e03df75a144cdfb06150af1`), untracked 8 plikow (`b9c8cc498ae5d7f41f9e4a2a6e4ef12bac7c0f284031e5862cb4f79fb9c664d1`), digest `0b16dedc22f8c6a096355c40d59860525cc7aa8d2b820f3c0386c8ea6573b20d`.

## Open product invariants

- `inv-bottom-tabs-not-chats`. Status: open, egzekwowane id `bottom:` i brakiem wiersza w `chats`. Impact: quit i zamkniecie zakladki nie usuwaja czatu. Evidence do zmiany: decyzja uzytkownika i zmiana spec.
- `inv-hide-keeps-pty`. Status: open. Ukrycie panelu i zmiana zakladki nie zabija PTY. Evidence do zmiany: brak. Review ma to sprawdzic na diffie etapu 1.
- `inv-bottom-tabs-session-only`. Status: open. Lista zakladek nie jest w SQLite. Po restarcie wraca tylko otwarcie i wysokosc. Evidence do zmiany: decyzja uzytkownika i zmiana spec.
- `inv-fixed-buttons-chat-only`. Status: open. Przyciski stale pisza do czatu, nie do zakladki dolnej. Evidence do zmiany: brak w tym zadaniu.
- `inv-bottom-terminal-mode-reserved`. Status: open do etapu 2. Formularz nie oferuje `bottom-terminal`. Evidence do zmiany: implementacja etapu 2 i aktualizacja zdan rezerwujacych w spec center-layout.

## Unresolved assumptions

- Bramki typecheck i test koordynator potwierdzil. Build potwierdzil tylko implementer. Konsekwencja: review moze zażadac ponownego build, jesli diff budzi watpliwosc. Rozstrzyga: `pnpm run build` przy review, gdy brak zaufania do raportu.
- Self-review implementera nie zastepuje review. Konsekwencja: w diffie moga zostac findingi. Rozstrzyga: pierwsza akcja resume.
- Brak odchylenia modelu. Implementer byl ta sama sesja narzedziowa, bez wskazanego innego modelu.

## Resume instructions

1. Pierwsza akcja: niezalezny review etapu 1. Skill: `code-review`. Baza: rodzic checkpoint commita (przed nim HEAD `d84c2a29237f1bac16b35994f4b66f32959c0240`). Zakres: pliki src tego zadania oraz spec etapu 1. Nie reviewuj planowania od zera. Oczekiwane evidence: lista findingow albo `No significant issues found.` Nastepny skill po review bez blokerow: `implement` dla etapu 2, osobny implementer (Large). Przy blokerach: korekta etapu 1, najwyzej dwie rundy.
2. Przed edycja: `git status`, `python .agents/scripts/task-status --check .agents/tasks/bottom-auxiliary-terminal/task.md`, spec i plan Stage 1. Zamknij wiersz Timing `handoff` i otworz `review:1`.
3. Nie zaczynaj etapu 2 przed przejsciem review etapu 1. Nie powtarzaj implementacji etapu 1 bez nowej usterki.
4. Nie commituj `package.json` ani `.gitattributes` razem z ta praca. Lint CRLF zostaw poza zakresem, chyba ze uzytkownik osobno zleci lekcje.
5. Nie powtarzaj falszywego twierdzenia o 63 CR w blobie HEAD `package.json`.
