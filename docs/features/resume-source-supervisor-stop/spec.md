# Zatrzymanie źródła Resume przez supervisor

## Cel

Anulowanie testu źródła Resume w Windows ma kończyć się deterministycznie: proces potomny i całe jego drzewo są zakończone, kanały stdio zamknięte, a żądanie zwraca błąd `cancelled`. Dziś rodzic wysyła `taskkill /T /F` 1 do 2 ms po starcie supervisora i czeka na zdarzenie `close`; gdy potomek odziedziczy stdio supervisora, `close` nie nadchodzi, a zatrzymanie kończy się fałszywym błędem „Cannot stop owned Resume discovery processes” i może zostawić proces.

## Dowody problemu

- `src/main/services/handoffs/resume-source-command.ts:225` daje 3 s na `close`, potem zgłasza błąd stopu.
- W przebiegu przegranym proces potomny ma `exitCode` 1, ale `stdout` i `stderr` pozostają otwarte (`readableEnded` false).
- Przy budżecie podniesionym do 30 s `close` nie nadchodzi w ciągu 15 s.
- `taskkill /PID <pid> /T /F` raportuje sukces także w przebiegach przegranych.
- Test pada w 2 z 3 przebiegów pod obciążeniem, przechodzi przy bezczynnej maszynie; ten sam plik przechodzi na commicie przed zmianami zadania NEKODE-138.

## Wymagania funkcjonalne

- FR-1: Konfiguracja supervisora Windows zawiera ścieżkę pliku stopu. Supervisor, czekając na proces potomny, sprawdza jej istnienie i po pojawieniu się pliku kończy całe zadanie (`TerminateJobObject`), a następnie kończy się sam.
- FR-2: Rodzic przy anulowaniu tworzy unikalny plik stopu w katalogu tymczasowym i czeka na zakończenie supervisora w istniejącym budżecie 3 s.
- FR-3: Gdy supervisor nie zakończy się w budżecie, rodzic używa dotychczasowego `taskkill` jako fallbacku, żeby nie pogorszyć zachowania przy starszych lub uszkodzonych środowiskach.
- FR-4: Po anulowaniu nie pozostaje proces potomny ani otwarty kanał stdio; żądanie kończy się błędem `cancelled`, nie błędem stopu.
- FR-5: Plik stopu jest usuwany w każdej ścieżce, także przy błędzie i przy normalnym zakończeniu źródła.
- FR-6: Kod wyjścia supervisora po zatrzymaniu jest zarezerwowany i rozpoznawalny, ale żądanie anulowane nie mapuje go na błąd użytkownika.

## Niezmienniki

- Ścieżka WSL i POSIX pozostaje bez zmian.
- Kontrakty IPC i typy współdzielone nie zmieniają się.
- Brak nowych zależności; zapis wyłącznie do katalogu tymczasowego procesu.
- Supervisor nadal nie interpretuje tekstu źródła; konfiguracja pozostaje danymi JSON.

## Kryteria akceptacji

- AC1: Test integracyjny „cancels a real owned child…” przechodzi 10 razy z rzędu przy obciążeniu porównywalnym z dzisiejszym.
- AC2: Nowy test jednostkowy potwierdza utworzenie pliku stopu przy anulowaniu, sprzątanie pliku oraz fallback, gdy supervisor nie kończy się w budżecie.
- AC3: `pnpm run verify` jest zielony.
- AC4: Po anulowaniu katalog roboczy testu daje się usunąć bez `EBUSY`.

## Ryzyka

- Opóźnienie zatrzymania do interwału pollowania (100 ms).
- Antywirus lub uprawnienia mogą blokować plik w katalogu tymczasowym; fallback z FR-3 to pokrywa.
- Zmiana wbudowanego skryptu supervisora wymaga testu na prawdziwym PowerShellu, nie tylko na mockach.
