# CI: automatyczna weryfikacja zmian (GitHub Actions)

CI (Continuous Integration) to automat, który po każdym zgłoszeniu zmiany sam pobiera repozytorium na czystej maszynie i uruchamia sprawdzenia. Dzięki temu nikt nie musi pamiętać o ręcznym odpalaniu testów, a błąd wykryty na czystej maszynie wykrywa się w minutę, nie u kogoś, kto świeżo sklonował projekt.

Ten projekt ma jeden pipeline zdefiniowany w [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Biega na GitHub Actions (system CI wbudowany w GitHub) i uruchamia dokładnie to samo polecenie, które używasz lokalnie: `pnpm run verify`.

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

`windows-latest`: wirtualna maszyna z Windows hostowana przez GitHub, z preinstalowanym Node i Visual Studio Build Tools (Build Tools są dostępne, ale ten projekt ich nie potrzebuje, patrz niżej).

Dlaczego Windows, skoro większość projektów wybiera Linuksa? NeKode jest projektem Windows-first: celowa platforma to Windows 11, moduły natywne mają zweryfikowane prebuildy `win32-x64`, a testy sprawdzają zachowanie specyficzne dla tego środowiska (ConPTY, ścieżki). CI ma odwzorowywać środowisko, w którym aplikacja realnie działa. Gdyby przyszło wsparcie dla Linuksa, pipeline rozszerza się o drugi job z `runs-on: ubuntu-latest`; dziś to by było fałszywe poczucie bezpieczeństwa, bo zielony Linux nie dowodzi niczego o Windows.

## Dlaczego bez VS C++ Build Tools

Moduły natywne (`better-sqlite3`, `node-pty`) korzystają z gotowych binariów N-API zamiast kompilacji. Polityka buildów jest zapisana w `pnpm-workspace.yaml` (sekcja `allowBuilds`) i jest śledzona przez gita, więc CI dostaje ją automatycznie:

- `better-sqlite3: false`: paczka ma wbudowane prebuildy (w tym `win32-x64.node`), wymuszony `node-gyp` jest zbędny i bez Build Tools by się wywalił.
- `node-pty: true`: skrypt instalacyjny tylko przenosi prebuildy w miejsce oczekiwane przez runtime.
- `electron`: nie ma skryptów instalacyjnych; binaria pobierają się dopiero przy pierwszym uruchomieniu aplikacji, którego CI nie robi.

Praktyczny wniosek: `pnpm install` na CI nie kompiluje niczego, więc pipeline nie zależy od kompilatora. Jeśli kiedyś pojawi się błąd typu "Could not find any Visual Studio installation" albo "NODE_MODULE_VERSION" na CI, to znak, że ktoś dodał zależność bez prebuildów: to blokada do analizy zgodnie z [setup.md](setup.md) (sekcja "Moduły natywne"), a nie powód, by dokładać Build Tools do pipeline'u.

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

Rekomendacja pozostaje GitHub Actions, dopóki repo mieszka na GitHub: pipeline żyje obok kodu, biega bez żadnej dodatkowej konfiguracji i darmowo dla repo publicznego. Koszt ewentualnej zmiany na GitLab jest mały: `ci.yml` to ok. 40 linii, a `pnpm run verify` przenosi się 1:1; realną pracą jest dopiero mirror i runner Windows.

## Jak czytać wynik

- Karta **Actions** na GitHub: lista runów, każdy z nazwą commita i statusem (zielony ptak = ok, czerwony krzyżyk = błąd).
- Przy PR: sekcja **Checks** pokazuje job `verify`; klik w job pokazuje log krok po kroku.
- Znaczniki przy commitach w historii: ptak/krzyżyk obok hashu.

Przy czerwonym runie: otwórz log, znajdź pierwszy krok z błędem (kolejność kroków odpowiada kolejności diagnozy: checkout, pnpm, Node, instalacja, verify), a potem odtwórz lokalnie to samo polecenie (`pnpm run verify`). CI używa czystej maszyny, więc czerwony wynik bez lokalnej reprodukcji zwykle oznacza rozjazd lockfile (`--frozen-lockfile`), brakujący prebuild albo różnicę systemową.

## Czego CI świadomie nie robi

- Nie buduje instalatora (`build:win`) ani paczki (`build:unpack`): build Windows sprawdza się lokalnie, a pipeline ma być szybki.
- Nie robi release'ów ani nie publikuje artefaktów: wydania to osobny proces.
- Nie biega na Linuksie ani macOS: brak wsparcia docelowego (patrz wyżej).
- Nie uruchamia skryptów harnessu (`.agents/` nie jest częścią publikowanego repo).
- Nie ma badge w README: może być dodany, kiedy ktoś zapragnie, jedną linią.
