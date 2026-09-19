# Canonical skills

Canonical reusable procedures live in `.agents/skills/<name>/SKILL.md`.

Each skill uses portable YAML frontmatter with at least:

```yaml
---
name: skill-name
description: Precise discovery description that says when the procedure is relevant and, when useful, when it is not.
---
```

The description is discovery metadata. The body owns execution after activation. Keep supporting knowledge under the owning skill's `references/` directory when it is not needed for every activation.
