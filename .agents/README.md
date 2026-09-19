# Praca z agentami

Ta instrukcja dotyczy projektu po zakończonym bootstrapie, gdy `AGENTS.md` i `.agents/project-profile.yaml` opisują już rzeczywisty stos oraz działające polecenia.

Zasady specyficzne dla tego projektu trzyma jedna sekcja `## Project rules` w [`AGENTS.md`](../AGENTS.md), w razie potrzeby podzielona podsekcjami `###`. Aktualizacja harnessu nigdy nie nadpisuje jej treści, a sekcje należące do harnessu odbudowuje z szablonu (zachowując sekcje własne projektu, dopisane wiersze routingu oraz tytuły wskazane w `sync.keep_sections`). Wcześniejsze `## Project Constitution` i `## Project-specific rules` przenosi tam automatycznie skill `harness-config-update`.

## Rozpoczęcie zadania

1. Uruchom agenta w katalogu głównym projektu.
2. Opisz cel, źródło wymagań, zakres, wyłączenia i kryteria akceptacji.
3. Pozwól agentowi sprawdzić repozytorium, dobrać workflow, wprowadzić zmiany i wykonać walidację.

Przykład:

> Dodaj eksport raportu zgodnie z `docs/features/report-export/spec.md`. Eksport ma obsługiwać CSV i nie może zmieniać istniejącego API. Zakończ po spełnieniu kryteriów akceptacji i pomyślnej walidacji.

Agent dobiera polecenia testowe z profilu projektu (`.agents/project-profile.yaml`). Klasyfikację zadania, dobór workflow, zasady tworzenia rekordu oraz obsługę operacji repozytorium definiuje router w [`AGENTS.md`](../AGENTS.md).

## Wybór skilla

Skill może zostać dobrany automatycznie na podstawie promptu. W Codex CLI wywołasz go przez `$`, a w Grok Build jako slash command.

| Zadanie | Codex CLI | Grok Build |
|---|---|---|
| Preflight i testy przed edycją produktu | `$preflight` | `/preflight` |
| Standardowa lub większa implementacja | `$implement` | `/implement` |
| Nieoczywisty błąd bez znanej przyczyny | `$systematic-debugging` | `/systematic-debugging` |
| Przegląd zmian bez ich modyfikowania | `$code-review` | `/code-review` |
| Utworzenie albo wznowienie handoffu | `$handoff` | `/handoff` |
| Aktualna dokumentacja bibliotek i API | `$context7` | `/context7` |
| Tablica postępu (osobna instalacja) | `$use-task-board` | `/use-task-board` |
| Delegowanie doradcze do modeli zewnętrznych przez AGY | `$external-model-delegation` | `/external-model-delegation` |
| Mała, oczywista zmiana | Zwykły prompt | Zwykły prompt |

Po nazwie skilla dopisz konkretny cel i źródło wymagań, na przykład:

> `$systematic-debugging` Odtwórz i napraw podwójne naliczanie opłaty opisane w `docs/features/billing/known-issue.md`.

Grok Build czyta `AGENTS.md` bez dodatkowej kopii instrukcji. Adaptery w `.grok/skills/` udostępniają kanoniczne skille z `.agents/skills/`; szczegóły uruchomienia i mapowania subagentów opisuje [`.grok/README.md`](../.grok/README.md).

AGY dodatkowo stosuje [`.agents/rules/agy.md`](rules/agy.md). Grok, Codex, Claude i OpenCode nie wczytują tego katalogu przy starcie. Zasady innego hosta kładź w jego adapterze (`.grok/`, `CLAUDE.md`, `.codex/`), nie w `.agents/rules/`.

## Status, wznowienie i przekazanie

Możesz użyć krótkich promptów:

> Pokaż aktualny status zadania i następny krok.

> Kontynuuj aktualne zadanie na podstawie rekordu w `.agents/tasks/`.

> `$handoff` Przygotuj handoff tego zadania dla kolejnej osoby.

> `$handoff` Wznów pracę z najnowszego handoffu.

Trwały stan zadania przechowują dedykowane pliki:

- Postęp i Timing zarejestrowanego zadania: `.agents/tasks/<task-id>/`. Nie usuwaj rekordu po zamknięciu zadania.
- Plan realizacji zadania: `.agents/tasks/<task-id>/plan.md`.
- Trwała specyfikacja zachowania produktu: `docs/features/<nazwa>/spec.md`.
- Migawki przekazania lub wstrzymania pracy: `.agents/handoffs/<task-id>.md`.

Zasady tworzenia rekordu, specyfikacji oraz planu definiuje router w [`AGENTS.md`](../AGENTS.md).

`preflight` uruchamia kontrolę środowiska i odpowiednie istniejące testy przed edycją produktu. Polecenia profilu używają przenośnego `{python}`. Jeśli bieżące `python` jest za stare, skrypt kończy się błędem i podaje wymagane minimum. Na Windows, gdy zgodny interpreter jest wykrywalny przez launcher `py`, podaje również dokładne polecenie, na przykład `py -3.13 .agents/scripts/preflight`; nie przełącza interpretera po cichu.

Projekt zawiera serwer MCP Context7 do aktualnej dokumentacji bibliotek i API. Po pierwszym pobraniu projektu albo zmianie `.codex/config.toml` uruchom ponownie sesję Codex; konfiguracja projektu działa tylko dla zaufanego repozytorium. Skill `$context7` zgłasza brak narzędzi jawnie i nie przedstawia innego źródła jako wyniku Context7.

## Kontekst limitów agenta

Hook używa `HUB_URL` jako bazowego adresu usługi i `HUB_TOKEN` jako wspólnego tokenu Bearer. Rejestruje limity przez `POST /api/v1/agent-quotas/batch`, a stan informacyjny pobiera przez `GET /api/v1/agent-quotas`; token potrzebuje odpowiednio uprawnień `agent:push` i `agent:read`. Brak `HUB_URL` lub `HUB_TOKEN` wyłącza komunikację z Hubem, bez domyślnego adresu produkcyjnego. Hook uzupełnia brakujące wartości z lokalnego `.agents/.env`; jawne wartości środowiska procesu mają pierwszeństwo. Plik `.agents/.env` jest ignorowany przez Git i powinien mieć uprawnienia `600`.

Hook wykonuje najwyżej jedną próbę dla danego endpointu w ciągu 60 sekund, również przy równoległych procesach. Stan throttlingu i niejawny wynik ostatniej próby zapisuje w ograniczonym cache katalogu tymczasowego systemu operacyjnego; nie zapisuje danych uwierzytelniających ani plików w repozytorium. Kolejne wywołania w tym oknie nie łączą się z siecią i nie powtarzają kontekstu. Odmowa przez kontrolę bezpieczeństwa nie uruchamia zapytania.

Pomiar limitów pozostaje po stronie systemu: hook rejestruje go i cache'uje bez wstawiania do kontekstu modelu. Tekst o limitach pojawia się w sesji tylko wtedy, gdy pozostała pojemność przejdzie poniżej progu `QUOTA_LOW_REMAINING_PERCENT` z `.agents/hooks/dispatch.py`, dokładnie raz na przejście; powrót powyżej progu uzbraja powiadomienie ponownie, a pierwszy pomiar sesji już poniżej progu ogłasza się raz. Dozwolone wywołanie narzędzia nie dołącza tekstu o limitach ani ich błędów. Runtime bez lokalnego źródła limitów (np. Claude Code) nie rejestruje pomiarów i nie zgłasza tego jako błędu.

Brak konfiguracji, timeout, błąd HTTP albo niezgodna odpowiedź nie blokują narzędzia. Komunikat niedostępności pojawia się przy zdarzeniach sesyjnych (pierwsza próba, kolejne wyciszone przez 60 sekund), a nigdy przy dozwolonym wywołaniu narzędzia. Timeout zapytania wynosi najwyżej jedną sekundę. Po zmianie `.codex/hooks.json` uruchom nową sesję Codex, a po zmianie `.claude/settings.json` nową sesję Claude Code, aby klient wczytał konfigurację hooków.

## Rezultat

Po zakończeniu otrzymasz:

- gotową zmianę zgodną z wymaganiami;
- zaktualizowane testy i dokumentację, jeśli były potrzebne;
- raport zmienionych plików i wykonanych kontroli;
- jawnie wskazane kontrole pominięte lub niedostępne, założenia i pozostałe ryzyka.

Nie musisz ręcznie uruchamiać skryptów harnessu. Wymagana kontrola zakończona błędem lub niedostępna blokuje zakończenie zadania.

## Mapa konfiguracji

- [`workflows/`](workflows/): przepływy wykonania (small-development, spec-driven-development, investigation);
- [`skills/handoff/SKILL.md`](skills/handoff/SKILL.md): jak utworzyć, zwalidować i wznowić handoff;
- [`skills/preflight/SKILL.md`](skills/preflight/SKILL.md): jak zebrać dowody środowiska i testów przed edycją produktu;
- [`skills/external-model-delegation/SKILL.md`](skills/external-model-delegation/SKILL.md): opcjonalne doradcze delegowanie zadań do modeli zewnętrznych przez lokalne AGY z jawną zgodą (consent ID);
- [`project-profile.yaml`](project-profile.yaml): stos, środowisko, polecenia projektu, `harness.version` (tag semver tego harnessu) oraz sekcja `sync:` z polityką aktualizacji harnessu (co wolno nadpisywać);
- [`engineering.md`](engineering.md): zasady projektowania kodu, testowania, weryfikacji i dokumentacji;
- [`safety.md`](safety.md): operacje niszczące, modyfikacje repozytorium i granice uprawnień;
- [`skills/`](skills/): procedury aktywne ładowane tylko dla pasujących zadań;
- [`.grok/`](../.grok/): cienki adapter odkrywania skilli i mapowania ról dla Grok Build;
- [`templates/`](templates/): wzorce rekordu, specyfikacji, planu i handoffu;
- [`tasks/`](tasks/): robocze rekordy zadań i plany; globalny widok przez skill [use-task-board](skills/use-task-board/SKILL.md) (tablica jest widokiem `task.md`, nie drugim rekordem);
- [`docs/`](../docs/): dokumentacja lazy-loadowana przez router (semantyka `project-profile.yaml`);
- [`handoffs/`](handoffs/): opcjonalne przekazania pracy;
- [`docs/harness/reviews/`](../docs/harness/reviews/): surowe wyniki zewnętrznych review tego repozytorium, przechowywane jako dowód, nie jako obowiązująca instrukcja;
- [`lessons/`](lessons/): selektywny magazyn lekcji projektu (`index.json` plus `items/`); lekcje stają się stałymi zasadami dopiero po awansie przez użytkownika;
- [`hooks/`](hooks/) i [`scripts/`](scripts/): automatyczna walidacja oraz kontrole bezpieczeństwa.

`BACKLOG.md` przechowuje wyłącznie odłożone pomysły i nie jest aktywnym planem.
