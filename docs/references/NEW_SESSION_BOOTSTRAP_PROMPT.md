# New Session Bootstrap Prompt

Wklej poniższy prompt na początku nowej sesji, a następnie — jeśli chcesz — od razu wklej `SDD.md`, `UX-UI.md` albo inne przygotowane dokumenty.

---

## Prompt

Pracujemy nad projektem desktopowej aplikacji do **agentic coding** na Windows 11.

Chcę kontynuować projekt od istniejącej koncepcji, a nie projektować go od zera.

### Krótki opis produktu

Budujemy **agent-first coding workspace** inspirowany kierunkiem UX ZCode, ale jako własny, niezależny produkt.

Aplikacja ma służyć do:

- zarządzania projektami programistycznymi,
- zarządzania taskami,
- uruchamiania coding agentów przez terminal,
- przełączania się pomiędzy aktywnymi zadaniami,
- wznawiania pracy z Handoffów,
- przeglądania plików projektu,
- obserwowania Git branch / worktree status / runtime,
- uruchamiania konfigurowalnych akcji projektu,
- oraz docelowo zarządzania pracą głównie przez Kanban.

MVP jest **terminal-first** i nie wymaga ACP.

Agent w MVP jest zwykłą aplikacją konsolową, np.:

- Codex,
- Claude Code,
- OpenCode,
- agy,
- Gemini CLI,
- dowolny inny skonfigurowany agent CLI.

Użytkownik ma:

- globalnego Default Console Agent,
- opcjonalnego agenta domyślnego dla projektu,
- opcjonalnego agenta przypisanego do Taska,
- możliwość jednorazowego wyboru innego agenta.

---

## Główna koncepcja domenowa

Centralnym obiektem jest:

```text
Task
```

Task może mieć:

```text
Project
Workspace
Terminal Session
Agent
Git branch
Git worktree
Handoff
Kanban state
Progress checkpoints
```

Kanban card i Task w drzewku projektu reprezentują **ten sam obiekt**.

Docelowy model:

```text
Project
└── Task
    ├── Workspace
    │   ├── cwd
    │   ├── branch
    │   └── worktree
    ├── Terminal
    ├── Agent
    ├── Handoffs
    ├── Progress Checkpoints
    └── Kanban state
```

---

## Główna struktura UI

Aplikacja ma pięć głównych obszarów:

```text
TOP
Project Action Bar

LEFT
Projects → Tasks
lub kontekstowo Project File Tree

CENTER HEADER
Project / Workspace context:
path
runtime
Git branch
worktree / Git status

CENTER
Main Surface:
Task Terminal
Files
Kanban
future surfaces

BOTTOM
Auxiliary Terminal
Ctrl + `

RIGHT
Secondary tools
domyślnie ukryte
np. Browser / second Terminal
```

---

## Istotne decyzje UX

UI całej aplikacji jest po angielsku.

Styl:

- dark-first,
- minimalistyczny,
- spokojny,
- premium developer tool,
- zwarty,
- inspirowany ZCode,
- ale nie będący kopią VS Code.

Animacje mają być:

- subtelne,
- krótkie,
- satysfakcjonujące,
- pomocne w orientacji przestrzennej,
- nigdy rozpraszające.

Szczególnie ważne są animowane przejścia:

- Projects/Tasks → File Tree,
- Project → Task,
- Files ↔ Kanban,
- otwieranie bottom terminala,
- otwieranie right panelu,
- Resume z Handoffu.

---

## Kanban

Kanban ma być jednym z głównych elementów produktu.

Na poziomie projektu:

```text
Files | Kanban
```

Podstawowe kolumny:

```text
Backlog
Todo
In Progress
Done
```

Docelowo prawdopodobnie także:

```text
Review
```

Karta Taska może mieć akcję:

```text
Implement
```

dla nowego zadania,

oraz:

```text
Resume
```

dla zadania aktywnego lub posiadającego Handoff.

Kliknięcie `Implement` powinno uruchomić Task z domyślnym agentem, chyba że użytkownik wybierze innego.

---

## Handoffs

Handoff jest zasobem Taska.

Ma pozwalać wznowić pracę jednym kliknięciem.

Kliknięcie:

```text
Resume
```

powinno automatycznie:

1. wybrać właściwy Project,
2. wybrać właściwy Task,
3. otworzyć / przywrócić Workspace,
4. otworzyć lub utworzyć Terminal,
5. dobrać właściwego Console Agenta,
6. uruchomić go, jeśli potrzeba,
7. przekazać mu kontekst Handoffu,
8. kontynuować pracę.

MVP nie może zakładać ACP.

Handoff może być przekazany agentowi np. jako:

- przygotowany prompt,
- plik tymczasowy,
- argument CLI,
- tekst wklejony do terminala.

---

## Task Progress / Checkpoints

Task może mieć wizualny progress z checkpointami, np.:

```text
Plan → Inspect → Implement → Test → Review
```

To nie jest zwykły procentowy progress bar.

Ma odpowiadać na:

- co już zrobiono,
- gdzie jesteśmy,
- co zostało.

Checkpointy mogą mieć status:

```text
pending
active
completed
failed
blocked
skipped
```

Progress powinien działać również przy pracy nieliniowej.

Handoff zachowuje stan checkpointów.

---

# Przygotowane dokumenty

Mamy już przygotowane następujące dokumenty.

## 1. `SDD.md`

Software Design Document.

Zawiera między innymi:

- architekturę Electron + React + TypeScript,
- model Project / Task / Workspace / TerminalSession,
- SQLite persistence,
- `node-pty`,
- GitService,
- RuntimeDetectionService,
- ActionService,
- IPC,
- file browsing,
- read-only Monaco,
- MVP scope,
- acceptance criteria,
- rozdział MVP vs post-MVP,
- kierunek przyszłych worktrees i agent integrations.

Jeśli wkleję `SDD.md` w tej sesji:

**traktuj go jako aktualne źródło prawdy dla architektury technicznej**, chyba że później jawnie uzgodnimy zmianę.

---

## 2. `UX-UI.md`

Pełna specyfikacja UX/UI.

Zawiera między innymi:

- układ aplikacji,
- wszystkie główne powierzchnie,
- Project/Task navigation,
- File Tree,
- Kanban,
- Console Agents,
- Default Agent,
- Handoffs,
- Resume flow,
- Project Action Bar,
- bottom terminal,
- right panel,
- Git/runtime context,
- checkpoint progress,
- motion design,
- error states,
- accessibility,
- English-only UI.

Jeśli wkleję `UX-UI.md`:

**traktuj go jako aktualne źródło prawdy dla UX/UI**, chyba że później jawnie uzgodnimy zmianę.

---

## 3. Mockup prompt pack

Istnieje zestaw promptów do generowania mockupów wszystkich istotnych widoków aplikacji.

Zawiera:

- inventory widoków,
- master visual system,
- prompty dla pełnych ekranów,
- prompty dla dialogów i stanów,
- komponenty,
- storyboardy animacji.

Pliki obejmują między innymi:

```text
00_MASTER_VISUAL_SYSTEM.md
VIEW_INVENTORY.md
ALL_PROMPTS.md
README.md
```

oraz osobne prompty widoków.

Nie musisz ich znać, jeśli ich nie wkleję.

---

## 4. `MAIN_HOME_VIEW_PROMPT.md`

Osobny prompt do wygenerowania jednego głównego mockupu aplikacji.

Ma służyć do sprawdzenia ogólnego:

- feelu,
- density,
- hierarchy,
- visual direction,
- mood,

zanim zaczniemy generować wszystkie pozostałe mockupy.

---

# Jak pracować w tej sesji

Jeśli po tym promptcie wkleję jeden lub kilka dokumentów:

1. przeczytaj je dokładnie,
2. nie proś mnie o ponowne podawanie informacji, które już w nich są,
3. wykrywaj sprzeczności pomiędzy dokumentami,
4. jeśli coś się różni, przyjmij:
   - nowsze jawne ustalenie z rozmowy > dokument,
   - UX-UI.md dla UX/UI,
   - SDD.md dla architektury technicznej,
5. nie rozszerzaj MVP bez potrzeby,
6. nie zamieniaj projektu w klasyczne IDE,
7. zachowuj terminal-first charakter MVP,
8. pamiętaj, że Kanban, Handoff i Task są elementami jednego spójnego modelu,
9. nowe propozycje oceniaj pod kątem zgodności z całą architekturą produktu.

Jeżeli proponujesz zmianę architektury albo UX, wskaż:

- co zmieniasz,
- dlaczego,
- jakie są konsekwencje,
- czy wymaga to aktualizacji `SDD.md`, `UX-UI.md` lub obu.

---

# Aktualny cel

Po wklejeniu tego promptu i dokumentów chcę móc od razu kontynuować pracę nad projektem bez ponownego rekonstruowania wcześniejszych ustaleń.

Potwierdź krótko, że rozumiesz projekt i przeczytaj dostarczone dokumenty przed dalszym projektowaniem.
