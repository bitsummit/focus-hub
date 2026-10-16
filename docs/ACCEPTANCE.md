# Acceptance evidence — local private v1

Validated 16 October 2026 against the actual Node 24 / SQLite runtime. All tests use fictional accounts and isolated temporary databases. This report concerns the local private implementation; it does not claim Sites deployment, hosted D1, ChatGPT identity, or cross-device hosting.

## Final gates

| Command / check | Result |
|---|---|
| `npm ci --cache /workspace/.npm-cache --no-audit --no-fund` | Frozen-lockfile installation passed |
| `npm test` | **9 passed**, 0 failed, 0 skipped |
| `npm run build` | TypeScript and Vite passed; production bundle generated |
| `npm run test:e2e` | **4 passed**, Chromium, 9.8 seconds |
| `npm run owner` | Fictional temporary owner created with masked terminal input; non-TTY stdin bootstrap also verified |
| `npm run demo` | Separate fictional persistent database and random local credentials created |
| `npm run smoke:demo` after stopping/restarting the server | Authentication, retained records and canonical journal references passed |
| Visual review, desktop 1440px and mobile 390px | Screenshots inspected, no JavaScript errors or page overflow observed |

## The 15 criteria

| # | Requirement | Evidence and result |
|---|---|---|
| 1 | Title + Enter, table, refresh persistence | **Passed.** Browser keyboard capture/reload/table/board; API and second SQLite connection retain the same record. Process restart smoke also retains the fictional demo. |
| 2 | Critical journal task, SRA and one canonical task | **Passed.** API exact `- [ ] !! Preparar presentación #SRA` verifies critical priority, project and one task/reference/event on retries. Browser creates project with name only, heading, note and critical task. |
| 3 | Journal ↔ board/table status | **Passed.** Browser changes canonical journal task through board/table to in_progress and pending_review; shared API state and journal reference use the same ID. |
| 4 | Waiting external and optional follow-up | **Passed.** Browser dialog saves waiting_external and follow-up date; API asserts retained status/date and optional waiting-on. |
| 5 | Completion, timestamp, audit, metrics and archive | **Passed.** API checks completed_at and completion event, metrics count and timestamp; browser completes and locates the task in Archive. |
| 6 | Reopening retains history, consistent metrics | **Passed.** API reopens/re-completes, verifies original completion retained and distinct per-period completion count. |
| 7 | Past journal, notes, headings, nesting and stable references | **Passed.** API saves an earlier day with heading/note/nested task, deduplicates retries and checks revision conflicts/removal without task loss. Browser creates notes/nesting. Two regressions prevent deleted parents and cross-section nesting. |
| 8 | Daily/weekly focus order and exact periods | **Passed.** API ordered daily/weekly selections and refetch; browser weekly focus survives reload. Completed previously selected tasks can stay in focus. |
| 9 | Strategic milestones independent of task counts | **Passed.** API marks milestone achieved while no task is completed. UI computes progress exclusively from milestone state. |
| 10 | Local calendar, UTC boundary and DST | **Passed.** Madrid/UTC boundary API fixture; calendar tests verify Monday/Sunday week starts and 23/25-hour DST days. |
| 11 | Historical archive filtering | **Passed.** API fixture includes September completion/event and verifies historical period. UI has text/project/status and date filters; browser finds completed journal task in Archive. Exact old-week timestamps are checked through API, not simulated as current achievements. |
| 12 | Full JSON and tasks CSV | **Passed.** Browser downloads and parses actual files, verifies task IDs and completion events. API checks all collections/relations/history plus deleted records; CSV formula prefixes are neutralized. |
| 13 | Server-side user isolation | **Passed.** Real A/B password sessions reject cross-tenant task mutation/events, projects/goals/milestones, blocks, focus and parent/project relations. Origin/CSRF/login/logout checked. |
| 14 | Smartphone, keyboard, accessible board fallback | **Passed.** Chromium 390×844 visits all seven routes, checks no root overflow and Tab focus; Enter capture and accessible state selectors work. Dialog focus trap/Escape and tab-accessible journal controls implemented. No claim of exhaustive screen-reader certification. |
| 15 | Real reproducible tests and build | **Passed.** 9 API/calendar tests + 4 Chromium cases and production build; no skipped tests or placeholder assertions. Commands and configuration are included in the repository source. |

## Additional regression evidence

The browser runs two independent authenticated tabs: a local description edit preserves a remote task status after refetch; a stale journal note edit is rejected with HTTP 409 and retains the other tab's saved content. Request payloads are kept stable for retries. Soft-deleted focus references do not consume invisible slots. Event history displays priority/project as recorded at completion, even after later edits.

## Team and integration

Three actual native agents were used, because `.codex/agents/` does not exist in the checkout:

- `platform_discovery`: runtime/documentation feasibility, then QA (`tests/`, Playwright configuration).
- `data_discovery`: relational/security discovery, then domain/calendar implementation, journal regressions and security/concurrency review.
- `ux_discovery`: UX/acceptance discovery, then all frontend sections and responsive styles.

The coordinator read the complete brief, consolidated architecture/contracts, owned schema/config/auth/HTTP/bootstrap/demo, integrated results, ran tests/build/smoke, inspected screenshots and saved reusable cloud instructions. File ownership prevented overlapping source edits. An early duplicate build interfered with one browser run; final browser validation ran against a single completed build. A real name-only project regression (empty icon) and concurrency/nesting regressions were fixed and retested.

## Remaining platform limits and optional scope

No tools/bindings or verified starter for Sites/D1/ChatGPT auth are present; official guide requests were rejected by the outbound proxy (CONNECT 403). The implemented fallback is private local React/TypeScript + Node + file-backed SQLite + real password/session auth. A hosted private URL, cross-device deployment, D1 adapter and platform identity remain a separately authorized deployment task. Nothing was published, pushed remotely, imported from real records or connected to Notion.

Bulk task actions and destructive data import are optional enhancements and are not included. JSON import preview is read-only and checks collection structure; a future importer must validate schema version, ownership and referential integrity before writing. SQLite is appropriate to this personal v1; large multi-user workloads need pagination and a separately verified hosting/storage adapter.

Reusable `install_script` and `start_skill` were saved in the cloud environment draft. That does not publish the app or prove restoration in a new task. To activate that environment configuration, review/save the draft in environment settings and publish the environment snapshot when desired.

## Delivery update: Codespaces

The Codespaces delivery was tested from a fresh GitHub clone: 11 API/calendar/security tests and 4 Chromium workflows passed, as did the frozen installation and production build. Lifecycle scripts were exercised on port 3000 (including exact HTTPS-origin simulation), repeated setup preserved the database/credentials, and a foreign occupied port was rejected without receiving demo credentials. See DELIVERY.md and CODESPACES.md for the distinction between verified commands and the pending first real Codespace launch.
