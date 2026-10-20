# Usage quota: analiza źródeł danych

Stan analizy: 2026-10-20. Zakres: NEKODE-90, rekomendacja i projekt wdrożenia do zatwierdzenia. Nie wykonano połączeń do prywatnych kont, odczytu tokenów ani zmian konfiguracji agentów.

## Rekomendacja

Panel powinien należeć do NeKode, a integracje być opcjonalnymi adapterami subskrypcji. Main zbiera znormalizowane odczyty, renderer pokazuje panel, a lokalny eksport JSON pozwala wykorzystać dane poza aplikacją. Adapter może odczytywać API dostawcy, udokumentowany interfejs CLI albo wskazany plik. Brak źródła oznacza jawną niedostępność, bez szacowania procentu z liczby tokenów.

Uniwersalny jest kontrakt danych. Nie da się obiecać niezawodnego, stale aktualnego odczytu każdej subskrypcji. Zamknięcie sesji, brak uprawnień lub zmiana API muszą być widoczne jako stan źródła. Sam zapis w hooku nie potwierdza, że procent został ponownie pobrany od dostawcy.

Nie rekomenduję dodatkowego systemu no-code jako obowiązkowej warstwy. Jeśli obecny collector Agent Harness może eksportować uzgodniony format, adapter plikowy wykorzysta jego dane bez drugiego zbierania. Format collectora nie został wskazany ani zweryfikowany; kompatybilność wymaga przykładu bez sekretów. Plan nie zmienia Agent Harness.

## Dostępne źródła

| Subskrypcja / usługa | Potwierdzone źródło | Ograniczenie i proponowana decyzja |
|---|---|---|
| Claude, używany przez Claude Code | Oficjalny statusLine: rate_limits.five_hour i seven_day, procent i reset | Dane po odpowiedzi API; okna mogą nie występować. Pro/Max lub odrębny spend limit bramki. Opcjonalny collector plikowy. |
| ChatGPT / Codex | Oficjalnie opisany codex app-server, account/rateLimits/read i account/rateLimits/updated | App-server jest eksperymentalny i niewspierany dla produkcji. Jawnie eksperymentalny adapter po sprawdzeniu wersji CLI, bez tur modelu. |
| ElevenLabs | GET /v1/user/subscription: character_count, character_limit, next_character_count_reset_unix | Wymaga uprawnień. Procent wynika z licznika i limitu; reset nie ustala początku okresu. |
| OpenRouter | GET /api/v1/credits: total_credits, total_usage | Wymaga Management key. To saldo konta, nie procent subskrypcji ani limit klucza. Tak szeroki klucz nie powinien być wymagany domyślnie. |
| Command Code | Oficjalny /usage pokazuje okno 5h i tygodniowe; dokumentacja opisuje też pule miesięczne | Nie potwierdzono maszynowego API odczytu subskrypcji. Pierwsze wdrożenie: import JSON. |
| AGY z prototypu | Nazwa nie identyfikuje jednoznacznie dostawcy ani konta | Nie utożsamiać automatycznie z Antigravity. Dokumentacja Antigravity potwierdza interaktywny /usage, bez ustalenia interfejsu maszynowego do tego celu. |
| Grok z prototypu | Dokumentacja subskrypcji opisuje pule i widoki użycia | Nie potwierdzono API odczytu tej subskrypcji. Nie zastępować jej limitami API xAI. Pierwsze wdrożenie: import JSON. |

Źródła pierwotne odczytane 2026-10-20:

- [Claude Code: status line](https://code.claude.com/docs/en/statusline): pola, warunkowa obecność, wyzwalanie i refreshInterval. Timer uruchamia skrypt; dokumentacja nie gwarantuje nowego odczytu limitów z serwera przy każdym uruchomieniu. Bez działającej sesji collector status line nie działa.
- [OpenAI: Codex App Server](https://learn.chatgpt.com/docs/app-server): handshake initialize / initialized, stdio JSONL, metody konta, rateLimitsByLimitId, usedPercent, windowDurationMins, resetsAt oraz eksperymentalny status app-server. Długości okien należy czytać z odpowiedzi, bez stałego założenia 5h/7d.
- [ElevenLabs: get user subscription](https://elevenlabs.io/docs/api-reference/user/subscription/get): licznik, limit, okres i czas resetu.
- [OpenRouter: get remaining credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits): dane konta i wymaganie Management key. Saldo = total_credits - total_usage.
- [Command Code: pricing limits](https://commandcode.ai/docs/resources/pricing-limits): rodzaje pul oraz interaktywny /usage.
- [Antigravity CLI: model quotas](https://www.antigravity.google/docs/cli/commands/usage): /usage / /quota otwiera interaktywny panel i pobiera dane backendu.
- [Grok: usage limits](https://docs.x.ai/x-subscription/usage-limits): zakres współdzielonej puli i widoki na koncie. Nie dowodzi mapowania do konkretnej subskrypcji użytkownika.

Nieoficjalny endpoint Claude nie jest potrzebny do podstawowego odczytu podczas pracy Claude Code. Analiza nie potwierdza jego kontraktu, uprawnień ani stabilności. Nie wchodzi do wdrożenia. Scraping strony lub terminalowego /usage również nie jest podstawą niezawodnej integracji.

## Dopasowanie do repozytorium

- [Architektura, IPC boundary](../../architecture/sdd.md#ipc-boundary): main posiada filesystem, procesy i persystencję; renderer korzysta z typowanego bridge. Nowe odczyty nie wymagają uprawnień Node w rendererze.
- [Adaptery Kanban](../kanban-adapter-interface/spec.md#behaviour), punkty 1-6, oraz src/main/services/kanban/adapter-host.ts:1: istnieje wzorzec procesów, manifestu, JSON przez stdin/stdout, limitu odpowiedzi i timeoutu. Można zastosować podobny mechanizm bez łączenia domen Kanban i quota. Nie należy z góry refaktoryzować Kanban.
- src/main/services/kanban/kanban-service.ts:55: istnieje interfejs safeStorage. Quota może korzystać z tego mechanizmu szyfrowania, z jawnym błędem przy niedostępności zamiast zapisu jawnego.
- src/main/services/app-state-service.ts:8: istnieje globalny magazyn app_state. Konfiguracja subskrypcji i pin nie wymagają nowej tabeli ani powiązania z projektem.
- src/renderer/src/App.tsx:2510: istnieje pasek tytułu z marką aplikacji. To miejsce na globalny przycisk quota; klikany obszar musi mieć no-drag i omijać przyciski systemowe.
- src/renderer/src/components/settings/AppSettings.tsx:44: globalne ustawienia mają jawną listę zakładek. Quota powinna mieć osobną zakładkę Usage, niezależną od profili agentów.
- [Wymagania produktu](../../product/requirements.md): UI jest angielski, agenci pozostają procesami CLI. Odczyt metadanych subskrypcji nie uruchamia modeli ani nie zastępuje terminali.

W początkowym wyszukaniu quota|subscription|usage w src/shared, src/main, src/renderer nie znaleziono serwisu limitów subskrypcji; subscription dotyczyło głównie subskrypcji zdarzeń terminala.

## Prototyp i prawdziwe dane

Lokalny tmp/nekode-prototype/README.md opisuje eksport jako referencję wizualną. Main.dc.html:74 zawiera panel, :558 stałe przykładowe odczyty, a :660 wiersze, segmenty, świeżość i przypinanie. Przykładowe odczyty nie dowodzą możliwości integracji.

Kontrakt zachowuje panel 400px, kompaktowe wiersze, awatary, paski i segmenty, wskaźnik świeżości oraz przypinanie do paska. Rzeczywiste dane wymagają kilku reguł:

- Subskrypcja/konto jest jednostką grupowania. Dwie sesje tego samego konta nie dodają procentów i nie tworzą dwóch subskrypcji.
- Nie każdy dostawca ma 5h i 7d. Nieobecne okno nie oznacza 0%.
- Świeżość ma wiek danych i pochodzenie. Ponowny odczyt pliku lub uruchomienie status line nie czyni starych danych aktualnymi. Podstawowy payload Claude nie podaje czasu obserwacji limitu, więc collector przekazuje Age unknown oraz osobno czas odbioru.
- Tempo ma sens dla znanego początku i końca okresu. resetsAt bez czasu trwania nie wystarcza. Różnica procentów to punkty procentowe, oznaczane pp.
- Reset, który minął, unieważnia wartość okna do nowego odczytu. Aplikacja nie wpisuje wtedy 0%.
- Saldo dolarowe OpenRouter nie jest paskiem miesięcznego zużycia. Uprawnienia klucza muszą być wyjaśnione przed konfiguracją.

## Jedno zbieranie, wielu odbiorców

Proponowany przepływ:

```text
API / oficjalny CLI / istniejący collector
                  |
         opcjonalny adapter quota
                  |
        walidacja + cache w main
             /             \
        typowany IPC    eksport JSON (opt-in)
             |               |
      panel NeKode      lokalny konsument / sync użytkownika
```

Collector może zapisywać ten sam normalizowany format poza NeKode. Wtedy adapter plikowy tylko czyta dane; zbieranie i dotychczasowy upload pozostają u collectora. Eksport NeKode jest osobnym plikiem do odczytu przez konsumentów, z jednym właścicielem zapisu i atomową podmianą. Nie wolno wskazać eksportu jako wejścia collectora, bo powstałaby pętla odświeżania.

Desktopowy konsument z dostępem do filesystemu może czytać lokalny JSON bez serwera. Zwykła strona www i hostowany no-code nie mają takiego dostępu. Wymagają wybranego synchronizatora lub uwierzytelnionej usługi. Automatyczny upload, lokalny serwer HTTP i kolejna integracja chmurowa są poza planem; sam plik ich nie zastępuje. Gdy NeKode jest zamknięty, jego eksport przestaje się odświeżać. Niezależny collector może nadal odświeżać swój plik.

## Proponowana kolejność

1. Panel, ustawienia subskrypcji, pin, normalizacja, adapter plikowy i eksport. Działający wynik na fixture i zewnętrznym pliku, bez kont dostawców.
2. Collector Claude Code oraz eksperymentalny adapter Codex przez stdio. Osobny test kompatybilności wersji i uprawnień. Brak danych pozostaje jawnym stanem.
3. Opcjonalne adaptery ElevenLabs i OpenRouter, z obsługą sekretów, ograniczeń odświeżania i błędów konta.

Bezpośrednie adaptery Command Code, AGY i Grok pozostają poza planem do potwierdzenia produktu, kontraktu i autoryzacji. Ich dane można dostarczyć przez adapter plikowy. Szczegóły są w [projekcie specyfikacji](spec.md), a wykonanie w lokalnym planie NEKODE-90. Zatwierdzenie planu nie gwarantuje stabilności eksperymentalnego interfejsu Codex ani dostępu do kont.
