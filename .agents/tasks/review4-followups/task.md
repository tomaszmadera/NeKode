---
id: review4-followups
schema_version: 2
status: active
intent: refactor
complexity: small
durability: recorded
current_phase: Phase 1
current_step: Phase 1.1
updated: 2026-09-28
branch: main
worktree: current
next_action: Preflight, then single implementer for all four follow-ups with discriminating regression tests; small review; no plan file.
blockers: none
---

# Review:4 follow-ups

## Objective

Zamknąć cztery nieblokujące sugestie review:4 zadania bottom-auxiliary-terminal zanim zniknie kontekst: dwa małe usprawnienia product-path w rendererze, jedno wzmocnienie testu migracji, dwie korekty dokumentów.

## Scope

Zakres kodu: `src/renderer/src/App.tsx` + testy renderera, `src/main/db/db.test.ts`, wybrane dokumenty. Bez zmian kontraktów IPC i bez migracji bazy. Poza zakresem: kontrola zadań/trwałość między restartami, reszta BACKLOG.md.

Cztery elementy (źródło: review:4, non-blocking suggestions):

1. Wyciek wpisów `pendingBottomCommandsRef` (App.tsx): wpis jest usuwany tylko przy udanym ready-write; zamknięcie zakładki, exit, spawn-error albo przerwane createBottomTab zostawiają wpis do końca sesji. Fix: usuwać wpis w handleCloseBottomTab / handleBottomExit / onSpawnError / przy abort createBottomTab. Test: wpis znika na każdej z tych ścieżek.
2. `focusBeforeOpenRef` (App.tsx): wykonanie akcji `bottom-terminal` otwiera ukryty panel zwykłym open bez zapisu focusu; późniejszy hide przywraca fokus na powierzchnię środkową zamiast na element sprzed otwarcia (odchylenie od Behaviour 4 spec bottom-auxiliary-terminal na tej ścieżce). Fix: przechwycić document.activeElement przy otwieraniu z ukrytego, z taką samą ochroną przed fokusem body jak w showBottomPanel. Test: hide po otwarciu z akcji przywraca fokus.
3. Test migracji v5 (`src/main/db/db.test.ts`): asercja zachowania wierszy pomija kolumnę `icon` — dodać icon do SELECT i oczekiwanych wierszy, fixture z nie-NULL icon, żeby realny drop kolumny padał.
4. Dokumenty: `docs/features/bottom-auxiliary-terminal/spec.md` l. 13 (Related requirements) — nieaktualny dopisek o rezerwacji trybu; `docs/architecture/sdd.md` §62 MVP User Flow — „Git status refreshes when command ends" sprzeczne z Behaviour 18.

## Phase 0 - Intake

- [x] Phase 0.1 - Inspect the repository and refine the provisional classification (branch main, clean worktree at d2e00a8; all four items are App.tsx-local, no IPC/database contract changes; refactor stands)

## Phase 1 - Preflight, Implementation, Review and Verify

- [ ] Phase 1.1 - Preflight gate
- [ ] Phase 1.2 - Implementation (single implementer, discriminating regression tests)
- [ ] Phase 1.3 - Independent review (implementation gate)
- [ ] Phase 1.4 - Final verification `changed` and close

## Decisions

- Zakres i priorytet pochodzi z review:4 (werdykt No significant issues found; sugestie nieblokujące). Użytkownik przyjął rekomendację koordynatora 2026-09-28: zrobić follow-upy przed diagnozą Ctrl+D/Ctrl+U GUI.
- Drobne poprawki product-path robimy teraz, nie przy okazji innych zadań; BACKLOG.md po scaleniu elementów traci cztery wpisy.

## Changed files

- (pending)

## Verification

| Check | Result | Notes |
|---|---|---|
| intake inspection | pass | 2026-09-28. Branch main at d2e00a8, worktree clean; review:4 suggestions list reconciled with BACKLOG.md (4 entries present) |

## Timing

| Element | Kind | Started | Ended |
|---|---|---|---|
| intake | work | 2026-09-28T01:10:00Z | 2026-09-28T01:12:00Z |
| handoff | wait | 2026-09-28T01:12:00Z | |

## Risks and blockers

- Zmiany w App.tsx dotykają ścieżek używanych przez zamknięty bottom-auxiliary-terminal; regresje łapią istniejące testy renderera (327 w baseline).

## Resume instructions

Wznów z handoff snapshot .agents/handoffs/review4-followups.md. Pierwsza akcja: preflight, potem jeden implementer na wszystkie cztery elementy z testami dyskryminującymi.
