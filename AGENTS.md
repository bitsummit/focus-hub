# Focus. — Engineering instructions

## Living authorities

Read this file before editing. Use the relevant reference for the assigned scope:

| Responsibility | Authority |
|---|---|
| Introduction and entry point | [README](README.md) |
| Implemented behavior, business rules and acceptance invariants | [Product](docs/PRODUCT.md) |
| Modules, contracts, persistence and runtimes | [Architecture](docs/ARCHITECTURE.md) |
| Visual identity and shared brand resources | [Brand](docs/BRAND_IDENTITY.md) |
| Running, updating, credentials and recovery | [Operations](docs/OPERATIONS.md) |
| Controls, trust boundaries and open risks | [Security](docs/SECURITY.md) |

Current owner instructions take precedence. Historical prompts are not active
specifications and never override approved living documentation. Code and tests
are evidence: investigate and resolve discrepancies rather than assuming either
code or prose is correct. Do not claim future capabilities as implemented.

## Engineering and data safety

- Preserve the current React/TypeScript/Vite + Node/Express/PostgreSQL architecture
  unless a migration is explicitly authorized. Avoid broad refactors unrelated
  to the request; preserve working features, relationships, dates and history.
- One canonical task record across journal, table, Kanban, focus, archive and
  analytics. Server state is authoritative; localStorage is presentation only.
- Enforce user/workspace scope, validated relationships and prepared SQL on the
  server. Keep canonical changes, events, references and idempotency atomic.
- Never weaken auth, CSRF, origin, cookie or Vite file boundaries to pass a test.
  Follow [Security](docs/SECURITY.md) for controls and unresolved assumptions.
- Use isolated fictional fixtures. Never use personal or demo owner databases,
  sessions, credentials or backups as fixtures, overwrite them, or print secrets.
  Inspect environment variable names/status, not values. Do not commit private data.
- No Notion connection, real-data import, public deployment, port visibility
  change, paid resource or remote push without owner authorization covering it.
  Configuration files do not grant authorization.
- Spanish is the default UI language; preserve Spanish/English via `src/i18n.ts`
  and `src/locales/en.json`. Never translate user content or persisted identifiers.
- Preserve accessible labels, keyboard/focus behavior, touch controls, responsive
  layouts, light/dark/system themes and reduced-motion preferences.
- Use meaningful existing unit/integration tests and real browser verification
  appropriate to the change. Never skip or weaken assertions to manufacture success.

## Proportional delegation

Use actual subagents only when independent work benefits from them. Small or
coupled changes can be sequential; no mandatory discovery team or agent count.
The coordinator defines contracts and owns integration, final verification and
shared changes to auth policy, migrations, types, dependencies and configuration.
Assign exclusive file ownership before concurrent edits; serialize shared changes.
Specify objective, owned files, contracts, checks and expected findings per task.

The functional profiles in [`.codex/config.toml`](.codex/config.toml) register:

| Role | Assignment boundary |
|---|---|
| `frontend` | Assigned React, CSS, translations and accessibility |
| `backend` | Assigned domain, SQL and API behavior within agreed contracts |
| `qa` | Isolated tests and evidence; no application edits without reassignment |
| `security` | Read-only review; proposes evidenced remediation |

Profiles inherit the runtime's model and permissions; security requests read-only
access. Compatible trusted-repository clients may need a new session to load them.
Committing TOML does not install Codex in Codespaces or automatically activate agents.
If custom-role selection is unavailable, read the relevant profile and pass its
instructions to a native subagent, respecting its limits. Report actual roles,
agents, work and limitations; never imply a profile was automatically loaded.
[Codex configuration format](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json).

Do not run competing browser suites on port 4173 or rebuild `dist` while a browser
suite uses it. Never stop an unrelated server. Review agents' changes and evidence
before integrating; distinguish passed, failed, skipped and unexecuted checks.

## Git policy

- Only `main` and `dev/focus-hub-v1.1-ux-readiness` are permanent remote branches.
- Work directly on the existing permanent development branch. Do not create task,
  feature or agent branches, extra worktrees, or rename dev to another identifier.
- Commit/push routine work there when authorized; no per-task Pull Request.
- `main` is stable. Occasional development-to-main reviews are useful; merging
  requires explicit owner approval. Never force push or rewrite published history.
- Inspect status before changes; preserve local work. Never discard edits, reset
  databases or remove a branch before verifying its commits are preserved.
- See [Operations](docs/OPERATIONS.md) for executable update/recovery procedures.

## Brand consistency

[Brand identity](docs/BRAND_IDENTITY.md) is the sole visual authority. Use shared
`BrandLogo`, centralized tokens and the official resources; do not recreate the
logo per page. Visible name **Focus.** and motto **Quiet the noise. Find clarity.**
are language-independent. Keep technical identifiers (`focus-hub`, DB paths,
cookies, routes and environment variables) stable. Update brand documentation
with any identity change in the same change, without unauthorized data migrations.

## Documentation governance

**Documentation is part of implementation, not an additional deliverable.**

- Maintain one authoritative source per concept. Describe the current system,
  not the chronology of tasks that created it; link instead of duplicating.
- Update existing authorities whenever practical. A new document needs a distinct,
  enduring responsibility; no arbitrary length limits, but remove maintenance noise.
- Do not commit task-specific implementation reports, delivery diaries, test logs
  or validation summaries. Report execution results in the task response or review.
- Keep operating commands executable and current. Update affected product,
  architecture, security, operations or brand documentation in the same change.
- Preserve important decisions, requirements, security constraints and recovery
  instructions, not every experiment. Git history preserves superseded documents.
- Keep documentation concise, accurate, actionable, navigable and explicit about
  limitations. No historical prompt outranks current approved references.

## Definition of done

Review the complete diff and references; only intended files and no private data
may change. Preserve product acceptance invariants and run relevant checks, normally
`npm run build` and `npm test` for implementation work, plus applicable Chromium
E2E tests. Use fictional temporary databases; restore any test-owned resources.
Update the appropriate living references. Report what changed, actual checks and
outcomes, unresolved gaps and material risks; no readiness claim based only on a
passing local build. Deliver using the authorized Git workflow without merging main.
