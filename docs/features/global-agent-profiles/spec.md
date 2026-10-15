# Globalne profile agentów i opt-in w projektach

Ten dokument jest kontraktem zachowania funkcji. Nie opisuje postępu implementacji.

Path: `docs/features/global-agent-profiles/spec.md`.

## Cel

Konfigurujesz sposób uruchamiania agenta raz, w ustawieniach aplikacji. W projekcie wybierasz tylko dostępne profile oraz domyślny profil. Gotowe szablony i edycja komendy w jednej linii zastępują ręczne budowanie tablicy argumentów w formularzu.

## Powiązane wymagania

- NEKODE-79: Globalne profile agentów, gotowe szablony i opt-in w projektach (work item `d23e517c-8d29-4762-8c46-d3e2971db59f`).
- Decyzja użytkownika z 2026-10-14: globalna biblioteka profili z gotowych szablonów albo własnych konfiguracji; nazwa i jedna linia komendy; w projekcie wybór dostępnych profili i domyślnego spośród nich; nowy projekt bez wyboru, wyłącznie opt-in. Nie ma dziedziczenia globalnego zestawu.
- [Wymagania produktu](../../product/requirements.md): agenci są procesami CLI, interfejs jest angielski, aplikacja nie wywołuje bezpośrednio API modeli.
- [Profile agentów i Start/Resume](../kanban-adapter-interface/spec.md#profile-agentów) oraz [menu New Chat](../new-chat-agent-menu/spec.md).
- NEKODE-78 (work item `f7589e3c-daeb-47a2-af5f-552a78ff4d40`): osobna korekta uruchamiania interaktywnego profili z flagą promptu. Ten kontrakt nie uznaje jej za wykonaną.

Decyzja z 2026-10-14 zastępuje projektowe przechowywanie definicji profili z 2026-10-07. Ten dokument jest właścicielem biblioteki, szablonów, formularza i przypisań do projektów. Powiązane kontrakty nadal są właścicielami gestów uruchamiania, promptów zadań, nazw czatów i cyklu życia terminala. Opis globalnego domyślnego agenta w `docs/UX-UI.md` §23 nie wprowadza dziedziczenia ani globalnego profilu domyślnego w tej funkcji.

## Zakres

- Zakładka `Agents` w App Settings: biblioteka profili, dodawanie z szablonu, dodawanie własnego profilu, edycja, kopiowanie i usuwanie.
- Nazwa oraz jedno pole `Command` zamiast `Executable` i wierszy `Argument N`.
- Zakładka `Agents` w Project Settings: zaznaczanie dostępnych profili, wybór domyślnego i odnośnik `Manage agents` do biblioteki.
- Ograniczenie menu New Chat oraz wyboru agenta w Kanban Start/Resume do profili zaznaczonych dla danego projektu.
- Walidacja w main, lokalna persystencja i migracja istniejących konfiguracji.

## Poza zakresem

- Automatyczne zaznaczanie profili dla nowych projektów, dziedziczenie i globalny profil domyślny.
- Automatyczne dodawanie wszystkich szablonów do biblioteki, instalowanie CLI, logowanie i synchronizacja chmurowa.
- Bezpośrednie API modeli, wspólny katalog providerów/modeli i przechowywanie kluczy API w NeKode.
- Projektowe kopie definicji, nadpisywanie pojedynczych pól profilu oraz dodatkowe poziomy dziedziczenia.
- Zmiana lewego kliknięcia New Chat, projektu powłoki, Actions, nazw istniejących czatów i działających sesji.
- Implementacja NEKODE-78. Jej ewentualne pola konfiguracji trzeba zachować, jeśli istnieją w kodzie w chwili realizacji.

## Zachowanie

### Biblioteka globalna

1. Biblioteka jest lokalna dla instalacji i katalogu danych aplikacji. Nie jest plikiem w repozytorium projektu. Możesz ją otworzyć bez wybranego projektu.
2. Nowa instalacja ma pustą bibliotekę. `Add agent` oferuje gotowy szablon albo `Custom`. Szablon jest propozycją konfiguracji; staje się profilem dopiero po zapisie.
3. Początkowy katalog obejmuje `Codex CLI`, `Claude Code`, `OpenCode` i `Gemini CLI`, zgodnie z rodzinami CLI wymienionymi w wymaganiach produktu. Każdy szablon musi mieć zweryfikowane uruchomienie interaktywne i przekazanie promptu zadania. Nie wolno dodawać niezweryfikowanego szablonu ani flag zmieniających zgodę na operacje, sandbox lub uprawnienia. Jeżeli wymagany szablon zależy od NEKODE-78, ta zależność blokuje gotowość tego szablonu, zamiast uzasadniać błędną komendę.
4. Wybranie szablonu uzupełnia nazwę i kompletną komendę. Formularz ma tę samą edycję dla gotowego i własnego profilu. Szablony korzystają z konfiguracji i modelu domyślnego CLI, bez narzucania wersji modelu.
5. `Custom` wymaga nazwy i komendy. Pomoc przy polu wyjaśnia cudzysłowy i znacznik `{prompt}`; nie wymaga tworzenia osobnych wierszy argumentów.
6. Skopiowanie profilu tworzy niezapisany formularz z tymi samymi ustawieniami. Zapis tworzy nowe id i nie przypisuje kopii do żadnego projektu.
7. Edycja profilu zachowuje jego id i obowiązuje przy kolejnych uruchomieniach we wszystkich przypisanych projektach. Formularz wyjaśnia ten zasięg. Działające procesy zachowują parametry, z którymi wystartowały.
8. Nazwy mogą się powtarzać, a tożsamość wyznacza id. Lista pokazuje również komendę; profile o identycznych nazwach muszą dać się rozróżnić bez zgadywania id. Dla profili po migracji można pokazać nazwę projektu pochodzenia jako pomocniczą informację.
9. Usunięcie profilu używanego przez projekt jest odrzucane z informacją, gdzie jest zaznaczony. Najpierw odznaczasz go w tych projektach. Usunięcie nieużywanego profilu usuwa tylko definicję. Nie zatrzymuje istniejących procesów.

### Opt-in w projekcie

1. Każdy nowy projekt zaczyna z pustą listą dostępnych profili i `defaultId: null`, nawet gdy biblioteka globalna jest już skonfigurowana. Nie ma opcji `Use global default`.
2. Project Settings pokazuje profile z biblioteki z checkboxami oraz wybór domyślnego tylko spośród zaznaczonych. Nie zawiera edycji komend ani dodawania definicji.
3. Zapis utrwala zestaw id i domyślny wybór razem. Anulowanie formularza niczego nie zmienia. Pierwszego zaznaczonego profilu aplikacja nie ustawia automatycznie jako domyślnego.
4. Domyślny profil jest opcjonalny, jak w dotychczasowym kontrakcie. Bez niego Start/Resume wymaga jawnego wyboru. Ustawienie domyślnego profilu niezaznaczonego w projekcie jest błędem walidacji.
5. Odznaczenie domyślnego profilu czyści domyślny wybór w tym samym formularzu i zapisie. Nie wybiera innego profilu w zastępstwie.
6. Dodanie lub skopiowanie globalnego profilu nigdy nie zmienia zestawu żadnego projektu. Nowy profil jest widoczny jako niezaznaczony w konfiguracji.
7. `Manage agents` otwiera App Settings na Agents bez utraty kontekstu projektu. Po powrocie lista odświeża definicje. Odświeżenie nie nadpisuje niezapisanych wyborów i nie zaznacza nowych profili.
8. Pusta biblioteka wskazuje możliwość dodania profilu globalnie. Biblioteka z pustym wyborem projektu wskazuje konieczność zaznaczenia profili dla projektu. Te stany nie są błędem odczytu.

### Uruchamianie

1. Menu New Chat oraz modal Kanban pokazują tylko profile zaznaczone w danym projekcie. Kolejność odpowiada kolejności profili w bibliotece globalnej; wybór checkboxów jej nie zmienia.
2. Domyślny wybór projektu jest używany wyłącznie tam, gdzie dotychczasowy kontrakt Start/Resume używał profilu domyślnego. Nie powoduje automatycznego startu agenta ani zmiany zwykłego New Chat.
3. Przy pustym wyborze `Configure agents` otwiera projektową zakładkę Agents. Nie tworzy czatu ani procesu.
4. Main odczytuje aktualną definicję i przypisanie do projektu przy każdym uruchomieniu. Samo globalne istnienie profilu nie uprawnia do jego uruchomienia w projekcie przez te akcje.
5. Katalogiem pracy pozostaje katalog projektu. Nazwa nowego czatu, rollback błędu spawn i transport błędów pozostają zgodne z kontraktami uruchamiania.

### Jedna linia komendy

1. Pole jest zapisem pliku wykonywalnego i argumentów, nie skryptem powłoki. Parser zamienia je na `executable` i `args`; main uruchamia proces przez argv. Nie wpisuje tekstu do terminala i nie przekazuje go do `cmd /c` lub PowerShell jako skryptu.
2. Pojedyncze i podwójne cudzysłowy grupują argumenty. Podwojenie otaczającego cudzysłowu wewnątrz cytowanego tekstu zapisuje dosłowny cudzysłów. Ukośniki wsteczne są zawsze dosłowne, również bezpośrednio przed zamykającym cudzysłowem. Wewnątrz cudzysłowów backtick z literą n zapisuje LF, backtick z literą r zapisuje CR, a dwa backticki zapisują jeden dosłowny backtick. Pozostałe sekwencje z backtickiem pozostają dosłowne. Dzięki temu historyczne argumenty zawierające CR/LF mają odwracalny zapis w jednym wierszu. Pusty argument w cudzysłowach jest zachowany. Nie ma rozwijania zmiennych, globów ani command substitution. Niezamknięty cudzysłów jest błędem. Parser, serializer i pomoc UI używają tej samej gramatyki.
3. Komendy wieloliniowe oraz niecytowane operatory powłoki (`|`, `||`, `&`, `&&`, `;`, `<`, `>`) są odrzucane z wyjaśnieniem. Znaki te wewnątrz cytowanego argumentu są danymi. Nie stosuje się automatycznego przejścia na wykonywanie przez shell.
4. Dotychczasowa reprezentacja promptu jest zachowana: dokładnie jeden pełny argument `{prompt}` dla Start/Resume; prompt trafia w jego miejsce jako jeden argument, niezależnie od spacji, nowych linii i znaków powłoki. Szablon wstawia znacznik sam. Fragment argumentu typu `prefix{prompt}` jest niepoprawny.
5. Przykłady formatu: `claude "{prompt}"` oraz `"C:\Tools\my-agent.exe" --model "my model" "{prompt}"`. Są przykładami składni, nie zapewnieniem, że dowolny CLI obsługuje ten interfejs.
6. Przejście zapisanych argv do formularza i ponowny zapis bez edycji muszą dać identyczne executable i argumenty, także dla spacji, pustych wartości, cudzysłowów i końcowych ukośników wstecznych.
7. Własny provider/model jest konfigurowany zgodnie z możliwościami wybranego CLI: przez parametry, jego plik konfiguracji lub własny wrapper. NeKode nie interpretuje nazw modeli ani nie obiecuje kompatybilności dowolnego providera z dowolnym agentem. Wrapper z odpowiednim interfejsem można uruchomić tą samą jedną linią. Kluczy API nie umieszcza się w komendzie; logowanie pozostaje po stronie CLI.

## Reguły biznesowe

- Definicja profilu jest globalna, a dostępność i domyślny wybór są projektowe. Projekt przechowuje odwołania, nie kopie definicji.
- Brak wybranego profilu jest prawidłowym stanem. Nie wolno wybierać innego agenta automatycznie.
- Zaznaczone id są unikalne, istnieją w bibliotece, a niepusty `defaultId` należy do zaznaczonego zestawu.
- Puste nazwy, puste executable, NUL, niewłaściwy typ argumentu i niepoprawny prompt są odrzucane przed zapisem.
- Zapis wyboru projektu, usunięcie profilu i kontrola odwołań nie mogą zostawić częściowo zmienionych danych.
- Projektowa lista jest preferencją uruchamiania w NeKode, nie polityką ograniczającą ręczne polecenia terminala ani wybór modelu wewnątrz CLI.

## Autoryzacja

Lokalna aplikacja jednego użytkownika, bez nowych ról. Renderer używa wyłącznie typowanego `window.app`; main waliduje żądanie, istnienie projektu, definicję profilu i aktualne przypisanie. Nie wolno polegać wyłącznie na checkboxach lub liście w UI.

## Dane i API

- Globalny dokument w istniejącym `app_state`: wersja formatu i uporządkowane definicje o stabilnym id, nazwie, executable i args. Jedna linia jest formatem edycji; argv pozostaje formatem uruchamiania i kanonicznych danych, aby uniknąć podwójnego parsowania promptu.
- Dokument projektu: wersja formatu, zaznaczone id i `defaultId`. Nie zawiera executable ani args.
- IPC rozdziela operacje biblioteki (odczyt, zapis, usunięcie) od odczytu i zapisu wyboru projektu. Odczyt efektywnych profili projektu zwraca wyłącznie zaznaczone, aktualne definicje oraz prawidłowy defaultId. Main nie przyjmuje definicji uruchomienia dostarczonej przez renderer zamiast id.
- Dokładne nazwy nowych kanałów i kluczy ustala implementacja przy zachowaniu `src/shared/ipc-contract.ts` jako jedynego źródła kontraktu. Zmiany przechodzą przez preload, walidatory, rejestrację i usługi.
- Profile i przypisania przetrwają restart aplikacji. Usunięcie projektu usuwa jego wybór, ale nie profile globalne. Ponowne dodanie katalogu jako nowego projektu wymaga nowego opt-in.
- Nie loguje się całych komend ani argumentów. Aplikacja nie zapisuje profili do repozytorium projektu ani plików konfiguracyjnych CLI.

### Migracja

1. Migracja obejmuje dotychczasowe dokumenty `project.agentProfiles:<projectId>` i wykonuje się tylko raz dla danego formatu, transakcyjnie. Kolejny start nie odtwarza usuniętych profili ani nie przywraca odznaczonych wyborów.
2. Każdy dotychczasowy profil staje się odrębną globalną definicją, z zachowaniem nazwy, executable, dokładnych argv i istniejących dodatkowych pól uruchamiania. Nie scala się profili po nazwie ani po identycznej komendzie: wcześniej były niezależnie edytowalne.
3. Id można zachować, o ile nie koliduje. Przy kolizji powstaje nowe id oraz jawne mapowanie użyte w przypisaniu i defaultId. Źródłowy projekt można zapisać jako pomocnicze pochodzenie do rozróżnienia nazw.
4. Dla istniejącego projektu zaznaczone są wyłącznie profile wcześniej należące do niego. Domyślny profil i kolejność dotychczasowych profili tego projektu pozostają takie same. Globalną kolejność migracja układa tak, aby zachować kolejność w każdym projekcie, ponieważ profile nie są scalane.
5. Projekt bez profili pozostaje bez profili. Wyjątek zachowania istniejących wyborów podczas migracji nie oznacza dziedziczenia dla nowych projektów.
6. Walidacja wszystkich migrowanych danych poprzedza zapis. Uszkodzony dokument powoduje jawny błąd z identyfikatorem projektu, bez czyszczenia lub zastępowania go pustą konfiguracją. Oryginalne dane pozostają dostępne; nie używa się obecnego odczytu, który sprowadza niepoprawny JSON do pustego dokumentu, jako dowodu poprawnej migracji.
7. Niepowodzenie migracji wycofuje jej wszystkie zapisy i nie pozwala uruchamiać agenta na podstawie częściowo przeniesionej konfiguracji. Zwykłe czaty z powłoką pozostają dostępne. Udana migracja eliminuje stare dokumenty jako aktywne źródło, tak aby późniejsza zmiana nie była nadpisywana.

## Przypadki brzegowe

- Profil odznaczony lub usunięty po otwarciu menu: main odrzuca start i UI odświeża wybór; nie powstaje czat.
- Profil edytowany po otwarciu menu: kolejny start korzysta z aktualnej definicji i nazwy; działająca sesja nie jest modyfikowana.
- Biblioteka zmieniona podczas edycji wyboru projektu: zapis ponownie waliduje id; błąd nie kasuje formularza ani poprzedniej konfiguracji.
- Zmiana projektu podczas odczytu lub zapisu: opóźniona odpowiedź nie nadpisuje formularza innego projektu.
- Usunięcie ostatniego zaznaczonego profilu: pusty wybór i pusty domyślny; brak automatycznego zastępstwa.
- Nieobecne CLI: profil można zapisać przed instalacją; start zwraca istniejący błąd spawn. Dodanie lub zapis profilu nigdy nie uruchamia procesu.
- Brak konfiguracji jest odróżniony od uszkodzenia danych lub błędu odczytu. Uszkodzenia nie naprawia się cichym pustym wynikiem.

## Błędy

Typowany `AppError` dla walidacji, brakującego projektu/profilu, odznaczonego profilu i błędów persystencji. UI pokazuje angielski komunikat w istniejącej powierzchni błędów, zachowuje formularz i poprzedni zapis. Odmowa usunięcia wskazuje projekty, w których profil jest zaznaczony. Błąd migracji nie jest pustą biblioteką. Błąd startu nie powoduje zastąpienia agenta innym profilem ani zwykłą powłoką.

## Kryteria akceptacji

1. Bez wybranego projektu można otworzyć globalną bibliotekę i zapisać profil z szablonu lub własnej komendy w jednym polu, bez wierszy argumentów.
2. Szablon uzupełnia kompletną konfigurację; profil można edytować i kopiować. Żadna z tych akcji nie uruchamia CLI ani nie zaznacza go w projekcie.
3. Nowy projekt ma pusty zestaw i domyślny wybór nawet przy niepustej bibliotece; dodanie kolejnego profilu globalnie tego nie zmienia.
4. Zaznaczenie tylko profilu `Claude - praca` powoduje, że tylko ten profil jest dostępny w menu New Chat i Kanban Start/Resume tego projektu. W innym projekcie wybór pozostaje niezależny.
5. Domyślny może należeć wyłącznie do zaznaczonego zestawu; jego odznaczenie czyści defaultId bez automatycznego wyboru następcy. Jawny brak domyślnego pozostaje dozwolony.
6. Parser i serializer zachowują dokładne argv dla cytowanych ścieżek, spacji, pustych argumentów, cudzysłowów i ukośników. Prompt pozostaje jednym argumentem i nie jest wykonywany przez shell.
7. Profile z własnym modelem/providerem można zapisać bez sztywnej listy modeli, korzystając z parametrów lub konfiguracji obsługiwanego CLI.
8. Edycja globalnego profilu wpływa na przyszłe uruchomienia przypisanych projektów, a skopiowany profil jest niezależny. Sesje już działające pozostają bez zmian.
9. Usunięcie zaznaczonego profilu jest odrzucane bez zmian danych; usunięcie projektu nie kasuje globalnego profilu.
10. Migracja zachowuje osobne definicje, przypisania, domyślne wybory i dokładne komendy; jest idempotentna. Błąd dowolnego dokumentu nie pozostawia częściowej migracji.
11. Niedostępny już profil jest odrzucany również przy bezpośrednim żądaniu IPC; nie powstaje czat. Zwykły lewy klik New Chat nadal tworzy czat z powłoką projektu.
12. Odczyt po restarcie odtwarza bibliotekę i wybory. Wymagane testy, lint i typecheck przechodzą, a Windows smoke potwierdza oba sposoby uruchomienia dla każdego dostarczonego szablonu.

## Wymagane testy

- Usługi i persystencja: globalne CRUD, niezależne wybory projektów, opt-in, walidacja defaultId, odmowa usunięcia używanego profilu, atomowość zapisu i sprzątanie tylko przypisania projektu.
- Migracja: świeża baza, kilka projektów (także pusty), powtarzające się nazwy i komendy, kolizje id, defaultId null, kolejność, drugi start po późniejszej edycji, niepoprawny JSON i rollback błędu zapisu.
- Parser: grupowanie cudzysłowami, ścieżka Windows z końcowym ukośnikiem, literalny cudzysłów, pusty argument, NUL, niedomknięte cytowanie, nowe linie, operatory oraz round-trip dokładnych argv. Test promptu ze spacjami, nową linią i znakami shell ma dowodzić przekazania jednego argumentu, bez ponownego parsowania.
- Renderer: oba wejścia dodawania, brak wierszy argumentów, kopiowanie, wybór i domyślny, brak automatycznego zaznaczania, niezapisany formularz po odświeżeniu, puste i błędne stany, zmiana projektu podczas odpowiedzi, klawiatura i etykiety dostępności.
- Uruchamianie: tylko zaznaczone profile, aktualna definicja, profil odznaczony po otwarciu menu, brak czatu po odmowie/spawn failure; regresja zwykłego New Chat i promptów Start/Resume.
- IPC: pozytywne przekazanie przez preload, walidacja każdego nowego pola i odmowa obcego sendera. Błąd przypisania jest sprawdzany w main, niezależnie od UI.
- Rzeczywista aplikacja Windows w izolowanym userData: utworzenie profilu, opt-in dwóch projektów, restart oraz uruchomienie interaktywne i zadaniowe szablonów. Fixture CLI może dowieść argv; zgodność szablonu wymaga odrębnego smoke konkretnego CLI. Brak CLI jest raportowany jako niezweryfikowany, nie zaliczony.

## Powiązane SDD i ADR

[SDD: IPC boundary, Persistence, Terminal lifecycle](../../architecture/sdd.md#current-implementation-obligations). Nowy ADR: none; decyzja użytkownika jest zapisana w tym kontrakcie.
