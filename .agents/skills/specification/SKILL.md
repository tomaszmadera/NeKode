---
name: specification
description: Create or update the durable behavioral contract for Standard or Large development before implementation planning.
---
# Specification

Create or update `docs/features/<slug>/spec.md` from `.agents/templates/feature-spec.md` when creating a new contract; update an existing feature contract in place rather than creating a competing spec.

Record objective, affected actors, in-scope behavior, exclusions, acceptance criteria, failure behavior, compatibility, data/security constraints, and verification expectations. For behavior-preserving refactors, state the contracts that must not change.

Resolve requirements from repository evidence before asking the user. Ask only when different answers materially change behavior, architecture, data handling, security, migration, cost, or verification. Keep progress/timing out of the spec and link consequential architecture decisions to ADRs.
