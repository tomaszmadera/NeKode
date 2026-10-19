# Review loop roles for NeKode

This file describes who does what in the maintainer's review loop: one work
item, usually one PR, independent review against written rules, at most three
passes, and a final decision by the owner. The rules themselves live in
[rules](rules.md).

The loop is the maintainer's own process. External contributions follow
[CONTRIBUTING](../CONTRIBUTING.md) and the
[branching model](../docs/operations/branching-model.md); contributors do not
need these bots, a Plane instance, or any particular agent.

## Roles

| Role | Who | Does | Never does |
|---|---|---|---|
| Owner | Tomasz (maintainer) | Writes or approves the brief and acceptance rules, decides escalations and disputes, merges PRs, accepts or cancels work items, approves commands on his Windows computer | Not applicable |
| Doer | Code Manager bot | Picks up the item, writes the brief for the coding agent, opens the PR, waits for CI, hands the pass to the reviewer, fixes only items with a FAIL verdict | Changes rules, reviews its own work, merges, releases, deploys, publishes |
| Reviewer | Code Reviewer bot | Checks every rule against the PR, diff, and CI result, posts one verdict comment per pass, counts passes, escalates | Changes code, tests, rules, or any repository file; reports a finding outside the rules as a FAIL |
| Coding agent | Claude Code or Codex on the owner's Windows computer, started by the doer | Implements the brief in a working branch | Works without a brief, runs past the stop conditions |

The bots share one computer and one set of command-line credentials. The
reviewer's independence comes from this role description and from the commit
history, not from separate access rights. Any repository commit by the reviewer
is a loop failure.

## Plane states

The loop uses these states in the NeKode Plane project:

| State | Plane group | Meaning |
|---|---|---|
| Backlog | backlog | Item exists, rules not yet approved |
| Todo | unstarted | Owner approved the brief and rules; ready for the doer |
| In Progress | started | Doer and coding agent are working on pass N |
| In Review | started | CI finished and the reviewer has the handoff for pass N |
| Needs Tomasz | started | All rules pass, or the loop escalated; waiting for the owner |
| Done | completed | Owner merged the PR and accepted the item |
| Cancelled | cancelled | Owner cancelled the item |

Who may move an item:

| Transition | Who | When |
|---|---|---|
| Backlog to Todo | Owner | Brief and acceptance rules approved |
| Todo to In Progress | Doer | Doer picks up the item; pass 1 starts |
| In Progress to In Review | Doer | PR is open, CI has finished, and the handoff is sent |
| In Review to In Progress | Reviewer | At least one FAIL and pass N is below 3; pass N+1 starts |
| In Review to Needs Tomasz | Reviewer | All rules PASS, or a FAIL remains after pass 3, or an early escalation |
| In Progress to Needs Tomasz | Doer | Early escalation only (see below), with a comment saying why |
| Needs Tomasz to Done | Owner | PR merged |
| Needs Tomasz to Todo | Owner | New brief or rules; the pass counter starts again at 1 |
| Any state to Cancelled | Owner | Item dropped |

Bots may change these states and post comments in Plane themselves. Neither bot
moves an item to Backlog, Todo, Done, or Cancelled, and neither bot edits the
brief or the acceptance rules of an item.

## One pass

1. The doer writes a short brief for the coding agent from the work item and
   the rules. Every brief contains the stop conditions below.
2. The coding agent implements the change in a working branch named after the
   [branching model](../docs/operations/branching-model.md), for example
   `nekode-<n>-<short-description>`, and the doer opens a PR that references
   the work item.
3. The doer waits for the `verify` check to finish, then sends the reviewer one
   message with the PR link, the Plane work item, the CI result, and the pass
   number. For a change under `adapters/plane`, the message also carries the
   `pnpm run test:adapters` log.
4. The reviewer posts one verdict comment on the work item in the format from
   [rules](rules.md#verdict-format) and moves the item.
5. On a FAIL, the doer asks the coding agent to fix only the failed rules.

Stop conditions in every brief:

- At most 3 passes for the item.
- Build, do not launch: no starting the app, no screenshot loops.
- One verification command per pass.
- On any ambiguity, stop and ask instead of guessing.

## Limits and escalation

- A pass is one full round: change from the doer and coding agent, CI, and a
  complete set of reviewer verdicts. Passes count from 1; pass 3 is the last.
- After pass 3 with at least one FAIL, the reviewer moves the item to
  Needs Tomasz and escalates. The doer stops work on the item.
- Escalation happens before the limit when a rule cannot be decided or
  contradicts another rule, when a check needs a command on the owner's
  computer that he has not approved, when the doer considers a verdict wrong,
  or when the coding agent stops on an ambiguity the brief does not resolve.
- An escalation is a comment on the Plane work item plus a short direct message
  to the owner:

```text
Escalation · NEKODE-<n> · after 3/3 passes
Still FAIL: R2 (no test for the fix in <file>)
Attempts: 1) fix without a test; 2) test added but passes without the fix; 3) test removed in a refactor
Recommendation: take over manually / change scope / reject
The decision is yours.
```

## Decisions reserved for the owner

- Merging any PR. When branch protection on `main` is enabled, it requires the
  `verify` check.
- Moving an item to Done or Cancelled, or back to Todo with a new brief.
- Changing [rules](rules.md) or this file.
- Pushing to `main`, tagging, releasing, publishing, and deploying, as in the
  [project contract](../docs/development/project-contract.md#authorization-and-publication).
- Approving commands on his Windows computer, one at a time.

## Where state lives

- Repository: [rules](rules.md), this file, and the tests.
- Plane: one work item per unit of work, its state, and one reviewer comment
  per pass with the verdicts and pass number.
- GitHub: the PR, the check history, and the owner's merge.
- Not in bot memory and not in local files on the bots' computer.

Plane access credentials stay out of the repository, logs, and command lines.
The [Plane adapter guide](../adapters/plane/README.md#secret-handling) describes
how the adapter receives them.
