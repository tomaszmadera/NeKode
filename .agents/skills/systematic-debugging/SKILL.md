---
name: systematic-debugging
description: Use when diagnosing and fixing a non-obvious defect by reproducing it, testing falsifiable hypotheses from evidence, adding regression coverage, and verifying the smallest root-cause correction.
---

# Systematic debugging

The router owns the durable-state decision. Do not create a record for session-local work. When the owning workflow supplies a record, activate `task-record` for its transitions.

1. Clarify expected versus actual behavior and inspect the smallest relevant evidence. Stay in the current session for diagnosis and any authorized root-cause fix. Do not use the coordinator-to-implementer boundary.
2. Reproduce the failure with the smallest reliable case and preserve the evidence.
3. Trace the failing path and form one falsifiable hypothesis at a time.
4. Change the approach after a failed hypothesis; never repeat an identical action without new evidence.
5. Add a regression test or equivalent deterministic check when practical.
6. When a fix is authorized, implement the smallest root-cause correction without unrelated cleanup; diagnosis-only requests end with the evidenced cause and recommendation.
7. Run the regression check, affected tests, and proportional verification.
8. Complete only when the cause is evidenced and any requested in-scope fix has passed its regression check and proportional verification.
9. Report the cause, fix, evidence, and any unresolved risk separately.
