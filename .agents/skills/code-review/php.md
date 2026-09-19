# PHP review criteria

Apply these criteria only when the named diff includes PHP sources or PHP package manifests. Output language, severity, file writing, and praise rules stay in `SKILL.md`.

## Security

- SQL: prepared statements or query builder; no string concatenation in SQL.
- User input: untrusted; validate and type it.
- XSS: escaped output; templates with auto-escape where the stack provides it.
- Authorization: new endpoints and actions check permissions; no cross-user data leaks.
- Secrets: no hardcoded secrets; passwords only via `password_hash` / `password_verify`.

## Quality

- Prefer argument and return type hints on new logic.
- No empty `catch`. Log errors without exposing stack traces externally.
- Prefer injection over `new` in domain logic when the project already uses it.

## Tests

- New calculations and business rules have tests, or a comment that says why not.
- Do not break existing interfaces or API contracts without versioning or documentation.
