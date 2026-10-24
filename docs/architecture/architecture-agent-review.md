# Przegląd architektury NeKode pod kątem elegancji i pracy z agentami AI

**Data:** 2026-10-24  
**Zakres:** Cała aplikacja (`src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, testy, konfiguracja)  
**Cel:** Ocena elegancji architektonicznej oraz przystosowania bazy kodu do efektywnej pracy w parze z agentami AI (AI-agent friendliness), ze szczególnym uwzględnieniem modularności, redukcji okna kontekstowego, jednoźródłowych kontraktów typów, testowalności i minimalizacji promienia rażenia zmian (blast radius).

---

## 1. Wstęp i kryteria oceny agentowości (Agent-Friendliness)

Architektura zoptymalizowana pod kątem programowania z agentami AI musi spełniać kluczowe wymagania wynikające ze specyfiki modeli językowych (LLM):

1. **Niski narzut kontekstowy (Context Economy):**
   Agent pracuje w ograniczonym oknie kontekstowym (i zużywa quota tokenów). Pliki o objętości powyżej 500-1000 linii wymuszają ładowanie dziesiątek tysięcy tokenów przy prostej modyfikacji.
2. **Wysoka lokalność zachowań (Locality of Behavior & Low Blast Radius):**
   Dodanie nowej opcji lub zmiana zachowania nie powinna wymagać edycji 7-8 rozproszonych plików w różnych katalogach projektu.
3. **Pojedyncze źródło prawdy (Single Source of Truth):**
   Typy, walidacja i kontrakty powinny wynikać z jednej definicji, eliminując konieczność ręcznego synchronizowania interfejsów TypeScript z imperatywnymi walidatorami runtime.
4. **Izolowana testowalność (Isolated Unit Testability):**
   Agent musi być w stanie uruchomić mały, wybiórczy test jednostkowy zmienionego komponentu w ułamku sekundy, bez konieczności montowania całego drzewa aplikacji i mockowania 15 niezwiązanych serwisów.
5. **Przewidywalność i brak ukrytych sprzężeń (Explicit Coupling):**
   Jawne zależności (np. store'y domenowe, context providers, dependency injection) zamiast głębokiego "prop drillingu" (przekazywania dziesiątek callbacków przez 4 poziomy drzewa).

---

## 2. Podsumowanie wykonawcze (Executive Summary)

Projekt NeKode posiada **wyjątkowo dojrzałą i elegancką warstwę backendową (Main Process & Persistence)**, lecz cierpi na **poważny dług architektoniczny w warstwie UI (Renderer) oraz redundancję w warstwie IPC**:

| Warstwa | Ocena elegancji | Agent-Friendliness | Główne obserwacje |
|---|---|---|---|
| **Main Process & Services** | 8.5 / 10 | 8.5 / 10 | Czyste Dependency Injection (`createServices`), brak importów Electrona w serwisach, deterministyczne SQLite (WAL, migracje transakcyjne). Błyskawiczne testy jednostkowe w Node. |
| **Baza danych (SQLite)** | 9.0 / 10 | 9.0 / 10 | Wzorcowe podejście: czyste `better-sqlite3`, jawne zapytania SQL, transakcyjne wersjonowane migracje, brak nieprzewidywalnego ORM-a. |
| **Kontrakty i Walidacja IPC** | 5.5 / 10 | 5.0 / 10 | Ponad 1,100 linii ręcznej, imperatywnej walidacji (`ipc-validation.ts`) zduplikowanej względem `ipc-contract.ts`. Brak wykorzystania bibliotek schematów (Zod/Valibot). |
| **Renderer & State Management** | 3.5 / 10 | 3.0 / 10 | **Krytyczne wąskie gardło.** Gigantyczny "God Component" `App.tsx` (3,117 linii, 57 stanów, 78 callbacków). Nieużyty Zustand mimo obecności w `package.json`. Ekstremalny prop-drilling (po 25-28 propsów). |
| **Testy w warstwie UI** | 4.5 / 10 | 4.0 / 10 | `App.test.tsx` (4,371 linii, 196 KB). Niemal każdy test UI montuje całą aplikację `<App />`, mockując dziesiątki serwisów, co drastycznie wydłuża testy i utrudnia izolację błędów. |

**Metryki kodu:**
- Linie kodu produkcyjnego: **36,711**
- Linie kodu testowego: **43,988** (stosunek testów do kodu: **1.20**, 119 plików testowych)
- Pokrycie i dyscyplina testowa są imponujące, ale architektura testów UI jest skrajnie scentralizowana wokół jednego komponentu.

---

## 3. Szczegółowa analiza warstw

### 3.1. Renderer: Problem "God Component" i brak State Managementu

#### Diagnoza:
Plik [src/renderer/src/App.tsx](file:///F:/projects/NeKode/src/renderer/src/App.tsx) liczy **3,117 linii** i 122 KB.
Wewnątrz funkcji `App()` znajduje się:
- **57 wywołań `useState`**
- **17 wywołań `useEffect`**
- **78 wywołań `useCallback`**
- 2,632 linie logiki biznesowej, helperów i handlerów zdarzeń przed instrukcją `return (...)`!

`App.tsx` zarządza jednocześnie:
1. Projektami (lista, wybór, dodawanie, usuwanie, foldery WSL, dialogi natywne)
2. Czatami i terminalami (tworzenie, zamykanie, aktywny czat, przełączanie Ctrl+Tab, PTY listeners)
3. Zakładkami środkowymi (CenterTabs: terminal, kanban, pliki, markdown preview, podział sesji)
4. Panelem dolnym (BottomPanel: terminal pomocniczy, taby, retry, resize)
5. Drzewem plików (ProjectFiles: rozwijanie katalogów, kosz, preview)
6. Tablicą Kanban (otwieranie, filtry, held-launch, resume modal, start modal)
7. Handoffami i agentami (launch profile, szablony resume)
8. Ustawieniami aplikacji (motywy, czcionki terminala, alerty uwagi, dyktowanie, skróty)
9. Paskiem akcji (Actions: wykonywanie, edycja, stany)
10. Dyktowaniem desktopowym (OpenWhispr, audio buffers, statusy)
11. Paskiem stanu (Git branch, sync, dirty status, runtimes)

#### Nieużywany Zustand i ekstremalny Prop Drilling:
W [package.json](file:///F:/projects/NeKode/package.json#L48) zainstalowano `"zustand": "^5.0.3"`. Wyszukanie w kodzie wykazuje **0** wystąpień słowa `zustand` w całym katalogu `src/`.
Zamiast współdzielonych store'ów domenowych zastosowano głęboki prop drilling:
- [LeftNavigation.tsx](file:///F:/projects/NeKode/src/renderer/src/components/layout/LeftNavigation.tsx#L32-L95): przyjmuje **28 propsów** (w tym 14 callbacków).
- [AppSettings.tsx](file:///F:/projects/NeKode/src/renderer/src/components/settings/AppSettings.tsx#L15-L43): przyjmuje **25 propsów** (indywidualny getter i setter dla każdego ustawienia).
- [KanbanBoard.tsx](file:///F:/projects/NeKode/src/renderer/src/components/kanban/KanbanBoard.tsx): 1,992 linie – łączy widok listy, edytor zadań, widok szczegółów (review), komentarze, formularz dodawania i logikę filtrowania w jednym pliku.

#### Konsekwencje dla agentów AI:
- **Token exhaust:** Agent proszony o dodanie drobnego skrótu lub modyfikację aktywnej zakładki musi wczytać ponad 3,000 linii `App.tsx` (około 25,000 tokenów).
- **Kruchość edycji (Diff errors):** Modyfikacje w pliku o 3,000 linii prowadzą do częstych konfliktów znaczników, zgubionych klamer i błędów w dopasowaniu kontekstu (search-replace anchors).
- **Brak lokalności zmian:** Każda nowa funkcja w dowolnym podkomponencie wymaga dodania stanu w `App.tsx`, handlera w `App.tsx` i przekazania kolejnego propsa przez całe drzewo.

---

### 3.2. Izolacja i architektura testów UI

#### Diagnoza:
- [src/renderer/src/App.test.tsx](file:///F:/projects/NeKode/src/renderer/src/App.test.tsx) liczy **4,371 linii** (196 KB).
- Co bardziej zaskakujące: testy dedykowane konkretnym podsystemom, takie jak [CenterTabs.test.tsx](file:///F:/projects/NeKode/src/renderer/src/components/tabs/CenterTabs.test.tsx) czy [BottomPanel.test.tsx](file:///F:/projects/NeKode/src/renderer/src/BottomPanel.test.tsx), **nie testują wyizolowanych komponentów, lecz montują całe `<App />`**!
  (Komponent `CenterTabs.tsx` w ogóle nie istnieje jako samodzielny plik na dysku – jego kod w całości tkwi w `App.tsx`).
- Każdy taki test musi zaimportować `createAppApiStub()`, zresetować mocki xterm, mocki fit addons i zasymulować pełny cykl życia aplikacji.

#### Konsekwencje dla agentów AI:
- Zmiana w jednym podsystemie (np. pasek stanu lub motywy) potrafi zepsuć testy w `CenterTabs.test.tsx` lub `BottomPanel.test.tsx`.
- Czas wykonania pełnego zestawu testów rendererowych rośnie nieproporcjonalnie.
- Agent ma ogromne trudności z pisaniem testów TDD dla nowej funkcjonalności UI, ponieważ nie może stworzyć prostego testu renderującego 20-liniowy komponent z mockowanymi propsami.

---

### 3.3. Warstwa IPC: Kontrakty i imperatywna walidacja

#### Diagnoza:
1. **Monolityczny kontrakt [src/shared/ipc-contract.ts](file:///F:/projects/NeKode/src/shared/ipc-contract.ts) (1,184 linie):**
   - W jednym pliku zdefiniowano interfejsy i kanały dla: projektów, czatów, terminali, plików, akcji, profili agentów, handoffów, progressu zadań i kanbana.
   - Wyjątkiem jest `usage-contract.ts`, który został wyodrębniony do osobnego pliku – co było doskonałą decyzją i powinno posłużyć za wzorzec dla reszty domen.
2. **Imperatywny walidator [src/main/ipc/ipc-validation.ts](file:///F:/projects/NeKode/src/main/ipc/ipc-validation.ts) (1,111 linii):**
   - Ponad tysiąc linii ręcznie pisanego kodu sprawdzającego typy: `assertString`, `assertFiniteNumber`, `assertSafePath`, sprawdzanie `Object.keys(input).length`, sprawdzanie każdego pola w pętli.
   - Posiada bliźniaczy plik testowy `ipc-validation.test.ts` (1,000+ linii).
3. **Rozjazd w czasie kompilacji:**
   - Interfejs w TypeScript (`export interface ActionInput { ... }`) i walidator (`function assertActionInput(...)`) są od siebie całkowicie odseparowane.
   - Jeśli deweloper lub agent doda pole do interfejsu w `ipc-contract.ts`, kompilator TypeScript **nie zgłosi błędu**, że walidator w `ipc-validation.ts` odrzuca payload z nowym polem (ponieważ `ipc-validation.ts` rzutuje argumenty jako `unknown` i sprawdza długości kluczy).

#### Konsekwencje dla agentów AI:
- Dodanie lub zmiana jednego parametru w IPC wymaga jednoczesnej edycji aż 6 plików:
  1. `src/shared/ipc-contract.ts` (interfejs TS)
  2. `src/main/ipc/ipc-validation.ts` (ręczna walidacja pól i typów)
  3. `src/main/ipc/ipc-validation.test.ts` (testy walidacji)
  4. `src/main/ipc/ipc-handlers.ts` (routing kanału)
  5. `src/preload/app-api.ts` (opakowanie metody w preload)
  6. `src/preload/app-api.test.ts` (test preload)
- Jest to klasyczny przykład "Shotgun Surgery" (rozstrzelona chirurgia) – agent bardzo często pomija jeden z tych kroków, co prowadzi do subtelnych błędów wykonawczych w runtime.

---

### 3.4. Warstwa Main Process & Persistence (Mocne fundamenty)

#### Diagnoza:
Warstwa główna aplikacji prezentuje bardzo wysoki poziom inżynierski:
1. **Dependency Injection:**
   - [src/main/services/create-services.ts](file:///F:/projects/NeKode/src/main/services/create-services.ts) wstrzykuje instancję bazy danych, adaptery systemu plików i delegaty powłoki.
   - Żaden serwis w `src/main/services/` nie importuje modułu `electron`! Dzięki temu serwisy są w 100% testowalne w czystym środowisku Node bez emulacji Electrona.
2. **Baza danych SQLite:**
   - [src/main/db/connection.ts](file:///F:/projects/NeKode/src/main/db/connection.ts) i [migrations.ts](file:///F:/projects/NeKode/src/main/db/migrations.ts) korzystają z czystego `better-sqlite3`.
   - Pragma WAL, klucze obce włączone, timeout 5000ms.
   - Wersjonowane, transakcyjne migracje w kodzie bez ciężkich zewnętrznych narzędzi.
   - Proste, czytelne zapytania SQL w `prepare().all()` / `run()`, bez nieprzewidywalnych warstw abstrakcji ORM.
3. **Bezpieczeństwo procesu:**
   - Włączone `contextIsolation: true`, `sandbox: true`, wyłączone `nodeIntegration: false`.
   - Sender guard weryfikujący pochodzenie zdarzeń IPC z zaufanego renderer frame.

#### Obszary do optymalizacji w Main:
- `create-services.ts` (465 linii) staje się powoli monolityczną fabryką, która łączy w jednym miejscu rejestrację wszystkich serwisów.
- Część serwisów leży bezpośrednio w `src/main/services/` (`project-service.ts`, `chat-service.ts`, `action-service.ts`), podczas gdy inne (`kanban/`, `terminal/`, `usage/`, `dictation/`) mają własne podkatalogi. Ujednolicenie struktury do podkatalogów domenowych zwiększy czytelność.

---

### 3.5. Konfiguracja TypeScript i importy

#### Diagnoza:
- W `tsconfig.web.json` skonfigurowano alias:
  `"@renderer/*": ["src/renderer/src/*"]`
- W praktyce alias ten ma **0 wystąpień** w kodzie źródłowym.
- Powszechne są głębokie, kruche ścieżki względne, np.:
  `import type { AppApi } from '../../../../shared/ipc-contract'`
- Brakuje aliasów `@shared/*` oraz `@main/*`.

#### Konsekwencje dla agentów AI:
- Gdy agent przenosi plik lub tworzy podkomponent w nowym podkatalogu, niemal zawsze popełnia błąd w liczbie segmentów `../` (np. pisze `../../../` zamiast `../../../../`).
- Użycie aliasów modułów (np. `@shared/ipc-contract`, `@renderer/components/...`) całkowicie eliminuje ten problem.

---

## 4. Konkretne propozycje usprawnień (Actionable Roadmap)

Poniżej przedstawiono 5 konkretnych, ustrukturyzowanych propozycji refaktoryzacji, uszeregowanych według wpływu na produktywność i niezawodność pracy z agentami AI.

### Propozycja 1: Aktywacja Zustand i dekompozycja stanu z `App.tsx`
**Priorytet:** Krytyczny  
**Wpływ:** Zmniejszenie `App.tsx` z 3,117 linii do poniżej 300 linii. Drastyczny spadek zużycia tokenów i ryzyka kolizji.

Ponieważ `zustand` jest już w `package.json`, należy wydzielić stany do niezależnych store'ów domenowych:
1. `useProjectStore`:
   - Stan: `projects`, `selectedProjectId`, `expandedProjectIds`, `projectColors`.
   - Akcje: `selectProject`, `toggleProject`, `addProject`, `removeProject`.
2. `useChatStore`:
   - Stan: `chatsByProject`, `selectedChatId`, `sessionStatuses`, `sessionTasks`, `attention`.
   - Akcje: `selectChat`, `createChat`, `closeChat`.
3. `useTabsStore`:
   - Stan: `sessions` (aktywna zakładka, otwarte pliki, stan markdown).
   - Akcje: `openTab`, `closeTab`, `activateTab`.
4. `useSettingsStore`:
   - Stan: motyw, rozmiar czcionki terminala, flagi alertów uwagi, skróty klawiszowe.
   - Automatyczna synchronizacja z `app.state` lub `localStorage`.

**Przykład docelowego store'a dla projektów:**
```ts
// src/renderer/src/stores/useProjectStore.ts
import { create } from 'zustand'
import type { ProjectInfo } from '@shared/ipc-contract'

interface ProjectState {
  projects: ProjectInfo[]
  selectedProjectId: string | null
  expandedProjectIds: Set<string>
  setProjects: (projects: ProjectInfo[]) => void
  selectProject: (id: string | null) => void
  toggleProjectExpanded: (id: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  selectedProjectId: null,
  expandedProjectIds: new Set(),
  setProjects: (projects) => set({ projects }),
  selectProject: (selectedProjectId) => set({ selectedProjectId }),
  toggleProjectExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedProjectIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedProjectIds: next }
    }),
}))
```
*Efekt:* Komponent `LeftNavigation` nie musi przyjmować 28 propsów – pobiera projekty i akcje bezpośrednio ze store'a.

---

### Propozycja 2: Wydzielenie autonomicznych komponentów i dekompozycja testów UI
**Priorytet:** Wysoki  
**Wpływ:** Eliminacja giganta `App.test.tsx` (4,371 linii) na rzecz szybkich, wyizolowanych testów podkomponentów.

1. **Wydzielenie `CenterTabs.tsx`:**
   Obecnie plik `CenterTabs.test.tsx` testuje `App`. Należy stworzyć prawdziwy komponent `CenterTabs.tsx`, który przyjmuje wyłącznie identyfikator aktywnego projektu i renderuje odpowiednią zakładkę (Terminal, Kanban, FilePreview).
2. **Dekompozycja `KanbanBoard.tsx` (1,992 linie):**
   Rozbić na mniejsze moduły:
   - `KanbanListView.tsx` (sama lista kolumn/zadań)
   - `KanbanItemReview.tsx` (panel szczegółów zadania, status, priorytet, komentarze)
   - `KanbanCreateTaskForm.tsx` (formularz tworzenia)
   - `KanbanHeader.tsx` (pasek filtrów, wyszukiwania i odświeżania)
3. **Dekompozycja `AppSettings.tsx` (472 linie):**
   Każda zakładka (`GeneralSettingsTab`, `FontsSettingsTab`, `UsageSettingsTab`) staje się autonomicznym komponentem korzystającym z `useSettingsStore`.

---

### Propozycja 3: Schema-First IPC (Valibot lub Zod) zamiast ręcznego `ipc-validation.ts`
**Priorytet:** Wysoki  
**Wpływ:** Usunięcie ~1,000 linii powtarzalnego, podatnego na błędy kodu imperatywnego. 100% gwarancji synchronizacji typów i walidacji w czasie kompilacji.

Zamiast pisać osobną definicję typu TypeScript i osobny 50-liniowy walidator w `ipc-validation.ts`:
```ts
// Obecnie w ipc-validation.ts (40 linii kodu na jeden obiekt):
function assertActionInput(value: unknown, label: string): asserts value is ActionInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(...)
  // ...ręczne sprawdzanie Object.keys, typeof każdego pola, regexy...
}
```

Można zdefiniować schemat, z którego typ TypeScript wynika automatycznie:
```ts
// Propozycja: wykorzystanie np. Valibot (bardzo lekki, zero-dependency) lub Zod
import * as v from 'valibot'

export const ActionInputSchema = v.object({
  scope: v.picklist(['global', 'project']),
  projectId: v.nullable(v.string()),
  title: v.pipe(v.string(), v.minLength(1)),
  icon: v.nullable(v.string()),
  command: v.pipe(v.string(), v.minLength(1)),
  cwd: v.nullable(v.string()),
  runMode: v.picklist(['background', 'new-terminal', 'bottom-terminal']),
  confirm: v.boolean(),
  sortOrder: v.number(),
})

// Typ TypeScript wyprowadzony bezpośrednio ze schematu:
export type ActionInput = v.InferOutput<typeof ActionInputSchema>

// Walidacja IPC w jednym wierszu:
export function validateActionInput(payload: unknown): ActionInput {
  return v.parse(ActionInputSchema, payload)
}
```
*Efekt:* Agent modyfikujący strukturę danych edytuje **tylko jedno miejsce**. Typ TypeScript oraz walidator runtime zawsze pozostają w 100% zsynchronizowane.

---

### Propozycja 4: Domknięcie modułowości kontraktów IPC (`shared/contracts/`)
**Priorytet:** Średni  
**Wpływ:** Lepsza lokalność domenowa i przejrzystość.

Obecnie w `src/shared/` istnieje osobny plik `usage-contract.ts` (świetne rozwiązanie!), ale cała reszta domeny tkwi w jednym 1,184-liniowym `ipc-contract.ts`.
Zalecana struktura:
```text
src/shared/
├── contracts/
│   ├── actions-contract.ts
│   ├── chats-contract.ts
│   ├── dictation-contract.ts
│   ├── files-contract.ts
│   ├── git-contract.ts
│   ├── kanban-contract.ts
│   ├── projects-contract.ts
│   ├── task-progress-contract.ts
│   ├── terminals-contract.ts
│   └── usage-contract.ts
├── ipc-channels.ts        # Rejestr stałych nazw kanałów
├── ipc-error.ts           # Obsługa błędów AppError
└── index.ts               # Główny eksport zbierający AppApi
```
*Efekt:* Agent pracujący np. nad obsługą Git czy Kanban otwiera mały, 50-100 liniowy plik z kontraktem danej domeny zamiast przeszukiwać tysiącliniowy plik ogólny.

---

### Propozycja 5: Pełne wdrożenie Path Aliases (`@shared`, `@main`, `@renderer`)
**Priorytet:** Średni  
**Wpływ:** Eliminacja błędów importów przy przenoszeniu i refaktoryzacji kodu przez agentów.

W `tsconfig.json` i `electron.vite.config.ts` dodać:
```json
{
  "paths": {
    "@shared/*": ["src/shared/*"],
    "@main/*": ["src/main/*"],
    "@renderer/*": ["src/renderer/src/*"]
  }
}
```
Zastąpienie `../../../../shared/ipc-contract` przez `@shared/contracts/kanban-contract` sprawia, że pliki można dowolnie przenosić w hierarchii katalogów bez psucia importów.

---

## 5. Inne znaleziska i uwagi techniczne

1. **Status Bar Git Polling:**
   [StatusBar.tsx](file:///F:/projects/NeKode/src/renderer/src/components/layout/StatusBar.tsx#L26) wykonuje aktywne odpytywanie git co 10 sekund (`STATUS_BAR_GIT_REFRESH_INTERVAL_MS = 10_000`).
   *Spostrzeżenie:* W architekturze zorientowanej na zdarzenia, główny proces (korzystający z chokidar lub fs.watch na katalogu `.git/`) mógłby rozgłaszać zdarzenie zmiany, zamiast obciążać procesy powłoki ciągłym odpytywaniem. Jednak w obecnej formie fallback 10s działa stabilnie.
2. **Katalog test-ids (`test-ids.ts` - 386 linii):**
   Plik `test-ids.ts` jest bardzo pomocny do wyszukiwania semantycznego, ale rozrósł się do ogromnych rozmiarów. Dobrą praktyką byłoby trzymanie identyfikatorów testowych bliżej modułów domenowych (np. `kanban-test-ids.ts`, `terminal-test-ids.ts`).
3. **Czystość serwisów w `src/main/services/`:**
   Warto podkreślić to jako doskonały wzorzec: brak bezpośrednich zależności od Electrona w serwisach (`openExternal`, `showInFolder`, `trashItem`, `pickDirectory` są wstrzykiwane jako proste funkcje). Należy ten wzorzec bezwzględnie utrzymać przy przyszłych zmianach.
