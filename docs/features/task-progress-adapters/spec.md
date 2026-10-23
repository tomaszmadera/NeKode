# Postęp zadań przez adaptery źródeł

Status: Delivered (NEKODE-81).
Path: `docs/features/task-progress-adapters/spec.md`.

Ten plik jest kontraktem zachowania funkcji. Agenci implementują na jego podstawie. Nie zapisuj tu postępu wykonania, list plików ani historii architektury.

## Goal

Pokazać postęp zadań agentów w projekcie (licznik kroków przy czacie w lewej nawigacji i pasek segmentów w wierszu akcji) na podstawie danych z adaptera, którego użytkownik świadomie wybrał w ustawieniach projektu. NeKode nie zna żadnego formatu rekordów zadań. Agent Harness, inny harness albo własny format plików podłącza się wyłącznie adapterem. Dane mają być aktualne podczas pracy agenta, a błąd lub stare dane muszą być odróżnialne od braku zadań.

## Related requirements

- NEKODE-81 (opis karty zaktualizowany 2026-10-23).
- Decyzje użytkownika z 2026-10-23: każde źródło, także Agent Harness, jest adapterem; osobna zakładka `Task progress` w Project Settings z kopiowaniem konfiguracji z innego projektu; nic nie włącza się automatycznie; NeKode nie dostarcza żadnego adaptera postępu, adapter Agent Harness powstaje w repozytorium agent-harness, a NeKode dokumentuje komendę jego instalacji.
- Wzorzec adapterów: [kanban-adapter-interface](../kanban-adapter-interface/spec.md) (Behaviour 1-8) i [usage-quota](../usage-quota/spec.md) (reguły 12-13: harmonogram, single-flight, pauza okna).
- Projekty WSL: [project-environments](../project-environments/spec.md) (reguła 9) i [ADR WSL](../../architecture/project-environment-adapters.md).
- Etykiety sesji: [session-labels](../session-labels/spec.md) (reguła 6: zachować wyświetlanie postępu; `task_ref` zapisany przy starcie z kanbanu).
- Kontrakt źródłowy dla adaptera Agent Harness: `task-status --json`, `schema_version: 2` (HARNESS-37, Done).

## Scope

- Odkrywanie adapterów postępu w jednym stałym katalogu adapterów, walidacja manifestu, protokół procesu v1.
- Zakładka `Task progress` w Project Settings: wybór adaptera albo `None`, formularz pól z manifestu, `Test`, kopiowanie konfiguracji z innego projektu, stan ostatniego odczytu.
- Usługa w procesie głównym: odczyt snapshotu, walidacja modelu, stany błędów, znacznik nieaktualności, obserwacja plików, odpytywanie zapasowe, sprzątanie.
- Znormalizowany model postępu w kontrakcie IPC i zdarzenie aktualizacji dla renderera.
- Dopasowanie czatu do zadania i zasilenie istniejących wskaźników nowym modelem.
- Usunięcie `TaskRecordService` (parser `task.md`) oraz pola `task` z `ChatInfo`.
- Dokumentacja protokołu dla autorów adapterów, z komendą instalacji adaptera Agent Harness, oraz przykładowy adapter protokołu w `adapters/` (nie jest dostarczany z aplikacją).

## Non-goals

- Dostarczanie jakiegokolwiek adaptera postępu z aplikacją, w tym adaptera Agent Harness. Jego kod powstaje w repozytorium agent-harness.
- Finalny widok graficzny postępu, rozwijany panel `TaskProgressButton`, zmiana wyglądu wskaźników poza znacznikiem nieaktualności.
- Zapis do rekordów zadań, sterowanie workflow, telemetria, model aktywności procesu, stan sesji (NEKODE-4).
- Ustawienie globalne w App Settings i dziedziczenie konfiguracji między projektami. Kopiowanie jest jednorazowe.
- Wybór, nadpisanie lub przeglądanie katalogu adapterów oraz pola konfiguracji wybierające katalog (decyzja użytkownika 2026-10-23).
- Serwer, demon adaptera, obowiązkowa baza danych dla snapshotów (snapshoty żyją w pamięci procesu głównego).
- Uruchamianie adaptera wewnątrz WSL przez NeKode. Adapter działa na hoście; komendy w WSL uruchamia sam (Behaviour 14).

## Behaviour

### Adaptery i protokół

1. Katalog adapterów jest jeden i stały: `<userData>/task-progress-adapters`. Nie ma ustawienia, nadpisania ani wyboru katalogu. Skan jednego poziomu przy każdym `taskProgress:adaptersList`. Podkatalog z poprawnym `adapter.json` jest adapterem. Niepoprawne manifesty są pomijane z ostrzeżeniem w logu, z nazwą ścieżki. Przy powtórzonym `id` wygrywa pierwszy katalog w porządku leksykograficznym. Brak katalogu oznacza pustą listę z wyjaśnieniem, nie błąd.
2. Manifest: `{ id, name, kind: "task-progress", protocolVersion: 1, invocation: { command, args? }, environments?: ["local" | "wsl"], configSchema: [ { key, label, type, required?, options?, default? } ] }`. `type` to `string | select | boolean`. `environments` domyślnie `["local"]`. Manifest z innym `kind` lub `protocolVersion` jest odrzucany. Pól `secret` nie ma w v1.
3. Wywołanie: jeden proces na żądanie, `invocation.command` i `invocation.args` jako argv bez powłoki, cwd to katalog adaptera. NeKode pisze jeden obiekt JSON na stdin i zamyka stdin, czyta stdout do EOF i oczekuje jednego obiektu JSON. stderr służy tylko diagnostyce. Limit czasu 15 s z zabiciem drzewa procesów, limit stdout 10 MB. Kod wyjścia 0 przy `ok: true`, 1 przy `ok: false`. Każde inne zachowanie to błąd protokołu.
4. Żądanie: `{ protocolVersion: 1, action, config, project }`, gdzie `project` to `{ root, environment: "local" | "wsl", distribution?, linuxRoot? }`. `root` to ścieżka projektu na hoście (dla WSL ścieżka UNC). Wartości konfiguracji nigdy nie trafiają do argv ani zmiennych środowiskowych.
5. Akcje:
   - `test`: sprawdza konfigurację wobec projektu i zwraca `{ summary }` (krótki tekst, na przykład liczba znalezionych rekordów).
   - `snapshot`: zwraca `{ schemaVersion: 1, generatedAt, watch, tasks }` według Data / API.
6. Odpowiedź błędu: `{ ok: false, error: { code, message } }`, gdzie `code` to `config | runtime | unsupported_source | transient | internal`. `runtime` oznacza brak programu, interpretera lub komendy źródła. `unsupported_source` oznacza format lub wersję źródła, której adapter nie obsługuje. `transient` oznacza chwilowy stan, na przykład wyścig z przenoszeniem rekordu do archiwum.

### Ustawienia projektu

7. Project Settings ma zakładkę `Task progress` obok `Kanban`. Lista adapterów zawiera `None` (domyślnie) i odkryte adaptery (nazwa, id). Wybór adaptera pokazuje formularz z `configSchema`; pola wymagane są oznaczone. `Save` zapisuje id adaptera i wartości pól. `None` usuwa powiązanie i zachowuje zapisane wartości pól.
8. `Test` uruchamia akcję `test` z bieżącymi, także niezapisanymi wartościami, bez ich zapisu. Wynik (sukces z `summary` albo typowany błąd) jest pokazany w zakładce, nie w toaście.
9. `Copy from project` pokazuje listę innych projektów z zapisanym powiązaniem. Wybór kopiuje id adaptera i wartości pól do formularza bez zapisu; użytkownik zatwierdza przez `Save`. Kopia jest jednorazowa: późniejsze zmiany w projekcie źródłowym nie zmieniają kopii.
10. Zakładka nie ma wyboru ani przeglądania katalogu adapterów. Przy pustej liście adapterów pokazuje tekst, że adaptery instaluje się w katalogu adapterów aplikacji, i odsyła do README protokołu. Lista jest odświeżana przy każdym otwarciu zakładki.
11. Zakładka pokazuje stan ostatniego odczytu dla projektu: czas ostatniego poprawnego snapshotu, liczbę zadań i bieżący błąd, jeśli jest.
12. Zapis, zmiana adaptera i `None` unieważniają snapshot projektu i zatrzymują jego obserwację przed uruchomieniem nowej. `projects:remove` usuwa klucze powiązania i konfiguracji projektu oraz zatrzymuje obserwację.

### Odczyt i odświeżanie

13. Bez powiązania NeKode nie uruchamia adaptera, nie czyta plików rekordów i nie obserwuje katalogów tego projektu. Wskaźniki postępu są wtedy ukryte.
14. Projekt WSL wymaga adaptera z `"wsl"` w `environments`. W przeciwnym razie `Test` i odczyt kończą się błędem `environment_unsupported` widocznym w zakładce, bez uruchamiania procesu. Adapter działa na hoście i dostaje `distribution` oraz `linuxRoot`; jeśli musi wykonać komendę w projekcie WSL, uruchamia ją sam w tej dystrybucji. NeKode nie uruchamia komend Windows wewnątrz projektu WSL.
15. Proces główny obserwuje projekt z powiązaniem, gdy renderer zgłasza go jako widoczny: projekt wybrany albo rozwinięty w lewej nawigacji. Renderer zgłasza pełny zbiór widocznych projektów (`taskProgress:observe`); projekt spoza zbioru przestaje być obserwowany w ciągu 1 s.
16. Rozpoczęcie obserwacji wykonuje jeden odczyt `snapshot`. Pole `watch` z odpowiedzi wskazuje katalogi do obserwacji względem `project.root`. Zmiana w nich planuje kolejny odczyt po 300 ms ciszy; seria zmian daje jeden odczyt. Obserwacja katalogów jest odnawiana po każdym snapshocie, gdy `watch` się zmieni.
17. Odpytywanie zapasowe: co 60 s, gdy obserwacja katalogów działa; co 10 s, gdy nie działa (błąd obserwacji, katalog nieistniejący, projekt WSL przez UNC). Minimalny odstęp między odczytami to 2 s. W danym projekcie trwa najwyżej jeden odczyt; zmiany w trakcie dają jeden kolejny odczyt po jego zakończeniu.
18. Ukryte lub zminimalizowane okno wstrzymuje odczyty i odpytywanie. Pokazanie okna wykonuje jeden zaległy odczyt. Zamknięcie aplikacji zatrzymuje obserwacje i zabija trwające procesy adapterów.
19. Błąd `transient` lub błąd protokołu jest ponawiany po 1 s, 2 s i 4 s z zachowaniem ostatniego poprawnego snapshotu bez znacznika nieaktualności. Po wyczerpaniu prób snapshot zostaje oznaczony jako nieaktualny. Błędy `config`, `runtime`, `unsupported_source` i `environment_unsupported` od razu oznaczają snapshot jako nieaktualny i wstrzymują automatyczne odczyty do zmiany konfiguracji, ręcznego `Test` lub następnej zmiany w obserwowanych katalogach.
20. Zadanie, które znika z poprawnego snapshotu, a było widoczne w poprzednim, jest usuwane dopiero po potwierdzającym odczycie po 1 s. To chroni przed wyścigiem z przenoszeniem rekordu do archiwum.
21. Wynik odczytu, który zakończy się po zmianie powiązania, usunięciu projektu albo zakończeniu obserwacji, jest odrzucany. Wynik nigdy nie trafia do innego projektu niż ten, dla którego uruchomiono adapter.

### Wyświetlanie

22. Renderer dostaje snapshoty zdarzeniem `taskProgress:changed` i przy starcie przez `taskProgress:get(projectId)`. `chats:list` nie zwraca już postępu.
23. Dopasowanie czatu do zadania w obrębie jednego projektu, w kolejności: zapisany `taskRef` czatu, a potem pierwszy token w nazwie czatu w formacie `<LITERY>-<CYFRY>` (bez prefiksu powłoki w nawiasach). Token pasuje do zadania, gdy jest równy jego `ref` bez względu na wielkość liter, albo gdy `id` zadania jest równe tokenowi lub zaczyna się od tokenu i `-`. Przy kilku dopasowaniach wygrywa zadanie w stanie `active` lub `blocked`, potem zadanie z nowszym `updated`. Skrót `n74` i dopasowanie po całej nazwie czatu przestają działać.
24. Licznik w lewej nawigacji i `TaskProgressButton` zachowują obecny wygląd i etykiety dostępności. Krok bieżący to krok o `currentStepId`, a bez niego pierwszy nieukończony; zadanie `completed` pokazuje ostatni krok. Nazwa kroku to `currentLabel` zadania, jeśli jest, w przeciwnym razie etykieta kroku. `corrections` daje dopisek ` · fix:N`.
25. Nieaktualny snapshot wyświetla wskaźniki przygaszone, a etykieta dostępności i podpowiedź zaczynają się od `Out of date:` z komunikatem błędu. Zadanie z `recordState` innym niż `valid` nie pokazuje wskaźnika postępu; jego błędy są widoczne w stanie odczytu w zakładce ustawień.

## Business rules

- Tożsamość zadania to para (id projektu, `task.id`). Przeniesienie rekordu do archiwum zmienia `location` i `path`, a tożsamość zostaje. To samo `task.id` w dwóch projektach to dwa różne zadania.
- `location: "archived"` z `state: "active"` lub `"blocked"` oznacza rekord zarchiwizowany w trakcie zamykania; nie jest to zadanie zakończone. Zakończenie oznacza wyłącznie `state: "completed"`.
- `task.id` jest unikalny w snapshocie. Powtórzony `id` unieważnia cały snapshot jako błąd protokołu.
- Puste `tasks` w poprawnym snapshocie oznacza brak zadań, nie błąd.
- Rdzeń NeKode nie odczytuje plików rekordów zadań. Czyta wyłącznie odpowiedzi adaptera i obserwuje katalogi z `watch`.
- Kopiowanie konfiguracji nie tworzy powiązania między projektami.

## Authorization

Brak kontroli dostępu. Adapter uruchamia się tylko po świadomym wyborze użytkownika w zakładce projektu; wybór adaptera oznacza zgodę na to, co adapter robi z projektem, w tym na uruchamianie komend z repozytorium projektu. Renderer nie może podać własnej komendy ani ścieżki adaptera: proces główny używa wyłącznie odkrytych manifestów. Klucze projektu są zapisywane tylko przez dedykowane kanały IPC z walidacją.

## Data / API

### Snapshot (odpowiedź `snapshot`, `schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-23T09:27:37Z",
  "watch": [{ "path": ".agents/tasks", "recursive": true }],
  "tasks": [
    {
      "id": "nekode-101-palette-tokens",
      "ref": "NEKODE-101",
      "title": "NEKODE-101: Tokeny palety NeKode Float",
      "state": "completed",
      "location": "archived",
      "recordState": "valid",
      "errors": [],
      "activity": "idle",
      "phases": [
        { "name": "Intake", "steps": [{ "id": "Phase 0.1", "label": "Inspect the repository", "done": true }] }
      ],
      "currentStepId": null,
      "currentLabel": null,
      "corrections": 0,
      "reviews": 0,
      "nextAction": null,
      "blockers": null,
      "createdAt": "2026-10-23T09:14:09Z",
      "updatedAt": "2026-10-23T09:27:37Z",
      "completedAt": "2026-10-23T09:27:37Z",
      "checkpoints": [{ "stepId": "Phase 0.1", "completedAt": "2026-10-23T09:14:57Z" }],
      "path": ".agents/tasks/archive/nekode-101-palette-tokens/task.md"
    }
  ]
}
```

- Wymagane: `id` (1-120 znaków), `state` (`active | blocked | completed`), `location` (`live | archived`), `recordState` (`valid | invalid | unsupported`), `phases` (może być puste przy `recordState` innym niż `valid`).
- Opcjonalne: `ref`, `title`, `errors` (lista tekstów), `activity` (`working | waiting | idle`), `currentStepId` (musi wskazywać istniejący krok), `currentLabel` (do 40 znaków), `corrections`, `reviews` (liczby nieujemne), `nextAction`, `blockers` (tekst, `null` oznacza brak), znaczniki czasu ISO 8601 UTC, `checkpoints`, `path` (względna, tylko informacyjna).
- `watch[].path` jest względna, bez `..` i bez ścieżek bezwzględnych; ścieżka wychodząca poza `project.root` unieważnia snapshot. Najwyżej 8 wpisów.
- Nieznane pola są ignorowane. Brak wymaganego pola, zły typ albo niespójność (`currentStepId` bez kroku) unieważnia snapshot jako błąd protokołu.

### Model w renderer

`TaskProgressSnapshot { projectId, adapterId, status: "ok" | "stale", tasks: TaskProgressItem[], receivedAt, error?: { code, message } }`. `TaskProgressItem` odpowiada zadaniu ze snapshotu po walidacji. `SessionTaskProgress` jest wyliczany z `TaskProgressItem` po stronie renderera do zasilenia istniejących komponentów.

### IPC

- `taskProgress:adaptersList()` → `{ adapters, warnings }`.
- `taskProgress:getBinding(projectId)` → `{ adapterId | null, config }`.
- `taskProgress:saveBinding(projectId, adapterId | null, config)`.
- `taskProgress:test(projectId, adapterId, config)` → `{ summary }` albo typowany błąd.
- `taskProgress:observe(projectIds[])`.
- `taskProgress:get(projectId)` → `TaskProgressSnapshot | null`.
- Zdarzenie `taskProgress:changed` z `TaskProgressSnapshot` (albo `{ projectId, cleared: true }`).

### Trwałość

Klucze `app_state`: `project.taskProgressAdapter:<projectId>`, `project.taskProgressConfig:<projectId>` (JSON). Bez migracji schematu. Snapshoty tylko w pamięci.

### Dokumentacja dla autorów adapterów

`adapters/task-progress-example/` zawiera przykładowy adapter protokołu (czyta jeden plik JSON w formacie snapshotu) i `README.md` z opisem protokołu, przykładami oraz komendą instalacji adaptera z innego repozytorium, na przykład adaptera Agent Harness:

```powershell
# Windows
New-Item -ItemType Directory -Force "$env:APPDATA\nekode\task-progress-adapters" | Out-Null
Copy-Item -Recurse -Force "<agent-harness>\adapters\nekode-task-progress" "$env:APPDATA\nekode\task-progress-adapters\agent-harness"
```

```sh
# Linux
mkdir -p ~/.config/nekode/task-progress-adapters
cp -r <agent-harness>/adapters/nekode-task-progress ~/.config/nekode/task-progress-adapters/agent-harness
```

Ścieżka adaptera w repozytorium agent-harness (`adapters/nekode-task-progress`) jest propozycją do potwierdzenia przy tworzeniu adaptera. README opisuje też dla autora adaptera Agent Harness, że domyślne `task-status --json` pomija zakończone rekordy z archiwum (`.agents/scripts/task-status`, `discover_paths`), więc adapter podaje ścieżki rekordów jawnie, jeśli ma zwracać zadania zakończone.

## Edge cases

- Adapter zapisany w powiązaniu, a nieobecny w katalogu: błąd `adapter_missing`, snapshot nieaktualny, zakładka pokazuje id brakującego adaptera.
- Katalog z `watch` nie istnieje: odpytywanie co 10 s; utworzenie katalogu wznawia obserwację przy następnym snapshocie.
- Projekt WSL przez UNC: obserwacja katalogów może nie zgłaszać zmian, więc działa odpytywanie co 10 s.
- Bardzo częste zmiany (agent zapisuje rekord wiele razy na sekundę): najwyżej jeden odczyt na 2 s na projekt.
- Dwa czaty dopasowane do tego samego zadania pokazują ten sam postęp.
- Zmiana nazwy katalogu zadania przy tym samym `id`: to samo zadanie.
- Usunięcie projektu w trakcie odczytu: wynik odrzucony, proces zabity, brak zdarzenia dla usuniętego projektu.
- Snapshot z setkami zadań lub ścieżkami z Unicode i spacjami: obsługiwane do limitu 10 MB.

## Errors

Typowane kody w `TaskProgressSnapshot.error` i w wyniku `Test`: `adapter_missing`, `environment_unsupported`, `timeout`, `protocol`, `spawn` (nie udało się uruchomić `invocation.command`) oraz kody adaptera `config`, `runtime`, `unsupported_source`, `transient`, `internal`. Komunikat zawiera id adaptera i akcję; końcówka stderr trafia tylko do logu procesu głównego. Żaden błąd nie jest połykany: każdy kończy się stanem widocznym w zakładce, a przy istniejącym snapshocie także znacznikiem nieaktualności na wskaźnikach. Nie ma cichego powrotu do odczytu plików przez NeKode.

## Acceptance criteria

1. Bez powiązania żaden proces adaptera nie startuje, żaden katalog projektu nie jest obserwowany, a wskaźniki postępu są ukryte.
2. W kodzie `src/` nie ma parsera rekordów zadań; `TaskRecordService` i `ChatInfo.task` nie istnieją.
3. Zakładka `Task progress` pozwala wybrać adapter, wypełnić pola, wykonać `Test`, zapisać, wyczyścić (`None`), skopiować konfigurację z innego projektu. Nie ma w niej wyboru katalogu adapterów ani pól wybierających katalog.
4. Zmiana w obserwowanym katalogu aktualizuje wskaźniki bez ponownego wyboru projektu, w ciągu 3 s dla projektu lokalnego.
5. Przeniesienie rekordu do archiwum zachowuje tożsamość zadania i postęp czatu; zadanie `archived` z `state: "active"` nie jest pokazywane jako zakończone.
6. Te same `task.id` w dwóch projektach nie wpływają na siebie.
7. Zmiana adaptera, `None`, zwinięcie lub usunięcie projektu zatrzymuje obserwację i procesy; spóźniony wynik nie nadpisuje danych innego projektu ani nowego powiązania.
8. Każdy kod błędu z Errors ma widoczny stan w zakładce; przy istniejącym snapshocie wskaźniki są oznaczone jako nieaktualne.
9. Projekt WSL z adapterem bez `"wsl"` kończy się `environment_unsupported` bez uruchamiania procesu.
10. `adapters/task-progress-example/README.md` opisuje protokół i komendę instalacji; przykładowy adapter przechodzi `Test` i `snapshot` w aplikacji.

## Required tests

- Manifest: poprawny, zły `kind`, zła wersja, duplikat id, brak katalogu, nieznany typ pola (w tym `directory`), `environments`.
- Host: sukces, `ok:false` z każdym kodem, zły kod wyjścia, niepoprawny JSON, dwa obiekty JSON, przekroczenie 10 MB, timeout z zabiciem drzewa, błąd uruchomienia.
- Walidacja snapshotu: wymagane pola, typy, duplikat `id`, `currentStepId` bez kroku, `watch` poza projektem, nieznane pola ignorowane.
- Harmonogram: debounce serii zmian, single-flight z jednym odczytem następczym, minimalny odstęp, odpytywanie 60 s i 10 s, pauza okna, ponawianie `transient`, wstrzymanie po błędach konfiguracji, potwierdzenie zniknięcia zadania, odrzucenie spóźnionych wyników, sprzątanie przy zmianie powiązania, zwinięciu i usunięciu projektu.
- Dopasowanie czatu: `taskRef`, token w nazwie z prefiksem powłoki, granica `-` (`NEKODE-8` nie pasuje do `nekode-81-x`), wybór przy kilku dopasowaniach, brak dopasowania.
- Renderer: zakładka ustawień (wybór, `Test`, `Save`, `None`, kopiowanie, pusta lista adapterów, stan odczytu), wskaźniki z nowego modelu, znacznik nieaktualności, brak wskaźnika bez powiązania i przy `recordState` innym niż `valid`.
- Integracja: przykładowy adapter uruchamiany jako prawdziwy proces przez host. Gdy zmienna `NEKODE_TASK_PROGRESS_ADAPTER_DIR` wskazuje adapter Agent Harness, test integracyjny uruchamia go na rekordach z fixture (w tym rekord zarchiwizowany i zakończony); bez zmiennej test jest pomijany z jawnym komunikatem.
- Regresja: istniejące testy `TaskProgressButton` i `LeftNavigation` zachowują wygląd i etykiety dostępności.

## Relevant SDD / ADR

- [docs/architecture/project-environment-adapters.md](../../architecture/project-environment-adapters.md) (granica WSL).
- [docs/architecture/sdd.md](../../architecture/sdd.md).
- Wzorzec protokołu: [kanban-adapter-interface](../kanban-adapter-interface/spec.md) Behaviour 1-8.
