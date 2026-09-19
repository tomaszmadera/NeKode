# <feature name>

This file is the behavioral contract for a feature. Agents implement from it. Do not put execution progress, file checklists, or architecture history here.

Path: `docs/features/<slug>/spec.md`. Use a short kebab-case slug, not a task id, unless that id is also the durable feature name.

## Goal

State the outcome and who it is for.

## Related requirements

Link product requirements, issues, or none.

## Scope

What this feature includes.

## Non-goals

What this feature excludes.

## Behaviour

Rules the implementation must preserve. Include user-visible flows when they exist.

## Business rules

Domain constraints that tests must cover.

## Authorization

Who may do what. Use `none` when the feature has no access control.

## Data / API

Inputs, outputs, persistence, and public contracts.

## Edge cases

## Errors

Expected failure behavior. No silent fallback unless this spec requires it.

## Acceptance criteria

Checkable outcomes. An implementer must be able to tell pass from fail without guessing.

## Required tests

Behavior and regression coverage this feature needs.

## Relevant SDD / ADR

Link architecture sources, or `none`.
