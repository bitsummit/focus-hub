import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Temporal } from "@js-temporal/polyfill";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flag,
  FolderOpen,
  Home,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  List,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings,
  Target,
  Trash2,
  X,
} from "lucide-react";
import {
  STATUSES,
  PRIORITIES,
  statusLabels,
  priorityLabels,
  type Snapshot,
  type Session,
  type Task,
  type Status,
  type Project,
  type Goal,
  type Analytics,
  type JournalBlock,
  type CaptureInput,
} from "../shared/contracts";
import "./styles.css";
import { Board, TaskTable, StatusControl, Priority } from "./components/TaskViews";
import { MobileQuickCapture } from "./components/QuickCapture";
import { filterTask, matchesQuickFilter, type QuickFilter } from "./task-filters";
import "./ux-v11.css";

type Page =
  | "home"
  | "tasks"
  | "projects"
  | "journal"
  | "progress"
  | "archive"
  | "settings";
const nav: { key: Page; path: string; label: string; icon: typeof Home }[] = [
  { key: "tasks", path: "/tasks", label: "Tareas", icon: Home },
  { key: "home", path: "/dashboard", label: "Tu espacio", icon: LayoutDashboard },
  { key: "journal", path: "/journal", label: "Diario", icon: BookOpen },
  { key: "progress", path: "/progress", label: "Mis avances", icon: BarChart3 },
  { key: "projects", path: "/projects", label: "Proyectos", icon: FolderOpen },
  { key: "archive", path: "/archive", label: "Archivo", icon: Inbox },
  { key: "settings", path: "/settings", label: "Ajustes", icon: Settings },
];
const requestId = () => crypto.randomUUID();
const dateAdd = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();
const todayIn = (tz: string) =>
  Temporal.Now.zonedDateTimeISO(tz).toPlainDate().toString();
const weekOf = (date: string, start = 1) => {
  const d = Temporal.PlainDate.from(date);
  return d
    .subtract({ days: (d.dayOfWeek - (start === 0 ? 7 : start) + 7) % 7 })
    .toString();
};
const niceDate = (value: string, tz?: string) =>
  value.length === 10
    ? new Intl.DateTimeFormat("es", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00Z"))
    : new Intl.DateTimeFormat("es", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz,
      }).format(new Date(value));
function validDate(date: string) {
  try {
    Temporal.PlainDate.from(date);
    return true;
  } catch {
    return false;
  }
}
function pathState() {
  const path = location.pathname;
  const section = nav.find((n) => path === n.path || path.startsWith(n.path + "/"));
  return {
    page: section?.key ?? "tasks",
    projectId: path.startsWith("/projects/") ? path.split("/")[2] : null,
    journalDate:
      /^\/journal\/\d{4}-\d{2}-\d{2}$/.test(path) &&
      validDate(path.split("/")[2])
        ? path.split("/")[2]
        : null,
  };
}

function App() {
  const [session, setSession] = useState<Session | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(0),
    [showSaving, setShowSaving] = useState(false),
    [route, setRoute] = useState(pathState),
    [editor, setEditor] = useState<Task | null>(null),
    [capture, setCapture] = useState(""),
    [captureRequest, setCaptureRequest] = useState(requestId()),
    [more, setMore] = useState(false),
    [captureSheet, setCaptureSheet] = useState(false),
    [captureBusy, setCaptureBusy] = useState(false),
    [quickFilter, setQuickFilter] = useState<QuickFilter>("all"),
    [feedback, setFeedback] = useState<{message:string; undo?:{id:string;before:Status;after:Status}}|null>(null),
    [archiveFilters, setArchiveFilters] = useState({search:"",project:"",status:"",priority:""});
  useEffect(() => {
    if (!busy) { setShowSaving(false); return; }
    const timer = setTimeout(() => setShowSaving(true), 250);
    return () => clearTimeout(timer);
  }, [busy > 0]);
  const capturePending = useRef(false);
  const pendingTaskIds = useRef(new Set<string>());
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    if (!feedback || feedback.undo) return;
    const timer = setTimeout(() => setFeedback(null), 4500);
    return () => clearTimeout(timer);
  }, [feedback]);
  const [search, setSearch] = useState(""),
    [projectFilter, setProjectFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [priorityFilter, setPriorityFilter] = useState(""),
    [taskView, setTaskView] = useState<"board" | "table">("table");
  const read = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { credentials: "same-origin", ...init });
    if (!r.ok) {
      const data = await r.json().catch(() => ({
        message: "No se ha podido conectar con el servidor.",
      }));
      if (r.status === 401) {
        setSession(null);
        setSnapshot(null);
      }
      throw new Error(data.message || `Error ${r.status}`);
    }
    return r.status === 204 ? null : r.json();
  }, []);
  const refresh = useCallback(async () => {
    const data = await read("/api/state");
    setSnapshot(data);
  }, [read]);
  useEffect(() => {
    (async () => {
      try {
        const s = await read("/api/session");
        setSession(s);
        const data = await read("/api/state");
        setSnapshot(data);
      } catch (e) {
        if ((e as Error).message !== "No autenticado") setError("");
      } finally {
        setReady(true);
      }
    })();
  }, [read]);
  useEffect(() => {
    if (!session) return;
    const onFocus = () => refresh().catch((e) => setError(e.message));
    window.addEventListener("focus", onFocus);
    const id = setInterval(onFocus, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [session, refresh]);
  useEffect(() => {
    const fn = () => setRoute(pathState());
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const theme = snapshot.user.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme =
      theme === "system" ? "light dark" : theme;
  }, [snapshot?.user.theme]);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditor(null);
        setMore(false);
      }
      if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (document.querySelector('.task-dialog, dialog[open]')) return;
        if (window.matchMedia("(max-width: 767px)").matches) setCaptureSheet(true);
        else document.querySelector<HTMLInputElement>("#quick-capture")?.focus();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const go = (page: Page, path?: string) => {
    history.pushState({}, "", path ?? nav.find((n) => n.key === page)!.path);
    setRoute(pathState());
    setMore(false);
    window.scrollTo({ top: 0 });
  };
  const mutate = async (
    path: string,
    method = "POST",
    body?: unknown,
    quietError = false,
  ): Promise<boolean> => {
    setBusy((n) => n + 1);
    setError("");
    try {
      const data = await read(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session?.csrfToken ?? "",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (data?.tasks) setSnapshot(data);
      else await refresh();
      setFeedback({message: path === "/api/tasks" && method === "POST" ? "Tarea creada" : "Cambios guardados"});
      return true;
    } catch (e) {
      if (!quietError) setError((e as Error).message);
      return false;
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const updateTask = async (id: string, fields: Partial<Task>) => {
    if (pendingTaskIds.current.has(id)) return false;
    pendingTaskIds.current.add(id);
    const previous = snapshotRef.current?.tasks.find(task => task.id === id)?.status;
    try {
      const saved = await mutate("/api/tasks/" + id, "PATCH", fields);
      if (saved && fields.status && previous && previous !== fields.status)
        setFeedback({message: fields.status === "completed" ? "Tarea completada" : "Estado actualizado", undo:{id,before:previous,after:fields.status}});
      return saved;
    } finally { pendingTaskIds.current.delete(id); }
  };
  const undoStatus = async () => {
    const undo=feedback?.undo;if(!undo)return;
    try {
      const latest:Snapshot=await read("/api/state");setSnapshot(latest);
      if(latest.tasks.find(task=>task.id===undo.id)?.status!==undo.after){setFeedback({message:"La tarea ha cambiado. Revisa su estado antes de deshacer."});return;}
      if(await mutate("/api/tasks/"+undo.id,"PATCH",{status:undo.before}))setFeedback({message:"Estado anterior restaurado"});
    } catch(e){setError((e as Error).message);}
  };
  const onCapture = (input:CaptureInput) => mutate("/api/tasks","POST",input);
  const quickCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capture.trim() || capturePending.current) return;
    capturePending.current=true;setCaptureBusy(true);
    try {
      if(await onCapture({text:capture,request_id:captureRequest})){
        setCapture("");setCaptureRequest(requestId());
        document.querySelector<HTMLInputElement>("#quick-capture")?.focus({preventScroll:true});
      }
    } finally {capturePending.current=false;setCaptureBusy(false);}
  };
  useEffect(() => {
    // The app's entry URL always starts in the table. Explicit /tasks links
    // still honor the saved view; switching views during a visit remains available.
    if (snapshot && location.pathname !== "/")
      setTaskView(snapshot.user.preferred_task_view);
  }, [snapshot?.user.preferred_task_view]);
  const currentTask =
    (editor && snapshot?.tasks.find((t) => t.id === editor.id)) || null;
  if (!ready)
    return (
      <div className="full-loading">
        <Leaf size={34} />
        <p>Preparando tu espacio…</p>
        <LoaderCircle className="spin" />
      </div>
    );
  if (!session || !snapshot)
    return (
      <Login
        read={read}
        onLogin={async (s) => {
          setSession(s);
          setError("");
          await refresh();
        }}
      />
    );
  const data = snapshot,
    today = todayIn(data.user.timezone),
    open = data.tasks.filter(
      (t) => !t.deleted_at && !["completed", "cancelled"].includes(t.status),
    );
  const advancedFilters={search,project:projectFilter,status:statusFilter,priority:priorityFilter};
  const filterTasks = (tasks:Task[]) => tasks.filter(task=>filterTask(task,archiveFilters));
  const todayIds=new Set(data.focus.filter(item=>item.period_type==="daily"&&item.period_start===today).map(item=>item.task_id));
  const taskResults=data.tasks.filter(task=>filterTask(task,advancedFilters)&&matchesQuickFilter(task,quickFilter,todayIds));
  const taskFiltersActive=Boolean(search||projectFilter||statusFilter||priorityFilter||quickFilter!=="all");
  const clearTaskFilters=()=>{setSearch("");setProjectFilter("");setStatusFilter("");setPriorityFilter("");setQuickFilter("all");};
  const shared = {
    data,
    mutate,
    updateTask,
    openTask: setEditor,
    today,
    busy: busy > 0,
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setTaskView("table");
            go("tasks", "/");
          }}
        >
          <span className="brand-icon">
            <Leaf size={21} />
          </span>
          Focus Hub<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">TU ESPACIO PERSONAL</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.key}
              className={"nav-link " + (route.page === n.key ? "active" : "")}
              onClick={() => go(n.key)}
              aria-label={n.label}
              title={n.label}
            >
              <n.icon size={19} />
              {n.label}
              {n.key === "tasks" && (
                <span className="nav-count">{open.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="profile">
          <div className="avatar">
            {data.user.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{data.user.display_name}</strong>
            <span>Espacio privado</span>
          </div>
          <button
            className="icon-button"
            aria-label="Cerrar sesión"
            onClick={async () => {
              try {
                await read("/api/session", {
                  method: "DELETE",
                  headers: { "X-CSRF-Token": session.csrfToken },
                });
                setSession(null);
                setSnapshot(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            Mi espacio <ChevronRight size={13} />{" "}
            <strong>{nav.find((n) => n.key === route.page)?.label}</strong>
          </span>
          <form className="quick-capture" onSubmit={quickCapture}>
            <Plus size={17} />
            <input
              id="quick-capture"
              aria-label="Captura rápida de tarea"
              placeholder="Añade una tarea y pulsa Enter"
              readOnly={captureBusy}
              value={capture}
              onChange={(e) => {
                setCapture(e.target.value);
                setCaptureRequest(requestId());
              }}
            />
            <kbd>⌘ K</kbd>
            <button
              type="submit"
              className="icon-button"
              aria-label="Crear tarea"
              disabled={!capture.trim() || captureBusy}
            >
              <ArrowUpRight size={17} />
            </button>
          </form>
          <span className="private-badge">
            <span />
            Privado
          </span>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button onClick={() => setError("")} aria-label="Cerrar error">
              <X size={16} />
            </button>
          </div>
        )}
        {showSaving && busy > 0 && (
          <div className="saving" role="status">
            <LoaderCircle size={13} className="spin" /> Guardando…
          </div>
        )}
        <main>
          {route.page === "home" && <HomePage {...shared} go={go} />}
          {route.page === "tasks" && (
            <>
              <PageHeading
                title="Tus tareas"
                action={
                  <div className="segmented">
                    <button
                      className={taskView === "board" ? "selected" : ""}
                      onClick={() => setTaskView("board")}
                    >
                      <LayoutGrid size={16} />
                      Kanban
                    </button>
                    <button
                      className={taskView === "table" ? "selected" : ""}
                      onClick={() => setTaskView("table")}
                    >
                      <List size={16} />
                      Tabla
                    </button>
                  </div>
                }
              />
              <div className="quick-filters" role="group" aria-label="Filtros rápidos">
                {([
                  ["all","Todas"],["inbox","Bandeja"],["today","Hoy"],
                  ["priority","Prioritarias"],["waiting","En espera"],["blocked","Bloqueadas"],
                ] as const).map(([key,label])=><button type="button" key={key} className="filter-chip" aria-pressed={quickFilter===key} onClick={()=>setQuickFilter(key)}>{label}</button>)}
              </div>
              <Filters
                activeOnly
                onClear={clearTaskFilters}
                extraActive={quickFilter!=="all"}
                data={data}
                {...{
                  search,
                  setSearch,
                  projectFilter,
                  setProjectFilter,
                  statusFilter,
                  setStatusFilter,
                  priorityFilter,
                  setPriorityFilter,
                }}
              />
              {taskView === "board" ? (
                <Board
                  tasks={taskResults}
                  emptyFiltered={taskFiltersActive}
                  onClearFilters={clearTaskFilters}
                  {...shared}
                  showAll={false}
                />
              ) : (
                <TaskTable
                  tasks={taskResults}
                  emptyFiltered={taskFiltersActive}
                  onClearFilters={clearTaskFilters}
                  {...shared}
                />
              )}
            </>
          )}
          {route.page === "projects" && (
            <ProjectsPage {...shared} selectedId={route.projectId} go={go} />
          )}
          {route.page === "journal" && (
            <JournalPage
              {...shared}
              date={route.journalDate ?? today}
              onDate={(date) => go("journal", "/journal/" + date)}
            />
          )}
          {route.page === "progress" && (
            <ProgressPage {...shared} read={read} />
          )}
          {route.page === "archive" && (
            <ArchivePage
              {...shared}
              filterTasks={filterTasks}
              filters={
                <Filters
                  data={data}
                  search={archiveFilters.search}
                  setSearch={value=>setArchiveFilters(current=>({...current,search:value}))}
                  projectFilter={archiveFilters.project}
                  setProjectFilter={value=>setArchiveFilters(current=>({...current,project:value}))}
                  statusFilter={archiveFilters.status}
                  setStatusFilter={value=>setArchiveFilters(current=>({...current,status:value}))}
                  priorityFilter={archiveFilters.priority}
                  setPriorityFilter={value=>setArchiveFilters(current=>({...current,priority:value}))}
                />
              }
              go={go}
            />
          )}
          {route.page === "settings" && (
            <SettingsPage {...shared} read={read} />
          )}
        </main>
        <footer className="main-footer">
          <Leaf size={13} /> Focus Hub
          <span>
            {data.workspace.name} · {data.user.timezone}
          </span>
        </footer>
      </div>
      <nav className="mobile-nav">
        {nav.slice(0, 4).map((n) => (
          <button
            key={n.key}
            className={route.page === n.key ? "active" : ""}
            onClick={() => go(n.key)}
          >
            <n.icon size={20} />
            <span>{n.label}</span>
          </button>
        ))}
        <button onClick={() => setMore(!more)} className={more ? "active" : ""}>
          <Settings size={20} />
          <span>Más</span>
        </button>
      </nav>
      {more && (
        <div className="mobile-more">
          {nav.slice(4).map((n) => (
            <button key={n.key} onClick={() => go(n.key)}>
              <n.icon size={18} />
              {n.label}
            </button>
          ))}
        </div>
      )}
      <button
        className="mobile-add"
        aria-label="Capturar una tarea"
        onClick={() => {
          setCaptureSheet(true);
        }}
      >
        <Plus size={25} />
      </button>
      <MobileQuickCapture open={captureSheet} onClose={()=>setCaptureSheet(false)} projects={data.projects} onCapture={input=>mutate("/api/tasks","POST",input,true)}/>
      {feedback && <div className="action-feedback" role="status" aria-live="polite">
        <span>{feedback.message}</span>
        {feedback.undo && <button type="button" onClick={undoStatus}>Deshacer</button>}
        <button type="button" aria-label="Cerrar confirmación" onClick={()=>setFeedback(null)}>×</button>
      </div>}
      {currentTask && (
        <TaskDialog
          key={currentTask.id}
          task={currentTask}
          {...shared}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}

type Shared = {
  data: Snapshot;
  mutate: (path: string, method?: string, body?: unknown) => Promise<boolean>;
  updateTask: (id: string, fields: Partial<Task>) => Promise<boolean>;
  openTask: (task: Task) => void;
  today: string;
  busy: boolean;
};
function Login({
  read,
  onLogin,
}: {
  read: (path: string, init?: RequestInit) => Promise<any>;
  onLogin: (s: Session) => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-icon">
            <Leaf />
          </span>
          Focus Hub.
        </div>
        <div>
          <span className="eyebrow">FOCUS HUB</span>
          <h1>
            Tareas,
            <br />
            proyectos y
            <br />
            <em>diario.</em>
          </h1>
          <p>
            Captura, organiza y consulta tu trabajo.
            <br />
            Tus tareas y su historial, en un solo lugar.
          </p>
        </div>
        <span className="story-footer">Acceso privado</span>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">TU ESPACIO PERSONAL</span>
          <h2>Acceder a Focus Hub</h2>
          <p>Introduce tus credenciales.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const challenge = await read("/api/session/challenge");
                const s = await read("/api/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "X-Login-CSRF": challenge.loginToken },
                  body: JSON.stringify({ email, password }),
                });
                await onLogin(s);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Correo electrónico
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Contraseña
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Entrando…" : "Entrar en mi espacio"}
              <ArrowUpRight size={17} />
            </button>
          </form>
          <p className="login-help">
            Acceso privado. La cuenta se configura con el comando de
            administración del entorno.
          </p>
        </div>
      </section>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Empty({
  title = "No hay elementos",
  text = "Captura tu primera tarea en la barra superior.",
  icon: Icon = Leaf,
}: {
  title?: string;
  text?: string;
  icon?: typeof Leaf;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TaskLine({
  task,
  data,
  openTask,
  updateTask,
  extra,
}: {
  task: Task;
  data: Snapshot;
  openTask: Shared["openTask"];
  updateTask: Shared["updateTask"];
  extra?: React.ReactNode;
}) {
  const p = data.projects.find((p) => p.id === task.project_id);
  return (
    <div
      className={
        "task-line " + (task.status === "completed" ? "is-completed" : "")
      }
    >
      <button
        className="check-task"
        aria-label={
          (task.status === "completed" ? "Reabrir " : "Completar ") + task.title
        }
        onClick={() =>
          updateTask(task.id, {
            status: task.status === "completed" ? "pending" : "completed",
          })
        }
      >
        {task.status === "completed" ? (
          <CheckCircle2 size={19} />
        ) : (
          <Circle size={19} />
        )}
      </button>
      <button className="task-line-title" onClick={() => openTask(task)}>
        <strong>{task.title}</strong>
        <span>
          <span className={"task-inline-status status-" + task.status}>
            <i className={"dot state-dot " + task.status} />
            {statusLabels[task.status]}
          </span>
          <span className="project-dot" style={{"--project-color":p?.color??"#757e88"} as React.CSSProperties}>
            {p?.name??"Bandeja de entrada"}
          </span>
          {task.waiting_on && ` · ${task.waiting_on}`}
          <span className="inline-mobile-priority">
            <Priority value={task.priority} />
          </span>
        </span>
      </button>
      <Priority value={task.priority} />
      {extra}
    </div>
  );
}

function HomePage(props: Shared & { go: (p: Page, path?: string) => void }) {
  const { data, today, go } = props;
  const [week, setWeek] = useState(weekOf(today, data.user.week_start_day));
  const goals = data.goals.filter((g) => g.status === "active"),
    active = data.projects.filter((p) => p.status === "active"),
    completedIds = new Set(
      data.events
        .filter(
          (e) =>
            e.event_type === "completed" &&
            localDate(e.occurred_at, data.user.timezone) >= week &&
            localDate(e.occurred_at, data.user.timezone) < dateAdd(week, 7),
        )
        .map((e) => e.task_id),
    );
  const created = data.events.filter(
    (e) =>
      e.event_type === "created" &&
      localDate(e.occurred_at, data.user.timezone) >= week &&
      localDate(e.occurred_at, data.user.timezone) < dateAdd(week, 7),
  ).length;
  return (
    <>
      <PageHeading
        eyebrow={new Intl.DateTimeFormat("es", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        })
          .format(new Date(today + "T12:00:00Z"))
          .toUpperCase()}
        title="Tu espacio"
        action={
          <PeriodNav date={week} onChange={setWeek} step={7} label="Semana" />
        }
      />
      <div className="dashboard-grid">
        <section className="panel weekly-panel">
          <PanelTitle
            icon={Target}
            title="Mi foco de la semana"
            subtitle="Selecciona hasta 5 tareas para esta semana."
            tag="HASTA 5"
          />
          <FocusPanel {...props} type="weekly" date={week} />
        </section>
        <section className="panel today-panel">
          <PanelTitle
            icon={CheckCircle2}
            title="Hoy"
            subtitle="Selecciona hasta 3 tareas para hoy."
            tag={Temporal.PlainDate.from(today).day.toString()}
          />
          <FocusPanel {...props} type="daily" date={today} />
        </section>
      </div>
      <div className="section-heading">
        <div>
          <h2>Objetivos estratégicos</h2>
        </div>
        <button className="text-button" onClick={() => go("projects")}>
          Gestionar objetivos
          <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="goal-grid">
        {goals.slice(0, 4).map((g) => (
          <GoalCard key={g.id} goal={g} data={data} />
        ))}
        {!goals.length && (
          <div className="panel full">
            <Empty
              title="Sin objetivos activos"
              text="Define un objetivo y sus hitos en Proyectos."
              icon={Target}
            />
          </div>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>
            Proyectos activos <span className="count">{active.length}</span>
          </h2>
        </div>
        <button className="text-button" onClick={() => go("projects")}>
          Ver proyectos
          <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="project-grid">
        {active.slice(0, 6).map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            data={data}
            onClick={() => go("projects", "/projects/" + p.id)}
          />
        ))}
        {!active.length && (
          <div className="panel full">
            <Empty
              title="Sin proyectos activos"
              text="Crea un proyecto para organizar tus tareas."
              icon={FolderOpen}
            />
          </div>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>Mis avances</h2>
        </div>
        <button className="text-button" onClick={() => go("progress")}>
          Ver mis avances
          <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="metrics-grid">
        <Metric
          label="Tareas completadas"
          value={completedIds.size}
          caption="Esta semana"
        />
        <Metric
          label="Nuevas tareas"
          value={created}
          caption="Capturadas esta semana"
        />
        <Metric
          label="Reducción neta"
          value={completedIds.size - created}
          caption="Completadas − creadas"
        />
        <Metric
          label="Por seguir"
          value={
            data.tasks.filter(
              (t) =>
                !t.deleted_at &&
                ["pending_review", "waiting_external"].includes(t.status),
            ).length
          }
          caption="En espera o revisión"
        />
      </div>

    </>
  );
}
function localDate(iso: string, tz: string) {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(tz)
    .toPlainDate()
    .toString();
}
function Metric({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <div className="metric" data-tone={label==="Tareas completadas"?"completed":label==="Nuevas tareas"?"created":label==="Reducción neta"?(value>0?"positive":value<0?"negative":"neutral"):"neutral"}>
      <span>{label}</span>
      <strong>
        {value > 0 && label === "Reducción neta" ? "+" : ""}
        {value}
      </strong>
      <small>{caption}</small>
    </div>
  );
}
function PanelTitle({
  icon: Icon,
  title,
  subtitle,
  tag,
}: {
  icon: typeof Leaf;
  title: string;
  subtitle?: string;
  tag?: string;
}) {
  return (
    <div className="panel-title">
      <div className="panel-icon">
        <Icon size={19} />
      </div>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {tag && <span className="panel-tag">{tag}</span>}
    </div>
  );
}
function PeriodNav({
  date,
  onChange,
  step = 1,
  label,
}: {
  date: string;
  onChange: (d: string) => void;
  step?: number;
  label?: string;
}) {
  return (
    <div className="period-nav">
      <button
        className="icon-button"
        aria-label="Periodo anterior"
        onClick={() => onChange(dateAdd(date, -step))}
      >
        <ChevronLeft size={17} />
      </button>
      <span>
        {label && <small>{label}</small>}
        {niceDate(date)}
      </span>
      <button
        className="icon-button"
        aria-label="Periodo siguiente"
        onClick={() => onChange(dateAdd(date, step))}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
function FocusPanel({
  type,
  date,
  ...props
}: Shared & { type: "daily" | "weekly"; date: string }) {
  const { data, mutate } = props;
  const [adding, setAdding] = useState(false);
  const selected = data.focus
      .filter(
        (f) =>
          f.period_type === type &&
          f.period_start === date &&
          data.tasks.some((t) => t.id === f.task_id && !t.deleted_at),
      )
      .sort((a, b) => a.sort_order - b.sort_order),
    ids = selected.map((f) => f.task_id),
    limit = type === "weekly" ? 5 : 3;
  const save = (task_ids: string[]) =>
    mutate(`/api/focus/${type}/${date}`, "PUT", { task_ids });
  const move = (i: number, delta: number) => {
    const next = [...ids];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    save(next);
  };
  return (
    <>
      <div className="focus-list">
        {selected.map((item, i) => {
          const task = data.tasks.find((t) => t.id === item.task_id);
          return task && !task.deleted_at ? (
            <div key={item.id} className="focus-item">
              <span className="focus-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <TaskLine task={task} {...props} />
              <div className="reorder">
                <button
                  aria-label={"Subir " + task.title}
                  disabled={!i}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  aria-label={"Bajar " + task.title}
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  aria-label={"Quitar del foco " + task.title}
                  onClick={() => save(ids.filter((id) => id !== task.id))}
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ) : null;
        })}
        {!selected.length && (
          <div className="focus-empty">
            <span className="empty-orbit">
              <Target size={24} />
            </span>
            <p>
              {type === "weekly"
                ? "¿Qué merece tu atención esta semana?"
                : "Elige lo esencial para hoy."}
            </p>
            <small>Selecciona tareas que ya tienes, sin duplicarlas.</small>
          </div>
        )}
      </div>
      {ids.length < limit && (
        <button className="add-subtle" onClick={() => setAdding(!adding)}>
          <Plus size={16} />
          Elegir tarea {ids.length > 0 && `(${ids.length}/${limit})`}
        </button>
      )}
      {adding && (
        <div className="focus-picker">
          <label className="sr-only" htmlFor={"focus-" + type}>
            Elegir tarea para el foco
          </label>
          <select
            id={"focus-" + type}
            defaultValue=""
            onChange={async (e) => {
              if (e.target.value && (await save([...ids, e.target.value])))
                setAdding(false);
            }}
          >
            <option value="">Selecciona una tarea abierta…</option>
            {data.tasks
              .filter(
                (t) =>
                  !t.deleted_at &&
                  !["completed", "cancelled"].includes(t.status) &&
                  !ids.includes(t.id),
              )
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </div>
      )}
    </>
  );
}
function GoalCard({ goal, data }: { goal: Goal; data: Snapshot }) {
  const milestones = data.milestones.filter((m) => m.goal_id === goal.id),
    achieved = milestones.filter((m) => m.status === "achieved").length;
  return (
    <div className="goal-card">
      <span className="goal-label">
        <Target size={14} />
        {goal.period_end
          ? `Hasta ${niceDate(goal.period_end)}`
          : "Objetivo activo"}
      </span>
      <h3>{goal.title}</h3>
      {goal.description && <p>{goal.description}</p>}
      <div className="progress-track">
        <span
          style={{
            width: `${milestones.length ? (achieved / milestones.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="goal-bottom">
        <span>
          {milestones.length
            ? `${achieved} de ${milestones.length} hitos`
            : "Sin hitos definidos"}
        </span>
        {milestones.length > 0 && (
          <strong>{Math.round((achieved / milestones.length) * 100)}%</strong>
        )}
      </div>
    </div>
  );
}
function ProjectCard({
  project: p,
  data,
  onClick,
}: {
  project: Project;
  data: Snapshot;
  onClick: () => void;
}) {
  const tasks = data.tasks.filter(
      (t) =>
        !t.deleted_at &&
        t.project_id === p.id &&
        !["completed", "cancelled"].includes(t.status),
    ),
    next = data.milestones.find(
      (m) => m.project_id === p.id && m.status === "pending",
    );
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card-top">
        <span
          className="project-icon"
          style={{ background: p.color + "18", color: p.color }}
        >
          {p.icon && p.icon !== "folder" ? (
            <span className="custom-project-icon">{p.icon}</span>
          ) : (
            <FolderOpen size={20} />
          )}
        </span>
        <ArrowUpRight size={16} />
      </div>
      <h3>{p.name}</h3>
      {p.goal_id && (
        <div className="project-goal">
          <Target size={11} />
          {data.goals.find((g) => g.id === p.goal_id)?.title}
        </div>
      )}
      <p>{p.description || "Sin descripción"}</p>
      <div className="project-card-counts">
        <span>
          <strong>{tasks.length}</strong> abiertas
        </span>
        <span>
          <i className="dot state-dot in_progress" aria-hidden="true" />
          {tasks.filter((t) => t.status === "in_progress").length} en curso
        </span>
        <span>
          <i className="dot state-dot pending_review" aria-hidden="true" />
          {tasks.filter((t) => t.status === "pending_review").length} en revisión
        </span>
        <span>
          <i className="dot state-dot waiting_external" aria-hidden="true" />
          {tasks.filter((t) => t.status === "waiting_external").length} en espera
        </span>
      </div>
      {next && (
        <div className="next-milestone">
          <Flag size={12} />
          {next.title}
        </div>
      )}
    </button>
  );
}

type FilterProps = {
  activeOnly?:boolean; onClear?:()=>void; extraActive?:boolean;
  data: Snapshot;
  search: string;
  setSearch: (s: string) => void;
  projectFilter: string;
  setProjectFilter: (s: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  priorityFilter: string;
  setPriorityFilter: (s: string) => void;
};
function Filters(p: FilterProps) {
  const active=Boolean(p.search||p.projectFilter||p.statusFilter||p.priorityFilter||p.extraActive);
  const advanced=Boolean(p.projectFilter||p.statusFilter||p.priorityFilter);
  const clear=()=>{p.setSearch("");p.setProjectFilter("");p.setStatusFilter("");p.setPriorityFilter("");p.onClear?.();};
  return <div className="task-filter-tools">
    <div className="filters filter-search-row">
      <div className="search-field"><Search size={16}/><input aria-label="Buscar tareas" placeholder="Buscar tareas…" value={p.search} onChange={event=>p.setSearch(event.target.value)}/></div>
      {active&&<button type="button" className="text-button" onClick={clear}>Limpiar filtros</button>}
    </div>
    <details className="advanced-filters" open={advanced||undefined}>
      <summary>Filtros avanzados{advanced?" · activos":""}</summary>
      <div className="filters">
        <select aria-label="Filtrar por proyecto" value={p.projectFilter} onChange={event=>p.setProjectFilter(event.target.value)}>
          <option value="">Todos los proyectos</option><option value="inbox">Bandeja de entrada</option>
          {p.data.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select aria-label="Filtrar por estado" value={p.statusFilter} onChange={event=>p.setStatusFilter(event.target.value)}>
          <option value="">{p.activeOnly?"Estados activos":"Todos los estados"}</option>
          {STATUSES.filter(status=>!p.activeOnly||!["completed","cancelled"].includes(status)).map(status=><option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
        <select aria-label="Filtrar por prioridad" value={p.priorityFilter} onChange={event=>p.setPriorityFilter(event.target.value)}>
          <option value="">Toda prioridad</option>{PRIORITIES.map(priority=><option key={priority} value={priority}>{priorityLabels[priority]}</option>)}
        </select>
      </div>
    </details>
  </div>;
}

function TaskDialog({
  task,
  onClose,
  ...props
}: Shared & { task: Task; onClose: () => void }) {
  const { data, mutate, updateTask, today } = props;
  const baseline = useRef({ ...task });
  const [draft, setDraft] = useState({ ...task }),
    [tagsText, setTagsText] = useState(task.tags.join(", ")),
    [subtask, setSubtask] = useState(""),
    [linkDate, setLinkDate] = useState(today);
  const events = data.events
    .filter((e) => e.task_id === task.id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const set = (key: keyof Task, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  useEffect(() => {
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const first =
      document.querySelector<HTMLInputElement>(".task-dialog input");
    first?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const dialog = document.querySelector(".task-dialog");
      const targets = dialog?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input, select, textarea",
      );
      if (!targets?.length) return;
      const first = targets[0],
        last = targets[targets.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {document.removeEventListener("keydown", handler);document.body.style.overflow=previousOverflow;opener?.focus({preventScroll:true});};
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-title"
      >
        <div className="dialog-top">
          <span className="eyebrow">DETALLE DE LA TAREA</span>
          <button
            className="icon-button"
            aria-label="Cerrar detalle"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fields = {
              title: draft.title,
              description: draft.description,
              status: draft.status,
              priority: draft.priority,
              project_id: draft.project_id,
              parent_task_id: draft.parent_task_id,
              due_at: draft.due_at,
              waiting_on: draft.waiting_on,
              follow_up_at: draft.follow_up_at,
              tags: tagsText
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            };
            const changed = Object.fromEntries(
              Object.entries(fields).filter(
                ([key, value]) =>
                  JSON.stringify(value) !==
                  JSON.stringify(baseline.current[key as keyof Task]),
              ),
            );
            if (
              !Object.keys(changed).length ||
              (await updateTask(task.id, changed))
            )
              onClose();
          }}
        >
          <label>
            Título
            <input
              id="task-title"
              required
              maxLength={500}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <label>
            Descripción
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Añade contexto, si lo necesitas…"
            />
          </label>
          <div className="form-grid">
            <label>
              Estado
              <select
                className={"status-select status-" + draft.status}
                value={draft.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabels[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabels[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Proyecto
              <select
                value={draft.project_id ?? ""}
                onChange={(e) => set("project_id", e.target.value || null)}
              >
                <option value="">Bandeja de entrada</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tarea principal
              <select
                value={draft.parent_task_id ?? ""}
                onChange={(e) => set("parent_task_id", e.target.value || null)}
              >
                <option value="">Sin tarea principal</option>
                {data.tasks
                  .filter(
                    (t) =>
                      t.id !== task.id && !t.deleted_at && !t.parent_task_id,
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Vencimiento
              <input
                type="date"
                value={draft.due_at?.slice(0, 10) ?? ""}
                onChange={(e) => set("due_at", e.target.value || null)}
              />
            </label>
            <label>
              Seguimiento
              <input
                type="date"
                value={draft.follow_up_at?.slice(0, 10) ?? ""}
                onChange={(e) => set("follow_up_at", e.target.value || null)}
              />
            </label>
          </div>
          <label>
            En espera de
            <input
              value={draft.waiting_on}
              onChange={(e) => set("waiting_on", e.target.value)}
              placeholder="Persona, respuesta o entrega (opcional)"
            />
          </label>
          <label>
            Etiquetas, separadas por comas
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="button danger-quiet"
              onClick={async () => {
                if (
                  confirm(
                    "¿Eliminar esta tarea? Se ocultará de las vistas, conservando su registro histórico.",
                  )
                ) {
                  if (await mutate("/api/tasks/" + task.id, "DELETE"))
                    onClose();
                }
              }}
            >
              <Trash2 size={15} />
              Eliminar
            </button>
            <button className="button primary" disabled={props.busy}>
              Guardar cambios
              <Check size={16} />
            </button>
          </div>
        </form>
        <section className="dialog-section">
          <h3>Subtareas</h3>
          {data.tasks
            .filter((t) => !t.deleted_at && t.parent_task_id === task.id)
            .map((t) => (
              <TaskLine task={t} key={t.id} {...props} />
            ))}
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                subtask.trim() &&
                (await mutate("/api/tasks", "POST", {
                  text: subtask,
                  parent_task_id: task.id,
                  project_id: task.project_id,
                  request_id: requestId(),
                }))
              )
                setSubtask("");
            }}
          >
            <input
              aria-label="Nueva subtarea"
              placeholder="Añadir subtarea…"
              value={subtask}
              onChange={(e) => setSubtask(e.target.value)}
            />
            <button className="button" disabled={!subtask.trim()}>
              <Plus size={15} />
            </button>
          </form>
        </section>
        <section className="dialog-section">
          <h3>Vincular al diario</h3>
          <div className="inline-form">
            <input
              aria-label="Día del diario para vincular"
              type="date"
              value={linkDate}
              onChange={(e) => setLinkDate(e.target.value)}
            />
            <button
              className="button"
              onClick={() => {
                const entry = data.journals.find(
                  (j) => j.entry_date === linkDate,
                );
                mutate("/api/journals/" + linkDate + "/blocks", "POST", {
                  text: "",
                  task_id: task.id,
                  request_id: requestId(),
                  revision: entry?.revision ?? 0,
                });
              }}
            >
              Vincular
            </button>
          </div>
        </section>
        <section className="dialog-section">
          <h3>Historial verificado</h3>
          {task.completed_at && (
            <p className="completion-note">
              Completada el {niceDate(task.completed_at, data.user.timezone)}
            </p>
          )}
          <ol className="event-history">
            {events.map((e) => (
              <li key={e.id}>
                <span className="event-dot" />
                <div>
                  <strong>{eventLabel(e.event_type)}</strong>
                  {e.to_value_json && (
                    <small>{eventValue(e.to_value_json, data)}</small>
                  )}
                  <time>{niceDate(e.occurred_at, data.user.timezone)}</time>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </section>
    </div>
  );
}
function eventLabel(type: string) {
  return (
    (
      {
        created: "Tarea creada",
        completed: "Tarea completada",
        reopened: "Tarea reabierta",
        cancelled: "Tarea cancelada",
        status_changed: "Estado actualizado",
        priority_changed: "Prioridad actualizada",
        project_changed: "Proyecto actualizado",
        title_changed: "Título actualizado",
        deleted: "Tarea eliminada",
        restored: "Tarea restaurada",
      } as Record<string, string>
    )[type] ?? "Tarea actualizada"
  );
}
function eventValue(json: string, data: Snapshot) {
  try {
    const v = JSON.parse(json);
    if (typeof v === "string")
      return (
        statusLabels[v as Status] ?? priorityLabels[v as Task["priority"]] ?? v
      );
    if (v && typeof v === "object") {
      return [
        v.status && statusLabels[v.status as Status],
        v.priority &&
          "Prioridad: " + priorityLabels[v.priority as Task["priority"]],
        "project_id" in v &&
          "Proyecto: " +
            (data.projects.find((p) => p.id === v.project_id)?.name ??
              "Bandeja de entrada"),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return "";
  } catch {
    return "";
  }
}

function JournalPage({
  date,
  onDate,
  ...props
}: Shared & { date: string; onDate: (date: string) => void }) {
  const { data, mutate } = props;
  const entry = data.journals.find((j) => j.entry_date === date),
    blocks = data.blocks
      .filter((b) => b.journal_entry_id === entry?.id)
      .sort((a, b) => a.sort_order - b.sort_order),
    [text, setText] = useState(""),
    [indent, setIndent] = useState(0),
    [search, setSearch] = useState(""),
    [request, setRequest] = useState(requestId());
  const pendingAppend = useRef<{
    key: string;
    payload: {
      text: string;
      indent_level: number;
      revision: number;
      request_id: string;
    };
  } | null>(null);
  const append = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const key = JSON.stringify([date, text, indent]);
    if (pendingAppend.current?.key !== key)
      pendingAppend.current = {
        key,
        payload: {
          text,
          indent_level: indent,
          revision: entry?.revision ?? 0,
          request_id: request,
        },
      };
    if (
      await mutate(
        "/api/journals/" + date + "/blocks",
        "POST",
        pendingAppend.current.payload,
      )
    ) {
      pendingAppend.current = null;
      setText("");
      setRequest(requestId());
    }
  };
  return (
    <>
      <PageHeading
        title="Mi diario"
        subtitle="Notas y tareas vinculadas por día."
        action={
          <div className="journal-date">
            <PeriodNav date={date} onChange={onDate} />
            <input
              type="date"
              aria-label="Fecha del diario"
              value={date}
              onChange={(e) => e.target.value && onDate(e.target.value)}
            />
          </div>
        }
      />
      <div className="journal-layout">
        <section className="journal-paper">
          <div className="journal-paper-header">
            <span className="eyebrow">
              {date === props.today ? "HOY" : "TU DIARIO"}
            </span>
            <h2>
              {new Intl.DateTimeFormat("es", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00:00Z"))}
            </h2>
            <span>
              {blocks.length} bloques ·{" "}
              {entry ? "Guardado en tu espacio" : "Un día por escribir"}
            </span>
          </div>
          <div className="journal-blocks">
            {blocks.map((block) => (
              <JournalBlockView
                key={block.id}
                block={block}
                revision={entry?.revision ?? 0}
                {...props}
              />
            ))}
            {!blocks.length && (
              <div className="journal-prompt">
                <p>¿Qué tienes en mente hoy?</p>
                <span>
                  Una idea, una nota o ese primer paso que quieres dar.
                </span>
              </div>
            )}
          </div>
          <form className="journal-compose" onSubmit={append}>
            <textarea
              aria-label="Escribir en el diario"
              rows={3}
              placeholder={
                "Escribe una nota…\n- [ ] Una tarea · # Un encabezado"
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setRequest(requestId());
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="journal-compose-tools">
              <select
                aria-label="Indentación del bloque"
                value={indent}
                onChange={(e) => setIndent(Number(e.target.value))}
              >
                <option value={0}>Nivel principal</option>
                <option value={1}>↳ Subtarea / indentado</option>
              </select>
              <span>Enter para guardar · Mayús+Enter para salto</span>
              <button
                className="button primary"
                disabled={!text.trim() || props.busy}
              >
                Añadir
                <Plus size={16} />
              </button>
            </div>
          </form>
        </section>
        <aside className="journal-aside">
          <div className="panel journal-tips">
            <BookOpen size={22} />
            <h3>Escribe a tu manera.</h3>
            <p>
              Las notas siguen siendo notas. Las tareas se conectan con todo tu
              espacio.
            </p>
            <dl>
              <dt>Una tarea</dt>
              <dd>
                <code>- [ ] Preparar propuesta</code>
              </dd>
              <dt>Prioridad rápida</dt>
              <dd>
                <code>! Alta · !! Crítica</code>
              </dd>
              <dt>Contexto de proyecto</dt>
              <dd>
                <code># Nombre del proyecto</code>
                <span>
                  Un encabezado existente da contexto a las siguientes tareas.
                </span>
              </dd>
              <dt>Proyecto en una línea</dt>
              <dd>
                <code>- [ ] Revisar #proyecto</code>
              </dd>
              <dt>Subtarea</dt>
              <dd>Selecciona el nivel indentado después de una tarea.</dd>
            </dl>
          </div>
          <div className="panel">
            <h3>Otros días</h3>
            <input
              aria-label="Buscar días del diario"
              placeholder="Buscar en el diario…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="journal-days">
              {data.journals
                .filter(
                  (j) =>
                    !search ||
                    j.entry_date.includes(search) ||
                    data.blocks.some(
                      (b) =>
                        b.journal_entry_id === j.id &&
                        b.text_content
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    ),
                )
                .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
                .slice(0, 15)
                .map((j) => (
                  <button
                    key={j.id}
                    className={j.entry_date === date ? "selected" : ""}
                    onClick={() => onDate(j.entry_date)}
                  >
                    {niceDate(j.entry_date)}
                    <ChevronRight size={14} />
                  </button>
                ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
function JournalBlockView({
  block,
  revision,
  ...props
}: Shared & { block: JournalBlock; revision: number }) {
  const { data, mutate } = props;
  const [editing, setEditing] = useState(false),
    [text, setText] = useState(block.text_content),
    [editRevision, setEditRevision] = useState(revision);
  const task = data.tasks.find((t) => t.id === block.task_id);
  return (
    <div
      className={"journal-block block-" + block.block_type}
      style={{ marginLeft: block.indent_level * 25 }}
    >
      {block.block_type === "task_reference" ? (
        task && !task.deleted_at ? (
          <TaskLine task={task} {...props} />
        ) : (
          <span className="muted">Referencia a una tarea eliminada</span>
        )
      ) : editing ? (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate("/api/blocks/" + block.id, "PATCH", {
                revision: editRevision,
                text_content: text,
              })
            )
              setEditing(false);
          }}
        >
          <input
            autoFocus
            aria-label="Editar bloque"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="icon-button" aria-label="Guardar bloque">
            <Check size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Cancelar edición"
            onClick={() => setEditing(false)}
          >
            <X size={16} />
          </button>
        </form>
      ) : (
        <button
          className="block-text"
          onClick={() => {
            setText(block.text_content);
            setEditRevision(revision);
            setEditing(true);
          }}
        >
          {block.block_type === "bullet" && <span>• </span>}
          {block.text_content}
        </button>
      )}
      <button
        className="block-delete"
        aria-label="Quitar bloque del diario"
        title="Quitar mención (conserva la tarea)"
        onClick={() => {
          if (
            confirm(
              "¿Quitar este bloque del diario? Las tareas vinculadas se conservan.",
            )
          )
            mutate("/api/blocks/" + block.id, "DELETE", { revision });
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function ProjectsPage({
  selectedId,
  go,
  ...props
}: Shared & {
  selectedId: string | null;
  go: (p: Page, path?: string) => void;
}) {
  const { data, mutate } = props,
    [create, setCreate] = useState(false),
    [showArchived, setShowArchived] = useState(false),
    [view, setView] = useState("cards");
  const project = data.projects.find((p) => p.id === selectedId);
  if (selectedId && project)
    return (
      <ProjectDetail key={project.id} project={project} {...props} go={go} />
    );
  return (
    <>
      <PageHeading
        title="Proyectos y objetivos"
        subtitle="Proyectos, objetivos e hitos."
        action={
          <button className="button primary" onClick={() => setCreate(!create)}>
            <Plus size={16} />
            Nuevo proyecto
          </button>
        }
      />
      {create && (
        <EntityForm
          kind="project"
          data={data}
          onSave={async (body) => {
            if (await mutate("/api/projects", "POST", body)) setCreate(false);
          }}
          onCancel={() => setCreate(false)}
        />
      )}
      <div className="section-heading">
        <h2>
          Proyectos{" "}
          <span className="count">
            {
              data.projects.filter(
                (p) => showArchived || p.status !== "archived",
              ).length
            }
          </span>
        </h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Incluir archivados
        </label>
      </div>
      <div className="segmented project-view-toggle">
        <button
          className={view === "cards" ? "selected" : ""}
          onClick={() => setView("cards")}
        >
          <LayoutGrid size={15} />
          Tarjetas
        </button>
        <button
          className={view === "table" ? "selected" : ""}
          onClick={() => setView("table")}
        >
          <List size={15} />
          Tabla de proyectos
        </button>
      </div>
      {view === "table" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Objetivo estratégico</th>
                <th>Estado</th>
                <th>Fecha objetivo</th>
                <th>Tareas abiertas</th>
              </tr>
            </thead>
            <tbody>
              {data.projects
                .filter((p) => showArchived || p.status !== "archived")
                .map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="table-title"
                        onClick={() => go("projects", "/projects/" + p.id)}
                      >
                        {p.icon && p.icon !== "folder" ? p.icon : "◈"} {p.name}
                      </button>
                    </td>
                    <td>
                      {data.goals.find((g) => g.id === p.goal_id)?.title ??
                        "Sin objetivo"}
                    </td>
                    <td>
                      {p.status === "active"
                        ? "Activo"
                        : p.status === "on_hold"
                          ? "En pausa"
                          : "Archivado"}
                    </td>
                    <td>{p.target_date ? niceDate(p.target_date) : "—"}</td>
                    <td>
                      {
                        data.tasks.filter(
                          (t) =>
                            !t.deleted_at &&
                            t.project_id === p.id &&
                            !["completed", "cancelled"].includes(t.status),
                        ).length
                      }
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="project-grid">
          {data.projects
            .filter((p) => showArchived || p.status !== "archived")
            .map((p) => (
              <ProjectCard
                project={p}
                data={data}
                key={p.id}
                onClick={() => go("projects", "/projects/" + p.id)}
              />
            ))}
          {!data.projects.length && (
            <div className="panel full">
              <Empty
                title="No hay proyectos"
                text="Crea un proyecto con su nombre."
                icon={FolderOpen}
              />
            </div>
          )}
        </div>
      )}
      <GoalsManager {...props} />
    </>
  );
}
function EntityForm({
  kind,
  data,
  initial,
  onSave,
  onCancel,
}: {
  kind: "project" | "goal" | "milestone";
  data: Snapshot;
  initial?: Record<string, any>;
  onSave: (body: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? initial?.title ?? ""),
    [description, setDescription] = useState(initial?.description ?? ""),
    [goalId, setGoalId] = useState(initial?.goal_id ?? ""),
    [projectId, setProjectId] = useState(initial?.project_id ?? ""),
    [color, setColor] = useState(initial?.color ?? "#39786e"),
    [icon, setIcon] = useState(initial?.icon ?? ""),
    [date, setDate] = useState(
      initial?.target_date ?? initial?.period_end ?? "",
    ),
    [start, setStart] = useState(initial?.period_start ?? ""),
    [status, setStatus] = useState(
      initial?.status ?? (kind === "milestone" ? "pending" : "active"),
    );
  return (
    <form
      className="entity-form panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const body =
          kind === "project"
            ? {
                name,
                description,
                goal_id: goalId || null,
                color,
                icon: icon.trim() || "◈",
                target_date: date || null,
                status,
              }
            : kind === "goal"
              ? {
                  title: name,
                  description,
                  period_start: start || null,
                  period_end: date || null,
                  status,
                }
              : {
                  title: name,
                  description,
                  goal_id: goalId || null,
                  project_id: projectId || null,
                  status,
                };
        await onSave(body);
      }}
    >
      <h3>
        {initial ? "Editar" : "Nuevo"}{" "}
        {kind === "project"
          ? "proyecto"
          : kind === "goal"
            ? "objetivo"
            : "hito"}
      </h3>
      <label>
        {kind === "project" ? "Nombre" : "Título"}
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="¿Qué quieres conseguir?"
        />
      </label>
      <label>
        Descripción
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="form-grid">
        {kind !== "goal" && (
          <label>
            Objetivo estratégico
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Sin objetivo asociado</option>
              {data.goals.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "milestone" && (
          <label>
            Proyecto
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Sin proyecto</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "project" && (
          <label>
            Icono (texto o emoji)
            <input
              maxLength={24}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="◈"
            />
          </label>
        )}
        {kind === "project" && (
          <label>
            Color
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        )}
        {kind === "goal" && (
          <label>
            Inicio
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
        )}
        {kind !== "milestone" && (
          <label>
            Fecha objetivo
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        <label>
          Estado
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {(kind === "project"
              ? ["active", "on_hold", "archived"]
              : kind === "goal"
                ? ["active", "achieved", "paused", "archived"]
                : ["pending", "achieved"]
            ).map((s) => (
              <option value={s} key={s}>
                {
                  (
                    {
                      active: "Activo",
                      on_hold: "En pausa",
                      archived: "Archivado",
                      achieved: "Conseguido",
                      paused: "En pausa",
                      pending: "Pendiente",
                    } as Record<string, string>
                  )[s]
                }
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancelar
        </button>
        <button className="button primary">
          Guardar
          <Check size={16} />
        </button>
      </div>
    </form>
  );
}
function GoalsManager(props: Shared) {
  const { data, mutate } = props,
    [create, setCreate] = useState<"goal" | "milestone" | null>(null),
    [edit, setEdit] = useState<Goal | null>(null);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">EL PORQUÉ DETRÁS DEL QUÉ</span>
          <h2>Objetivos estratégicos</h2>
        </div>
        <div className="button-row">
          <button
            className="button"
            onClick={() => {
              setCreate("milestone");
              setEdit(null);
            }}
          >
            <Flag size={15} />
            Nuevo hito
          </button>
          <button
            className="button primary"
            onClick={() => {
              setCreate("goal");
              setEdit(null);
            }}
          >
            <Plus size={15} />
            Nuevo objetivo
          </button>
        </div>
      </div>
      {create && (
        <EntityForm
          key={create}
          kind={create}
          data={data}
          onSave={async (body) => {
            if (
              await mutate(
                "/api/" + (create === "goal" ? "goals" : "milestones"),
                "POST",
                body,
              )
            )
              setCreate(null);
          }}
          onCancel={() => setCreate(null)}
        />
      )}{" "}
      {edit && (
        <EntityForm
          key={edit.id}
          kind="goal"
          data={data}
          initial={edit}
          onSave={async (body) => {
            if (await mutate("/api/goals/" + edit.id, "PATCH", body))
              setEdit(null);
          }}
          onCancel={() => setEdit(null)}
        />
      )}
      <div className="goal-grid">
        {data.goals.map((g) => (
          <div key={g.id} className="goal-with-milestones">
            <GoalCard goal={g} data={data} />
            <div className="goal-actions">
              <span className="muted">
                {g.status === "active"
                  ? "Activo"
                  : g.status === "achieved"
                    ? "Conseguido"
                    : g.status === "paused"
                      ? "En pausa"
                      : "Archivado"}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setEdit(g);
                  setCreate(null);
                }}
              >
                Editar
              </button>
            </div>
            <MilestoneList
              milestones={data.milestones.filter((m) => m.goal_id === g.id)}
              {...props}
            />
          </div>
        ))}
      </div>
      {!data.goals.length && (
        <div className="panel">
          <Empty
            title="Sin objetivos"
            text="Define un objetivo y mide avances reales mediante hitos, no por cantidad de tareas."
            icon={Target}
          />
        </div>
      )}
      {data.milestones.some((m) => !m.goal_id) && (
        <div className="panel standalone-milestones">
          <h3>Hitos sin objetivo</h3>
          <MilestoneList
            milestones={data.milestones.filter((m) => !m.goal_id)}
            {...props}
          />
        </div>
      )}
    </>
  );
}
function MilestoneList({
  milestones,
  ...props
}: Shared & { milestones: Snapshot["milestones"] }) {
  const [edit, setEdit] = useState<Snapshot["milestones"][number] | null>(null);
  return (
    <div className="milestone-list">
      {milestones.map((m) => (
        <div key={m.id} className="milestone-line">
          <button
            className="check-task"
            aria-label={
              (m.status === "achieved" ? "Reabrir hito " : "Conseguir hito ") +
              m.title
            }
            onClick={() =>
              props.mutate("/api/milestones/" + m.id, "PATCH", {
                status: m.status === "achieved" ? "pending" : "achieved",
              })
            }
          >
            {m.status === "achieved" ? (
              <CheckCircle2 size={18} />
            ) : (
              <Circle size={18} />
            )}
          </button>
          <button
            className={
              "milestone-title " + (m.status === "achieved" ? "done" : "")
            }
            onClick={() => setEdit(m)}
          >
            {m.title}
            {m.achieved_at && (
              <small>{niceDate(m.achieved_at, props.data.user.timezone)}</small>
            )}
          </button>
        </div>
      ))}
      {edit && (
        <EntityForm
          key={edit.id}
          kind="milestone"
          data={props.data}
          initial={edit}
          onSave={async (body) => {
            if (await props.mutate("/api/milestones/" + edit.id, "PATCH", body))
              setEdit(null);
          }}
          onCancel={() => setEdit(null)}
        />
      )}
    </div>
  );
}
function ProjectDetail({
  project,
  go,
  ...props
}: Shared & { project: Project; go: (p: Page, path?: string) => void }) {
  const { data, mutate } = props,
    [editing, setEditing] = useState(false),
    [newTask, setNewTask] = useState(""),
    [hito, setHito] = useState(false);
  const tasks = data.tasks.filter(
      (t) => !t.deleted_at && t.project_id === project.id,
    ),
    goal = data.goals.find((g) => g.id === project.goal_id),
    entryIds = new Set(
      data.blocks
        .filter((b) => b.task_id && tasks.some((t) => t.id === b.task_id))
        .map((b) => b.journal_entry_id),
    );
  return (
    <>
      <button className="text-button back-link" onClick={() => go("projects")}>
        <ChevronLeft size={16} />
        Todos los proyectos
      </button>
      <PageHeading
        eyebrow={
          project.status === "archived"
            ? "PROYECTO ARCHIVADO"
            : project.status === "on_hold"
              ? "PROYECTO EN PAUSA"
              : "TU PRÓXIMO GRAN PASO"
        }
        title={project.name}
        subtitle={
          project.description || "Cada proyecto empieza con un primer paso."
        }
        action={
          <button className="button" onClick={() => setEditing(!editing)}>
            Editar proyecto
          </button>
        }
      />
      {editing && (
        <EntityForm
          kind="project"
          data={data}
          initial={project}
          onSave={async (body) => {
            if (await mutate("/api/projects/" + project.id, "PATCH", body))
              setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className="project-detail-meta">
        {goal && (
          <span>
            <Target size={16} />
            {goal.title}
          </span>
        )}
        {project.target_date && (
          <span>Fecha objetivo: {niceDate(project.target_date)}</span>
        )}
      </div>
      <div className="status-summary">
        {STATUSES.map((s) => (
          <div key={s}>
            <strong>{tasks.filter((t) => t.status === s).length}</strong>
            <span className={"task-inline-status status-"+s}>{statusLabels[s]}</span>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>Hitos del proyecto</h2>
        <button className="text-button" onClick={() => setHito(!hito)}>
          <Plus size={16} />
          Nuevo hito
        </button>
      </div>
      {hito && (
        <EntityForm
          kind="milestone"
          data={data}
          initial={{
            project_id: project.id,
            goal_id: project.goal_id,
            status: "pending",
          }}
          onSave={async (body) => {
            if (await mutate("/api/milestones", "POST", body)) setHito(false);
          }}
          onCancel={() => setHito(false)}
        />
      )}
      <div className="panel">
        <MilestoneList
          milestones={data.milestones.filter(
            (m) => m.project_id === project.id,
          )}
          {...props}
        />
        {!data.milestones.some((m) => m.project_id === project.id) && (
          <p className="muted">
            Sin hitos definidos. Añade un resultado que merezca celebrarse.
          </p>
        )}
      </div>
      <div className="section-heading">
        <h2>Próximos pasos</h2>
      </div>
      <form
        className="inline-form project-capture"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            newTask.trim() &&
            (await mutate("/api/tasks", "POST", {
              text: newTask,
              project_id: project.id,
              request_id: requestId(),
            }))
          )
            setNewTask("");
        }}
      >
        <input
          placeholder="Añadir una tarea a este proyecto…"
          aria-label="Nueva tarea del proyecto"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
        />
        <button className="button primary" disabled={!newTask.trim()}>
          <Plus size={16} />
          Añadir
        </button>
      </form>
      <TaskTable
        defaultSort="priority"
        tasks={tasks
          .filter((t) => !["completed", "cancelled"].includes(t.status))
          .sort(
            (a, b) =>
              PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority),
          )}
        {...props}
      />
      <div className="section-heading">
        <h2>Avances recientes</h2>
      </div>
      <div className="panel">
        {tasks
          .filter((t) => t.status === "completed")
          .sort((a, b) =>
            (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
          )
          .slice(0, 10)
          .map((t) => (
            <TaskLine key={t.id} task={t} {...props} />
          ))}
        {!tasks.some((t) => t.status === "completed") && (
          <p className="muted">Tus próximas finalizaciones aparecerán aquí.</p>
        )}
      </div>
      <div className="section-heading">
        <h2>En tu diario</h2>
      </div>
      <div className="panel journal-days">
        {data.journals
          .filter((j) => entryIds.has(j.id))
          .map((j) => (
            <button
              key={j.id}
              onClick={() => go("journal", "/journal/" + j.entry_date)}
            >
              <BookOpen size={16} />
              {niceDate(j.entry_date)}
              <ArrowUpRight size={15} />
            </button>
          ))}
        {!entryIds.size && (
          <p className="muted">
            Aún no hay tareas de este proyecto vinculadas al diario.
          </p>
        )}
      </div>
    </>
  );
}

function ProgressPage({
  read,
  ...props
}: Shared & { read: (path: string) => Promise<any> }) {
  const { data, today } = props,
    [start, setStart] = useState(weekOf(today, data.user.week_start_day)),
    [mode, setMode] = useState<"weekly" | "monthly">("weekly"),
    [analytics, setAnalytics] = useState<Analytics | null>(null),
    [error, setError] = useState(""),
    [project, setProject] = useState("");
  const end =
    mode === "weekly"
      ? dateAdd(start, 7)
      : Temporal.PlainDate.from(start).add({ months: 1 }).toString();
  useEffect(() => {
    let active = true;
    setAnalytics(null);
    read(`/api/analytics?start=${start}&end=${end}`)
      .then((a) => {
        if (active) setAnalytics(a);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [read, start, end, data]);
  const changeMode = (m: "weekly" | "monthly") => {
    setMode(m);
    setStart(
      m === "weekly"
        ? weekOf(today, data.user.week_start_day)
        : today.slice(0, 7) + "-01",
    );
  };
  return (
    <>
      <PageHeading
        title="Mis avances"
        subtitle="Resultados verificados del periodo."
        action={
          <div className="segmented">
            <button
              className={mode === "weekly" ? "selected" : ""}
              onClick={() => changeMode("weekly")}
            >
              Semana
            </button>
            <button
              className={mode === "monthly" ? "selected" : ""}
              onClick={() => changeMode("monthly")}
            >
              Mes
            </button>
          </div>
        }
      />
      <div className="analytics-period">
        <button
          className="icon-button"
          aria-label="Periodo anterior"
          onClick={() =>
            setStart(
              mode === "weekly"
                ? dateAdd(start, -7)
                : Temporal.PlainDate.from(start)
                    .subtract({ months: 1 })
                    .toString(),
            )
          }
        >
          <ChevronLeft />
        </button>
        <strong>
          {niceDate(start)} — {niceDate(dateAdd(end, -1))}
        </strong>
        <button
          className="icon-button"
          aria-label="Periodo siguiente"
          onClick={() => setStart(end)}
        >
          <ChevronRight />
        </button>
        <span>{data.user.timezone}</span>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {!analytics ? (
        <div className="panel">
          <LoaderCircle className="spin" /> Calculando avances…
        </div>
      ) : (
        <>
          <div className="metrics-grid">
            <Metric
              label="Tareas completadas"
              value={analytics.completed}
              caption="Tareas distintas con finalización verificada"
            />
            <Metric
              label="Nuevas tareas"
              value={analytics.created}
              caption="Creaciones reales en el periodo"
            />
            <Metric
              label="Reducción neta"
              value={analytics.net}
              caption="Completadas − creadas"
            />
            <Metric
              label="Backlog al cierre"
              value={analytics.ending_backlog}
              caption="Tareas abiertas al final del periodo"
            />
          </div>
          <div className="analytics-notes">
            <span>
              Reaperturas: <strong>{analytics.reopened}</strong>
            </span>
            <span>
              Cancelaciones: <strong>{analytics.cancelled}</strong>
            </span>
            <span>Una misma tarea cuenta una vez por periodo.</span>
            <span>Capturar trabajo nuevo puede aumentar el backlog; no mide productividad.</span>
          </div>
          <div className="dashboard-grid">
            <section className="panel chart-panel">
              <PanelTitle
                icon={BarChart3}
                title="Actividad diaria"
                subtitle="Creaciones y finalizaciones verificadas por día."
              />
              <div className="chart-legend">
                <span>
                  <i className="dot teal" />
                  Completadas
                </span>
                <span>
                  <i className="dot slate" />
                  Creadas
                </span>
              </div>
              <div
                className="bar-chart"
                role="img"
                aria-label="Tareas completadas y creadas por día"
              >
                {analytics.series.map((s) => {
                  const max = Math.max(
                    1,
                    ...analytics.series.flatMap((p) => [
                      p.created,
                      p.completed,
                    ]),
                  );
                  return (
                    <div
                      key={s.date}
                      className="bar-group"
                      title={`${s.date}: ${s.completed} completadas, ${s.created} creadas`}
                    >
                      <div className="bars">
                        <span
                          className="bar completed"
                          style={{
                            height:
                              Math.max(
                                s.completed ? 3 : 0,
                                (s.completed / max) * 100,
                              ) + "%",
                          }}
                        />
                        <span
                          className="bar created"
                          style={{
                            height:
                              Math.max(
                                s.created ? 3 : 0,
                                (s.created / max) * 100,
                              ) + "%",
                          }}
                        />
                      </div>
                      <small>{s.date.slice(8)}</small>
                    </div>
                  );
                })}
              </div>
              <details className="chart-data">
                <summary>Ver datos del gráfico</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Día</th>
                      <th>Completadas</th>
                      <th>Creadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.series.map((s) => (
                      <tr key={s.date}>
                        <td>{s.date}</td>
                        <td>{s.completed}</td>
                        <td>{s.created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </section>
            <section className="panel">
              <PanelTitle
                icon={LayoutGrid}
                title="Cómo está tu espacio"
                subtitle="Distribución de tareas al cierre del periodo."
              />
              {STATUSES.filter(
                (s) => !["completed", "cancelled"].includes(s),
              ).map((s) => (
                <div className="distribution-row" key={s}>
                  <span>
                    <i className={"dot state-dot " + s} />
                    {statusLabels[s]}
                  </span>
                  <strong>{analytics.distribution[s] ?? 0}</strong>
                </div>
              ))}
              <h3 className="mini-title">Por prioridad</h3>
              {PRIORITIES.map((p) => (
                <div className="distribution-row" key={p}>
                  <Priority value={p} />
                  <strong>
                    {
                      data.tasks.filter(
                        (t) =>
                          !t.deleted_at &&
                          !["completed", "cancelled"].includes(t.status) &&
                          t.priority === p,
                      ).length
                    }
                  </strong>
                </div>
              ))}
            </section>
          </div>
          <section className="panel project-distribution">
            <h3>Trabajo abierto por proyecto</h3>
            {[
              ...data.projects.map((p) => ({ id: p.id, name: p.name })),
              { id: null, name: "Bandeja de entrada" },
            ].map((p) => (
              <div className="distribution-row" key={p.id ?? "inbox"}>
                <span>{p.name}</span>
                <strong>
                  {
                    data.tasks.filter(
                      (t) =>
                        !t.deleted_at &&
                        !["completed", "cancelled"].includes(t.status) &&
                        t.project_id === p.id,
                    ).length
                  }
                </strong>
              </div>
            ))}
          </section>
          <div className="section-heading">
            <h2>Lo que has conseguido</h2>
            <select
              aria-label="Filtrar logros por proyecto"
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">Todos los proyectos</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="panel achievements">
            {analytics.achievements
              .filter(
                (e, i, list) =>
                  list.findIndex((x) => x.task_id === e.task_id) === i,
              )
              .filter(
                (e) =>
                  !project ||
                  data.tasks.find((t) => t.id === e.task_id)?.project_id ===
                    project,
              )
              .map((e) => {
                const t = data.tasks.find((t) => t.id === e.task_id);
                return t ? (
                  <div className="achievement" key={e.id}>
                    <span className="achievement-icon">
                      <Check size={18} />
                    </span>
                    <button onClick={() => props.openTask(t)}>
                      <strong>{t.title}</strong>
                      <small>
                        {niceDate(e.occurred_at, data.user.timezone)}
                      </small>
                    </button>
                    <span className="achievement-type">Tarea completada</span>
                  </div>
                ) : null;
              })}
            {analytics.milestones
              .filter((m) => !project || m.project_id === project)
              .map((m) => (
                <div className="achievement" key={m.id}>
                  <span className="achievement-icon">
                    <Flag size={18} />
                  </span>
                  <div>
                    <strong>{m.title}</strong>
                    <small>
                      {m.achieved_at
                        ? niceDate(m.achieved_at, data.user.timezone)
                        : "Fecha desconocida / importada"}
                    </small>
                  </div>
                  <span className="achievement-type">Hito conseguido</span>
                </div>
              ))}
            {!analytics.achievements.length && !analytics.milestones.length && (
              <Empty
                title="Sin logros en este periodo"
                text="Cambia el periodo para consultar otras finalizaciones."
                icon={CheckCircle2}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

function ArchivePage({
  filterTasks,
  filters,
  go,
  ...props
}: Shared & {
  filterTasks: (tasks: Task[]) => Task[];
  filters: React.ReactNode;
  go: (p: Page, path?: string) => void;
}) {
  const { data } = props,
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [kind, setKind] = useState("tasks"),
    [historySearch, setHistorySearch] = useState(""),
    [historyProject, setHistoryProject] = useState("");
  const tasks = filterTasks(data.tasks)
    .filter(
      (t) =>
        ["completed", "cancelled"].includes(t.status) ||
        data.events.some(
          (e) => e.task_id === t.id && e.event_type === "completed",
        ),
    )
    .filter((t) => {
      const events = data.events.filter(
        (e) =>
          e.task_id === t.id &&
          ["completed", "cancelled"].includes(e.event_type),
      );
      return (
        (!start && !end) ||
        events.some((e) => {
          const d = localDate(e.occurred_at, data.user.timezone);
          return (!start || d >= start) && (!end || d <= end);
        })
      );
    });
  return (
    <>
      <PageHeading
        title="Tu archivo"
        subtitle="Tareas, hitos y diarios anteriores."
      />
      <div className="archive-tools">
        <div className="segmented">
          {[
            { key: "tasks", label: "Tareas" },
            { key: "milestones", label: "Hitos" },
            { key: "journals", label: "Diarios" },
          ].map((k) => (
            <button
              key={k.key}
              className={kind === k.key ? "selected" : ""}
              onClick={() => setKind(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <label>
          Desde
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {kind !== "tasks" && (
        <div className="filters">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Buscar en el histórico"
              placeholder="Buscar en el histórico…"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Proyecto del histórico"
            value={historyProject}
            onChange={(e) => setHistoryProject(e.target.value)}
          >
            <option value="">Todos los proyectos</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {kind === "tasks" && (
        <>
          {filters}
          <div className="panel archive-list">
            {tasks.map((t) => (
              <div className="archive-item" key={t.id}>
                <TaskLine
                  task={t}
                  {...props}
                  extra={
                    <span className="archive-state">
                      {statusLabels[t.status]}
                    </span>
                  }
                />
                <div className="archive-timestamp">
                  {t.completed_at
                    ? `Finalización: ${niceDate(t.completed_at, data.user.timezone)}`
                    : t.status === "completed"
                      ? "Fecha desconocida / importada"
                      : data.events.some(
                            (e) =>
                              e.task_id === t.id &&
                              e.event_type === "completed",
                          )
                        ? "Finalizada anteriormente; ver historial"
                        : t.cancelled_at
                          ? `Cancelación: ${niceDate(t.cancelled_at, data.user.timezone)}`
                          : "Sin fecha verificada"}{" "}
                  ·{" "}
                  <button
                    className="text-button"
                    onClick={() => props.openTask(t)}
                  >
                    Ver historial y prioridad al completar
                  </button>
                </div>
              </div>
            ))}
            {!tasks.length && (
              <Empty
                title="No hay tareas en el archivo"
                text="Aquí encontrarás tareas completadas, canceladas y reabiertas. Prueba a ajustar los filtros."
                icon={Inbox}
              />
            )}
          </div>
        </>
      )}
      {kind === "milestones" && (
        <div className="panel">
          <MilestoneList
            milestones={data.milestones.filter(
              (m) =>
                m.status === "achieved" &&
                (!historySearch ||
                  m.title
                    .toLowerCase()
                    .includes(historySearch.toLowerCase())) &&
                (!historyProject || m.project_id === historyProject) &&
                (!start ||
                  (!!m.achieved_at &&
                    localDate(m.achieved_at, data.user.timezone) >= start)) &&
                (!end ||
                  (!!m.achieved_at &&
                    localDate(m.achieved_at, data.user.timezone) <= end)),
            )}
            {...props}
          />
          {!data.milestones.some((m) => m.status === "achieved") && (
            <Empty
              title="Sin hitos logrados"
              text="Aparecerán aquí cuando los marques como logrados."
              icon={Flag}
            />
          )}
        </div>
      )}
      {kind === "journals" && (
        <div className="panel journal-days">
          {data.journals
            .filter(
              (j) =>
                (!historySearch ||
                  j.entry_date.includes(historySearch) ||
                  data.blocks.some(
                    (b) =>
                      b.journal_entry_id === j.id &&
                      (b.text_content
                        .toLowerCase()
                        .includes(historySearch.toLowerCase()) ||
                        data.tasks.some(
                          (t) =>
                            t.id === b.task_id &&
                            t.title
                              .toLowerCase()
                              .includes(historySearch.toLowerCase()),
                        )),
                  )) &&
                (!historyProject ||
                  data.blocks.some(
                    (b) =>
                      b.journal_entry_id === j.id &&
                      data.tasks.some(
                        (t) =>
                          t.id === b.task_id && t.project_id === historyProject,
                      ),
                  )) &&
                (!start || j.entry_date >= start) &&
                (!end || j.entry_date <= end),
            )
            .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
            .map((j) => (
              <button
                key={j.id}
                onClick={() => go("journal", "/journal/" + j.entry_date)}
              >
                <BookOpen size={17} />
                {niceDate(j.entry_date)}
                <span>
                  {
                    data.blocks.filter((b) => b.journal_entry_id === j.id)
                      .length
                  }{" "}
                  bloques
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          {!data.journals.length && (
            <Empty
              title="Sin entradas de diario"
              text="Las entradas guardadas aparecerán aquí."
              icon={BookOpen}
            />
          )}
        </div>
      )}
    </>
  );
}

function SettingsPage({
  read,
  ...props
}: Shared & { read: (path: string, init?: RequestInit) => Promise<any> }) {
  const { data, mutate } = props,
    [name, setName] = useState(data.user.display_name),
    [timezone, setTimezone] = useState(data.user.timezone),
    [theme, setTheme] = useState(data.user.theme),
    [view, setView] = useState(data.user.preferred_task_view),
    [week, setWeek] = useState(data.user.week_start_day),
    [success, setSuccess] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  const download = async (format: string) => {
    try {
      setError("");
      const response = await fetch("/api/export?format=" + format, {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("No se ha podido exportar. Inténtalo de nuevo.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `focus-hub-${props.today}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess("Exportación descargada.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PageHeading
        title="Configuración"
        subtitle="Preferencias y exportación de datos."
      />
      <div className="settings-grid">
        <section className="panel">
          <PanelTitle
            icon={Settings}
            title="Tu espacio"
            subtitle="Preferencias personales y calendario."
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                Intl.DateTimeFormat("es", { timeZone: timezone });
                if (
                  await mutate("/api/preferences", "PATCH", {
                    display_name: name,
                    timezone,
                    theme,
                    preferred_task_view: view,
                    week_start_day: week,
                  })
                ) {
                  setSuccess("Preferencias guardadas.");
                  setError("");
                }
              } catch {
                setError(
                  "Introduce una zona IANA válida, por ejemplo Europe/Madrid.",
                );
              }
            }}
          >
            <label>
              Nombre
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Zona horaria IANA
              <input
                required
                list="timezones"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
              <datalist id="timezones">
                {[
                  "Europe/Madrid",
                  "Atlantic/Canary",
                  "Europe/London",
                  "America/Mexico_City",
                  "America/Bogota",
                  "America/Argentina/Buenos_Aires",
                  "UTC",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </datalist>
              <small>Los días y semanas se calculan en esta zona.</small>
            </label>
            <div className="form-grid">
              <label>
                Apariencia
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                >
                  <option value="light">Clara</option>
                  <option value="dark">Oscura</option>
                  <option value="system">Seguir al sistema</option>
                </select>
              </label>
              <label>
                Vista de tareas
                <select
                  value={view}
                  onChange={(e) => setView(e.target.value as typeof view)}
                >
                  <option value="board">Kanban</option>
                  <option value="table">Tabla</option>
                </select>
              </label>
              <label>
                La semana empieza en
                <select
                  value={week}
                  onChange={(e) => setWeek(Number(e.target.value))}
                >
                  <option value={1}>Lunes</option>
                  <option value={0}>Domingo</option>
                </select>
              </label>
            </div>
            <button className="button primary" disabled={props.busy}>
              Guardar preferencias
              <Check size={16} />
            </button>
          </form>
        </section>
        <div>
          <section className="panel">
            <PanelTitle
              icon={Inbox}
              title="Exportar datos"
              subtitle="Descarga archivos de tu espacio, cuando quieras."
            />
            <p className="settings-copy">
              El JSON conserva identificadores, proyectos, objetivos, hitos,
              tareas, eventos, bloques de diario y focos. Incluye versión de
              esquema para facilitar futuras migraciones.
            </p>
            <div className="export-options">
              <button className="button" onClick={() => download("json")}>
                <ArrowDown size={16} />
                Exportar todo · JSON
              </button>
              <button className="button" onClick={() => download("csv")}>
                <ArrowDown size={16} />
                Exportar tareas · CSV
              </button>
            </div>
            <div className="import-preview">
              <h3>Validar una exportación</h3>
              <p>Solo lectura. No importa ni modifica datos.</p>
              <label className="button file-button">
                Seleccionar JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const json = JSON.parse(await file.text());
                      const required = [
                        "tasks",
                        "projects",
                        "goals",
                        "milestones",
                        "events",
                        "journals",
                        "blocks",
                        "focus",
                      ];
                      const root = json.data ?? json;
                      const aliases: Record<string, string[]> = {
                        events: ["events", "task_events"],
                        journals: ["journals", "journal_entries"],
                        blocks: ["blocks", "journal_blocks"],
                        focus: ["focus", "focus_items"],
                      };
                      const missing = required.filter(
                        (k) =>
                          !(aliases[k] ?? [k]).some((name) =>
                            Array.isArray(root[name]),
                          ),
                      );
                      setPreview(
                        missing.length
                          ? `Estructura incompleta: faltan ${missing.join(", ")}.`
                          : "JSON válido: colecciones principales presentes. La importación futura también deberá validar referencias e integridad.",
                      );
                    } catch {
                      setPreview("El archivo no contiene JSON válido.");
                    }
                  }}
                />
              </label>
              {preview && <p role="status">{preview}</p>}
            </div>
          </section>
          <section className="panel privacy-panel">
            <Leaf size={21} />
            <h3>Privado por diseño.</h3>
            <p>
              Sin conexión a Notion. Sin datos públicos. Las operaciones se
              limitan a tu espacio autenticado.
            </p>
            <p>
              Para eliminar una tarea, abre su detalle y confirma la
              eliminación. Archivar un proyecto conserva su historia.
            </p>
          </section>
        </div>
      </div>
      {success && (
        <div className="success-message" role="status">
          <CheckCircle2 size={17} />
          {success}
        </div>
      )}
      {error && (
        <div role="alert" className="error-text">
          {error}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
