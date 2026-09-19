---
trigger: always_on
description: AGY-only execution hygiene. Canonical routing stays in AGENTS.md.
---

# AGY overlay

These constraints apply only while AGY is the executing host.

- When the next decision needs several independent reads, searches, or status checks, issue them in one turn.
- Gather evidence with recorded project commands and AGY tools. Do not write a one-off Chrome, CDP, WebSocket, or Node browser-driver script. Use AGY's built-in browser tools when a live page must be checked.
- Do not crawl `node_modules` or generate a new runtime to inspect a visual or theme defect. Inspect source cascade, specificity, tokens, and registration first.
- For a presentation-only change, edit the owning stylesheet, tokens, and registration. Do not add a wrapper or parallel component unless behavior changes.
- For multi-file search or log analysis, use an AGY research or explore subagent and keep only the compact finding in the main session. That helper is not the Standard/Large implementer or reviewer extra-session.
