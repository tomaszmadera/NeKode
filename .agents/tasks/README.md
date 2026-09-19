# Task records

Ten katalog zawiera rekordy postępu zadań rejestrowanych (Small, Standard, Large oraz intencji bezrozmiarowych). Trivial nie tworzy rekordu taska.

Jeden input użytkownika dla zadania rejestrowanego to jeden katalog `.agents/tasks/<task-id>/` z jednym `task.md`. Standardowa lub większa praca rozwojowa ma też jeden `plan.md`. Small ma rekord i tabelę Timing, bez specyfikacji i bez planu. Etapy nie dostają osobnych tasków ani osobnych planów: są wierszami w tym planie. Rekord jest aktualizowany w istotnych checkpointach. Plan nie zawiera checkboxów postępu. Po zakończeniu nie usuwaj rekordu: Timing zostaje jako pomiar.

Task record i plan nie są trwałą dokumentacją produktu. Specyfikacja zachowania należy do `docs/features/<nazwa>/spec.md` - jedna na funkcję, nie na etap. Decyzje architektoniczne zapisuj jako ADR.

Nie istnieje drugi lokalny magazyn rekordów zadań.

```bash
python .agents/scripts/task-status
python .agents/scripts/task-status --check
python .agents/scripts/task-status --json
```

Globalna tablica postępu jest osobną instalacją - [use-task-board](../skills/use-task-board/SKILL.md). Jest tylko widokiem `task.md`, nie drugim rekordem postępu.
