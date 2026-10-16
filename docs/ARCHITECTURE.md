# Focus Hub — implementation plan

## Platform evidence and decision

Phase 0 used three actual native subagents: platform_discovery, data_discovery and ux_discovery. The repository has no `.codex/agents/` profiles. The available runtime has no Sites/D1/deployment/auth tools or bindings. Official documentation attempts to OpenAI Sites and Cloudflare D1 were rejected by the outbound proxy (CONNECT 403); this does not establish that Sites itself is unavailable globally. No verified Sites starter/auth contract can be chosen here.

Compatible private alternative: React/TypeScript/Vite, Node 24, SQLite file storage and real password/session authentication. No external account, paid integration, Notion or publication. Listen on loopback. SQL uses a portable relational schema; a future D1 adapter must implement transaction/batch semantics and a verified identity provider before deployment. Local SQLite is not claimed to be hosted D1.

## Contracts and ownership

Coordinator owns migrations, shared/contracts.ts, package/configuration, auth, HTTP routes and integration. Backend agent owns server/domain.ts and server/calendar.ts. Frontend agent owns src/. QA agent owns tests/ and playwright.config.ts. No overlapping writes.

Authenticated GET /api/state returns Snapshot (snake_case domain rows). Every mutation is server scoped to the session workspace; no caller supplied user/workspace establishes authority. UI refetches canonical state after writes, on focus and periodically. Errors: {message,code}. POST /api/session {email,password}; GET returns Session with csrfToken; DELETE revokes. All authenticated mutations require X-CSRF-Token and same-origin requests.

Tasks POST {text,request_id,project_id?,parent_task_id?,journal_date?,indent_level?}; PATCH /:id accepts editable fields; DELETE soft-deletes. CRUD /api/projects, /api/goals, /api/milestones. POST /api/journals/:date/blocks {text,request_id,revision,indent_level?,task_id?}; PATCH/DELETE /api/blocks/:id includes revision; entries and references retain stable IDs. PUT /api/focus/:type/:date {task_ids:string[]} preserves ordered period selections. PATCH /api/preferences. GET /api/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD (exclusive local end). GET /api/export?format=json|csv.

All mutations respond with refreshed Snapshot (except login/logout). Task events are append-only; capture+event+journal reference and focus replacement are transactions. Request IDs deduplicate retries. Journal revisions reject stale changes. Real UTC events; local dates and DST boundaries via Temporal. Completed metrics count distinct task IDs within the period, including historical events after reopening. The same task can count in separate periods if re-completed. Strategic progress comes only from achieved milestones. CSV formula characters are neutralized.

## Phases and gates

0. Discovery and contracts (complete).
1. Auth, migration and durable task/project API: build/type check, persistent-file restart and tenant isolation tests.
2. Transactional journal: parser/idempotency/revisions, two-way task references and subtasks tests.
3. Board/table/projects/goals/focus: API validation and browser workflows.
4. Dashboard/archive/analytics/export: timezone/DST/history/export assertions.
5. Integration: all tests/build, real browser desktop/mobile/keyboard checks and 15-criterion release matrix.

Backend and frontend implementation proceed independently against these contracts; QA creates tests concurrently. Each gate is verified after integration before claiming completion.

## Risks

- Hosted Sites/D1/private URL cannot be delivered or verified in this runtime; only local private execution is validated.
- Password authentication requires an explicit local owner bootstrap; no default password or public registration.
- SQLite adapter is synchronous and intended for a personal v1; D1 and multi-node hosting need a separately validated adapter.
- Multi-tab edits: journal revision conflicts protect content; other edits are server-serialized, last accepted write wins.
- Processes do not survive environment snapshots; saved startup instructions must restart the server.

## Integration review

Backend/auth foundation passed real HTTP and file persistence checks. A follow-up review corrected journal nesting across headings/deleted parents and added two regressions (9 API/calendar tests passed). Owner CLI bootstrap was tested both interactively with masked input and by stdin using temporary fictional databases. Frozen-lockfile installation repeated successfully with `npm ci --cache /workspace/.npm-cache`. No credentials were committed or printed. Frontend concurrency findings were corrected and verified with two-tab Chromium regressions. Final gates: 9 API/calendar tests and 4 browser cases passed; production build passed. The retained fictional demo was stopped, restarted and verified again with real authentication. See ACCEPTANCE.md for the complete evidence and limits.
