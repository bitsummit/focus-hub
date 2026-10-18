# Focus. — Product reference

Focus. is a private personal workspace for capturing tasks, organizing projects
and reviewing verified progress. This document describes implemented behavior;
[ARCHITECTURE.md](ARCHITECTURE.md) explains its implementation and
[OPERATIONS.md](OPERATIONS.md) explains how to run and recover it.

## Navigation and preferences

The seven sections are **Tareas / Tasks**, **Mi espacio / My space**,
**Diario / Journal**, **Avances / Progress**, **Proyectos / Projects**,
**Archivo / Archive** and **Ajustes / Settings**, in that order. `/` opens the
task table; `/tasks` honors the saved table/Kanban preference. The dashboard is
`/dashboard`, project details are `/projects/:id`, and dated journals are
`/journal/YYYY-MM-DD`. Mobile navigation exposes the first four sections and
a More menu for the rest.

Settings persist display name, Spanish/English, IANA timezone, light/dark/system
theme, preferred task view and Monday/Sunday week start. Defaults include Spanish,
Europe/Madrid and Monday. Language changes translate interface text and formatted
dates, never task titles, notes, identifiers, status codes or stored dates. The
authenticated user's saved preference applies across browsers; the last language
hint on the login screen is only a local presentation preference.

## Canonical tasks and capture

A task has one ID and one canonical record. Table, Kanban, journal references,
focus, projects, archive and analytics do not create separate copies. Server
storage is authoritative; browser storage is not a task database.

- Title is the only required capture field. Enter saves a line; no project means
  **Bandeja de entrada / Inbox**. Default status is `pending`, priority `normal`.
- A leading `!` means high and `!!` critical. Recognized `#project` slugs/names
  assign an existing project; unmatched shorthand remains title text. An explicit
  capture priority overrides the prefix.
- Desktop capture remains available across sections, with Ctrl/⌘+K and focus
  retained for successive captures. Mobile `+` opens a capture sheet with optional
  project/priority and save-and-continue or save-and-close actions.
- Capture and journal appends accept idempotency keys: repeating the same request
  does not create a second task/event; reusing its key with different content fails.
  The main capture flows retain their key and text after failed responses.
- Description, project, due date, waiting-on, follow-up date, parent and tags are
  optional. Pending review and external waiting do not require extra fields.
- Task history records creation and actual field/state changes. Completion stores
  a verified UTC timestamp and event together. Reopening clears the current
  completion timestamp and preserves previous completion events. Cancellation
  remains distinct from completion. Confirmed deletion is soft deletion; records
  and events remain in the full export, but ordinary views hide deleted tasks.

Status and priority are independent of one another and of focus membership.
The shared contract is [shared/contracts.ts](../shared/contracts.ts):

| Status | Spanish label | Visual meaning |
|---|---|---|
| `pending` | Pendiente | Neutral gray |
| `in_progress` | En curso | Blue |
| `pending_review` | Pendiente de revisión | Violet |
| `waiting_external` | En espera de terceros | Amber |
| `blocked` | Bloqueada | Coral |
| `completed` | Completada | Green |
| `cancelled` | Cancelada | Muted gray |

Priorities are `low` (Baja), `normal` (Normal), `high` (Alta) and `critical`
(Crítica). State labels accompany semantic colors; colors are not the sole cue.

## Table, Kanban and subtasks

Desktop table supports sorting and direct project/status/priority/due-date editing.
Below 768 px it becomes a compact vertical list with completion, title, project,
state, priority and an optional due date. Desktop Kanban supports drag-and-drop
and state selectors; mobile Kanban groups tasks into collapsible vertical status
sections with counts and accessible state controls.

Tareas selects open, nondeleted tasks (completed descendants can remain inside
their parent block). Quick chips intersect with project, status
and priority filters: All, Inbox, Today, High priority, Waiting and Blocked.
**Today means manually selected daily focus**, not tasks due today. Waiting includes
review and external waiting. The selector row scrolls horizontally when necessary;
there is no text search in Tareas. Archive retains its own search and filters.
Filters/view survive internal navigation; temporary filters reset on full reload.
The heading and sidebar count all open tasks, including subtasks, rather than the
currently filtered result count.

Successful writes provide discreet feedback. Quick state changes offer Undo,
checking the latest task state before applying a compensating update; they do not
erase events. Network errors expose retry/recovery rather than an offline queue.

Changing an existing task's project, including returning it to Inbox, asks for
Confirm/Cancel. Cancel/Escape sends no update. In the editor confirmation accepts
the draft; Save changes still persists it. Creation retains its quick flow.

Subtasks are canonical tasks connected by `parent_task_id`, with their own state,
checkbox and history. Table/list/Kanban show them beneath the parent, including
completed children. Parent completion is independent; no checklist-specific
statistics are introduced. A visible parent brings its nondeleted descendants;
a matching child without a matching ancestor remains an independent result.
Board counts count top-level visible blocks, not every nested row; a child may
have a different status from its containing parent column. Cycles are rejected.

## Projects, strategic goals and milestones

Projects can be created with a name only. Optional metadata includes description,
unique workspace code, goal, color/icon and target date. States are active,
on hold and archived. Cards and a project table can include archived projects;
archiving preserves tasks and history.

Project details show state counts, milestones, prioritized open tasks, recent
completions and journal days referencing project tasks. Capture there assigns the
project. Strategic goals have optional periods and active/achieved/paused/archived
states. A milestone belongs to a project, a goal or both and has explicit
pending/achieved state and achievement timestamp.

Goal progress is **achieved milestones / all linked milestones**, independent of
task counts. With no milestones the UI says no milestones are defined, without
inventing a percentage. Goal status itself is edited explicitly.

## Journal

`/journal` is a descending feed of saved, nonempty days, **15 days per page**,
with search and URL-preserved pagination. Opening a blank date does not by itself
save an entry. New entry opens today in the user's timezone; the calendar selects
other days. Feed notes remain editable and task references use the same controls
and IDs as dated entries.

The daily editor supports headings, plain notes, bullets and indentation. An
explicit `- [ ]` line creates a canonical task and persisted task reference;
ordinary prose/bullets remain notes. A matching heading supplies project context;
`#project` shorthand can override it. Indented task lines can associate with the
preceding parent in that heading section. A heading resets nesting context, and a
deleted parent cannot redirect a child to an unrelated older sibling.

Saving/reopening does not reparse references into duplicate tasks. Removing a
reference does not delete its task. Existing tasks can be linked into a day's
entry. Journal revisions reject stale edits with a recoverable conflict rather
than silently overwriting saved notes.

## My space and focus

Mi espacio's subtitle is “Todo lo importante, de un vistazo.” Its order is weekly
and daily focus, strategic goals, active projects, then progress. It shows up to
four active goals and six active projects; project summaries include open,
in-progress, waiting/review work and the next pending milestone when present.

Focus is deliberate selection, not a priority/overdue query: at most **five weekly**
and **three daily** tasks, ordered by the user and saved for that exact local
period. Historical choices survive navigation. New selections must be open;
already selected tasks can remain after completion. Dashboard week navigation
changes weekly focus/metrics; Today remains the current local day.

## Progress and history semantics

Progress provides weekly/monthly navigation, daily series with textual values,
verified task achievements and achieved milestones. Period dates are local calendar
dates; absolute event timestamps are UTC. Calculations use the selected IANA
timezone, including DST, and an **inclusive start, exclusive end**. Week start is
the saved Monday/Sunday preference.

| Metric | Definition |
|---|---|
| Created | Distinct task IDs with creation events inside the period |
| Completed | Distinct task IDs with verified completion events inside the period |
| Reopened / cancelled | Distinct task IDs with the corresponding event inside the period |
| Net reduction | Completed minus created; not the same as ending backlog |
| Ending backlog | Open, nondeleted tasks reconstructed from events before the period end |

Multiple completions of one task count once per selected period; completing it
again in a later period can count there. Each day's series also deduplicates within
that day, so its sum can exceed the period's distinct count after re-completion.
Subtasks participate as ordinary canonical tasks. Cancellation is not an achievement.
Unknown/imported completion dates are displayed as unknown and never fabricated
into dated achievements. Historical backlog requires recorded creation/state events.

Completed metrics are green, created blue, net positive green/zero neutral/negative
amber, and backlog neutral. Capturing more work may increase backlog without
implying poor performance. Historical state distribution uses the selected period
end; open-work distributions by priority and project use the **current snapshot**.
The achievement project filter follows the task's current project; the task event
history preserves project and priority recorded at completion.

Archive includes completed, cancelled and previously completed/reopened tasks,
with text/project/status/priority/date filters, plus achieved milestones and
journal history. Task date filters match completion/cancellation events in local
dates. The task editor exposes exact event history and known timestamps. Archived
projects do not erase their records.

## Export and current boundaries

User-initiated JSON export (`schemaVersion: 1`) includes the authenticated user
preferences/workspace, projects, goals, milestones, tasks including soft-deleted
ones, events, journals/blocks, focus, identifiers and timestamps. Task CSV retains
canonical codes and neutralizes spreadsheet formula prefixes. Credentials and
sessions are not part of the domain JSON export.

JSON preview checks that principal collections are arrays; it is **not** a full
schema/relationship validator or importer. A recoverable full SQLite backup is a
separate operational mechanism; see [OPERATIONS.md](OPERATIONS.md).

The following are not implemented promises: bulk task actions, destructive JSON
import, Notion integration, Google/ChatGPT sign-in, shared-workspace collaboration
UI, offline writes or production hosting.
The current runtime is Node/SQLite, not Sites/D1. Snapshot loading is not server
paginated; the journal's 15-day pagination limits rendering, not downloaded data.
Task field updates follow last-write-wins; journal revision checking does not
provide general collaborative conflict resolution. Cross-view state refreshes
after mutations, when the window regains focus and every 20 seconds while signed
in; there is no push stream or guarantee of instantaneous cross-device updates.
Real assistive-technology/mobile-device review and durable private hosting remain
distinct from automated browser coverage. See [SECURITY.md](SECURITY.md) before
entrusting real data to an environment.

## Enduring acceptance invariants

These preserve the original 15 behavioral criteria with current approved UX.
Test files provide executable evidence, not a permanent claim that every future
revision passes. Run instructions belong in [OPERATIONS.md](OPERATIONS.md).

| # | Required behavior | Executable coverage |
|---|---|---|
| 1 | Title + Enter appears in table and survives refresh | [app.spec.ts](../tests/app.spec.ts), [api.test.ts](../tests/api.test.ts) |
| 2 | Critical journal capture with project creates one task/reference | [api.test.ts](../tests/api.test.ts), [app.spec.ts](../tests/app.spec.ts) |
| 3 | Journal, board and table share state/identity | [app.spec.ts](../tests/app.spec.ts) |
| 4 | External waiting and optional follow-up persist independently of active work | [api.test.ts](../tests/api.test.ts), [app.spec.ts](../tests/app.spec.ts) |
| 5 | Completion retains timestamp/event and updates archive/analytics | [api.test.ts](../tests/api.test.ts), [ux-v11.spec.ts](../tests/ux-v11.spec.ts) |
| 6 | Reopening preserves completions and distinct-count semantics | [api.test.ts](../tests/api.test.ts), [analytics-hardening.test.ts](../tests/analytics-hardening.test.ts) |
| 7 | Past journal notes/headings/nesting/references survive without clones | [journal-edge.test.ts](../tests/journal-edge.test.ts), [journal-feed.spec.ts](../tests/journal-feed.spec.ts) |
| 8 | Daily/weekly focus preserves order and exact periods | [api.test.ts](../tests/api.test.ts), [app.spec.ts](../tests/app.spec.ts) |
| 9 | Milestone-driven goal progress is independent of tasks | [api.test.ts](../tests/api.test.ts) |
| 10 | Local calendar/UTC boundaries and DST are correct | [calendar.test.ts](../tests/calendar.test.ts), [analytics-hardening.test.ts](../tests/analytics-hardening.test.ts) |
| 11 | Historical archive is searchable/filterable without fabricated dates | [api.test.ts](../tests/api.test.ts), [app.spec.ts](../tests/app.spec.ts) |
| 12 | Downloaded JSON/CSV preserve identifiers and domain history | [api.test.ts](../tests/api.test.ts), [app.spec.ts](../tests/app.spec.ts) |
| 13 | Manipulated foreign user/workspace IDs cannot bypass authorization | [api.test.ts](../tests/api.test.ts), [security-hardening.test.ts](../tests/security-hardening.test.ts) |
| 14 | Smartphone/desktop, keyboard and accessible board fallback remain usable | [ux-v11.spec.ts](../tests/ux-v11.spec.ts), [app.spec.ts](../tests/app.spec.ts) |
| 15 | Real tests/build are reproducible and contain meaningful assertions | [package.json](../package.json), [playwright.config.ts](../playwright.config.ts), [tests](../tests/) |

Additional current contracts are covered by [task filters](../tests/task-filters.test.ts),
[subtasks](../tests/subtasks.spec.ts), [project confirmation](../tests/project-confirmation.spec.ts),
[language](../tests/language.spec.ts), [journal/progress navigation](../tests/journal-feed.spec.ts),
and [restart/recovery](../tests/daily-readiness.spec.ts) tests. These use fictional,
isolated data; local success does not certify deployed availability or real-device
screen-reader behavior.
