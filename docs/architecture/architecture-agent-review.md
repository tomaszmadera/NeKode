# Przegląd architektury NeKode pod kątem elegancji i pracy z agentami AI

**Data przeglądu:** 2026-10-24
**Weryfikacja i aktualizacja:** 2026-10-25 (HEAD `27f2f95`)
**Zakres:** Cała aplikacja (`src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`, testy, konfiguracja)  
**Cel:** Ocena elegancji architektonicznej oraz przystosowania bazy kodu do efektywnej pracy w parze z agentami AI (AI-agent friendliness), ze szczególnym uwzględnieniem modularności, redukcji okna kontekstowego, jednoźródłowych kontraktów typów, testowalności i minimalizacji promienia rażenia zmian (blast radius).

> Status dokumentu: sekcje 1-5 są zapisem przeglądu z 2026-10-24. Korekty faktograficzne z 2026-10-25 są oznaczone w tekście jako `Korekta` lub `Aktualizacja`. Sekcja 6 weryfikuje każde ustalenie wobec kodu, sekcje 7-9 dodają niezależny przegląd z 2026-10-25.

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

**Metryki kodu (baza przeglądu, 2026-10-24, `b4764b6`):**
- Linie kodu produkcyjnego: **36,711**
- Linie kodu testowego: **43,988** (stosunek testów do kodu: **1.20**, 119 plików testowych)
- Pokrycie i dyscyplina testowa są imponujące, ale architektura testów UI jest skrajnie scentralizowana wokół jednego komponentu.

**Metryki kodu (2026-10-25, `27f2f95`):**
- Linie kodu produkcyjnego: **46,818** (+10,107, +27.5% w ciągu jednego dnia roboczego)
- Linie kodu testowego: **53,062** (+9,074, +20.6%), **137** plików testowych
- `App.tsx`: **3,197** linii, 59 `useState`, 16 `useEffect`, 77 `useCallback`, 519 linii JSX po instrukcji `return` w linii 2678
- Sześć z trzydziestu ostatnich commitów dotyka `App.tsx`, a każda taka zmiana wymaga też zmiany `App.test.tsx`

**Korekta:** zdanie "drastycznie wydłuża testy" nie potwierdziło się co do czasu wykonania. Pełny zestaw na 2026-10-25 to 135 plików i 2,567 testów w **22,6 s**. Koszt scentralizowanych testów UI jest kosztem utrzymania i przypisania odpowiedzialności (każda zmiana podsystemu przechodzi przez testy całej aplikacji), nie czasu CI.

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
- [KanbanBoard.tsx](file:///F:/projects/NeKode/src/renderer/src/components/kanban/KanbanBoard.tsx): 1,992 linie - łączy widok listy, edytor zadań, widok szczegółów (review), komentarze, formularz dodawania i logikę filtrowania w jednym pliku.

*Aktualizacja 2026-10-25:* `LeftNavigation` ma **31 propsów** (`LeftNavigation.tsx:32-99`), `AppSettings` **26** (`AppSettings.tsx:28-58`), `KanbanBoard.tsx` **2,038** linii. `AppSettings.tsx` zmalał z 472 do 339 linii po restylingu na wspólny shell ustawień (`545f86b`, `fbd3bc7`), więc dekompozycja prezentacji już się zaczęła, ale nie objęła stanu aplikacji.

#### Konsekwencje dla agentów AI:
- **Token exhaust:** Agent proszony o dodanie drobnego skrótu lub modyfikację aktywnej zakładki musi wczytać ponad 3,000 linii `App.tsx` (około 25,000 tokenów).
- **Kruchość edycji (Diff errors):** Modyfikacje w pliku o 3,000 linii prowadzą do częstych konfliktów znaczników, zgubionych klamer i błędów w dopasowaniu kontekstu (search-replace anchors).
- **Brak lokalności zmian:** Każda nowa funkcja w dowolnym podkomponencie wymaga dodania stanu w `App.tsx`, handlera w `App.tsx` i przekazania kolejnego propsa przez całe drzewo.

---

### 3.2. Izolacja i architektura testów UI

#### Diagnoza:
- [src/renderer/src/App.test.tsx](file:///F:/projects/NeKode/src/renderer/src/App.test.tsx) liczy **4,371 linii** (196 KB).
- Co bardziej zaskakujące: testy dedykowane konkretnym podsystemom, takie jak [CenterTabs.test.tsx](file:///F:/projects/NeKode/src/renderer/src/components/tabs/CenterTabs.test.tsx) czy [BottomPanel.test.tsx](file:///F:/projects/NeKode/src/renderer/src/BottomPanel.test.tsx), **nie testują wyizolowanych komponentów, lecz montują całe `<App />`**!
  (Komponent `CenterTabs.tsx` w ogóle nie istnieje jako samodzielny plik na dysku - jego kod w całości tkwi w `App.tsx`).
- Każdy taki test musi zaimportować `createAppApiStub()`, zresetować mocki xterm, mocki fit addons i zasymulować pełny cykl życia aplikacji.

*Aktualizacja 2026-10-25:* dziewięć plików testowych w `src/renderer/src` montuje `<App />` (195 wywołań `render(<App` łącznie), w tym `ProjectFiles.test.tsx`, `KanbanTabs.test.tsx`, `AppUpdateBlock.test.tsx`, `useResizableRegion.test.tsx`, `kanban-start-draft.test.tsx` i `pending-bottom-command.lifecycle.test.tsx`. `App.test.tsx` ma 4,387 linii i 144 przypadki `it`.

#### Konsekwencje dla agentów AI:
- Zmiana w jednym podsystemie (np. pasek stanu lub motywy) potrafi zepsuć testy w `CenterTabs.test.tsx` lub `BottomPanel.test.tsx`.
- Czas wykonania pełnego zestawu testów rendererowych rośnie nieproporcjonalnie.
- Agent ma ogromne trudności z pisaniem testów TDD dla nowej funkcjonalności UI, ponieważ nie może stworzyć prostego testu renderującego 20-liniowy komponent z mockowanymi propsami.

*Korekta 2026-10-25:* drugi punkt jest nieaktualny co do czasu. Pełny zestaw trwa 22,6 s. Utrzymuje się koszt utrzymania: test podsystemu nie może failować w izolacji, a asercje często dotyczą stanu globalnych mocków, nie zachowania komponentu.

---

### 3.3. Warstwa IPC: Kontrakty i imperatywna walidacja

#### Diagnoza:
1. **Monolityczny kontrakt [src/shared/ipc-contract.ts](file:///F:/projects/NeKode/src/shared/ipc-contract.ts) (1,184 linie):**
   - W jednym pliku zdefiniowano interfejsy i kanały dla: projektów, czatów, terminali, plików, akcji, profili agentów, handoffów, progressu zadań i kanbana.
   - Wyjątkiem jest `usage-contract.ts`, który został wyodrębniony do osobnego pliku - co było doskonałą decyzją i powinno posłużyć za wzorzec dla reszty domen.
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
- Jest to klasyczny przykład "Shotgun Surgery" (rozstrzelona chirurgia) - agent bardzo często pomija jeden z tych kroków, co prowadzi do subtelnych błędów wykonawczych w runtime.

*Aktualizacja i korekta 2026-10-25:* liczba plików jest większa, a jeden punkt listy jest błędny.
- `ipc-handlers.ts` nie wymaga edycji dla zwykłego kanału: routing powstaje w pętli po `buildValidatedChannels` (`ipc-handlers.ts:195-207`). Ręczne wpisy dotyczą tylko czterech kanałów specjalnych (`projects:add`, `projects:remove`, `chats:remove`, `dictation:desktopActivate`).
- Lista pomija `src/main/ipc/service-registry.ts` (powierzchnia `AppServices`), `src/main/services/create-services.ts` (wiring) oraz `src/renderer/src/test/app-api-stub.ts` (stub używany przez testy renderera).
- Realny przykład: `06efc3d` (trzy nowe kanały `appUpdate:*`) dotknął **dziewięciu** plików warstwy IPC: `ipc-contract.ts`, `ipc-validation.ts`, `ipc-validation.test.ts`, `ipc-handlers.test.ts`, `service-registry.ts`, `create-services.ts`, `preload/app-api.ts`, `preload/app-api.test.ts`, `renderer/src/test/app-api-stub.ts`, plus nowy serwis i komponent.
- Mechanizm rozjazdu typ/walidator potwierdzony: `assertActionInput` porównuje `Object.keys(input).length` z zamkniętą listą kluczy (`ipc-validation.ts:124-145`), więc nowe pole w interfejsie przechodzi `tsc` i jest odrzucane w runtime.
- Stan na 2026-10-25: `ipc-contract.ts` 1,347 linii i 108 kanałów; `ipc-validation.ts` 1,440 linii i 19 funkcji `assert*`. Audyt pokrycia: każdy kanał invoke ma wpis walidacyjny, cztery kanały push (main do renderer) nie potrzebują go.

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

*Aktualizacja 2026-10-25:* `create-services.ts` ma **530** linii. Wzorzec "brak Electrona w serwisach" nadal obowiązuje (0 trafień `from 'electron'` w `src/main/services`). Nowe znaleziska z tego obszaru: 7.2 i 7.3.

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

*Aktualizacja 2026-10-25:* alias `@renderer` ma 0 wystąpień (potwierdzone `grep -rn "@renderer/" src`). `tsconfig.node.json` nie ma sekcji `paths`. `vitest.config.ts` nie ma `resolve.alias`.

---

## 4. Konkretne propozycje usprawnień (Actionable Roadmap)

Poniżej przedstawiono 5 konkretnych, ustrukturyzowanych propozycji refaktoryzacji, uszeregowanych według wpływu na produktywność i niezawodność pracy z agentami AI. Zaktualizowaną kolejność wykonania zawiera sekcja 8.

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
*Efekt:* Komponent `LeftNavigation` nie musi przyjmować 28 propsów - pobiera projekty i akcje bezpośrednio ze store'a.

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

*Aktualizacja 2026-10-25:* punkt 3 jest częściowo wykonany: ustawienia mają wspólny `SettingsShell` i osobne panele (`FontsSettings`, `DictationSettings`, `GlobalAgentProfilesSettings`, `AppUpdateBlock`), a `AppSettings.tsx` ma 339 linii. Pozostaje 26 propsów i brak `useSettingsStore`.

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

*Aktualizacja 2026-10-25:* walidacja nie jest wyłącznie sprawdzaniem kształtu. `ipc-validation.ts` zawiera reguły bezpieczeństwa, które muszą przetrwać migrację: `assertSafePath`, `assertRelativePath`, ochrona kluczy stanu (`isSecretStateKey`, `isTaskProgressStateKey`) i ścisła arytmetyka argumentów (`requireArgs`). Schemat Zod/Valibot musi je odtwarzać jako `refine`/`superRefine` na poziomie kanału, inaczej migracja osłabi granicę zaufania.

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

*Aktualizacja 2026-10-25:* stan wyjściowy jest lepszy niż w opisie. Obok `usage-contract.ts` istnieją już `dictation-contract.ts` i `desktop-dictation-contract.ts`, więc wzorzec jest stosowany. Pozostałe domeny (projekty, czaty, terminale, pliki, akcje, agenci, handoffy, task progress, kanban) nadal są w `ipc-contract.ts`, który ma 1,347 linii i 108 kanałów.

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

*Korekta 2026-10-25:* wskazane pliki są błędne. `tsconfig.json` to solution file z `files: []` i dwiema referencjami, bez `compilerOptions.paths`. Alias trzeba dodać w czterech miejscach: `tsconfig.web.json` (renderer i shared), `tsconfig.node.json` (main, preload i shared; obecnie brak sekcji `paths`), `electron.vite.config.ts` (`resolve.alias` dla builda) oraz `vitest.config.ts` (bez tego testy nie rozwiążą nowych importów, bo Vite nie czyta `paths` z tsconfig). Zaniedbanie czwartego miejsca daje zielony `typecheck` i czerwone testy.

---

## 5. Inne znaleziska i uwagi techniczne

1. **Status Bar Git Polling:**
   [StatusBar.tsx](file:///F:/projects/NeKode/src/renderer/src/components/layout/StatusBar.tsx#L26) wykonuje aktywne odpytywanie git co 10 sekund (`STATUS_BAR_GIT_REFRESH_INTERVAL_MS = 10_000`).
   *Spostrzeżenie:* W architekturze zorientowanej na zdarzenia, główny proces (korzystający z chokidar lub fs.watch na katalogu `.git/`) mógłby rozgłaszać zdarzenie zmiany, zamiast obciążać procesy powłoki ciągłym odpytywaniem. Jednak w obecnej formie fallback 10s działa stabilnie.
2. **Katalog test-ids (`test-ids.ts` - 386 linii):**
   Plik `test-ids.ts` jest bardzo pomocny do wyszukiwania semantycznego, ale rozrósł się do ogromnych rozmiarów. Dobrą praktyką byłoby trzymanie identyfikatorów testowych bliżej modułów domenowych (np. `kanban-test-ids.ts`, `terminal-test-ids.ts`).
3. **Czystość serwisów w `src/main/services/`:**
   Warto podkreślić to jako doskonały wzorzec: brak bezpośrednich zależności od Electrona w serwisach (`openExternal`, `showInFolder`, `trashItem`, `pickDirectory` są wstrzykiwane jako proste funkcje). Należy ten wzorzec bezwzględnie utrzymać przy przyszłych zmianach.

*Aktualizacja 2026-10-25:*
- Punkt 1: potwierdzony (`StatusBar.tsx:26`, interwał w `:162-166`). `chokidar` jest zadeklarowany w `dependencies` i nieużywany, więc wariant zdarzeniowy wymaga najpierw podłączenia watchera albo usunięcia zależności.
- Punkt 2: ścieżka w przeglądzie była błędna. Plik to `src/renderer/src/lib/test-ids.ts` i ma **412** linii; `src/shared/test-ids.ts` nie istnieje.

---

## 6. Weryfikacja ustaleń przeglądu z 2026-10-24

Metoda: każde ustalenie sprawdzone bezpośrednio w kodzie na `27f2f95`; metryki odtworzone na commitcie bazowym przeglądu (`b4764b6`) przez `git archive` i `wc -l`, żeby oddzielić błąd przeglądu od późniejszego dryfu.

| # | Ustalenie | Werdykt | Dowód |
|---|---|---|---|
| 1 | `App.tsx` to God Component: 3,117 linii, 57 `useState`, 17 `useEffect`, 78 `useCallback`, logika przed `return` | Zasadne, liczby nieaktualne | Na `b4764b6` dokładnie 3,117/57/17/78. Na `27f2f95`: 3,197 linii, 59 `useState`, 16 `useEffect`, 77 `useCallback`, `return` w linii 2678, 65 funkcji `handle*` |
| 2 | `zustand` w `package.json`, 0 użyć w `src/` | Zasadne | `package.json:48`; `grep -rn zustand src` = 0. Nieużywane też `chokidar`, `clsx`, `tailwind-merge` |
| 3 | `LeftNavigation` przyjmuje 28 propsów | Zasadne, liczba rośnie | `LeftNavigation.tsx:32-99`, dziś 31 propsów |
| 4 | `AppSettings` przyjmuje 25 propsów | Zasadne, dziś 26 | `AppSettings.tsx:28-58`; plik zmalał 472 do 339 linii po restylingu (`545f86b`, `fbd3bc7`) |
| 5 | `KanbanBoard.tsx` 1,992 linie, miesza listę, edytor, review, komentarze, formularz i filtry | Zasadne | Dziś 2,038 linii; test `KanbanBoard.test.tsx` 2,859 linii |
| 6 | `App.test.tsx` 4,371 linii / 196 KB | Zasadne | Dziś 4,387 linii, 144 `it` |
| 7 | `CenterTabs.test.tsx` i `BottomPanel.test.tsx` montują `<App />`; `CenterTabs.tsx` nie istnieje | Zasadne | `components/tabs/` zawiera tylko `TabStrip.tsx`, `tabs-session.ts` i testy; 9 plików testowych i 195 wywołań `render(<App` |
| 8 | `ipc-contract.ts` to monolit 1,184 linii | Zasadne | Dziś 1,347 linii, 108 kanałów w `IPC_CHANNEL` |
| 9 | `ipc-validation.ts` 1,111 linii ręcznej walidacji z bliźniaczym testem 1,000+ linii | Zasadne | Dziś 1,440 linii, 19 funkcji `assert*`; test 1,164 linie |
| 10 | Brak wykrywania rozjazdu typ/walidator w kompilacji | Zasadne | `assertActionInput` (`ipc-validation.ts:124-145`) porównuje `Object.keys(input).length` z zamkniętą listą, przy argumencie `unknown` i `asserts value is ActionInput` |
| 11 | Jedna zmiana parametru IPC wymaga edycji 6 plików, w tym `ipc-handlers.ts` | Częściowo błędne | Routing zwykłych kanałów jest generowany (`ipc-handlers.ts:195-207`); brakuje `service-registry.ts`, `create-services.ts`, `app-api-stub.ts`. `06efc3d` dotknął 9 plików warstwy IPC |
| 12 | Serwisy main nie importują `electron` | Zasadne | `grep -rn "from 'electron'" src/main/services` = 0 |
| 13 | SQLite: WAL, klucze obce, transakcyjne migracje, jawne SQL | Zasadne | `migrations.ts:236-243` (transakcja per migracja); luka w `runMigrations` opisana w 7.2 |
| 14 | `contextIsolation`, `sandbox`, `nodeIntegration: false`, sender guard | Zasadne | `index.ts:65-67`; `isTrustedSender` w `ipc-handlers.ts:59-71` |
| 15 | Alias `@renderer` skonfigurowany i nieużywany; brak `@shared`/`@main` | Zasadne | `tsconfig.web.json` (paths), `electron.vite.config.ts` (alias), 0 wystąpień `@renderer/` w `src` |
| 16 | Aliasy dodać w `tsconfig.json` i `electron.vite.config.ts` | Błędne | `tsconfig.json` to solution file; potrzebne `tsconfig.web.json`, `tsconfig.node.json`, `electron.vite.config.ts` i `vitest.config.ts` (sekcja 4, propozycja 5) |
| 17 | `test-ids.ts` ma 386 linii w `src/shared` | Błędna ścieżka | `src/renderer/src/lib/test-ids.ts`, 412 linii |
| 18 | Pasek stanu odpytuje git co 10 s | Zasadne | `StatusBar.tsx:26`, interwał `:162-166` |
| 19 | Metryki 36,711 / 43,988 / 119 | Zasadne dla bazy | Odtworzone dokładnie na `b4764b6`. Dziś 46,818 / 53,062 / 137 |
| 20 | Scentralizowane testy UI drastycznie wydłużają testy | Niepotwierdzone co do czasu | Pełny zestaw: 135 plików, 2,567 testów, 22,6 s. Koszt jest w utrzymaniu i przypisaniu, nie w czasie |

**Wniosek:** przegląd z 2026-10-24 jest merytorycznie trafny. Diagnoza warstwy renderera, kontraktów IPC i architektury testów potwierdza się w kodzie. Trzy ustalenia wymagają korekty (lista plików IPC, pliki konfiguracji aliasów, ścieżka `test-ids`), jedno jest niedoszacowane (liczba plików do zmiany przy nowym parametrze IPC jest większa), jedno jest nadinterpretacją (czas testów). Wszystkie metryki były dokładne na commitcie bazowym i wymagają odświeżenia, bo baza urosła o 27.5% w ciągu doby.

---

## 7. Nowe znaleziska (przegląd 2026-10-25)

Każde znalezisko ma etykietę ważności, lokalizację `ścieżka:linia`, problem i konkretną poprawkę. Wszystkie pozycje `critical` i `warning` zostały sprawdzone osobiście w kodzie po zgłoszeniu przez sesje obszarowe.

### 7.1. Dystrybucja i pakowanie

**critical** `electron-builder.yml:1`
Brak listy `files`, więc electron-builder pakuje całe drzewo robocze (`**/*`), a lokalnie zbudowany instalator zawiera harness agenta i źródła.
**Fix:** dodać `files: [out/**/*, package.json]` i przebudować; `node_modules` produkcyjne electron-builder doda sam.
**Dowód:** istniejący `dist/win-unpacked/resources/app.asar` (468 MB, 16,680 plików) zawiera `.agents` (1,617 pozycji, w tym `.agents/.env`), `.claude` (32), `.codex`, `.grok`, `.opencode`, `src` (317), `docs` (122), `tmp`, `pnpm-lock.yaml` i `*.tsbuildinfo`. Zawartość `.agents/.env` nie była czytana; to plik środowiskowy harnessu (klucze API). Wydania z `.github/workflows/release.yml` powstają na czystym checkoutcie CI (`runs-on: ${{ matrix.os }}`), gdzie tych ścieżek nie ma, więc wyciek dotyczy instalatorów budowanych lokalnie. Ten sam brak listy odpowiada za rozmiar: w `app.asar` leżą `node_modules/monaco-editor` (1,309 plików), `mermaid` (563) i `@xterm` (109), mimo że renderer jest bundlowany przez Vite.

**warning** `package.json:31`
Biblioteki wyłącznie rendererowe są w `dependencies`, więc trafiają do bundla i dodatkowo do `node_modules` w instalatorze.
**Fix:** przenieść `react`, `react-dom`, `mermaid`, `monaco-editor`, `@monaco-editor/react`, `@panzoom/panzoom`, `@xterm/*`, `lucide-react`, `react-markdown` i `remark-gfm` do `devDependencies`; w `dependencies` zostawić tylko externale main/preload (`better-sqlite3`, `node-pty`).
**Dowód:** `electron.vite.config.ts` nie ustawia `external` dla renderera; żaden plik `src/main` ani `src/preload` nie importuje tych pakietów.

### 7.2. Granice zaufania i cykl życia procesów (main)

**warning** `src/main/ipc/ipc-handlers.ts:110-113`, `:134-137`, `:172-175`
Trzy z czterech kanałów specjalnych pobierają wpis walidacyjny opcjonalnie i przy jego braku przekazują surowy payload dalej, więc kanał wypadnięty z `buildValidatedChannels` traci walidację po cichu.
**Fix:** wymagać wpisu i rzucić `AppError('validation', ...)` przy braku, jak robi to `dictation:desktopActivate` (`:183-186`); dodać test startowy porównujący zbiór kanałów `IPC_CHANNEL` z kluczami `buildValidatedChannels`.
**Dowód:** `entry !== undefined ? entry.parse(payload) : payload` w `projects:remove` i `chats:remove`; `if (entry)` w `projects:add`.

**warning** `src/main/index.ts:262-265`
Listener `before-quit` zamykający usage i task-progress nie ma `try/catch` i jest rejestrowany przed listenerem `registerShutdown`, więc wyjątek w nim przerywa emisję zdarzenia i teardown PTY nie startuje.
**Fix:** obsłużyć błąd w listenerze albo przenieść oba zamknięcia do hooków `registerShutdown`, które mają izolację.

**warning** `src/main/shutdown.ts:24`
Po nieudanym teardownie (`teardownFailed`) kolejne `before-quit` wraca przed `preventDefault()`, mimo że `shutdownTerminals` nadal trwa, więc Electron może wyjść z żywymi PTY.
**Fix:** trzymać `preventDefault()` dopóki `started && !complete`, a force-quit dopuścić tylko po rozstrzygnięciu obietnicy.

**warning** `src/main/user-data-override.ts:34-38` (wywołanie w `src/main/index.ts:25-28`)
`app.setPath` rzuca wyjątkiem, gdy katalog nie istnieje, a wywołanie stoi na poziomie modułu przed `app.whenReady()`, więc świeży `NEKODE_USER_DATA` kończy proces surowym błędem Electrona.
**Fix:** `mkdirSync(resolved, { recursive: true })` przed `setPath` i test na brak katalogu.
**Dowód:** dokumentacja w `node_modules/electron/electron.d.ts:1800-1802`; `user-data-override.test.ts` modeluje tylko przypadek ścieżki względnej.

**warning** `src/main/db/migrations.ts:216-231`
`runMigrations` akceptuje dowolny podzbiór znanych wersji, więc baza z `{1,2,4}` przejdzie kontrolę i wersja 3 zostanie zastosowana po 4.
**Fix:** odrzucać zbiór, który nie jest prefiksem listy migracji.

**warning** `src/main/db/migrations.ts:23` z `src/main/services/project-service.ts:68-76`
`projects.path` ma `UNIQUE` w kolacji BINARY, a `ProjectService.add` zapisuje ścieżkę z dialogu bez normalizacji, więc `D:\demo`, `d:/demo` i `D:/demo/` mogą zarejestrować ten sam katalog trzy razy.
**Fix:** normalizować ścieżkę (wielkość liter i końcowy separator na win32) przed insertem, z unikalnym indeksem na znormalizowanej wartości.

**warning** `src/main/index.ts` (brak `requestSingleInstanceLock`)
Dwie instancje dzielą `nekode.db` i userData, a obie uruchamiają migracje, co daje wyścig o `schema_migrations` i podwójne okna.
**Fix:** `app.requestSingleInstanceLock()`, wyjście przy `false`, fokus istniejącego okna w `second-instance`.
**Dowód:** `grep -rn requestSingleInstanceLock src` = 0; `create-services.ts:102-103` otwiera tę samą bazę.

### 7.3. Timeouty i wycieki w serwisach

**warning** `src/main/services/dictation/adapters/elevenlabs-adapter.ts`, `openrouter-adapter.ts`, `local-openai-adapter.ts`, `post-processing/post-processor.ts`
Tylko adapter OpenWhispr Cloud ogranicza żądanie własnym timeoutem; pozostałe polegają na sygnale wywołującego, więc zawieszone żądanie nigdy się nie kończy, a `DictationService.active` pozostaje zajęte.
**Fix:** `AbortSignal.any([request.signal, AbortSignal.timeout(ms)])` w każdym adapterze i w post-processorze, wzorem `openwhispr-cloud-adapter.ts:119`.
**Dowód:** `grep setTimeout|AbortSignal.timeout` w tych plikach zwraca wyłącznie trafienia w `openwhispr-cloud-adapter.ts`.

**warning** `src/main/services/dictation/dictation-service.ts:224`, `:265`, `:289`, `:315`
Cztery niestrzeżone `JSON.parse` na zapisanej konfiguracji providera: uszkodzony wiersz wywala `providersList` dla wszystkich providerów.
**Fix:** jeden pomocnik parsujący z fallbackiem `{}` lub `AppError('validation', ...)`, jak w `create-services.ts:135-143`.

**warning** `src/main/services/app-update/app-update-service.ts:85`, `:96-146`
`latest()` przekazuje sygnał z `AbortController`, którego nikt nie przerywa, a `download()` czyści `busy` tylko w `finally`, więc zawieszone połączenie trwale blokuje kolejne pobrania komunikatem "An update is already in progress."
**Fix:** limit czasu na każde żądanie i reset `busy` na ścieżce timeoutu.

**warning** `src/main/services/task-progress/adapter-host.ts:167-190`
Po timeoucie `killTree` nadal czeka na `close` bez własnego rozstrzygnięcia, więc proces ignorujący kill zostawia obietnicę zawieszoną, a `runtime.controller` zablokowany.
**Fix:** wyścig `close` z drugim timerem rozstrzygającym po killu.

**warning** `src/main/services/terminal/wsl.ts:10` (użycie w `shell-service.ts:134`, `:245`, `:258`)
Sondowanie WSL używa `execFileSync` z timeoutem 5 s na ścieżkach IPC, więc wybór katalogu i start PTY z własną powłoką linuksową blokują cały main process.
**Fix:** asynchroniczny `execFile` dla ścieżek wywoływanych z IPC; forma synchroniczna tylko przy starcie.

**warning** `src/main/services/git/git-service.ts:333-351`
`sync` nie ma blokady in-flight i uruchamia `git pull` bez `--no-edit`, więc równoległe wywołania walczą o `index.lock`, a pull wymagający merge commita kończy się timeoutem 15 s bez TTY.
**Fix:** zbiór trwających synców per projekt z `AppError('conflict', ...)` i `git pull --no-edit`.

**warning** `src/main/services/dictation/adapters/openwhispr-adapter.ts:113-114`
Nagranie trafia do `os.tmpdir()` jako `nekode-openwhispr-<uuid>.wav`, poza katalogiem, który `DictationService` zamiata (wzorzec `generatedWav` w `dictation-service.ts:60`), więc crash między zapisem a `unlinkSync` zostawia audio użytkownika bez sprzątacza.
**Fix:** przekazać katalog sesji do adaptera albo użyć wzorca nazwy objętego sprzątaniem.

### 7.4. Renderer: interakcje i afordancje

**warning** `src/renderer/src/components/kanban/KanbanBoard.tsx:883` z `src/main/services/kanban/local-task-file.ts:283-292`
Wartością opcji statusu jest `state.name`, a main rozwiązuje najpierw `id`, potem nazwę, więc stan, którego nazwa równa się identyfikatorowi innego stanu, przenosi zadanie do złego stanu; dwie identyczne nazwy dają nieosiągalną opcję.
**Fix:** używać `state.id` jako wartości dla znanych stanów, nazwę zostawić jako etykietę.

**warning** `src/renderer/src/components/kanban/KanbanBoard.tsx:1435`
Przy przedawnionym żądaniu `load()` wraca przed usunięciem wpisów z `retainedCreates`/`retainedUpdates`, więc mapy trzymają nieosiągalne wpisy do zmiany projektu lub odmontowania.
**Fix:** czyścić wpisy `requestId` także na ścieżce przedawnienia.

**warning** `src/renderer/src/App.tsx:1377-1393`
`handleToggleProject` liczy `isExpanded` z domknięcia renderu i decyduje na tej wartości wewnątrz updatera, więc dwa przełączenia w jednym ticku dają ten sam wynik.
**Fix:** liczyć stan następny i "czy rozwinięto" wewnątrz `setExpandedProjectIds((previous) => ...)`, wzorem `:1087`, `:1522`, `:1990`.

**warning** `src/renderer/src/hooks/useResizableRegion.ts:70`
Wysokość panelu dolnego liczona jest jako `window.innerHeight - clientY`, a pod panelem stoi pasek stanu (`StatusBar.tsx:181`, `h-7` = 28 px), więc krawędź panelu przez cały drag jest 28 px od kursora, a pierwszy ruch skacze o tę wartość.
**Fix:** liczyć rozmiar od punktu startu drag: `startSize + (startClientY - event.clientY)`; to samo naprawia 8 px offset motywu float.

**warning** `src/renderer/src/components/actions/ActionBar.tsx:181-214`
Efekt pollingu statusów ma `states` w zależnościach, a każdy tick ustawia nowy obiekt, więc interwał jest niszczony i tworzony co tick; kadencja staje się czasem odpowiedzi plus 250 ms.
**Fix:** zależność od stabilnego klucza uruchomionych akcji albo odczyt z `ref`.

**warning** `src/renderer/src/components/actions/ActionBar.tsx:281` i `:327`
Dla własnej ikony (emoji spoza palety) `actionIconGlyph` zwraca `null`, więc `StateIcon` bierze glif statusu, a span w `:327` renderuje emoji: przycisk dostaje dwa znaki.
**Fix:** rozwiązać glif raz i wybrać wyłącznie jeden wariant.

**warning** `src/renderer/src/components/settings/ShellTab.tsx:143-147`
`handleColorSelect` łapie każdy błąd zapisu pustym `catch { // ignore }`, więc kolor, który nie zapisał się, wraca bez komunikatu, podczas gdy reszta panelu raportuje błędy inline.
**Fix:** ustawić `saveError` z `parseAppErrorPayload(cause)?.message`.

**warning** `src/renderer/src/components/tabs/TabStrip.tsx:348`, `:362`
Kopiowanie z menu zakładki robi `navigator.clipboard.writeText(...).catch(() => {})`, więc odmowa dostępu jest cicha, a brak `navigator.clipboard` rzuca synchronicznie z handlera (ścieżka plików w `App.tsx:1871-1889` raportuje to jako notice).
**Fix:** sprawdzić dostępność API i pokazać notice.

**warning** `src/renderer/src/components/settings/DictationDictionary.tsx:246-253`
Nieudane `dictionaryDelete` ustawia `loadFailed`, co zamienia całą listę komunikatem o błędzie wczytywania.
**Fix:** osobny `actionError` nad listą, `loadFailed` tylko dla `dictionaryList`.

**warning** `src/renderer/src/components/actions/ActionSettings.tsx:532`, `src/renderer/src/components/settings/GlobalAgentProfilesSettings.tsx:340`
Usunięcie akcji paska i globalnego profilu agenta wykonuje IPC bez potwierdzenia, podczas gdy usunięcie projektu, zamknięcie czatu i usunięcie źródła usage przechodzą przez `ConfirmDialog`.
**Fix:** skierować oba usunięcia przez `ConfirmDialog` z nazwą elementu.

**warning** `src/renderer/src/components/layout/ConfirmDialog.tsx:72`
Dialog deklaruje `aria-modal="true"` i ustawia fokus na Confirm, ale nie utrzymuje go w dialogu: Tab wychodzi do aplikacji pod overlayem.
**Fix:** użyć pętli Tab z `SettingsShell.tsx:84-100`; ten sam trap dać `HandoffPicker`.

**warning** `src/renderer/src/components/terminal/TerminalContextMenu.tsx:44-63`
Listener `keydown` w fazie capture blokuje każdy klawisz poza menu, a fokus nigdy nie wchodzi do menu, więc po otwarciu żaden klawisz poza Escape nie dociera do pozycji.
**Fix:** fokus na pierwszej pozycji przy montażu i cykl Tab wewnątrz menu; przechwytywać klawisze tylko gdy menu ma fokus.

**warning** `src/shared/ipc-error.ts:10-17` z `src/renderer/src/components/kanban/KanbanBoard.tsx:1461`
`AppErrorCode` ma dwie pisownie tej samej klasy błędu (`validation_error` i `validation`, `not_found` i `notFound`), a producenci używają obu: serwisy kanbana rzucają `validation_error`, renderer mapuje tylko `validation`, więc błąd konfiguracji trafia do gałęzi ogólnej.
**Fix:** jeden kod na klasę błędu, aliasy mapowane w `parseAppErrorPayload`.

### 7.5. Testy i konfiguracja

**warning** `src/renderer/src/App.test.tsx:644-653`
`aliveFontSizeOptions()` asertuje globalny stan mocków, a zestaw "app settings and themes" nie resetuje terminali w `beforeEach`, co komentarz w kodzie przyznaje wprost; wynik zależy od kolejności plików.
**Fix:** `resetMockTerminals()` i `resetMockFitAddons()` w `beforeEach` tego zestawu.

**warning** `src/main/ipc/ipc-handlers.test.ts:129-146`
Test sender guardu konstruuje `senderFrame === sender.mainFrame` przez podstawienie tego samego obiektu, więc nie może wykryć sytuacji, w której prawdziwe obiekty `WebFrameMain` nigdy nie są równe (wtedy każde IPC zostałoby odrzucone).
**Fix:** pokryć tożsamość ramki raz w harnessie CDP: invoke z ramki głównej przechodzi, invoke z iframe jest odrzucany.

**warning** `tsconfig.node.json:2`
Brak `lib` i `types`, więc main i preload typują się z domyślnym `DOM` i wszystkimi `@types/*`, co pozwala skompilować globalne API renderera w procesie głównym.
**Fix:** `"lib": ["ES2022"]`, `"types": ["node"]`.

**warning** `package.json:28`
`verify` nie obejmuje `scripts/release.test.mjs` (wymagany przez `release.yml:81`) ani `test:adapters`, którego nie uruchamia żaden workflow; dodatkowo `test:adapters` woła `python`, którego nie ma na `ubuntu-24.04`.
**Fix:** rozszerzyć `verify` o oba testy i rozwiązać interpreter portable.

**warning** `@types/better-sqlite3` 9.6.0 przy `better-sqlite3` 13.0.3
Typy opisują API cztery major wersje starsze od runtime, a pakiet runtime nie dostarcza własnych typów.
**Fix:** przypiąć typy zgodne z 13.x albo dostarczyć lokalną deklarację zweryfikowaną z `lib/database.js`.

**suggestion** `src/renderer/src/components/kanban/TaskStartModal.tsx:102-125` i `TaskResumeModal.tsx:177-200`
Ten sam 24-liniowy trap fokusu jest skopiowany w dwóch modalach i żaden test nie ćwiczy gałęzi Tab.
**Fix:** jeden helper `trapDialogFocus` plus test Tab/Shift+Tab dla obu.

**suggestion** `src/renderer/src/components/kanban/TaskResumeModal.tsx:80-83`
`runScan` czyści błąd i ustawia `scanning`, ale nie wraca do fazy `loading`, więc Refresh ze stanu błędu pokazuje puste ciało dialogu do końca skanu.
**Fix:** `setPhase('loading')`, gdy `result === null`.

**suggestion** `src/renderer/src/components/layout/ConfirmDialog.tsx`, `TerminalContextMenu.tsx`, `FileTree.tsx`
Trzy powierzchnie modalne mają własne, rozbieżne podejście do fokusu i Escape; brak wspólnego prymitywu.
**Fix:** jeden hook `useDialogFocusTrap` używany przez wszystkie dialogi i menu kontekstowe.

**suggestion** `src/renderer/src/test/monaco-mock.test.ts:11`
Test sprawdza sam mock (`monaco.editor.create` z mocka), więc nie może wykryć regresji w produkcyjnym kodzie.
**Fix:** usunąć test mocka; zepsuty mock wywali prawdziwych konsumentów.

**suggestion** `src/renderer/src/App.test.tsx:927-963`
Dwa testy wyłączania skrótu Ctrl+Tab mają ten sam setup i te same dwie negatywne asercje.
**Fix:** zostawić wariant cross-project, który pokrywa więcej.

**suggestion** `src/renderer/src/App.test.tsx:1131-1154`, `:2154-2157`
Dwa testy czekają na zegarze rzeczywistym (150 ms i 700 ms) zamiast na timerach wirtualnych.
**Fix:** `vi.useFakeTimers()` i `advanceTimersByTime`.

**suggestion** `package.json`
Cztery zadeklarowane zależności nie mają żadnego importu w `src`: `zustand`, `chokidar`, `clsx`, `tailwind-merge` (`cn` w `lib/cn.ts` to własny `join`).
**Fix:** usunąć albo podłączyć świadomie; `zustand` i `chokidar` mają sens tylko razem z odpowiednimi decyzjami architektonicznymi (propozycja 1 i 7.2).

**suggestion** `src/shared/ipc-contract.ts:1045`, `:1074`
`AppApi.dictation.dictionaryList` obiecuje unię `DictationDictionaryEntry[] | DictationDictionary`, choć preload zwraca tylko tablicę, a `postProcessingSetSettings` przyjmuje inline `{mode: string; level: string}` zamiast eksportowanego `SetPostProcessingSettingsInput`.
**Fix:** zawęzić typ zwracany i użyć typu wejściowego, żeby `tsc` łapał literały.

---

## 8. Zaktualizowana roadmapa

Pakiety w kolejności wykonania. Kolejność wynika z ryzyka, nie z rozmiaru pracy.

**P0. Higiena wydania (przed następnym lokalnie budowanym instalatorem)**
1. `files` allowlist w `electron-builder.yml` i ponowny build.
2. Krok CI sprawdzający, że `app.asar` nie zawiera `.agents`, `.claude`, `.codex`, `.grok`, `.opencode`, `src`, `docs`, `tmp`.
3. Podział zależności renderer/main (7.1, drugie znalezisko) i sprawdzenie rozmiaru asar.
Efekt: instalator nie zawiera harnessu ani kluczy, a rozmiar spada o setki megabajtów.

**P1. Granice zaufania i cykl życia procesów**
1. Fail-closed w czterech kanałach specjalnych plus test równości zbioru kanałów.
2. Izolacja `before-quit` i poprawka `preventDefault` w `shutdown.ts`.
3. `mkdirSync` przed `setPath`; `requestSingleInstanceLock`; prefiks migracji; normalizacja ścieżki projektu.
Efekt: brak cichych obejść walidacji i brak osieroconych PTY przy zamykaniu.

**P2. Timeouty i wycieki w serwisach**
1. Wspólny limit czasu dla adapterów dyktowania i post-processora; strzeżony `JSON.parse`.
2. Limit czasu i reset `busy` w `app-update`; rozstrzygnięcie po killu w `adapter-host`.
3. Asynchroniczne sondowanie WSL; blokada in-flight i `--no-edit` w `git sync`; katalog tymczasowy dyktowania objęty sprzątaniem.
Efekt: żadna zawieszona operacja nie blokuje funkcji do restartu aplikacji.

**P3. Renderer: poprawność interakcji**
1. Matematyka resize od punktu startu drag.
2. Potwierdzenia dla usunięć akcji i profili.
3. Trap fokusu w `ConfirmDialog`, `HandoffPicker` i menu kontekstowych; fokus w menu terminala.
4. Ciche ścieżki błędów (`ShellTab`, `TabStrip`, `DictationDictionary`), polling `ActionBar`, ikona akcji, `handleToggleProject`, mapa `validation`/`validation_error`.
Efekt: zachowanie zgodne z resztą aplikacji, bez cichych niepowodzeń.

**P4. Architektura pod agentów (duży, etapowy)**
1. Etap A: `CenterTabs.tsx` jako prawdziwy komponent i osobny test; wyprowadzenie `App` z 9 plików testowych do testów komponentów.
2. Etap B: dekompozycja `KanbanBoard.tsx` na listę, review, formularz i nagłówek; wyniesienie logiki do `kanban-board-logic.ts` (już istnieje) i usunięcie ręcznego re-eksportu.
3. Etap C: store'y domenowe (Zustand) dla projektów, czatów, zakładek i ustawień; `App.tsx` jako kompozycja. Kryterium etapu: `App.tsx` poniżej 800 linii i brak nowego stanu domenowego w `App` przy dodawaniu funkcji.
4. Etap D: `shared/contracts/` per domena i schema-first walidacja (Zod/Valibot) z zachowaniem reguł ścieżek i kluczy stanu.
5. Etap E: aliasy `@shared`, `@main`, `@renderer` w czterech plikach konfiguracji (propozycja 5).
Efekt: nowa funkcja UI nie wymaga czytania trzech tysięcy linii ani montowania całej aplikacji w teście.

Status (2026-10-26): P4 dostarczone w NEKODE-128 (kontrakt: [agent-friendly-architecture/spec.md](../features/agent-friendly-architecture/spec.md)). Etapy A-E są w kodzie: `CenterTabs.tsx` z własnym testem, `KanbanBoard.tsx` złożony z `KanbanListView`, `KanbanItemReview`, `KanbanCreateTaskForm` i `KanbanHeader`, kontrakty w `src/shared/contracts/` ze schematami Zod używanymi tylko w main, aliasy `@shared`, `@main`, `@renderer`, store'y Zustand `useProjectStore`, `useChatStore`, `useTabsStore` i `useSettingsStore` w `src/renderer/src/stores/` (zakres jednego montażu `App` przez `AppStoresProvider`). `App.tsx` ma 628 linii; przepływy aplikacji są w hookach `src/renderer/src/hooks/app/`. Pozostałe pakiety (P0-P3, P5) prowadzą NEKODE-134 do NEKODE-140.

**P5. Drobne porządki**
`tsconfig.node.json` (`lib`, `types`), rozszerzenie `verify`, wersja `@types/better-sqlite3`, usunięcie nieużywanych zależności, zawężenie typów w `AppApi`, usunięcie testu mocka i zduplikowanego testu Ctrl+Tab.

Uwaga o kolejności: P0 jest niezależne od reszty i powinno wejść pierwsze. P4 jest największe i powinno iść etapami z zielonym `verify` po każdym, bo dotyka wszystkich 195 miejsc, w których testy montują `App`.

---

## 9. Metoda, pokrycie i ograniczenia

**Sposób wykonania.** Przegląd z 2026-10-25 powstał w pięciu niezależnych sesjach odczytu (bez prawa zapisu, bez uruchamiania testów), po jednej na obszar:

| Obszar | Zakres | Pliki |
|---|---|---|
| Main core | `src/main/db`, `src/main/ipc`, `src/main/security`, `bootstrap`, `index`, `shutdown`, `user-data-override` | 24 |
| Main services | serwisy poza kanban/usage: akcje, czaty, projekty, agenci, dyktowanie, pliki, git, handoffy, terminal, task progress | 45 |
| Renderer components | `components/layout`, `settings`, `files`, `workspace`, `terminal`, `usage`, `actions`, `hooks`, `lib` | 84 |
| Renderer shell | `App.tsx`, `App.test.tsx`, `components/kanban`, `components/tabs`, `test/`, `main.tsx` | 34 |
| Build i kontrakty | konfiguracje, workflowy, `scripts/`, `src/preload`, `src/shared` | 45 |

**Weryfikacja właściciela.** Każde znalezisko `critical` i `warning` z sekcji 7 zostało sprawdzone w kodzie na wskazanej linii po zgłoszeniu. Absence claims potwierdzone osobnym wyszukiwaniem (`grep` po `src`, parsowanie nagłówka `app.asar`, `git show --name-only`). Metryki z sekcji 2 odtworzono na commitcie bazowym przeglądu przez `git archive b4764b6` i `wc -l`, co pozwoliło oddzielić błąd przeglądu od późniejszego dryfu.

**Uruchomione sprawdzenia.** `pnpm run lint`: 6 warningów, 0 błędów. `pnpm run typecheck`: czysto. `pnpm run test`: 135 plików zaliczonych, 2 pominięte, 2,567 testów zaliczonych, 13 pominiętych, 22,6 s. Zawartość `app.asar` odczytana z nagłówka archiwum (bez czytania plików wewnątrz).

**Ograniczenia.** Przegląd jest statyczny: defekty zależne od zachowania GUI (resize, fokus, kolejność zdarzeń PTY) nie były reprodukowane w działającej aplikacji, a wnioski o nich opierają się na kodzie i testach. Nie jest to audyt bezpieczeństwa: sprawdzono granice zaufania IPC, ścieżki plików i pakowanie, ale nie przeprowadzono analizy zależności pod kątem CVE. Testy pozostałych plików testowych obszarów renderera (`ChatTerminal`, `ChatWorkspace`, `ProjectFiles`, `StatusBar`, `UsageToolbar`, `ActionSettings`, `KanbanSettings`, `DictationSettings`, `TaskProgressSettings`, testy `lib/*`) zostały przejrzane wybiórczo (nazwy testów i styl asercji), więc ocena ich uczciwości jest ograniczona do wskazanych wyjątków.
