# Model gałęzi: trunk-based hybrydowy

Decyzja z 2026-10-02 (karta NEKODE-15). Obowiązuje trunk-based hybrydowy: jedna stała gałąź `main`, krótko żyjące gałęzie robocze na większe prace, wydania jako tagi na `main`.

## Zasady

- `main` jest jedyną stałą gałęzią. Zawsze zielona (CI biega na push do `main` i na każdym PR) i zawsze gotowa do wydania.
- Drobne zmiany utrzymaniowe (poprawki, małe funkcje): commit wprost na `main`. Przed pushem uruchom zarejestrowaną weryfikację: `cmd /c pnpm run lint && cmd /c pnpm run typecheck` albo pełne `cmd /c pnpm run verify`.
- Większe lub ryzykowne prace: gałąź robocza z aktualnego `main`, merge przez PR z zielonym CI. Czas życia gałęzi: docelowo do ok. 3 dni; dłuższe prace dziel na mniejsze albo regularnie rebase'uj na `main`.
- Nazwa gałęzi roboczej: `nekode-<numer>-<krotki-opis>` (np. `nekode-20-terminal-shell-choice`), gdy praca ma kartę w backlogu; bez karty: `<krotki-opis>`.
- Merge robi maintainer. Historia `main` pozostaje liniowa; obce PR-y wchodzą squashem (jeden commit na PR).
- Obce PR-y: celują w `main`, z forków współpracowników. Merge po recenzji i zielonym CI.
- Wydanie: tag na `main` przez `python .agents/skills/ci/scripts/ci.py release` (semver, strategia liniowa). Tag zawsze wskazuje commit na `main`; gałąź `develop` nie istnieje.

## Ochrona main na GitHubie

Repo jest publiczne (`github.com:tomaszmadera/NeKode`). Docelowa konfiguracja: ruleset na `main` wymagający PR i zielonego checku CI dla wszystkich, z pominięciem (bypass) dla administratora, żeby maintainer zachował możliwość bezpośrednich commitów. Włączenie rulesetu to osobna akcja w ustawieniach repozytorium.

## Dlaczego nie git-flow

Git-flow (main + develop, merge do main przy wydaniu) opłaca się przy równoległych wydaniach, kilku osobach w zespole albo długiej stabilizacji release'a. W NeKode praca jest solo, wydania są liniowe, a CI od początku biega na `main`; develop podwajałby merge każdej zmiany i dodawał drugą gałąź do utrzymania. Powrót do tej decyzji ma sens, gdy pojawi się drugi aktywny maintainer albo równoległe wersje wydawnicze.

Powiązane: działanie CI opisuje [docs/development/ci.md](../development/ci.md).
