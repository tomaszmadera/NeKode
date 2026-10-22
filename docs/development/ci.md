# CI: automatyczna weryfikacja zmian (GitHub Actions)

## Dobór weryfikacji

[Kontrakt projektu](project-contract.md) określa obowiązki kontrybutora;
[package.json](../../package.json) i [vitest.config.ts](../../vitest.config.ts)
są źródłem bieżących poleceń i zakresu testów. W raporcie podaj polecenie,
dokładny cel, kod wyjścia i ograniczenia. Błąd dowolnego wymaganego checku blokuje
akceptację; brak uruchomienia nie jest wynikiem pass.

| Polecenie lub check | Co potwierdza i kiedy go użyć |
|---|---|
| `pnpm run lint` | Statyczne reguły Biome, także format obsługiwanych plików; nie zachowanie runtime |
| `pnpm run typecheck` | Typy main/preload/shared i renderera; oba projekty TypeScript |
| `pnpm run test <potwierdzona-ścieżka-testu>` | Skupiony test Vitest istniejącego zakresu; najpierw sprawdź dokładny plik, a po uruchomieniu liczbę wybranych testów |
| `pnpm run test` | Cała suite: projekt `node` dla main/preload/shared i `renderer` z jsdom dla renderera |
| `pnpm run verify` | Lint, oba typechecki i cała suite; lokalny odpowiednik gate CI dla zmian kodu |
| `pnpm run format` | Zmienia format plików; to edycja, a nie test. Przejrzyj wynik i zachowaj zakres zmiany |
| Dokumentacja/linki i `git diff --check` | Dla zmian samej prozy: linki względem publicznego inventory Git, dokładna wielkość liter, przenośne ścieżki, zgodność reguł i brak zależności od prywatnych rekordów. Sam diff-check nie ocenia treści ani plików untracked |
| Dev, packaged lub installer smoke | Prawdziwy Electron, natywne moduły i ConPTY; [setup](setup.md) określa izolację i teardown |

Dobierz skupione testy do zachowania, które zmieniasz; nie wyprowadzaj nazwy
testu z nazwy modułu bez sprawdzenia inventory. Regresja zgłoszonego defektu musi
nie przechodzić bez poprawki: zachowaj wynik red albo cofnij i przywróć poprawkę
przed końcową weryfikacją. Asercja braku zmiany wymaga dowodu, że operacja została
wykonana. Nie dodawaj testu tylko po to, by powtórzył kod lub słowa dokumentacji.

Dla zmian IPC sprawdź pozytywne routing i odrzucenia payload/sender; dla bazy
migracje, transakcje i integralność; dla terminala przełączanie sesji, błędy spawn
i zamknięcie bez osieroconych procesów. Szczegóły mają jednego właściciela:
[obowiązki architektury](../architecture/sdd.md#current-implementation-obligations).
Zmiany integracyjne, bezpieczeństwa lub szerokich kontraktów wymagają całej
suite i odpowiedniego smoke. Zmiany natywne lub pakowania wymagają realnego
Electrona nawet gdy Vitest przechodzi; jsdom nie jest e2e. Dla samej prozy nie
traktuj testów aplikacji jako dowodu poprawności tekstu.

Przed akceptacją przejrzyj cały finalny diff i wykonaj wymagany zakres po
ostatniej zmianie, która mogła unieważnić wynik. Nie maskuj kodu wyjścia
poleceniem raportującym. Integracje sprawdzaj na sandboxie lub fixture, gdy
jest dostępny; nie używaj danych produkcyjnych. Gdy środowisko nie może wykonać
wymaganego smoke, zapisz cel i powód, a wynik pozostaw jako nieuruchomiony.

CI (Continuous Integration) to automat, który po każdym zgłoszeniu zmiany sam pobiera repozytorium na czystej maszynie i uruchamia sprawdzenia. Dzięki temu nikt nie musi pamiętać o ręcznym odpalaniu testów, a błąd wykryty na czystej maszynie wykrywa się w minutę, nie u kogoś, kto świeżo sklonował projekt.

Ten projekt ma jeden pipeline weryfikacji zdefiniowany w [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Biega na GitHub Actions (system CI wbudowany w GitHub) i uruchamia dokładnie to samo polecenie, które używasz lokalnie: `pnpm run verify`. Osobny workflow wydania [`.github/workflows/release.yml`](../../.github/workflows/release.yml) opisuje sekcja [Workflow wydania](#workflow-wydania).

## Co sprawdzamy i dlaczego

`pnpm run verify` to zestaw trzech sprawdzeń z `package.json`:

| Sprawdzenie | Polecenie | Co łapie |
|---|---|---|
| Lint | `biome check .` | błędy stylistyczne, nieużywane zmienne, podejrzane wzorce |
| Typecheck | `tsc --noEmit` (projekty `node` i `web`) | błędy typów TypeScript zanim ktokolwiek uruchomi aplikację |
| Testy | `vitest run` | regresje w logice (projekty `node` i `renderer`, środowisko `jsdom`, z `vitest.config.ts`) |

Kolejność ma znaczenie: lint i typecheck są szybsze od testów, więc najtańsze błędy padają pierwsze. Wszystkie trzy muszą przejść; jedno czerwone kończy cały pipeline.

## Kiedy pipeline się uruchamia

Dwa zdarzenia odpalają CI:

1. **Pull request**: niezależnie od gałęzi źródłowej. Wynik widać na stronie PR jako check; czerwony check to sygnał "nie mergować".
2. **Push na `main`**: kontrola, że sama gałąź główna jest zawsze zielona.

Nowy push do tego samego PR-a lub gałęzi anuluje jeszcze biegnący run (sekcja `concurrency` w workflow): nie płacimy czasu na sprawdzanie kodu, który już jest nieaktualny. Pojedynczy run ma limit 20 minut; przekroczenie traktowane jest jak awaria.

## Na jakim systemie biega

Dwa joby biegną równolegle przy każdym triggerze:

- `verify` na `windows-latest`: wirtualna maszyna z Windows hostowana przez GitHub, z preinstalowanym Node i Visual Studio Build Tools (Build Tools są dostępne, ale ten projekt ich nie potrzebuje, patrz niżej). To jest **wymagany** check: ochrona gałęzi `main` żąda dokładnie tej nazwy, więc job i jego nazwa się nie zmieniają.
- `verify-linux` na `ubuntu-24.04`: to samo `pnpm run verify` na Linuksie, na tej samej wersji Ubuntu co build AppImage w [workflow wydania](#workflow-wydania). Na razie check **doradczy**: nie jest wymagany przez ochronę gałęzi, ale czerwony wynik i tak trzeba wyjaśnić przed merge'em.

Dlaczego Windows, skoro większość projektów wybiera Linuksa? NeKode jest projektem Windows-first: celowa platforma to Windows 11, moduły natywne mają zweryfikowane prebuildy `win32-x64`, a testy sprawdzają zachowanie specyficzne dla tego środowiska (ConPTY, ścieżki). CI ma odwzorowywać środowisko, w którym aplikacja realnie działa. Job linuksowy (faza 0 planu wersji na Linuksa) pilnuje, żeby kod i testy nie dryfowały w stronę Windows-only; nie zastępuje joba Windows, bo zielony Linux nie dowodzi niczego o Windows. Testy specyficzne dla Windows (WSL, kandydaci PowerShell/cmd) są na Linuksie pomijane (`skipIf`), a ścieżki w fixture'ach przechodzą przez `hostPath` (`src/main/test-support/host-path.ts`), który na Windows zwraca literał bez zmian.

## Dlaczego bez VS C++ Build Tools

Moduły natywne (`better-sqlite3`, `node-pty`) korzystają z gotowych binariów N-API zamiast kompilacji. Polityka buildów jest zapisana w `pnpm-workspace.yaml` (sekcja `allowBuilds`) i jest śledzona przez gita, więc CI dostaje ją automatycznie:

- `better-sqlite3: false`: paczka ma wbudowane prebuildy (w tym `win32-x64.node`), wymuszony `node-gyp` jest zbędny i bez Build Tools by się wywalił.
- `node-pty: true`: skrypt instalacyjny tylko przenosi prebuildy w miejsce oczekiwane przez runtime.
- `electron`: nie ma skryptów instalacyjnych; binaria pobierają się dopiero przy pierwszym uruchomieniu aplikacji, którego CI nie robi.

Praktyczny wniosek: `pnpm install` w jobie Windows nie kompiluje niczego, więc ten job nie zależy od kompilatora.

Wyjątek: job `verify-linux`. `node-pty` 1.1.0 nie ma prebuildów dla Linuksa, więc job instaluje `build-essential` i `python3`, a potem kompiluje moduł ze źródeł (`pnpm rebuild node-pty`, kilka sekund; moduł jest N-API, więc ta sama binarka działa w Node i w Electronie). To świadoma decyzja dla Linuksa, opisana w [setup.md](setup.md) (sekcja "Moduły natywne"). Jeśli kiedyś pojawi się błąd typu "Could not find any Visual Studio installation" albo "NODE_MODULE_VERSION" na CI, to znak, że ktoś dodał zależność bez prebuildów: to blokada do analizy zgodnie z [setup.md](setup.md) (sekcja "Moduły natywne"), a nie powód, by dokładać Build Tools do pipeline'u.

## Cache pnpm

Krok `actions/setup-node` z opcją `cache: pnpm` zapisuje magazyn paczek pnpm między runami. Po zmianie `pnpm-lock.yaml` pobierane są tylko nowe paczki. Pierwszy run (i każdy po zmianie klucza cache) jest wolniejszy, bo pobiera wszystko od zera; to normalne. Cache jest optymalizacją: jego brak nigdy nie zmienia wyniku.

Instalacja biega zawsze z `--frozen-lockfile`: jeśli `pnpm-lock.yaml` nie zgadza się z `package.json`, instalacja natychmiast pada. To celowe: rozjazd zależności ma być naprawiony w commicie, nie zignorowany.

## GitHub Actions vs GitLab CI

Oba systemy robią to samo (ciągła weryfikacja), różni się integracja z hostingiem repo, definicja pipeline'u i dostępność runnerów:

| Cecha | GitHub Actions (obecny wybór) | GitLab CI |
|---|---|---|
| Hosting repo | origin tego projektu: `github.com:tomaszmadera/NeKode` | wymaga repo na GitLab (push mirror z GitHub lub przenosiny) |
| Plik pipeline'u | `.github/workflows/*.yml` | `.gitlab-ci.yml` w katalogu głównym |
| Definicja | joby z listą `steps` (uses/run) | `stages` i skrypty per job |
| Runnery Windows | `windows-latest` dostępny od razu, dla publicznego repo bezpłatnie | dostępność współdzielonych runnerów Windows na GitLab.com jest ograniczona (beta, ograniczona dostępność); w praktyce podpina się własną maszynę (self-hosted) |
| Konfiguracja startowa | zero: workflow w repo działa po pushu | konto na GitLab, mirror, ewentualnie własny runner |

Rekomendacja pozostaje GitHub Actions, dopóki repo mieszka na GitHub: pipeline żyje obok kodu, biega bez żadnej dodatkowej konfiguracji i darmowo dla repo publicznego. Koszt ewentualnej zmiany na GitLab jest mały: `ci.yml` to ok. 70 linii, a `pnpm run verify` przenosi się 1:1; realną pracą jest dopiero mirror i runner Windows.

## Jak czytać wynik

- Karta **Actions** na GitHub: lista runów, każdy z nazwą commita i statusem (zielony ptak = ok, czerwony krzyżyk = błąd).
- Przy PR: sekcja **Checks** pokazuje joby `verify` (wymagany, Windows) i `verify-linux` (doradczy); klik w job pokazuje log krok po kroku.
- Znaczniki przy commitach w historii: ptak/krzyżyk obok hashu.

Przy czerwonym runie: otwórz log, znajdź pierwszy krok z błędem (kolejność kroków odpowiada kolejności diagnozy: checkout, pnpm, Node, instalacja, verify), a potem odtwórz lokalnie to samo polecenie (`pnpm run verify`). CI używa czystej maszyny, więc czerwony wynik bez lokalnej reprodukcji zwykle oznacza rozjazd lockfile (`--frozen-lockfile`), brakujący prebuild albo różnicę systemową.

## Workflow wydania

[`.github/workflows/release.yml`](../../.github/workflows/release.yml) buduje pliki wydania i jest niezależny od `ci.yml`; wymagany check `verify` na `main` się nie zmienia. Zasady wydań i procedurę opisuje [releases.md](../operations/releases.md).

- Wyzwalacz: push tagu z numerycznym semver bez prefiksu `v` (np. `0.15.0` albo `0.15.0-rc.1`). Tag, który nie zaczyna się od liczbowego `X.Y.Z` (np. `test`), nie uruchamia workflow; inne niepoprawne tagi (np. `1.2.3foo`) zatrzymuje bramka.
- Bramki przed budowaniem: tag równa się `version` w `package.json` otagowanego commita, otagowany commit jest osiągalny z `main` (oba sprawdza `node scripts/release.mjs gate`), a `pnpm run verify` przechodzi na Windows i na Linuksie.
- Build Windows (`pnpm run build:win`) i Linux (`pnpm run build:linux`, Ubuntu 24.04) biegnie równolegle; electron-builder działa z `--publish never`.
- Job `Create draft release` działa tylko dla pushu tagu i tylko gdy oba buildy się udały. Tworzy szkic `NeKode <version>` z `NeKode-Setup-<version>.exe`, `NeKode-<version>-x86_64.AppImage` i `SHA256SUMS.txt` oraz notatkami z commitów od poprzedniego tagu. Nie nadpisuje istniejącego wydania. Szkic publikuje ręcznie utrzymujący.
- Uprawnienia: tylko `GITHUB_TOKEN`; `contents: write` ma wyłącznie job tworzący szkic, pozostałe joby `contents: read`.
- Ręczne uruchomienie (`workflow_dispatch`, np. `gh workflow run release.yml --ref main`) buduje oba pliki jako artefakty runu (`windows-installer`, `linux-appimage`) i nie tworzy wydania.

## Czego CI świadomie nie robi

- Workflow `ci.yml` nie buduje instalatora (`build:win`), AppImage (`build:linux`) ani paczki (`build:unpack`): pipeline weryfikacji ma być szybki, a pliki wydania buduje [workflow wydania](#workflow-wydania).
- `ci.yml` nie robi release'ów ani nie publikuje artefaktów: wydania tworzy wyłącznie workflow wydania z tagu.
- Nie biega na macOS: brak wsparcia docelowego. Linux ma doradczy job `verify-linux` (patrz wyżej).
- Nie uruchamia skryptów harnessu (`.agents/` nie jest częścią publikowanego repo).
- README ma badge najnowszego wydania (latest release), ale nie ma badge statusu CI: można go dodać jedną linią.
