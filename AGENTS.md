# Focus. — Codex repository instructions

## Source of truth
- Read `FOCUS_HUB_CODEX_MASTER_PROMPT.md` completely before proposing architecture or implementation. It defines product scope, UX, security, data model, phases and 15 acceptance tests. It wins over a convenience plan if they conflict. Its historical product naming does not override the approved identity in `docs/BRAND_IDENTITY.md`.
- Read `CODEX_START_HERE.md` for the initial brief. Keep Spanish as the default UI language and support the user-selected Spanish/English interface through src/i18n.ts and src/locales/en.json. Never translate user content or persisted identifiers; keep code identifiers in English/TypeScript.
- Build a full-stack working personal productivity app with a single canonical task record across journal, board, table, focus, archive and analytics. This must be a functional v1, not a static mockup or a cut-down checklist app.

## Multi-agent orchestration
- Project role definitions are registered in `.codex/config.toml` and stored in `.codex/agents/`: `frontend`, `backend`, `qa` and read-only `security`. See `.codex/agents/README.md` for responsibilities and runtime compatibility. If custom-role loading is unavailable, read and pass the relevant profile to a native subagent and report that limitation; never claim automatic activation.
- The primary agent is **coordinator/integrator** and owns architecture, shared schema, interfaces, versioned dependencies, integration and final verification.
- Prefer delegating independent, bounded work to actual Codex subagents. Use `frontend`, `backend` and `qa` when those defined custom agents are available, or built-in subagents as appropriate. Explicitly launch subagents, wait for results and summarize them; do not merely pretend to be multiple agents.
- During Phase 0 spawn up to 3 read-only discovery subagents concurrently for platform/runtime feasibility, data/security architecture and UX/acceptance coverage. Merge findings before choosing architecture.
- Before concurrent code edits, agree on DB schema, domain types, API contracts and file ownership. Assign each subagent nonoverlapping modules. No concurrent edits to migrations, shared types, package manifests, auth policy or project-wide configs; the coordinator owns these or serializes changes.
- Every delegation should specify objective, files/modules owned, inputs/contracts, acceptance tests and expected report. Use separate worktrees/branches when appropriate for parallel writes, and merge after review.
- If a task is dependent or tiny, do it sequentially. More agents are not an end in themselves. Subagents cost extra tokens.
- At each phase gate the coordinator runs tests, reviews diffs, ensures single source of truth, documents changes and unresolved issues and checks relevant acceptance tests.
- Report **actual** agents used, tests run and outcomes; never represent intended delegation as work performed.

## Security and engineering limits
- Verify current official Sites/D1/auth deployment capabilities before depending on them. If unsupported, report a blocker and compatible fallback rather than simulating persistence or inventing platform support.
- Persist data durably through a typed repository/service boundary; never make `localStorage` the source of truth. Enforce workspace/user isolation on the server, prepared queries, secret hygiene, and auditable task events.
- Do not connect Notion, import private/professional records, publish publicly, push remotely or spend money without the owner's explicit approval.
- Keep the implementation portable and use only fictional test data. Preserve the 15 acceptance tests and run nontrivial tests/builds with real evidence.

## Brand consistency

- `docs/BRAND_IDENTITY.md` is the authoritative reference for brand identity.
- All product branding must use the shared brand component and centralized design tokens.
- Do not recreate, approximate or independently style the logo in individual pages.
- Any change affecting the visual identity must update the brand documentation in the same Pull Request.
- Visible product naming must remain consistent across Spanish and English interfaces.
- Historical specifications may preserve former product names, but current application documentation and UI must use the approved identity.
- Keep technical identifiers (`focus-hub`, database paths, environment variables, API routes and authentication cookies) stable; rebranding does not authorize data or identifier migrations.
