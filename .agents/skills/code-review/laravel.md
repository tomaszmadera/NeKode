# Laravel review criteria

Apply these criteria only when the named diff shows Laravel. Load `php.md` as well when PHP also matches. Output language, severity, file writing, and praise rules stay in `SKILL.md`.

## Security

- CSRF on forms/web UI; do not mix web and API mechanisms without reason.
- Uploads: validate `mimes`/`max` and store via `Storage` without path traversal.
- Queries must not return other users' or tenants' data (scope, policy, explicit conditions).
- Mass assignment: `create`/`update`/`fill` must not overwrite guarded fields.
- `whereRaw` / `DB::raw` with concatenation is a defect; bind parameters.

## HTTP and domain

- New endpoints have the project's auth, `can`, and throttle middleware.
- Validation belongs in `FormRequest` (`rules()` and `authorize()`), not ad hoc in the controller, when that is the project convention.
- Authorize the bound model instance, not only the model type.
- Blade: `{{ }}` by default; `{!! !!}` only for trusted HTML.

## Queue, cache, migrations

- Heavy work is `ShouldQueue` with sensible retry and idempotency.
- Cache keys account for tenant/user.
- Multi-step writes use `DB::transaction`.
- Migrations on large tables must not take unexplained long locks.

## Tests

- Critical endpoints have Feature tests, including authorization.
- Jobs, mail, and storage use the matching fakes when the project already tests that way.
