# Wydania NeKode na GitHub Releases

Path: `docs/features/github-releases/spec.md`.

Kontrakt behawioralny zadania NEKODE-104. Postęp prac trzyma rekord zadania, nie specyfikacja.

## Goal

Publiczne repozytorium `tomaszmadera/NeKode` udostępnia gotowe do pobrania wydania aplikacji dla Windows i Linux. Użytkownik bez narzędzi deweloperskich pobiera najnowszą wersję ze strony "Latest release", sprawdza sumę kontrolną i instaluje ją. Utrzymujący projekt tworzy wydanie jednym tagiem, a przed publikacją sprawdza zbudowane pliki.

## Related requirements

- Work item NEKODE-104 (Plane), decyzje z 2026-10-22 w komentarzu karty.
- `docs/operations/branching-model.md` (NEKODE-15): wydania to tagi na `main`.
- `docs/features/ci-pipeline/spec.md` (NEKODE-12): istniejący workflow `verify` i `verify-linux`.
- NEKODE-13 (Linux): zakres Ubuntu 22.04 i 24.04, x64.

## Scope

1. Konfiguracja pakowania w `electron-builder.yml` i skryptach `package.json` dla Windows (NSIS x64) i Linux (AppImage x64).
2. Workflow `.github/workflows/release.yml` budujący pliki wydania z tagu i tworzący szkic GitHub Release.
3. Zasady wydań i procedura w `docs/operations/releases.md`.
4. Sekcja pobierania i instalacji w `README.md`; aktualizacja `docs/development/setup.md` i `docs/development/ci.md`.
5. Pierwsze wydanie wykonane nowym procesem.

## Non-goals

- Auto-updater i jakiekolwiek sprawdzanie aktualizacji w aplikacji.
- Podpisywanie kodu (Windows Authenticode, Linux GPG).
- macOS, ARM, pakiety deb, rpm, Snap, Flatpak, wersja portable dla Windows.
- Wsteczne wydania dla istniejących tagów (do `0.14.19` włącznie).
- Plik `CHANGELOG.md`: kanoniczną historią zmian są notatki GitHub Release.
- Zmiana wymaganego checku `verify` w ochronie gałęzi `main`.

## Behaviour

### Zasady wydań

- Każdy tag wersji na `main` jest wydaniem z binarkami Windows i Linux. Nie ma tagów bez wydania.
- Zmiany gromadzą się na `main`; wersję podnosi się tylko na wyraźne polecenie utrzymującego. Jedno wydanie obejmuje wszystkie zmiany od poprzedniego tagu. Pojedyncza poprawka dostaje własne wydanie tylko na polecenie utrzymującego (np. crash, utrata danych).
- Nazwy tagów to numeryczny semver bez prefiksu `v` (np. `0.15.0`), zgodnie z istniejącą konwencją.
- Wersje `X.Y.Z` bez sufiksu to zwykłe wydania (widoczne jako "Latest"), także w okresie 0.x. Status beta komunikuje tytuł wydania, notatki i README.
- Tag z sufiksem semver (np. `0.15.0-rc.1`) tworzy wydanie oznaczone jako pre-release.

### Pakowanie

- Windows: instalator NSIS x64 o nazwie `NeKode-Setup-<version>.exe`.
- Linux: AppImage x64 o nazwie `NeKode-<version>-x86_64.AppImage`, budowany na Ubuntu 22.04 (baza glibc z `verify-linux`).
- Pakowanie nigdy nie publikuje samodzielnie: electron-builder działa z `--publish never`, a wydanie tworzy wyłącznie workflow.
- Lokalne skrypty: istniejący `build:win` oraz nowy `build:linux` dają te same nazwy plików co CI.

### Workflow wydania

- Wyzwalacz: push tagu pasującego do numerycznego semver (z opcjonalnym sufiksem). Dodatkowo ręczne uruchomienie (`workflow_dispatch`) buduje pliki jako artefakty runu, bez tworzenia wydania.
- Bramki przed budowaniem; niespełnienie dowolnej przerywa workflow bez tworzenia wydania:
  1. wersja w `package.json` w otagowanym commicie równa się nazwie tagu;
  2. otagowany commit jest osiągalny z `main`;
  3. `pnpm run verify` przechodzi na Windows i na Linux.
- Budowanie Windows i Linux biegnie równolegle. Wydanie powstaje tylko, gdy oba buildy się udały.
- Do wydania trafiają: instalator Windows, AppImage i `SHA256SUMS.txt` z sumami obu plików w formacie `sha256sum`.
- Wydanie powstaje jako szkic (draft). Publikuje je ręcznie utrzymujący po sprawdzeniu plików.
- Tytuł wydania: `NeKode <version>`. Notatki zawierają listę commitów od poprzedniego tagu (bez commitów `chore: bump version`), pogrupowaną według typu conventional commits, oraz stały blok: status beta, brak auto-updatera (aktualizacja przez pobranie nowej wersji), ostrzeżenie SmartScreen dla niepodpisanego instalatora, odnośnik do weryfikacji sum.
- Workflow nie nadpisuje istniejącego wydania ani plików o tej samej nazwie.

### Dokumentacja

- `README.md` ma sekcję pobierania z odnośnikiem do `releases/latest`, instrukcją instalacji dla obu systemów, aktualizacji ręcznej, weryfikacji sum i opisem ostrzeżenia SmartScreen. Sekcja Status przestaje twierdzić, że nie ma gotowych instalatorów, dopiero gdy pierwsze wydanie jest opublikowane.
- `docs/operations/releases.md` opisuje zasady wydań z tej specyfikacji i procedurę: bump, tag, push tagu, kontrola szkicu, publikacja.

## Business rules

- Tag = wydanie; brak wersji bez binarek.
- Szkic nie jest wydaniem dla użytkowników, dopóki utrzymujący go nie opublikuje.
- Opublikowanego wydania ani tagu nie przenosi się. Błędne wydanie naprawia się kolejną wersją patch.

## Authorization

- Push tagu i publikację szkicu wykonuje wyłącznie utrzymujący.
- Workflow używa `GITHUB_TOKEN` z uprawnieniem `contents: write` tylko w jobie tworzącym wydanie; joby budujące mają `contents: read`. Żadnych dodatkowych sekretów.

## Data / API

- Wejście: tag Git, `package.json` (`version`).
- Wyjście: GitHub Release (draft) z trzema plikami: `NeKode-Setup-<version>.exe`, `NeKode-<version>-x86_64.AppImage`, `SHA256SUMS.txt`.

## Edge cases

- Pierwszy tag po wdrożeniu: poprzedni tag to `0.14.19` lub nowszy istniejący; notatki obejmują commity od niego.
- Tag z sufiksem: wydanie oznaczone pre-release, nie zmienia "Latest".
- Ponowne uruchomienie workflow dla tagu, którego wydanie już istnieje: workflow kończy się błędem z czytelnym komunikatem, nic nie nadpisuje.
- Tag niebędący wersją (np. `test`): workflow się nie uruchamia.

## Errors

- Niezgodność wersji, tag spoza `main`, czerwony `verify`, nieudany build któregokolwiek systemu: workflow kończy się błędem, nie tworzy wydania ani częściowego szkicu, a komunikat nazywa niespełnioną bramkę.
- Brak cichych fallbacków: brak pliku do wgrania jest błędem.

## Acceptance criteria

1. `pnpm run build:win` tworzy `dist/NeKode-Setup-<version>.exe`; instalator instaluje i uruchamia aplikację na Windows 11.
2. `pnpm run build:linux` na Ubuntu 22.04 tworzy `dist/NeKode-<version>-x86_64.AppImage`; plik uruchamia aplikację na Ubuntu 22.04 lub 24.04 z terminalem działającym w sesji.
3. Ręczne uruchomienie workflow wydania produkuje oba pliki jako artefakty runu i nie tworzy wydania.
4. Push tagu z wersją niezgodną z `package.json` kończy workflow błędem bez wydania.
5. Push poprawnego tagu tworzy szkic z trzema plikami; sumy z `SHA256SUMS.txt` zgadzają się z pobranymi plikami.
6. `docs/operations/releases.md` i `README.md` opisują zachowanie z tej specyfikacji.
7. Pierwsze wydanie nowym procesem jest opublikowane, widoczne jako "Latest", a pobrane z niego pliki instalują się i uruchamiają na obu systemach.

## Required tests

- Lokalny smoke instalatora Windows (kryterium 1) i AppImage (kryterium 2).
- Run `workflow_dispatch` (kryterium 3) i run z celowo błędnym tagiem na forku lub z tagiem testowym usuniętym przed publikacją (kryterium 4), uzgodniony z utrzymującym.
- Smoke plików pobranych z opublikowanego wydania (kryterium 7).
- `pnpm run verify` bez regresji.

## Relevant SDD / ADR

none
