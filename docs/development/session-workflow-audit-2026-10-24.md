# Analiza ostatnich sesji Codexa i Claude Code

Data analizy: 2026-10-24. Zakres: lokalne sesje projektu NeKode, bez zmian w kodzie, konfiguracji, harnessie i tablicach zadań.

Największe problemy w tej próbie to niespójna specyfikacja po zmianie protokołu adapterów, pominięta obsługa cyklu zadania w Kanbanie oraz polecenia, których końcowy sukces maskował wcześniejszy błąd. Koszt pracy zwiększały też niepełne scenariusze regresyjne, błędne filtrowanie testów i powtarzanie znanych błędów narzędziowych. Niezależny review wykrył istotne regresje i zatrzymał ich zamknięcie.

## Próba i metoda

Przeanalizowano trzy ostatnie sesje główne każdego narzędzia dostępne podczas rozpoczęcia przeglądu. Pominięto bieżącą sesję analizy oraz sesje podrzędne jako osobne elementy próby. Raporty agentów podrzędnych odczytano jako dowody pomocnicze w sesji nadrzędnej.

| Id | Agent | Temat | Przedział widocznych zdarzeń, UTC |
|---|---|---|---|
| C1 | Codex | NEKODE-116, Sources zamiast Accounts | 2026-10-24 05:20:51-05:33:59 |
| C2 | Codex | Diagnoza i poprawka komunikatu odświeżania, potem PDH-13 | 2026-10-23 20:58:35-21:31:04 |
| C3 | Codex | Instalacja, aktualizacja i konfiguracja adaptera Personal Data Hub | 2026-10-23 20:14:50-20:50:27 |
| H1 | Claude Code | Diagram adapterów, live refresh, adapter Claude, commit | 2026-10-23 18:26:33-19:45:00 |
| H2 | Claude Code | NEKODE-120, przypinanie metryk PDH | 2026-10-23 16:07:52-16:26:52 |
| H3 | Claude Code | Breadcrumb, następnie nazwa projektu w zakładce Kanban | 2026-10-23 15:53:40-16:06:53 |

C1 była jeszcze w toku. Jej zamrożony zakres kończy się na wierszu 351 pliku JSONL; ostatni odczytany wynik narzędzia jest w wierszu 346. Braku zakończenia tej sesji nie uznano za błąd. Pozostałe pliki miały odpowiednio: C2 332, C3 348, H1 1244, H2 978 i H3 534 wiersze. Przedziały obejmują również oczekiwanie na użytkownika i agentów, więc nie są czasem aktywnej pracy modelu.

Sprawdzono kolejność poleceń, odpowiedzi narzędzi, pytania, decyzje użytkownika, raporty końcowe oraz przywoływane reguły repozytorium. Porównanie obejmuje `AGENTS.md`, workflow investigation/small/spec-driven, politykę engineering i odpowiednie kontrakty narzędzi. Gdy treść instrukcji występowała w logu, była dowodem jej dostępności w danej sesji. Dzisiejsza treść pliku sama nie dowodzi, że agent znał ją wcześniej.

To analiza wykonania pracy, a nie ponowny code review produktu. Nie uruchamiano testów aplikacji ani integracji sieciowych. Nie wyliczano kosztu tokenów ani łącznego czasu zmarnowanego: rozmiar logu, obrazy i czas między wiadomościami nie pozwalają tego rzetelnie obliczyć. Sześć sesji nie wystarcza do porównania jakości modeli.

### Lokalizatory dowodów

Zapis `C1:44` oznacza fizyczny wiersz 44 pliku JSONL przypisanego do C1. Zakres oznacza przedział wierszy tego samego pliku. Numery odnoszą się do surowego JSONL, a nie do sformatowanej rozmowy. Przytoczono tylko fragmenty potrzebne do analizy, bez tokenów dostępu i danych kont.

Katalog Codexa: `%USERPROFILE%/.codex/sessions/`. Katalog Claude Code: `%USERPROFILE%/.claude/projects/F--projects-NeKode/`.

| Id | Plik względem katalogu narzędzia |
|---|---|
| C1 | `2026/10/24/rollout-2026-10-24T07-20-51-01a16c5a-c6f9-7943-8c7b-fc02f9c56101.jsonl` |
| C2 | `2026/10/23/rollout-2026-10-23T22-58-16-01a16a8e-a758-7682-8f18-3fc3a2849a3c.jsonl` |
| C3 | `2026/10/23/rollout-2026-10-23T22-14-20-01a16a66-6e15-7560-bc4d-ea216d5d43dd.jsonl` |
| H1 | `5e8af21a-75dc-4d3c-b429-a265ac38805e.jsonl` |
| H2 | `ce4934e5-5725-4d5c-b83c-344b4301ee2d.jsonl` |
| H3 | `70e2ecca-ed95-4b75-9f48-966dd1e20eef.jsonl` |

## Ustalenia według priorytetu

Priorytet wysoki oznacza ryzyko błędnego kontraktu, niespełnionej bramki albo fałszywego sygnału sukcesu. Średni oznacza potwierdzone poprawki i powtarzalną stratę pracy. Niski oznacza lokalną niedogodność, która została skorygowana.

| Id | Priorytet | Ustalenie | Sesje |
|---|---|---|---|
| F1 | Wysoki | Specyfikacja zachowała równolegle stary i nowy kontrakt adapterów | H1 |
| F2 | Wysoki | Brak widocznego wykonania obowiązkowego cyklu Kanbana dla NEKODE-120 | H2 |
| F3 | Wysoki | Końcowy sukces polecenia maskował wcześniejszy błąd | C1, C2, H2 |
| F4 | Średni | Niepełne scenariusze regresyjne wymusiły dwie rundy poprawek | H1 |
| F5 | Średni | Ponownie odwrócono identyfikatory helpera Kanbana | C1 |
| F6 | Średni | Wąskie polecenie testowe uruchomiło pełny zestaw | C2 |
| F7 | Średni | Znane problemy powłoki i ścieżek wracały w kolejnych sesjach | C2, C3, H1 |
| F8 | Średni | Język i sposób zadawania pytań powodowały dodatkowe interwencje | H2, H3 |
| F9 | Średni | Zbyt duże odczyty obcinały potrzebne wyniki | C1, C2 |
| F10 | Średni | Implementer omyłkowo zmienił indeks Git | H1 |
| F11 | Niski | Przejście do GUI nastąpiło przed wyczerpaniem ścieżki konfiguracji | C3 |
| F12 | Niski | Smoke test zakładał całkowitą szerokość obramowania | C1 |

### F1. Stary kontrakt pozostał obok nowego po zamknięciu pracy

H1 dopisała sekcję `Amendment: live refresh and Claude OAuth adapter`, ale nie uzgodniła całego istniejącego kontraktu. Po komunikacie o zakończeniu i pełnej weryfikacji sekcja `Local adapter contract` nadal opisywała `protocolVersion: 1`, wyłącznie `read` oraz usunięte czytniki. Dopiero kolejna prośba użytkownika spowodowała aktualizację tej sekcji, reguły 17 i oznaczenie siedmiu starszych reguł jako zastąpionych.

Dowody: H1:415-430 dopisanie amendment; H1:1038-1060 zamknięcie i raport; H1:1062 prośba o aktualny opis i diagram; H1:1068-1075 odczyt starego kontraktu; H1:1099-1143 jego późniejsza korekta. W szczególności H1:1075 pokazuje literalne `protocolVersion: 1` po zakończeniu implementacji protokołu 2.

To luka w utrzymaniu kontraktu. Pełny zestaw testów nie wykrył sprzeczności dokumentacji. [Skill specification](../../.agents/skills/specification/SKILL.md) wymaga aktualizowania istniejącego kontraktu w miejscu; [polityka engineering](../../.agents/engineering.md) wymaga jednego kanonicznego źródła dla danego zagadnienia.

Zalecenie: przy zmianie publicznego protokołu sprawdzać przed zamknięciem wszystkie normatywne wystąpienia starej wersji i usuniętych możliwości. Amendment powinien jednoznacznie uzgadniać lub zastępować wcześniejsze reguły. Ten konkretny przypadek został poprawiony w dalszej części sesji.

### F2. NEKODE-120 obsłużono lokalnie bez widocznej obsługi statusu i komentarzy na wejściu

H2 zaczęła diagnozę, utworzyła rekord, zmieniła kod, wykonała testy i zamknęła lokalny rekord. W jawnych wywołaniach tej sesji nie ma odczytu `get NEKODE-120`, aktualnych komentarzy, potwierdzenia `In Progress` przed diagnozą ani przejścia do `Done` z odczytem potwierdzającym. Pierwsza widoczna operacja CLI na tym zadaniu to komentarz końcowy.

Dowody: H2:6 wskazuje konkretne zadanie; H2:35-329 pokazuje rozpoczęcie diagnozy i testy reprodukujące; H2:745-754 wysłanie komentarza; H2:760-793 lokalne zamknięcie i raport. Skill `kanban` wywołano dopiero dla nowego zadania o odświeżaniu, H2:847-862.

[Skill kanban](../../.agents/skills/kanban/SKILL.md), sekcja `Work-item lifecycle`, wymaga świeżego odczytu zadania i wszystkich komentarzy, potwierdzenia stanu przed pracą oraz ustawienia i potwierdzenia `Done` przed raportem zakończenia. Sam komentarz i `taskctl complete` nie zastępują tych operacji.

Nie ustalono historycznego stanu tablicy w tym momencie. Nie ma podstaw, żeby twierdzić, że tablica na pewno miała zły status. Potwierdzona jest luka w wykonaniu i dowodzie wymaganych kroków sesji.

Zalecenie: traktować rozpoczęcie konkretnego work item jako wejście w lifecycle Kanbana, także gdy pełny opis zadania jest już w promptcie. Oddzielać lokalne zakończenie rekordu od potwierdzonego zakończenia na tablicy.

### F3. Polecenia zwracały sukces mimo błędu we wcześniejszym kroku

W C1 błędny odczyt komentarzy zwrócił 403, lecz w tym samym poleceniu wykonano kolejne operacje i utworzono rekord. Zewnętrzne `exec_command` zwróciło `exit_code: 0`. W C2 `rg` zgłosił `os error 123`, a całe polecenie także miało kod 0. W H2 nieudany `taskctl step` został przykryty późniejszym poprawnym `task-status --check`.

Dowody: C1:44-47 (`403`, następnie `created ...`, końcowe `exit_code=0`); C2:36 (`os error 123`, końcowe `exit_code=0`); H2:643-645 (`ERROR: no unchecked step remains`, następnie `task records valid: 1`, wynik narzędzia bez oznaczenia błędu).

Agent zauważył te błędy w tekście i skorygował działania. Nie stwierdzono fałszywego zamknięcia zadania na ich podstawie. Problem pozostaje istotny: automatyczny odbiorca opierający się na kodzie procesu uznałby częściowo nieudane polecenie za udane. [Engineering, `Execution evidence`](../../.agents/engineering.md) wymaga zachowania kodu głównego sprawdzenia.

Zalecenie: rozdzielać zależne operacje i kończyć wykonanie po niezerowym kodzie programu natywnego. Samo `$ErrorActionPreference = 'Stop'` nie jest dowodem przeniesienia kodu wyjścia takiego programu. Po błędzie odczytu wejściowego nie przechodzić automatycznie do następnej mutacji.

### F4. Testy terminów odświeżania nie sprawdzały całego zachowania

W H1 pierwszy test zachowania terminów po edycji konta nie uruchamiał serwisu jako widocznego. Mógł przechodzić, choć harmonogram po zmianie nazwy lub przełączeniu konta wysyłał nowy odczyt podczas `Retry-After`. Po zachowaniu terminu ujawniła się kolejna regresja: zmiana nazwy usuwała dane i przypięcie, a następny odczyt mógł nastąpić dopiero po 300 s.

Dowody: H1:741, raport review wskazujący brak `setVisible(true)` i obejście `Retry-After`; H1:799, ponowny review wskazujący utratę cache i pin; H1:835-849 sprawdzenie starszych testów i uzgodnienie znaczenia zmiany nazwy; H1:876 ostateczny wynik bez uwag blokujących.

Od pierwszego raportu blokującego o 19:26:24 do ostatniego wyniku review o 19:38:20 upłynęło około 11 min 56 s. To zmierzony czas całej pętli poprawek i przeglądów, nie oszacowanie samego narzutu delegacji. Sesja użyła ośmiu wywołań `Agent`: implementacji i review dwóch etapów oraz dwóch par correction/re-review etapu 2. Taka delegacja była zgodna z [workflow Large](../../.agents/workflows/spec-driven-development.md).

Zalecenie: przed oddaniem zmian terminów odświeżania sprawdzać wspólny scenariusz: widoczny panel, zaplanowany odczyt, ręczny odczyt, aktywny backoff, odczyt w toku oraz edycja nazwy/przełącznika z zachowaniem danych i przypięcia. Review zadziałał; problemem była niepełna samoweryfikacja poprzedzająca kolejne przekazania.

### F5. Powtórzono znany błąd kolejności identyfikatorów Kanbana

C1 przypisała wynik `resolve_issue_ref` jako `pid, iid, ref`, chociaż helper zwraca identyfikator zadania przed identyfikatorem projektu. Powstał błędny URL komentarzy, a odpowiedź 403 sugerowała problem uprawnień. Zamiana na `iid, pid, ref` naprawiła odczyt.

Dowody: C1:44 kod błędnego unpackingu; C1:47 odpowiedź 403; C1:58 poprawka kolejności; C1:80 potwierdzenie pustej historii komentarzy. Kontrakt helpera: `.agents/skills/kanban/scripts/kanban_cli.py:391-407`. [Istniejąca lekcja](../../.agents/lessons/items/kanban-helper-reference-order.md) opisuje wcześniejsze powtórzenia z NEKODE-90, NEKODE-81 i NEKODE-121.

Agent odtworzył wymaganą obsługę paginacji w tymczasowym skrypcie, ponieważ CLI nie udostępnia odczytu komentarzy. Jest to dozwolone obejście opisane w skillu, ale wymaga ręcznego korzystania z wewnętrznego helpera. To jednocześnie błąd wywołania i ograniczenie interfejsu narzędzia.

Zalecenie doraźne: przed składaniem URL odczytać sygnaturę i zwracane wartości helpera. Kandydat do osobnego zadania w agent-harness: komenda odczytu komentarzy z paginacją, bez kopiowania tego samego skryptu do każdej sesji.

### F6. Polecenie z filtrami uruchomiło cały zestaw testów

C2 miała sprawdzić `usage-service.test.ts` i `UsageToolbar.test.tsx`, ale podała `pnpm run test -- <pliki>`. Wynik pokazał 118 zaliczonych i 2 pominięte pliki testowe oraz 2158 testów, czyli pełny zestaw zamiast dwóch wskazanych plików. Późniejsze poprawne sprawdzenie tych dwóch obszarów wykazało 67 testów.

Dowody: C2:57 polecenie z dodatkowym `--`; C2:75 wynik 2158 testów i czas Vitest 27,24 s; C2:200 polecenie końcowe z filtrami bez dodatkowego separatora; C2:223 potwierdzenie 67 testów. [Zapisana lekcja Windows](../../.agents/lessons/items/windows-bounded-file-discovery.md) już ostrzega: `pnpm run test <file>...`, ponieważ dodatkowe `--` rozszerza wykonanie.

Zalecenie: po uruchomieniu wąskich testów porównywać listę lub liczbę uruchomionych plików z zamierzonym zakresem. Raport o zaliczonych testach powinien opisywać faktyczny zakres. Nie ma podstaw, żeby różnicę czasu między tymi przebiegami uznać w całości za stratę: wykonano je na różnych etapach pracy.

### F7. Powracały błędy powłoki i zgadywane ścieżki

Potwierdzone przykłady:

- C2:36: pozycyjny wildcard `src/renderer/src/components/usage/UsageToolbar*` spowodował `os error 123`. Poprawny wzorzec repozytorium to istniejący katalog i filtr `rg -g`.
- C3:208: wyszukiwanie zawierało pozycyjne `src/main/services/settings*`; dalszy przebieg sesji wracał do rozpoznawania właściwych plików, a na C3:338 zapisano kolejną aktualizację lekcji o niezgadywaniu ścieżek.
- H1:415-422: duży heredoc dopisujący specyfikację nie przeszedł przez Bash (`unexpected EOF while looking for matching`). H1:429-430 ponowiła zapis narzędziem Edit. H1:948-959 odczytała i zaktualizowała istniejącą lekcję o tym samym problemie.

Wzorzec jest już opisany w [referencji Windows](../../.agents/environments/windows.md), [lekcji odkrywania plików](../../.agents/lessons/items/windows-bounded-file-discovery.md) i [lekcji cytowania skryptów](../../.agents/lessons/items/shell-inline-script-backticks.md). Nie ma potrzeby dodawania kolejnych ogólnych instrukcji o ostrożności. Potrzebne jest stosowanie znanego sposobu przed wywołaniem, które ma ten sam kształt.

Zalecenie: potwierdzać ścieżki przez import lub `rg --files`; wielowierszowe skrypty z Markdownem i kodem zapisywać do scratchpada albo stosować narzędzie edycji. Nie traktować poprawy po błędzie jako dowodu, że jego powtarzanie jest nieuniknione.

### F8. Pytania i język zwiększały koszt udziału użytkownika

H2 prowadziła dużą część rozmowy po angielsku mimo polskiego opisu zadania. O 16:11:12 zadała dwa techniczne pytania po angielsku. Użytkownik przerwał je po około trzech minutach i odpowiedział `nie wiem`, a następnie poprosił o najbardziej eleganckie rozwiązanie. Agent wybrał wtedy rozwiązanie mieszczące się w zakresie naprawy. Późniejszy angielski raport z pytaniem o komentarz wywołał kolejną odpowiedź: `Nie wiem co odemnie chcesz. Wytłumacz mi po polsku.`

Dowody: H2:34-356 angielska komunikacja i pytania; H2:363-379 przerwanie, odpowiedzi i samodzielny wybór; H2:727-739 raport i prośba o wyjaśnienie. `AGENTS.md:7` wymaga dopasowania języka, jeśli repozytorium nie stanowi inaczej. English-only UI nie nakazuje rozmowy po angielsku.

H2:727, H2:739 i H2:793 pytały o decyzje w zwykłej wiadomości, mimo dostępnego `AskUserQuestion`. H3:415 także podała warianty dalszego zachowania w wiadomości zamiast narzędzia. `AGENTS.md:10` kieruje takie decyzje do narzędzia interaktywnego.

Sama zgoda na publikację komentarza nie była zbędną bramką: H2 sprawdziła politykę, przygotowała konkretną treść i dopiero potem pytała. Problemem były język, długość komunikatu oraz forma pytania. Zgoda na komentarz i zgoda na commit dotyczyły różnych operacji.

Zalecenie: zadawać krótkie pytania po polsku, z konsekwencją i rekomendacją. Dla decyzji implementacyjnych przedstawiać wybrany wariant i jego uzasadnienie, jeżeli istniejące wymagania pozwalają go rozstrzygnąć. Nie usuwać wymaganej autoryzacji publikacji.

### F9. Duże odczyty obcinały wyniki potrzebne do kolejnego kroku

C2:50 połączyła pełny indeks lessons z odczytem istotnych fragmentów kodu. Wynik C2:53 zgłasza `truncated output`, 8111 tokenów przed obcięciem i 1246 linii; początek zajmowały metadane lekcji. C1:58 podobnie połączyła pełny indeks z poprawionym odczytem komentarzy. C1:61 zgłasza obcięcie wyniku 6149 tokenów do limitu 4500.

To utrudnia dostęp do rozstrzygającego wyniku znajdującego się za obszernym materiałem pomocniczym. W C2:57 agent przeszedł następnie na filtrowanie indeksu w PowerShell, co dawało mniejszy i bardziej użyteczny wynik. Nie dowiedziono, że te odczyty same spowodowały późniejsze ograniczenia kontekstu.

Zalecenie: filtrować metadane przed drukowaniem, a wynik działania wymagającego potwierdzenia oddzielać od długiego odczytu instrukcji. Rozmiaru surowego JSONL, zwłaszcza zawierającego obrazy, nie używać jako miary tokenów modelu.

### F10. Implementer przypadkowo stagedował usunięcia

Implementer etapu 1 w H1 sam zgłosił, że przez pomyłkę dodał usunięcia do indeksu, a następnie je wycofał. Koordynator sprawdził indeks przed uruchomieniem review. Nie ma dowodu utraty cudzych zmian ani nieautoryzowanego commita.

Dowody: H1:608 raport implementera, który opisuje `git reset -q -- <deleted paths>`; H1:617-618 reakcja koordynatora i `git diff --cached --name-only`. Raport agenta jest dowodem pomocniczym; wynik kontroli koordynatora potwierdza stan po korekcie, a nie cały przebieg wcześniejszej operacji.

Zalecenie: w zleceniu implementacji wyraźnie określać odpowiedzialność za indeks, a przy przekazaniu porównywać go ze stanem wejściowym. Kontrola koordynatora była właściwą reakcją na zgłoszoną omyłkę.

### F11. Ścieżka GUI została rozpoczęta przed rozstrzygnięciem konfiguracji lokalnej

Po prośbie o konfigurację C3 zaczęła ładować skill computer-use i inicjalizować połączenie z interfejsem Windows. Użytkownik zapytał, czy zamiast tego da się edytować konfigurację. Agent ustalił, że ustawienia są w `nekode.db`, odnalazł zaszyfrowane konto w zachowanym profilu testowym i przywrócił je bez GUI.

Dowody: C3:204-229 prośba, odczyty dokumentacji i inicjalizacja narzędzia; C3:231 korekta użytkownika; C3:236-255 odczyt SQLite; C3:297-345 odzyskanie konfiguracji i wynik. Pomiędzy prośbą a korektą użytkownika upłynęło około 26 s. Cała konfiguracja trwała dłużej, lecz dalszego czasu nie można przypisać inicjalizacji GUI.

Zalecenie: najpierw ustalić właściciela ustawień i dostępne API. W przypadku aktywnej aplikacji uwzględnić jej stan w pamięci i szyfrowanie sekretów przed zapisem bezpośrednio do bazy. Końcowa informacja o wymaganym restarcie była prawidłowa.

### F12. Smoke test mylił obecność obramowania z dokładnie 1 px

C1 dwukrotnie przerwała smoke na asercji `parseFloat(metrics.border) >= 1`. Drugi przebieg pokazał `border: 0.8px`, poprawny padding, wysokość i fokus. Agent skorygował test na obecność obramowania i poinformował o przyczynie.

Dowody: C1:251 pierwszy błąd; C1:258 pomiar drugiego przebiegu; C1:297 wyjaśnienie skorygowanej asercji. Nie uznano tego za dowód błędu produktu ani ukrywania czerwonego testu: zmieniono nieuzasadnione założenie o renderowanym wymiarze.

Zalecenie: w kontroli wyglądu rozdzielać wymaganie semantyczne, takie jak widoczny przycisk i fokus, od dokładnych wymiarów. Jeśli dokładny piksel jest wymaganiem, test powinien jawnie uwzględniać skalowanie i sposób pomiaru.

## Co działało i czego nie uznano za naruszenie

- C1:126-143 zatrzymała implementację na akceptacji gotowej specyfikacji i planu. To wymagana bramka Standard, a nie zbędne pytanie.
- C3:73-88 poprosiła o rozszerzenie instalacji na zmianę adaptera w osobnym repozytorium. Użytkownik to zatwierdził. Brak obsługiwanej wersji protokołu nie został ukryty reinstalacją tych samych plików.
- C2:72-86 odtworzyła mylący komunikat bez nowego odczytu i jawnie oddzieliła tę diagnozę od niepotwierdzonej świeżości danych PDH. Pierwszy prompt pytał o przyczynę, dlatego samego zakończenia na diagnozie nie uznano za złamanie zakresu. Dopiero C2:93 jednoznacznie zażądał poprawki.
- H1:741-876 pokazuje skuteczny niezależny review i poprawki przed zamknięciem. Dwie rundy correction/re-review mieściły się w budżecie workflow. Ośmiu wywołań agentów nie uznano automatycznie za nadmiarowe.
- C2:240-249 ujawniła blokadę usunięcia profili testowych i sprawdziła zakończenie procesów. Odmowa polityki bezpieczeństwa sama nie jest błędem wywołania ani powodem do jej obchodzenia.
- H3:350 zmieniła wymaganie z breadcrumbu na nazwę projektu w zakładce. Część ponownej pracy i testów wynikała z tej decyzji użytkownika. Nie zaliczono całego przebudowania UI do strat agenta.

## Zalecana kolejność dalszych działań

1. Najpierw uszczelnić wykonanie: propagację błędów poleceń, potwierdzanie zakresu testów oraz lifecycle Kanbana. Te luki mogą dać nieprawidłowy sygnał zakończenia pracy.
2. Dodać do istniejącego przeglądu końcowego sprawdzenie spójności kontraktu po zmianie protokołu. Nie potrzeba kolejnej specyfikacji ani osobnego procesu akceptacji.
3. Przy zmianach harmonogramu wymagać scenariusza obejmującego widoczność, terminy dostawcy, edycję i zachowanie obserwacji. Celem jest ograniczenie regresji trafiających do kolejnej rundy review.
4. Osobno zgłosić do agent-harness brak komendy odczytu komentarzy z paginacją. Zmiany harnessu wymagają odrębnego upoważnienia; ta analiza ich nie wprowadza.
5. Uporządkować wykonanie po stronie agentów: polskie i krótkie pytania, narzędzie interaktywne do decyzji, mniejsze odczyty, potwierdzone ścieżki i konfiguracja lokalna przed inicjalizacją GUI.

Powyższe zalecenia nie są zgodą na implementację. Najbardziej wartościowy następny krok to osobne, ograniczone zadanie dotyczące propagacji błędów i potwierdzania obowiązkowych bramek, z reprodukcjami F2, F3, F5 i F6 jako materiałem wejściowym.

## Ograniczenia i kontrola samej analizy

Raport opiera się na lokalnych logach. Nie sprawdzono historii audytowej serwera Kanban, nie odtwarzano dostępu do kont i nie oceniano zmian produktu wykonanych już po granicy próby. Brak wywołania w logu oznacza brak dowodu wykonania w tej sesji; nie dowodzi stanu całego systemu ani działania innej sesji.

Podczas tej analizy także wystąpił błąd rozpoznania: próba odczytu nieistniejącego `CLAUDE.md` przed potwierdzeniem ścieżki. Odczytano `lesson-select` i istniejącą lekcję `windows-bounded-file-discovery`; dalsze rozpoznanie oparto na rzeczywistym katalogu `.claude`. Duże odczyty na początku analizy również wymagały zawężenia wyników. Te zdarzenia nie wchodzą do sześciosesyjnej próby i nie zostały użyte do zwiększenia liczby ustaleń.

Wynikiem jest ten dokument. Nie wdrożono zaleceń, nie zmieniono kodu ani istniejących plików workflow i nie wykonano commita.
