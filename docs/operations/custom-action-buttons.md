# Przyciski akcji — uruchamianie apkI (start.ps1 / stop.ps1)

System **Actions** jest już wbudowany w NeKode — przycisk dodaje się z poziomu UI,
bez zmian w kodzie.

## Jak dodać przycisk

1. Otwórz panel: **ikona ustawień na pasku akcji** (nad główną powierzchnią)
   albo **Project Settings** w lewej nawigacji → sekcja **Actions**.
2. Kliknij **Add Action** i wypełnij pola:

| Pole        | Wartość                                                |
| ----------- | ------------------------------------------------------ |
| Scope       | Global (albo Project, jeśli ma być per-projekt)        |
| Title       | `Start NeKode`                                         |
| Icon        | `None` (paleta Lucide) albo `Custom (emoji)`, np. 🚀   |
| Command     | `powershell -NoProfile -ExecutionPolicy Bypass -File "F:\projects\NeKode\scripts\start.ps1"` |
| Working Dir | `F:\projects\NeKode`                                   |
| Run In      | `Background`                                           |
| Confirm     | opcjonalnie                                            |

3. **Save** — przycisk pojawia się na pasku akcji.

## Ikona przycisku

Pole **Icon** daje dwa tryby wyboru:

- **Paleta Lucide** (predefiniowane, spójne z resztą UI): run, stop, preview,
  continue, retry, build, test, bug, deploy, web, terminal, database, package,
  timer. Wybrana nazwa renderuje się jako glif Lucide przed tytułem przycisku.
- **Custom (emoji)**: dowolna emotka (np. 🚀) wklejona do pola tekstowego —
  renderuje się dosłownie.

`None` = bez ikony; przycisk pokazuje wtedy tylko znacznik statusu (idle /
running / failed) i tytuł. Wybór nie wpływa na wykonanie komendy.

## Run with PowerShell NoProfile

Checkbox zaraz pod polem Command — jego etykieta pokazuje pełny prefiks
`powershell -NoProfile -ExecutionPolicy Bypass -File`, który zostaje doklejony
do zapisywanej komendy.
W polu Command wpisz ścieżkę skryptu i jego argumenty, np. `./scripts/start.ps1`.
Ścieżkę ze spacjami umieść w cudzysłowach.
Opcja działa dla każdego Run In. Przy edycji zapisanej akcji formularz pokazuje
oryginalne polecenie i zaznaczony checkbox; odznaczenie usuwa opakowanie PowerShell.
Przy edycji polecenia z tym prefiksem checkbox jest automatycznie zaznaczony.

## Ważne

- Przy odznaczonym checkboxie **Run with powershell -NoProfile -ExecutionPolicy
  Bypass -File** pole Command jest odpalane przez
  `cmd.exe` (`spawn` z `shell: true`), a cmd nie wykona .ps1 bezpośrednio.
  Dlatego komenda opakowuje skrypt w `powershell -NoProfile -ExecutionPolicy Bypass -File ...`.
- Run In = **Background**: `start.ps1` sam odpala `pnpm run dev` w tle
  (logi w `tmp\logs\`), a sam kończy się po ~3 s, więc przycisk pokaże
  running → success, a apka dalej działa.
- Jeśli apka już biega, `start.ps1` wychodzi z kodem 1 („already running")
  i przycisk pokaże **failed** — to zamierzone. Zatrzymywanie przez stop.ps1 (niżej).
- Dev-mode odpalony **z wnętrza** NeKode uruchomi **drugą instancję**
  (drugie okno obok pierwszej). Jeśli chcesz „otwierać apkę" z poziomu
  zwykłego używania, użyj trybu Unpacked (niżej) po wcześniejszym
  `pnpm run build:unpack`.

## Gotowe komendy do wklejenia

Start (dev):

```
powershell -NoProfile -ExecutionPolicy Bypass -File "F:\projects\NeKode\scripts\start.ps1"
```

Stop:

```
powershell -NoProfile -ExecutionPolicy Bypass -File "F:\projects\NeKode\scripts\stop.ps1"
```

Start (skompilowana apka, wymaga wcześniejszego `pnpm run build:unpack`):

```
powershell -NoProfile -ExecutionPolicy Bypass -File "F:\projects\NeKode\scripts\start.ps1" -Mode Unpacked
```

Dla Stop/Unpacked pozostałe pola identyczne (Title tylko inny).
