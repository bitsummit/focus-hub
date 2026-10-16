# FOCUS HUB — Master implementation brief for Codex

**Project:** Focus Hub  
**Version:** Product specification 1.0 — 15 October 2026  
**Language:** Spanish in the user-facing application; TypeScript/English for source code, identifiers and technical documentation.  
**Objective:** Build a genuinely working, attractive, responsive personal productivity application, ready for future multi-user use, with **no paid Notion dependency**.

---

## 0. Instructions for Codex (read before coding)

You are acting as the product engineer, technical architect, designer and QA lead for Focus Hub. **Implement a functioning full-stack app; do not stop after a static mockup or an architecture memo.** The outcome should be demonstrably usable with durable data, a journal, priorities, Kanban, project views, historical activity and accurate analytics.

1. Read this brief entirely. Inspect the project/environment and the current, official ChatGPT Sites development guide before choosing framework, deployment and D1 integration details.
2. Start with a concise architecture plan, risk register and phased execution checklist in the repository. Then implement each phase, validating it before moving to the next.
3. Prefer the current Sites-supported starter/framework. Use **TypeScript + React** for the UI if compatible with the current Sites runtime. Use Tailwind CSS and accessible, composable UI components if supported. Do not force Next.js, a native Node server, Prisma or any other framework that the Sites runtime cannot deploy.
4. Use **ChatGPT Sites D1** (SQLite-compatible relational storage) for persistent application data, with migration scripts, prepared/parameterized queries and an explicit repository abstraction. Do **not** use localStorage as the source of truth for tasks, projects or journals.
5. Use platform-supported authentication, including **Sign in with ChatGPT** where appropriate and supported. First deployment must be private/owner-only. Build the data model and access layer to support distinct users and workspaces in the future.
6. Do not require a paid Notion plan, Supabase subscription, AI API key or other paid integration for core functionality. No Notion connection is required in v1.
7. If the selected environment lacks a critical capability (durable D1 writes, supported server-side authentication, or functional endpoints), **explicitly report the blocker and offer a compatible alternative**. Never silently substitute demo data, browser-only persistence, fake authentication or unsecured APIs.
8. Maintain working source in a Git repository; create `README.md`, `AGENTS.md`, migration scripts, tests, `.env.example` if applicable, and clear deployment instructions. Keep credentials out of source control.
9. Use fictional/anonymized demo data only. Do not import existing Notion records or real professional content without explicit authorization. Do not publish publicly or expose work information.
10. Keep the app structurally portable. Avoid business logic tightly coupled to the hosting provider; use storage interfaces so a future migration to another SQLite host or PostgreSQL/Supabase is feasible.
11. Implement the **complete functional v1** below, even if it requires several iterations. Phasing is for quality, not for replacing the product with a minimalist to-do list.
12. End with working preview/deployment instructions, evidence of tests, known limitations, and a concise list of any missing acceptance criteria. Save a version for review; do not publish to the public until explicitly instructed.

## 0A. Multi-agent execution protocol (Codex)

Use **Codex subagents**, not only sequential role-playing. The primary Codex session is the coordinator and remains accountable for architectural consistency, shared contracts, integration, and the 15 acceptance tests. Follow the project `AGENTS.md` and `.codex/agents/*.toml` instructions. The current Codex runtime should have subagents enabled; if unavailable, explicitly say so and proceed with one agent rather than claiming delegation occurred.

1. **Phase 0: parallel discovery, no edits.** Spawn up to three focused subagents concurrently: (a) supported Sites/runtime/auth/D1/deployment feasibility, verified against official documentation; (b) relational domain model, data access, tenant isolation and integrity risks; (c) interaction design, feature coverage and acceptance-test plan. Wait for all results and produce a consolidated architecture plan, risk register, dependency map, contracts and work ownership plan.
2. **Set contracts before implementation.** The coordinator owns cross-cutting interfaces: shared types, DB schema/migrations, auth contract, API contracts, dependency versions and repository configuration. Do not parallelize writes to these files. Resolve critical platform blockers before writing dependent features; never fake unsupported persistence/authentication.
3. **Parallel implementation only for independent, bounded tasks.** Delegate frontend screens/components, backend services/endpoints and QA/tests to specialized subagents after agreeing on contracts. Give each subagent a file/module ownership boundary, clear acceptance criteria and expected output. Avoid shared-file edits, overlapping branches and simultaneous migrations. Where feasible use distinct Git worktrees/branches and integrate through reviewed diffs; otherwise serialize conflicting work.
4. **Phase gates.** Before each phase, list parallelizable tasks, dependencies, owner and verification. At the end, collect every subagent's findings; integrate, build, test, fix regressions and report evidence before advancing. Parallelism is a means, not a requirement for every task.
5. **Safety and quality.** Preserve all v1 requirements, the canonical single-source-of-truth task model and the 15 acceptance tests. Use only fictional development data. Keep preview private; do not push to remotes, expose secrets, publish or import real professional data without explicit authorization.
6. **Visibility.** In status reports include which actual subagents were launched, each assigned responsibility, changed files, test evidence, conflicts resolved and remaining blockers. Do not present a proposed team as an executed team.

## 1. Product vision and non-negotiable principles

**Tagline:** _Dedica tu tiempo a avanzar en tus proyectos, no a gestionar tu gestor de tareas._

The user is a busy project manager with many concurrent workstreams. Their established habit is to open a **daily work journal** and add single-line checkbox tasks under natural-language headings, sometimes with nested tasks. They formerly duplicated weekly journal entries to preserve a historical record of completed items. That historical motivation must be retained, but duplication eliminated through a proper event log and searchable archive.

**Principles:**
- Capture a task with **one line + Enter**. Title must be the only required field.
- Priority must be expressible with a lightweight prefix, e.g. `!` high and `!!` critical; default is normal. Also editable from cards/tables.
- Project can be inferred from the active journal heading or the `#project` shorthand; otherwise it can remain in an inbox without forcing a decision.
- The journal, focus dashboard, Kanban, table, project pages, archive and analytics must use **the same canonical task record**.
- Distinguish task status from priority, and distinguish doing, waiting on someone, pending third-party review, and blocked.
- A completed task remains accessible forever (unless the user explicitly deletes it), including verified timestamps and a history of state transitions.
- Reward meaningful progress without shaming users for growing backlogs. Show completed items, achievements, strategic milestones and the difference between newly created and completed items.
- Strategic goals sit above projects; they do not have to be manually assigned to every tiny task.
- Cross-device persistence and usable layouts on smartphone, tablet and desktop are essential.
- Privacy and portable data first; no paid Notion or Trello requirement.

## 2. Functional scope of complete v1

### A. Mi espacio de trabajo — landing dashboard

Layout with generous typography, restrained visual hierarchy and uncluttered panels:
- **Mi foco de la semana:** manually selected 3–5 weekly focus tasks, sortable, with status, priority, and project. Can choose from all open tasks; not implicitly identical to “all high priority tasks”.
- **Hoy:** manually selected up to 3 daily priorities, with one-click completion/status change.
- **Objetivos estratégicos:** top 2–4 active quarterly goals, each with objective statement and milestone progress. Do not equate task-count completion with strategic progress.
- **Proyectos activos:** cards with name, optional strategic goal, open tasks, in-progress tasks, waiting/review tasks and next meaningful milestone.
- **Mis avances:** weekly metrics showing completed, created, net backlog change, pending follow-up and recently accomplished milestones. Provide access to detailed analytics.
- **Captura rápida:** persistent keyboard-friendly single-line task input, directly accessible in desktop header and via a fixed mobile action.
- Easily switch time period (current week, previous week), without losing historical focus choices.

### B. Tareas — Kanban + table

Two synchronized views with shared filters and search:
- **Kanban board** grouped by workflow status; drag/drop between columns on desktop and an accessible status selector as a robust mobile fallback.
- **Table view** with sortable columns (task, priority, project, status, updated, due date optional, waiting-on optional), filters by project/priority/status and text search. Inline editing for key fields. Multi-select/bulk actions are desirable if feasible.
- Statuses in canonical order: `pending`, `in_progress`, `pending_review`, `waiting_external`, `blocked`, `completed`, `cancelled`. Hide completed/cancelled from the default active board but make them accessible in Archive and in an optional board filter.
- Priorities: `low`, `normal`, `high`, `critical` (and any mapped UI symbols; `!` -> high, `!!` -> critical). Default normal.
- Optional task fields: description, project, due date, waiting-on, follow-up date, parent task, tags. No optional field must block capture.
- When task is `pending_review` or `waiting_external`, optionally capture who/what we are awaiting, with a follow-up date; don't require these fields.
- A task can be reopened; historical completion events must not disappear.
- Deleting requires a deliberate confirmation or a reversible soft-delete; cancelling is not the same as completing.
- Support at least one level of subtask nesting.

### C. Proyectos

- List/card and table views of active/archived projects.
- Project detail: objective, linked strategic goal (optional), milestones, task counts by status, prioritized backlog, recent completed items and relevant journal entries.
- Project color/icon, active/on-hold/archived state, optional target date.
- Allow project creation with name only; all other attributes optional.

### D. Diario — the central capture experience

- Daily journal entries, keyed to the signed-in user and a **local calendar date** based on user's selected IANA timezone (default `Europe/Madrid`, editable). Navigation by day, search and archive.
- Editor supports simple headings, free-form notes, bullet lines, inline task lines and lightweight indentation/subtasks. Avoid requiring a complex properties form.
- Typing a task line such as `- [ ] !! Preparar presentación #SRA` followed by Enter creates one canonical task, records its priority/project association, and embeds a **task reference** in the journal entry. A heading such as `# CESDA` can establish default project context if it matches an existing project.
- Ordinary notes remain text; not every bullet should automatically become a task. There must be a clear task syntax or deliberate command/action.
- Completing/editing a task from Journal updates the same task shown in Kanban and elsewhere. Completing from Kanban updates the journal reference immediately on next synchronization/refetch.
- Avoid duplicates: each journal task block carries the persisted task ID. Re-rendering, saving and re-opening a journal entry must never create another task. Multiple references to one task are allowed but never clone the task.
- Journal version/content changes must not corrupt canonical tasks. A removal of a task mention does not silently delete the task.
- For tasks captured outside a journal, let users optionally link them to that day's entry.
- Journal should be an attractive, distraction-free writing experience, not a spreadsheet masquerading as a diary.

### E. Mis avances — progress/analytics

- Weekly and monthly completed and created tasks; trend over time (simple charts, no excessive gamification).
- Net backlog change with clear labels: `completed - created` and ending-open-backlog, distinguishing genuine newly added vs reopened where appropriate.
- Workload distribution by state, project and priority.
- Chronological list of **logros**: actual completed tasks and milestones, filterable by period/project; a weekly recap based on verified records, not invented AI summaries.
- Strategic goals progress computed from explicit milestone state, not from number of associated tasks.
- For imported legacy tasks with unknown completion time, show an explicit “date unknown/imported” indicator and do not fabricate historical metrics.
- Use local timezone day/week boundaries (Monday-start weeks by default); store absolute UTC event timestamps.

### F. Archivo / histórico

- Persistent search/filter on historical tasks, completed milestones and journal entries.
- Display exact completion timestamp when known, project, priority at completion (or event history), and task state history.
- Archived projects never erase their historical tasks.
- A “week in review” view can reconstruct what was finished during that week, without copying a daily/weekly list.

### G. Configuración y portabilidad

- User display preferences including timezone, theme (light/dark/system), preferred table/Kanban view and week start.
- Full-fidelity **JSON export** covering projects, goals, milestones, tasks, task events, journal entries/blocks, daily/weekly focus selections, and timestamps. CSV export of tasks as well.
- Exports must be initiated by the user and downloaded as ordinary files. Validate that exported data can in principle be imported into a future version; document schema version.
- Read-only import preview/validation is desirable; destructive import or Notion sync not required for first release.
- Basic data-deletion controls with confirmations; no silent loss.

## 3. Interaction design and visual direction

**Design language:** calm, credible, modern productivity tool; references: Linear's discipline, Notion's reading comfort, Trello's board clarity. Avoid copies of logos or brand elements. No overwhelming gradients or gamified confetti everywhere.

- Palette: warm white / soft slate neutral surfaces, desaturated blue/teal accent; subtle warm amber for priority; red only for critical or blocked. Dark theme supported.
- Typography: strong hierarchy, readable dense tables; small uppercase labels only sparingly.
- Card layout: quiet backgrounds, soft 8–12px rounded corners, fine borders, generous space; consistent iconography.
- Dashboard: focus and strategic outcomes ABOVE task statistics; project section below, statistics and achievements clearly visible.
- Desktop: left sidebar navigation `Inicio / Tareas / Proyectos / Diario / Mis avances / Archivo / Ajustes`; quick-capture bar always visible.
- Mobile: bottom navigation for common sections, prominent quick-add action, scrollable board or status list; controls comfortably tappable; no tiny columns that force pinch-zoom.
- Keyboard: Enter to capture, Esc to dismiss, focused inputs, intuitive tab behavior and accessible labels.
- Interface entirely in Spanish initially; structure strings so English localization is easy later.
- Status labels: `Pendiente`, `En curso`, `Pendiente de revisión`, `En espera de terceros`, `Bloqueada`, `Completada`, `Cancelada`.
- Priority labels: `Baja`, `Normal`, `Alta`, `Crítica`. Show discreet badges/icons, not loud color everywhere.
- Empty states should encourage first capture and first weekly focus selection; never pretend there are real achievements when there aren't.
- Use demo seed data only in **development/preview**, clearly labeled. Do not ship fictional records in the signed-in user's real account.

## 4. Relational data model — logical schema

Use proper migration scripts compatible with D1/SQLite. UUID/text identifiers generated securely. Dates are ISO-8601; event timestamps in UTC. Add appropriate unique constraints, FK constraints, indexes on ownership, state and relevant date fields. `created_at` and `updated_at` where applicable. The following is a conceptual schema, not an instruction to copy blindly without adapting to the Sites runtime.

**`users`**
- `id TEXT PRIMARY KEY`
- `auth_provider TEXT NOT NULL`
- `auth_subject TEXT NOT NULL` (stable verified provider identifier if available; for Sites' documented identity headers, map verified email to internal UUID; do not accept unverified client email)
- `email TEXT`, `display_name TEXT`, `timezone TEXT DEFAULT 'Europe/Madrid'`, `created_at TEXT`
- `UNIQUE(auth_provider, auth_subject)`

**`workspaces`**
- `id TEXT PRIMARY KEY`, `name TEXT`, `owner_user_id TEXT REFERENCES users(id)`, `is_personal INTEGER DEFAULT 1`, `created_at TEXT`

**`workspace_members`**
- `workspace_id TEXT`, `user_id TEXT`, `role TEXT CHECK(role IN ('owner','admin','member'))`, `created_at TEXT`
- composite PK `(workspace_id, user_id)`
- v1 creates one private personal workspace per user; shared collaboration UI is future scope.

**`strategic_goals`**
- `id`, `workspace_id`, `title`, `description`, `period_start`, `period_end`, `status` (`active`,`achieved`,`paused`,`archived`), `sort_order`, `created_at`, `updated_at`

**`projects`**
- `id`, `workspace_id`, `goal_id NULL REFERENCES strategic_goals(id)`, `name`, `slug` (unique within workspace), `description`, `color`, `icon`, `status` (`active`,`on_hold`,`archived`), `target_date NULL`, `sort_order`, timestamps

**`milestones`**
- `id`, `workspace_id`, `project_id NULL`, `goal_id NULL`, `title`, `description NULL`, `status` (`pending`,`achieved`), `achieved_at NULL`, `sort_order`, timestamps
- A milestone can relate to a goal, project or both. Validate same-workspace links.

**`tasks`**
- `id`, `workspace_id`, `project_id NULL`, `parent_task_id NULL`, `title`, `description NULL`, `status` (seven states above), `priority` (four states above), `due_at NULL`, `waiting_on NULL`, `follow_up_at NULL`, `completed_at NULL`, `cancelled_at NULL`, `deleted_at NULL`, `created_by_user_id`, `created_at`, `updated_at`, `sort_order`
- Default `status='pending'`, `priority='normal'`. Support at least one level of subtasks.
- Maintain a canonical row per task, never duplicate tasks across journal views.

**`task_events`** (append-only audit/history)
- `id`, `workspace_id`, `task_id`, `actor_user_id`, `event_type` (`created`,`status_changed`,`priority_changed`,`project_changed`,`title_changed`,`completed`,`reopened`,`cancelled`,`restored`, etc.), `from_value_json NULL`, `to_value_json NULL`, `occurred_at`
- Completion transitions must be recorded transactionally with `tasks.completed_at`. Reopening retains prior completion events; update current completed timestamp consistently.
- Events enable historical metrics and reconstruction. They are not an editable duplicate of a task.

**`journal_entries`**
- `id`, `workspace_id`, `author_user_id`, `entry_date` (YYYY-MM-DD LOCAL date), `title NULL`, `created_at`, `updated_at`
- `UNIQUE(workspace_id, author_user_id, entry_date)`

**`journal_blocks`**
- `id`, `workspace_id`, `journal_entry_id`, `block_type` (`heading`,`paragraph`,`bullet`,`task_reference`), `text_content NULL`, `task_id NULL REFERENCES tasks(id)`, `indent_level`, `sort_order`, timestamps
- When `block_type='task_reference'`, persist real `task_id`; never re-parse to re-create it.
- Store notes explicitly and avoid executable HTML injection; sanitize any rich content.

**`focus_items`**
- `id`, `workspace_id`, `user_id`, `task_id`, `period_type` (`daily`,`weekly`), `period_start` (local YYYY-MM-DD), `sort_order`, `created_at`
- `UNIQUE(user_id, task_id, period_type, period_start)`
- Default limit 3 daily and 5 weekly in application validation. Historical periods are kept.

**`user_preferences`** (or fields on users)
- `user_id`, `theme`, `preferred_task_view`, `week_start_day`, `updated_at`

**Optional indexes/constraints:** `(workspace_id,status,priority)`, `(workspace_id,project_id,status)`, `task_events(task_id,occurred_at)`, `task_events(workspace_id,occurred_at)`, `journal_entries(author_user_id,entry_date)`, `milestones(goal_id,status)`, `focus_items(user_id,period_type,period_start)`. Validate child relations within same workspace in trusted server-side code; foreign keys alone do not enforce tenant equality.

## 5. Persistence, API and authorization rules

- Use a typed service/repository boundary (`TaskRepository`, `JournalRepository`, `ProjectRepository`, `AnalyticsService`, etc.). Route handlers should validate inputs and invoke domain services; UI should not issue arbitrary SQL.
- Never take user_id/workspace_id from a client as proof of authority. Resolve the active authenticated user on the server, then look up personal workspace/membership.
- All queries and mutations are scoped to that authorized workspace and checked on the server. An unknown/cross-tenant ID returns a safe not-found/forbidden response without leaking details.
- Validate and sanitize input (length limits, enum validation, safe string handling); use prepared SQL; CSRF protection/same-site/session defenses consistent with Sites architecture; do not expose secrets.
- If Sign in with ChatGPT is used, follow official Sites' platform auth behavior. Never treat a caller-supplied header as authentication unless the platform reliably injects/verifies it. Never trust the frontend to enforce authorization.
- Ensure task state transition, task event insertion, focus reordering and task-in-journal creation are atomic/idempotent as appropriate.
- Support optimistic UI updates only if failures roll back clearly. Handle refresh, simultaneous tabs and network errors without silent data loss.
- No credentials in browser bundles. No sensitive professional or organizational information in demo data, logs, sample screenshots or public builds.

## 6. Business rules and metric definitions

1. **Canonical task:** A task has exactly one ID. A project page, journal block, Kanban card or focus list is a view/reference, not another copy.
2. **New task:** One-line capture saves a canonical task and emits exactly one `created` event; duplicate retries must be idempotent.
3. **Completion:** Transition to `completed` records a verified UTC timestamp and emits a completion event. Completed task remains searchable in Archivo.
4. **Reopening:** Transition away from completed retains the event log and reflects current status accurately. Prevent double-counting repeated toggles; define and document how a later re-completion is counted.
5. **Priority:** Distinct from workflow status and focus membership; a high priority task may be in external review.
6. **Weekly focus:** Chosen tasks are user commitments, not every overdue/high priority task; period retains history.
7. **Strategic progress:** `achieved_milestones / total_milestones` when denominator >0, otherwise show “Sin hitos definidos”; never invent percent progress.
8. **Created this week:** Number of task creation events in local Monday–Sunday window, excluding migrated historical records from fabricated current-period counts.
9. **Completed this week:** Define stable unambiguous task-level metric from real completion events; do not inflate it for duplicate journal references or unchanged state edits.
10. **Net workload reduction:** Completed minus newly created, clearly distinct from “tasks still open”; separately show any reopening/cancellation effects when relevant.
11. **Unverified dates:** Imported legacy completions with unknown times are displayed as unknown and not presented as verified completions for a particular day.
12. **Cancelled tasks:** Excluded from completed achievements and counted distinctly.

## 7. Screens/routes and sample navigation

- `/` — **Mi espacio de trabajo**
- `/tasks` — **Tareas** (Kanban and table tabs)
- `/projects` — **Proyectos**
- `/projects/:id` — project detail
- `/journal` — **Mi diario** (defaults to current local day)
- `/journal/:date` — diary by local day
- `/progress` — **Mis avances**
- `/archive` — **Archivo**
- `/settings` — **Configuración**
- Appropriate signed-out flow if auth-enabled; no anonymous access to private data.

## 8. Execution phases (all required for successful v1)

**Phase 0 — Compatibility and architecture**  
Inspect current Sites runtime and starter. Decide compatible framework, D1 binding shape, server route mechanism, auth. Write brief architecture, acceptance checklist and migrations plan. Do not fabricate runtime support.

**Phase 1 — Foundation + durable task system**  
App shell, responsive navigation, theme, protected server identity, workspace bootstrap, D1 schema/migrations, typed data access and CRUD for tasks/projects, quick capture and event log. Prove data survives refresh and device/session changes.

**Phase 2 — Journal + two-way synchronization**  
Daily journal editor, inline one-line capture parser, projects inherited from heading, unique linked task blocks and subtask support. Task status change synchronizes across Journal, Kanban and table without duplicate records.

**Phase 3 — Full management experience**  
Kanban drag/drop or status move, table view, status/priority filters, project details, goals/milestones, daily and weekly focus selection and reordering.

**Phase 4 — Dashboard, archive, analytics and export**  
Finished Mi espacio de trabajo page, meaningful focus + strategic cards + active projects + key metrics; Mis avances charts/achievements, searchable history, JSON/CSV export and completed/reopened edge cases.

**Phase 5 — Security, UX and QA release candidate**  
Mobile layout, keyboard/accessibility tests, multi-tenant isolation tests with two distinct simulated accounts, load/empty/error states, migration/export checks, private reviewable Site version, README/deployment guide. Don't publish publicly without user approval.

## 9. Acceptance tests — required, not optional

1. Create a task with just `Preparar presentación` + Enter; it appears in the open task table and survives page refresh.
2. Create `!! Preparar presentación #SRA` within the journal under a heading; the task has `critical` priority, is linked to project SRA and appears exactly once across all views.
3. Create one task in Diary and move it from `pending` to `in_progress` and then `pending_review` in Kanban; Diary and table show the same canonical status.
4. Move the task to `waiting_external` and set an optional follow-up date; that task does not need to be actively worked on and is visibly distinguished from active tasks.
5. Complete a task in table/board; completed_at is persisted, event history has a completion, weekly achievement metrics update, and item is searchable in Archivo.
6. Reopen a completed task; event history retains original completion and the current pending count/metrics are consistent.
7. Journal navigation to an earlier day retains headings, notes, nested tasks and references exactly, without cloning tasks on save or re-open.
8. Add tasks to Mi foco semanal and Hoy, then navigate away and back; selections and order persist for the exact selected period.
9. Mark a strategic milestone achieved; goal progress updates independently of task counts.
10. Verify week boundaries and timestamps across UTC date changes using a configured IANA timezone.
11. Search and filter task archive by project/date/status and find a task completed several weeks earlier.
12. Export JSON and tasks CSV; inspect the resulting files and verify the full history and identifiers/timestamps are represented.
13. Verify separate user A cannot read/update/delete records of user B via manipulated API requests, URL IDs or UI state.
14. Test smartphone-sized viewport, keyboard operation, readable Kanban fallback and no horizontal layout overflow except deliberate board scrolling.
15. Demonstrate tests/build passing, with reproducible commands and real evidence. No superficial passing placeholder tests.

## 10. Definition of done and deliverables

The app is complete only when the seven main sections work with **persistent data and one canonical state**, the historical metrics are accurate, key controls function on mobile and desktop, and user-private data stays private. Visual mockups do not satisfy acceptance.

Deliver:
- Version-controlled source code
- `README.md` for setup, testing and Sites deployment
- `AGENTS.md` with persistent Codex engineering rules and scope
- D1 SQL migrations with reproducible schema setup
- Automated tests (unit/integration, and end-to-end/browser checks where runtime permits)
- A private Site preview or saved version, not a public release
- Demo or test-only fictional data seed
- Known limitations, security decisions, data export documentation
- Concise release checklist mapped to acceptance tests

**Proceed with implementation using sensible defaults.** Ask for human action only where an external account, infrastructure provisioning, secret, permission or security decision genuinely requires it. Do not postpone ordinary engineering decisions. Focus Hub should feel simpler than maintaining a Work Journal in Notion while delivering substantially more insight and satisfaction.
