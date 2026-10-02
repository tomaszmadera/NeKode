# CI: automatyczna weryfikacja na GitHub Actions

Kontrakt behawioralny zadania NEKODE-12. Implementacja korzysta z tego pliku; postęp prac trzyma rekord zadania, nie specyfikacja.

## Goal

Każda zmiana w repozytorium jest automatycznie sprawdzana na GitHub Actions tym samym poleceniem co lokalnie (`pnpm run verify`: Biome lint, typecheck obu projektów, Vitest). Utrzymujący projekt (użytkownik nieznający standardów CI) dostaje ponadto samowyjaśniający dokument `docs/development/ci.md`, który tłumaczy: co CI sprawdza, kiedy, na jakim systemie, czym różni się GitHub Actions od GitLab CI i dlaczego pipeline nie wymaga VS C++ Build Tools.

## Related requirements

- Work item NEKODE-12 (Plane): "CI: sensowny GitLab CI + dokumentacja jak powinno wygladac CI".
- Powiązany, poza zakresem: NEKODE-13 (Linux), NEKODE-15 (model gałęzi), NEKODE-17 (co publikować).

## Scope

1. Workflow `.github/workflows/ci.yml` (GitHub Actions) zgodny z "Behaviour".
2. Dokument `docs/development/ci.md` po polsku, samowyjaśniający, zgodny z "Behaviour".
3. Odnośnik do `docs/development/ci.md` w `docs/development/setup.md` (odkrywalność bez wcześniejszej wiedzy).

## Non-goals

- Build instalatora / smoke poza dev w CI (NSIS, `build:win`): bez zmian.
- Release i publikacja artefaktów z CI.
- Runnerzy Linux/macOS i wsparcie dla nich (NEKODE-13).
- Konfiguracja GitLab CI w repo: GitLab jest tylko omówiony w dokumencie jako alternatywa.
- Decyzja o modelu gałęzi (NEKODE-15); pipeline musi działać zarówno przy samym `main`, jak i przy przyszłym `develop` + feature branches.
- Badge CI w README.
- Uruchamianie skryptów harnessu (`.agents/` nie jest publikowane).

## Behaviour

### Workflow (`.github/workflows/ci.yml`)

- Trigger: `push` na `main` oraz `pull_request` (każda gałąź źródłowa).
- Jeden job `verify` na `runs-on: windows-latest`; limit czasu 20 minut.
- Współbieżność: nowy push do tego samego refa anuluje nadal biegnący run (`concurrency` z `cancel-in-progress`).
- Kroki w kolejności: checkout; instalacja pnpm z pola `packageManager` (`pnpm@12.5.1`); instalacja Node 24 z cache magazynu pnpm; `pnpm install --frozen-lockfile`; `pnpm run verify`.
- Job nie instaluje VS C++ Build Tools ani żadnego kompilatora; nie używa sekretów; nie ustawia `continue-on-error` na żadnym kroku.
- Wymagany Node to 24 (spełnia `engines` `^24.15.0`, zgodny ze zweryfikowanym hostem 24.18.0 z `docs/development/setup.md`).
- Kompilacja natywnych modułów nie może zachodzić: polityka `allowBuilds` w `pnpm-workspace.yaml` (śledzona przez gita) wymusza prebuildy N-API (`better-sqlite3: false`, `node-pty` staging prebuildów), a Electron 44.x nie ma skryptów install.

### Dokument (`docs/development/ci.md`)

Po polsku, zrozumiały bez wcześniejszej wiedzy o CI. Musi wyjaśniać:

1. Czym jest CI i co sprawdza w tym projekcie (lint, typecheck, testy = `pnpm run verify`) i dlaczego właśnie to.
2. Kiedy pipeline się uruchamia (PR, push na `main`; anulowanie zastąpionych runów).
3. Na jakim systemie biega (`windows-latest`) i dlaczego (projekt Windows-first, zweryfikowane prebuildy `win32-x64`), oraz co trzeba by dodać dla Linuksa (NEKODE-13).
4. Dlaczego bez VS C++ Build Tools: prebuildy N-API, polityka `allowBuilds`, brak rebuildu Electrona.
5. Cache pnpm: co jest cache'owane i jaki ma wpływ na czas runu.
6. Rozjazd GitHub Actions vs GitLab CI: hosting repo (origin = GitHub), plik pipeline'u (`.github/workflows/` vs `.gitlab-ci.yml`), składnia, runnerzy (w tym ograniczenia Windows na GitLab), kiedy mirror miałby sens. Dokument rekomenduje GitHub Actions i podaje koszt zmiany decyzji.
7. Jak czytać wynik (znaczniki commita, logi, co robić przy czerwonym runie).
8. Czego CI świadomie nie robi (non-goals).

## Business rules

- CI weryfikuje dokładnie to samo co lokalne `pnpm run verify`; żadne sprawdzenie nie może być pomijane ani lukierowane (`continue-on-error` zabronione).
- `pnpm install --frozen-lockfile`: rozjazd `pnpm-lock.yaml` z `package.json` musi kończyć job błędem.
- Pipeline nie może wymagać sekretów ani kompilatora.

## Authorization

`none` (job bez sekretów; forkowe PR dostają co najwyżej read-only).

## Data / API

Brak trwałych danych i publicznych kontraktów. Nowy plik `.github/workflows/ci.yml` jest kontraktem dla GitHub Actions; `docs/development/ci.md` jest dokumentem referencyjnym linkowanym z `docs/development/setup.md`.

## Edge cases

- Pierwszy run bez ciepłego cache pnpm: musi przejść (cache to tylko optymalizacja).
- PR z forka: job biega bez sekretów (i tak żadnych nie ma).
- Rozjazd lockfile (`--frozen-lockfile`): instalacja pada, job czerwony; naprawa należy do autora zmiany.
- Brak prebuilda N-API dla użytej pary platforma/Node: job pada; zgodnie z `docs/development/setup.md` sekcja 5 to blokada do analizy, nie powód do doinstalowania Build Tools.

## Errors

Czerwony job (exit != 0 z lint, typecheck lub test) blokuje zmianę: check na PR jest wymagany do merge, a czerwony commit na `main` sygnalizuje regresję. Brak cichych fallbacków.

## Acceptance criteria

1. `.github/workflows/ci.yml` istnieje, parsuje się jako poprawny YAML i spełnia "Behaviour" (triggery, windows-latest, Node 24, pnpm z `packageManager`, cache, `--frozen-lockfile`, `pnpm run verify`, brak kompilatora i sekretów, brak `continue-on-error`).
2. `docs/development/ci.md` istnieje, jest po polsku i pokrywa wszystkie 8 punktów sekcji "Dokument".
3. `docs/development/setup.md` linkuje do `docs/development/ci.md`.
4. Lokalne `pnpm run verify` jest zielone na drzewie roboczym ze zmianami.
5. Nie zmienia się żadne zachowanie aplikacji: diff nie dotyka `src/`.

## Required tests

Brak nowych testów jednostkowych (zmiana nie dotyka kodu aplikacji). Weryfikacja: lokalne `pnpm run verify`, kontrola parsowalności YAML workflow, przegląd dokumentu względem kryteriów 2-3. Prawdziwy dowód działania pipeline'u (zielony run na GitHub) nastąpi po osobno zatwierdzonym pushu i nie jest częścią tego kontraktu.

## Relevant SDD / ADR

- Decyzja o systemie CI: GitHub Actions; pochodzi z zapisanej decyzji publikacyjnej z 2026-10-02 (repo opublikowane na GitHub, CI "po publikacji, osobnym commicie", runner `windows-latest`, `pnpm run verify`). Tytuł work itemu ("GitLab CI") ustępuje tej decyzji; alternatywa GitLab pozostaje omówiona w `docs/development/ci.md`.
- Brak osobnego ADR; powyższe jest wiążącym zapisem decyzji dla tego kontraktu.
