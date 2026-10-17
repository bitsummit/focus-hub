import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { BrandLogo } from "./components/BrandLogo";
import { BRAND_TAGLINE } from "./brand";
import { Board, TaskTable, StatusControl, Priority } from "./components/TaskViews";
import { ProjectSelect } from "./components/ProjectSelect";
import { MobileQuickCapture } from "./components/QuickCapture";
import { filterTask, matchesQuickFilter, type QuickFilter } from "./task-filters";
import "./ux-v11.css";
import "./journal-navigation.css";
import "./capture-halo.css";
import "./login-brand.css";
import {t as tr, locale, getLanguage, setLanguage, subscribeLanguage, translateError} from "./i18n";

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
  { key: "home", path: "/dashboard", label: "Mi espacio", icon: LayoutDashboard },
  { key: "journal", path: "/journal", label: "Diario", icon: BookOpen },
  { key: "progress", path: "/progress", label: "Avances", icon: BarChart3 },
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
    ? new Intl.DateTimeFormat(locale(), {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00Z"))
    : new Intl.DateTimeFormat(locale(), {
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
  const page = Number(new URLSearchParams(location.search).get("page") ?? 1);
  const section = nav.find((n) => path === n.path || path.startsWith(n.path + "/"));
  return {
    page: section?.key ?? "tasks",
    journalPage: Number.isSafeInteger(page) && page > 0 ? page : 1,
    projectId: path.startsWith("/projects/") ? path.split("/")[2] : null,
    journalDate:
      /^\/journal\/\d{4}-\d{2}-\d{2}$/.test(path) &&
      validDate(path.split("/")[2])
        ? path.split("/")[2]
        : null,
  };
}

function App() {
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  const [session, setSession] = useState<Session | null>(null),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
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
  const [projectFilter, setProjectFilter] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [priorityFilter, setPriorityFilter] = useState(""),
    [taskView, setTaskView] = useState<"board" | "table">("table");
  const read = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { credentials: "same-origin", ...init });
    if (!r.ok) {
      const data = await r.json().catch(() => ({
        message: tr("No se ha podido conectar con el servidor."),
      }));
      if (r.status === 401) {
        setSession(null);
        setSnapshot(null);
      }
      throw new Error(data.message || `Error ${r.status}`);
    }
    const data = r.status === 204 ? null : await r.json();
    if (data?.user?.language) setLanguage(data.user.language);
    return data;
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
        if ((e as Error).message !== tr("No autenticado")) setError("");
      } finally {
        setReady(true);
      }
    })();
  }, [read]);
  const reconnect = useCallback(async () => {
    try { await refresh(); setConnectionError(""); }
    catch (e) { setConnectionError((e as Error).message); }
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    const onFocus = () => { void reconnect(); };
    window.addEventListener("focus", onFocus);
    const id = setInterval(onFocus, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [session, reconnect]);
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
        <BrandLogo iconOnly />
        <p>{tr("Preparando tu espacio…")}</p>
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
  const advancedFilters={search:"",project:projectFilter,status:statusFilter,priority:priorityFilter};
  const filterTasks = (tasks:Task[]) => tasks.filter(task=>filterTask(task,archiveFilters));
  const todayIds=new Set(data.focus.filter(item=>item.period_type==="daily"&&item.period_start===today).map(item=>item.task_id));
  const taskResults=data.tasks.filter(task=>filterTask(task,advancedFilters)&&matchesQuickFilter(task,quickFilter,todayIds));
  const taskFiltersActive=Boolean(projectFilter||statusFilter||priorityFilter||quickFilter!=="all");
  const clearTaskFilters=()=>{setProjectFilter("");setStatusFilter("");setPriorityFilter("");setQuickFilter("all");};
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
          <BrandLogo size="compact" />
        </a>
        <div className="workspace-label">{tr("TU ESPACIO PERSONAL")}</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.key}
              className={"nav-link " + (route.page === n.key ? "active" : "")}
              onClick={() => go(n.key)}
              aria-label={tr(n.label)}
              title={tr(n.label)}
            >
              <n.icon size={19} />
              {tr(n.label)}
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
            <span>{tr("Espacio privado")}</span>
          </div>
          <button
            className="icon-button"
            aria-label={tr("Cerrar sesión")}
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
          <BrandLogo size="compact" iconOnly className="mobile-header-brand" />
          <span className="breadcrumb">{tr("Mi espacio ")}<ChevronRight size={13} />{" "}
            <strong>{tr(nav.find((n) => n.key === route.page)?.label ?? "")}</strong>
          </span>
          <form className="quick-capture" onSubmit={quickCapture}>
            <Plus size={17} />
            <input
              id="quick-capture"
              aria-label={tr("Captura rápida de tarea")}
              placeholder={tr("Añade una tarea y pulsa Enter")}
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
              aria-label={tr("Crear tarea")}
              disabled={!capture.trim() || captureBusy}
            >
              <ArrowUpRight size={17} />
            </button>
          </form>
          <span className="private-badge">
            <span />{tr("Privado")}</span>
        </header>
        {(error || connectionError) && (
          <div role="alert" className="error-banner">
            {translateError(error || connectionError)}
            {!error && connectionError && <button className="connection-retry" onClick={() => void reconnect()}>{tr("Reintentar")}</button>}
            <button onClick={() => { setError(""); setConnectionError(""); }} aria-label={tr("Cerrar error")}>
              <X size={16} />
            </button>
          </div>
        )}
        {showSaving && busy > 0 && (
          <div className="saving" role="status">
            <LoaderCircle size={13} className="spin" />{tr(" Guardando…")}</div>
        )}
        <main>
          {route.page === "home" && <HomePage {...shared} go={go} />}
          {route.page === "tasks" && (
            <>
              <PageHeading
                title={tr("Tareas")}
                badge={<span className="count task-count" role="status"
                  aria-label={tr("{0} tareas abiertas",open.length)}
                  title={tr("{0} tareas abiertas",open.length)}>{open.length}</span>}
                action={
                  <div className="segmented">
                    <button
                      className={taskView === "board" ? "selected" : ""}
                      onClick={() => setTaskView("board")}
                    >
                      <LayoutGrid size={16} />{tr("Kanban")}</button>
                    <button
                      className={taskView === "table" ? "selected" : ""}
                      onClick={() => setTaskView("table")}
                    >
                      <List size={16} />{tr("Tabla")}</button>
                  </div>
                }
              />
              <div className="quick-filters" role="group" aria-label={tr("Filtros rápidos")}>
                {([
                  ["all",tr("Todas")],["inbox",tr("Bandeja")],["today",tr("Hoy")],
                  ["priority",tr("Prioritarias")],["waiting",tr("En espera")],["blocked",tr("Bloqueadas")],
                ] as const).map(([key,label])=><button type="button" key={key} className="filter-chip" aria-pressed={quickFilter===key} onClick={()=>setQuickFilter(key)}>{label}</button>)}
              </div>
              <Filters
                activeOnly
                onClear={clearTaskFilters}
                extraActive={quickFilter!=="all"}
                data={data}
                {...{
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
          {route.page === "journal" && (route.journalDate ? (
            <>
              <button className="text-button back-link" onClick={() => go("journal")}>
                <ChevronLeft size={15} />{tr("Entradas del diario")}
              </button>
              <JournalPage key={route.journalDate} {...shared} date={route.journalDate}
                onDate={(date) => go("journal", "/journal/" + date)} />
            </>
          ) : (
            <JournalFeed {...shared} page={route.journalPage}
              onPage={(page) => go("journal", page === 1 ? "/journal" : "/journal?page=" + page)}
              onDate={(date) => go("journal", "/journal/" + date)} />
          ))}
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
          <div><BrandLogo size="compact" /></div>
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
            <span>{tr(n.label)}</span>
          </button>
        ))}
        <button onClick={() => setMore(!more)} className={more ? "active" : ""}>
          <Settings size={20} />
          <span>{tr("Más")}</span>
        </button>
      </nav>
      {more && (
        <div className="mobile-more">
          {nav.slice(4).map((n) => (
            <button key={n.key} onClick={() => go(n.key)}>
              <n.icon size={18} />
              {tr(n.label)}
            </button>
          ))}
        </div>
      )}
      <button
        className="mobile-add"
        aria-label={tr("Capturar una tarea")}
        onClick={() => {
          setCaptureSheet(true);
        }}
      >
        <Plus size={25} />
      </button>
      <MobileQuickCapture open={captureSheet} onClose={()=>setCaptureSheet(false)} projects={data.projects} onCapture={input=>mutate("/api/tasks","POST",input,true)}/>
      {feedback && <div className="action-feedback" role="status" aria-live="polite">
        <span>{tr(feedback.message)}</span>
        {feedback.undo && <button type="button" onClick={undoStatus}>{tr("Deshacer")}</button>}
        <button type="button" aria-label={tr("Cerrar confirmación")} onClick={()=>setFeedback(null)}>×</button>
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
        <div className="login-brand-lockup">
          <BrandLogo size="large" />
          <p className="brand-tagline" lang="en">{BRAND_TAGLINE}</p>
        </div>
        <div className="login-story-copy">
          <h1 className="login-headline"><span>{tr("Tareas,")}</span><span>{tr("proyectos y")}</span><span>{tr("progreso.")}</span></h1>
          <p>{tr("Captura, organiza y consulta tu trabajo.")}<br />{tr("Tus tareas y su historial, en un solo lugar.")}</p>
        </div>
      </section>
      <section className="login-form">
        <div>
          <h2>{tr("Bienvenido de nuevo")}</h2>
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
            <label>{tr("Correo electrónico")}<input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>{tr("Contraseña")}<input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {translateError(error)}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? tr("Entrando…") : tr("Entrar en mi espacio")}
              <ArrowUpRight size={17} />
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  subtitle,
  badge,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        {badge ? <div className="page-title-line"><h1>{title}</h1>{badge}</div> : <h1>{title}</h1>}
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Empty({
  title = tr("No hay elementos"),
  text = tr("Captura tu primera tarea en la barra superior."),
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
          (task.status === "completed" ? tr("Reabrir ") : tr("Completar ")) + task.title
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
            {tr(statusLabels[task.status])}
          </span>
          <span className="project-dot" style={{"--project-color":p?.color??"#757e88"} as React.CSSProperties}>
            {p?.name??tr("Bandeja de entrada")}
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
        eyebrow={new Intl.DateTimeFormat(locale(), {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        })
          .format(new Date(today + "T12:00:00Z"))
          .toUpperCase()}
        title={tr("Mi espacio")}
        subtitle={tr("Todo lo importante, de un vistazo.")}
        action={
          <PeriodNav date={week} onChange={setWeek} step={7} label={tr("Semana")} />
        }
      />
      <div className="dashboard-grid">
        <section className="panel weekly-panel">
          <PanelTitle
            icon={Target}
            title={tr("Mi foco de la semana")}
            subtitle={tr("Selecciona hasta 5 tareas para esta semana.")}
            tag={tr("HASTA 5")}
          />
          <FocusPanel {...props} type="weekly" date={week} />
        </section>
        <section className="panel today-panel">
          <PanelTitle
            icon={CheckCircle2}
            title={tr("Hoy")}
            subtitle={tr("Selecciona hasta 3 tareas para hoy.")}
            tag={Temporal.PlainDate.from(today).day.toString()}
          />
          <FocusPanel {...props} type="daily" date={today} />
        </section>
      </div>
      <div className="section-heading">
        <div>
          <h2>{tr("Objetivos estratégicos")}</h2>
        </div>
        <button className="text-button" onClick={() => go("projects")}>{tr("Gestionar objetivos")}<ArrowUpRight size={15} />
        </button>
      </div>
      <div className="goal-grid">
        {goals.slice(0, 4).map((g) => (
          <GoalCard key={g.id} goal={g} data={data} />
        ))}
        {!goals.length && (
          <div className="panel full">
            <Empty
              title={tr("Sin objetivos activos")}
              text={tr("Define un objetivo y sus hitos en Proyectos.")}
              icon={Target}
            />
          </div>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>{tr("Proyectos activos ")}<span className="count">{active.length}</span>
          </h2>
        </div>
        <button className="text-button" onClick={() => go("projects")}>{tr("Ver proyectos")}<ArrowUpRight size={15} />
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
              title={tr("Sin proyectos activos")}
              text={tr("Crea un proyecto para organizar tus tareas.")}
              icon={FolderOpen}
            />
          </div>
        )}
      </div>
      <div className="section-heading">
        <div>
          <h2>{tr("Avances")}</h2>
        </div>
        <button className="text-button" onClick={() => go("progress")}>{tr("Ver avances")}<ArrowUpRight size={15} />
        </button>
      </div>
      <div className="metrics-grid">
        <Metric
          label={tr("Tareas completadas")}
          value={completedIds.size}
          caption={tr("Esta semana")}
        />
        <Metric
          label={tr("Nuevas tareas")}
          value={created}
          caption={tr("Capturadas esta semana")}
        />
        <Metric
          label={tr("Reducción neta")}
          value={completedIds.size - created}
          caption={tr("Completadas − creadas")}
        />
        <Metric
          label={tr("Por seguir")}
          value={
            data.tasks.filter(
              (t) =>
                !t.deleted_at &&
                ["pending_review", "waiting_external"].includes(t.status),
            ).length
          }
          caption={tr("En espera o revisión")}
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
    <div className="metric" data-tone={label===tr("Tareas completadas")?"completed":label===tr("Nuevas tareas")?"created":label===tr("Reducción neta")?(value>0?"positive":value<0?"negative":"neutral"):"neutral"}>
      <span>{label}</span>
      <strong>
        {value > 0 && label === tr("Reducción neta") ? "+" : ""}
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
        aria-label={tr("Periodo anterior")}
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
        aria-label={tr("Periodo siguiente")}
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
                  aria-label={tr("Subir ") + task.title}
                  disabled={!i}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  aria-label={tr("Bajar ") + task.title}
                  disabled={i === ids.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  aria-label={tr("Quitar del foco ") + task.title}
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
                ? tr("No hay tareas en el foco semanal.")
                : tr("No hay tareas en el foco de hoy.")}
            </p>
            <small>{tr("Selecciona tareas que ya tienes, sin duplicarlas.")}</small>
          </div>
        )}
      </div>
      {ids.length < limit && (
        <button className="add-subtle" onClick={() => setAdding(!adding)}>
          <Plus size={16} />{tr("Elegir tarea ")}{ids.length > 0 && `(${ids.length}/${limit})`}
        </button>
      )}
      {adding && (
        <div className="focus-picker">
          <label className="sr-only" htmlFor={"focus-" + type}>{tr("Elegir tarea para el foco")}</label>
          <select
            id={"focus-" + type}
            defaultValue=""
            onChange={async (e) => {
              if (e.target.value && (await save([...ids, e.target.value])))
                setAdding(false);
            }}
          >
            <option value="">{tr("Selecciona una tarea abierta…")}</option>
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
          ? tr("Hasta {0}", niceDate(goal.period_end))
          : tr("Objetivo activo")}
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
            : tr("Sin hitos definidos")}
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
      <p>{p.description || tr("Sin descripción")}</p>
      <div className="project-card-counts">
        <span>
          <strong>{tasks.length}</strong>{tr(" abiertas")}</span>
        <span>
          <i className="dot state-dot in_progress" aria-hidden="true" />
          {tasks.filter((t) => t.status === "in_progress").length}{tr(" en curso")}</span>
        <span>
          <i className="dot state-dot pending_review" aria-hidden="true" />
          {tasks.filter((t) => t.status === "pending_review").length}{tr(" en revisión")}</span>
        <span>
          <i className="dot state-dot waiting_external" aria-hidden="true" />
          {tasks.filter((t) => t.status === "waiting_external").length}{tr(" en espera")}</span>
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
  search?: string;
  setSearch?: (s: string) => void;
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
  const clear=()=>{p.setSearch?.("");p.setProjectFilter("");p.setStatusFilter("");p.setPriorityFilter("");p.onClear?.();};
  const controls = <>
        <select aria-label={tr("Filtrar por proyecto")} value={p.projectFilter} onChange={event=>p.setProjectFilter(event.target.value)}>
          <option value="">{tr(p.activeOnly ? "Proyecto" : "Todos los proyectos")}</option><option value="inbox">{tr("Bandeja de entrada")}</option>
          {p.data.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select aria-label={tr("Filtrar por estado")} value={p.statusFilter} onChange={event=>p.setStatusFilter(event.target.value)}>
          <option value="">{p.activeOnly?tr("Estado"):tr("Todos los estados")}</option>
          {STATUSES.filter(status=>!p.activeOnly||!["completed","cancelled"].includes(status)).map(status=><option key={status} value={status}>{tr(statusLabels[status])}</option>)}
        </select>
        <select aria-label={tr("Filtrar por prioridad")} value={p.priorityFilter} onChange={event=>p.setPriorityFilter(event.target.value)}>
          <option value="">{tr(p.activeOnly ? "Prioridad" : "Toda prioridad")}</option>{PRIORITIES.map(priority=><option key={priority} value={priority}>{tr(priorityLabels[priority])}</option>)}
        </select>
  </>;
  if (p.activeOnly) return <div className="filters task-visible-filters">
    {controls}
    {active&&<button type="button" className="text-button" onClick={clear}>{tr("Limpiar filtros")}</button>}
  </div>;
  return <div className="task-filter-tools">
    <div className="filters filter-search-row">
      <div className="search-field"><Search size={16}/><input aria-label={tr("Buscar tareas")} placeholder={tr("Buscar tareas…")} value={p.search ?? ""} onChange={event=>p.setSearch?.(event.target.value)}/></div>
      {active&&<button type="button" className="text-button" onClick={clear}>{tr("Limpiar filtros")}</button>}
    </div>
    <details className="advanced-filters" open={advanced||undefined}>
      <summary>{tr("Filtros avanzados")}{advanced?" · activos":""}</summary>
      <div className="filters">{controls}</div>
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
          <span className="eyebrow">{tr("DETALLE DE LA TAREA")}</span>
          <button
            className="icon-button"
            aria-label={tr("Cerrar detalle")}
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
          <label>{tr("Título")}<input
              id="task-title"
              required
              maxLength={500}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <label>{tr("Descripción")}<textarea
              rows={3}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={tr("Añade contexto, si lo necesitas…")}
            />
          </label>
          <div className="form-grid">
            <label>{tr("Estado")}<select
                className={"status-select status-" + draft.status}
                value={draft.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tr(statusLabels[s])}
                  </option>
                ))}
              </select>
            </label>
            <label>{tr("Prioridad")}<select
                value={draft.priority}
                onChange={(e) => set("priority", e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {tr(priorityLabels[p])}
                  </option>
                ))}
              </select>
            </label>
            <label>{tr("Proyecto")}<ProjectSelect
                aria-label={tr("Proyecto")}
                value={draft.project_id}
                projects={data.projects}
                taskTitle={draft.title}
                onChange={projectId => set("project_id", projectId)}
              />
            </label>
            <label>{tr("Tarea principal")}<select
                value={draft.parent_task_id ?? ""}
                onChange={(e) => set("parent_task_id", e.target.value || null)}
              >
                <option value="">{tr("Sin tarea principal")}</option>
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
            <label>{tr("Vencimiento")}<input
                type="date"
                value={draft.due_at?.slice(0, 10) ?? ""}
                onChange={(e) => set("due_at", e.target.value || null)}
              />
            </label>
            <label>{tr("Seguimiento")}<input
                type="date"
                value={draft.follow_up_at?.slice(0, 10) ?? ""}
                onChange={(e) => set("follow_up_at", e.target.value || null)}
              />
            </label>
          </div>
          <label>{tr("En espera de")}<input
              value={draft.waiting_on}
              onChange={(e) => set("waiting_on", e.target.value)}
              placeholder={tr("Persona, respuesta o entrega (opcional)")}
            />
          </label>
          <label>{tr("Etiquetas, separadas por comas")}<input
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
                    tr("¿Eliminar esta tarea? Se ocultará de las vistas, conservando su registro histórico."),
                  )
                ) {
                  if (await mutate("/api/tasks/" + task.id, "DELETE"))
                    onClose();
                }
              }}
            >
              <Trash2 size={15} />{tr("Eliminar")}</button>
            <button className="button primary" disabled={props.busy}>{tr("Guardar cambios")}<Check size={16} />
            </button>
          </div>
        </form>
        <section className="dialog-section">
          <h3>{tr("Subtareas")}</h3>
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
              aria-label={tr("Nueva subtarea")}
              placeholder={tr("Añadir subtarea…")}
              value={subtask}
              onChange={(e) => setSubtask(e.target.value)}
            />
            <button className="button" disabled={!subtask.trim()}>
              <Plus size={15} />
            </button>
          </form>
        </section>
        <section className="dialog-section">
          <h3>{tr("Vincular al diario")}</h3>
          <div className="inline-form">
            <input
              aria-label={tr("Día del diario para vincular")}
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
            >{tr("Vincular")}</button>
          </div>
        </section>
        <section className="dialog-section">
          <h3>{tr("Historial verificado")}</h3>
          {task.completed_at && (
            <p className="completion-note">{tr("Completada el ")}{niceDate(task.completed_at, data.user.timezone)}
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
        created: tr("Tarea creada"),
        completed: tr("Tarea completada"),
        reopened: tr("Tarea reabierta"),
        cancelled: tr("Tarea cancelada"),
        status_changed: tr("Estado actualizado"),
        priority_changed: tr("Prioridad actualizada"),
        project_changed: tr("Proyecto actualizado"),
        title_changed: tr("Título actualizado"),
        deleted: tr("Tarea eliminada"),
        restored: tr("Tarea restaurada"),
      } as Record<string, string>
    )[type] ?? tr("Tarea actualizada")
  );
}
function eventValue(json: string, data: Snapshot) {
  try {
    const v = JSON.parse(json);
    if (typeof v === "string")
      { const label=statusLabels[v as Status] ?? priorityLabels[v as Task["priority"]]; return label ? tr(label) : v; }
    if (v && typeof v === "object") {
      return [
        v.status && tr(statusLabels[v.status as Status]),
        v.priority &&
          tr("Prioridad: ") + tr(priorityLabels[v.priority as Task["priority"]]),
        "project_id" in v &&
          tr("Proyecto: ") +
            (data.projects.find((p) => p.id === v.project_id)?.name ??
              tr("Bandeja de entrada")),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return "";
  } catch {
    return "";
  }
}

function JournalFeed({ page, onPage, onDate, ...props }: Shared & {
  page:number; onPage:(page:number)=>void; onDate:(date:string)=>void;
}) {
  const {data}=props;
  const [search,setSearch]=useState("");
  const tasks=new Map(data.tasks.map(task=>[task.id,task]));
  const blocksByEntry=new Map<string,JournalBlock[]>();
  for(const block of data.blocks){
    const group=blocksByEntry.get(block.journal_entry_id) ?? [];
    group.push(block);blocksByEntry.set(block.journal_entry_id,group);
  }
  for(const blocks of blocksByEntry.values())blocks.sort((a,b)=>a.sort_order-b.sort_order);
  const needle=search.trim().toLocaleLowerCase(locale());
  const entries=data.journals.filter(entry=>!needle ||
    [entry.entry_date,entry.title,...(blocksByEntry.get(entry.id) ?? []).map(block=>
      block.block_type==='task_reference' ? tasks.get(block.task_id ?? '')?.title ?? '' : block.text_content
    )].join(' ').toLocaleLowerCase(locale()).includes(needle)
  ).sort((a,b)=>b.entry_date.localeCompare(a.entry_date));
  const pages=Math.max(1,Math.ceil(entries.length/15));
  const current=Math.min(page,pages);
  const visible=entries.slice((current-1)*15,current*15);
  return <>
    <PageHeading title={tr("Diario")} subtitle={tr("Tus entradas, de la más reciente a la más antigua.")}
      action={<div className="journal-feed-actions">
        <input type="date" aria-label={tr("Fecha del diario")} value=""
          onChange={event=>event.target.value && onDate(event.target.value)} />
        <button className="button primary" onClick={()=>onDate(props.today)}><Plus size={16}/>{tr("Nueva entrada")}</button>
      </div>} />
    <div className="journal-feed-toolbar">
      <input type="search" aria-label={tr("Buscar entradas del diario")} placeholder={tr("Buscar en el diario…")}
        value={search} onChange={event=>{setSearch(event.target.value);if(page!==1)onPage(1);}} />
      <span className="muted">{tr("{0} entradas",entries.length)}</span>
    </div>
    <section className="journal-feed" aria-label={tr("Entradas del diario")}>
      {visible.map(entry=>{
        const blocks=blocksByEntry.get(entry.id) ?? [];
        return <article className="journal-paper journal-feed-entry" key={entry.id}
          data-entry-date={entry.entry_date} aria-labelledby={'journal-entry-'+entry.id}>
          <header className="journal-feed-heading">
            <div><h2 id={'journal-entry-'+entry.id}><time dateTime={entry.entry_date}>{niceDate(entry.entry_date)}</time></h2></div>
            <div className="journal-feed-actions"><button className="text-button"
              aria-label={tr("Abrir entrada {0}",entry.entry_date)} onClick={()=>onDate(entry.entry_date)}>
              {tr("Abrir entrada")}<ChevronRight size={16}/></button></div>
          </header>
          <div className="journal-blocks">{blocks.map(block=><JournalBlockView key={block.id}
            block={block} revision={entry.revision} {...props}/>)}
            {!blocks.length && <p className="muted">{tr("Entrada sin contenido.")}</p>}
          </div>
        </article>;
      })}
      {!visible.length && <Empty title={tr(needle ? "Ninguna entrada coincide con la búsqueda" : "No hay entradas de diario")}
        text={tr(needle ? "Prueba con otra búsqueda." : "Abre una fecha y guarda una nota o tarea para crear tu primera entrada.")}
        icon={BookOpen}/>}
    </section>
    {pages>1 && <nav className="journal-pagination" aria-label={tr("Paginación del diario")}>
      <button className="button" aria-label={tr("Página anterior")} disabled={current===1}
        onClick={()=>onPage(current-1)}><ChevronLeft size={16}/>{tr("Anterior")}</button>
      <span role="status" aria-live="polite">{tr("Página {0} de {1}",current,pages)}</span>
      <button className="button" aria-label={tr("Página siguiente")} disabled={current===pages}
        onClick={()=>onPage(current+1)}>{tr("Siguiente")}<ChevronRight size={16}/></button>
    </nav>}
  </>;
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
        title={tr("Diario")}
        subtitle={tr("Notas y tareas vinculadas por día.")}
        action={
          <div className="journal-date">
            <PeriodNav date={date} onChange={onDate} />
            <input
              type="date"
              aria-label={tr("Fecha del diario")}
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
              {date === props.today ? tr("HOY") : tr("TU DIARIO")}
            </span>
            <h2>
              {new Intl.DateTimeFormat(locale(), {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00:00Z"))}
            </h2>
            <span>
              {blocks.length}{tr(" bloques ·")}{" "}
              {entry ? tr("Guardado en tu espacio") : tr("Sin entrada guardada")}
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
                <p>{tr("Sin bloques en esta fecha.")}</p>
                <span>{tr("Escribe una nota o una tarea en el campo inferior.")}</span>
              </div>
            )}
          </div>
          <form className="journal-compose" onSubmit={append}>
            <textarea
              aria-label={tr("Escribir en el diario")}
              rows={3}
              placeholder={
                tr("Escribe una nota…\n- [ ] Una tarea · # Un encabezado")
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
                aria-label={tr("Indentación del bloque")}
                value={indent}
                onChange={(e) => setIndent(Number(e.target.value))}
              >
                <option value={0}>{tr("Nivel principal")}</option>
                <option value={1}>{tr("↳ Subtarea / indentado")}</option>
              </select>
              <span>{tr("Enter para guardar · Mayús+Enter para salto")}</span>
              <button
                className="button primary"
                disabled={!text.trim() || props.busy}
              >{tr("Añadir")}<Plus size={16} />
              </button>
            </div>
          </form>
        </section>
        <aside className="journal-aside">
          <div className="panel journal-tips">
            <BookOpen size={22} />
            <h3>{tr("Escribe a tu manera.")}</h3>
            <p>{tr("Las notas siguen siendo notas. Las tareas se conectan con todo tu espacio.")}</p>
            <dl>
              <dt>{tr("Una tarea")}</dt>
              <dd>
                <code>{tr("- [ ] Preparar propuesta")}</code>
              </dd>
              <dt>{tr("Prioridad rápida")}</dt>
              <dd>
                <code>{tr("! Alta · !! Crítica")}</code>
              </dd>
              <dt>{tr("Contexto de proyecto")}</dt>
              <dd>
                <code>{tr("# Nombre del proyecto")}</code>
                <span>{tr("Un encabezado existente da contexto a las siguientes tareas.")}</span>
              </dd>
              <dt>{tr("Proyecto en una línea")}</dt>
              <dd>
                <code>{tr("- [ ] Revisar #proyecto")}</code>
              </dd>
              <dt>{tr("Subtarea")}</dt>
              <dd>{tr("Selecciona el nivel indentado después de una tarea.")}</dd>
            </dl>
          </div>
          <div className="panel">
            <h3>{tr("Otros días")}</h3>
            <input
              aria-label={tr("Buscar días del diario")}
              placeholder={tr("Buscar en el diario…")}
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
          <span className="muted">{tr("Referencia a una tarea eliminada")}</span>
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
            aria-label={tr("Editar bloque")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="icon-button" aria-label={tr("Guardar bloque")}>
            <Check size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={tr("Cancelar edición")}
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
        aria-label={tr("Quitar bloque del diario")}
        title={tr("Quitar mención (conserva la tarea)")}
        onClick={() => {
          if (
            confirm(
              tr("¿Quitar este bloque del diario? Las tareas vinculadas se conservan."),
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
        title={tr("Proyectos y objetivos")}
        subtitle={tr("Proyectos, objetivos e hitos.")}
        action={
          <button className="button primary" onClick={() => setCreate(!create)}>
            <Plus size={16} />{tr("Nuevo proyecto")}</button>
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
        <h2>{tr("Proyectos")}{" "}
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
          />{tr("Incluir archivados")}</label>
      </div>
      <div className="segmented project-view-toggle">
        <button
          className={view === "cards" ? "selected" : ""}
          onClick={() => setView("cards")}
        >
          <LayoutGrid size={15} />{tr("Tarjetas")}</button>
        <button
          className={view === "table" ? "selected" : ""}
          onClick={() => setView("table")}
        >
          <List size={15} />{tr("Tabla de proyectos")}</button>
      </div>
      {view === "table" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr("Proyecto")}</th>
                <th>{tr("Objetivo estratégico")}</th>
                <th>{tr("Estado")}</th>
                <th>{tr("Fecha objetivo")}</th>
                <th>{tr("Tareas abiertas")}</th>
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
                        tr("Sin objetivo")}
                    </td>
                    <td>
                      {p.status === "active"
                        ? tr("Activo")
                        : p.status === "on_hold"
                          ? tr("En pausa")
                          : tr("Archivado")}
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
                title={tr("No hay proyectos")}
                text={tr("Crea un proyecto con su nombre.")}
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
        {initial ? tr("Editar") : tr("Nuevo")}{" "}
        {kind === "project"
          ? "proyecto"
          : kind === "goal"
            ? "objetivo"
            : "hito"}
      </h3>
      <label>
        {kind === "project" ? tr("Nombre") : tr("Título")}
        <input
          autoFocus
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tr("¿Qué quieres conseguir?")}
        />
      </label>
      <label>{tr("Descripción")}<textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="form-grid">
        {kind !== "goal" && (
          <label>{tr("Objetivo estratégico")}<select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">{tr("Sin objetivo asociado")}</option>
              {data.goals.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "milestone" && (
          <label>{tr("Proyecto")}<select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">{tr("Sin proyecto")}</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "project" && (
          <label>{tr("Icono (texto o emoji)")}<input
              maxLength={24}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="◈"
            />
          </label>
        )}
        {kind === "project" && (
          <label>{tr("Color")}<input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        )}
        {kind === "goal" && (
          <label>{tr("Inicio")}<input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
        )}
        {kind !== "milestone" && (
          <label>{tr("Fecha objetivo")}<input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )}
        <label>{tr("Estado")}<select value={status} onChange={(e) => setStatus(e.target.value)}>
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
                      active: tr("Activo"),
                      on_hold: tr("En pausa"),
                      archived: tr("Archivado"),
                      achieved: tr("Conseguido"),
                      paused: tr("En pausa"),
                      pending: tr("Pendiente"),
                    } as Record<string, string>
                  )[s]
                }
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>{tr("Cancelar")}</button>
        <button className="button primary">{tr("Guardar")}<Check size={16} />
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
          <h2>{tr("Objetivos estratégicos")}</h2>
        </div>
        <div className="button-row">
          <button
            className="button"
            onClick={() => {
              setCreate("milestone");
              setEdit(null);
            }}
          >
            <Flag size={15} />{tr("Nuevo hito")}</button>
          <button
            className="button primary"
            onClick={() => {
              setCreate("goal");
              setEdit(null);
            }}
          >
            <Plus size={15} />{tr("Nuevo objetivo")}</button>
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
                  ? tr("Activo")
                  : g.status === "achieved"
                    ? tr("Conseguido")
                    : g.status === "paused"
                      ? tr("En pausa")
                      : tr("Archivado")}
              </span>
              <button
                className="text-button"
                onClick={() => {
                  setEdit(g);
                  setCreate(null);
                }}
              >{tr("Editar")}</button>
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
            title={tr("Sin objetivos")}
            text={tr("Define un objetivo y mide avances reales mediante hitos, no por cantidad de tareas.")}
            icon={Target}
          />
        </div>
      )}
      {data.milestones.some((m) => !m.goal_id) && (
        <div className="panel standalone-milestones">
          <h3>{tr("Hitos sin objetivo")}</h3>
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
              (m.status === "achieved" ? tr("Reabrir hito ") : tr("Conseguir hito ")) +
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
        <ChevronLeft size={16} />{tr("Todos los proyectos")}</button>
      <PageHeading
        eyebrow={
          project.status === "archived"
            ? tr("PROYECTO ARCHIVADO")
            : project.status === "on_hold"
              ? tr("PROYECTO EN PAUSA")
              : tr("TU PRÓXIMO GRAN PASO")
        }
        title={project.name}
        subtitle={
          project.description || tr("Sin descripción")
        }
        action={
          <button className="button" onClick={() => setEditing(!editing)}>{tr("Editar proyecto")}</button>
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
          <span>{tr("Fecha objetivo: ")}{niceDate(project.target_date)}</span>
        )}
      </div>
      <div className="status-summary">
        {STATUSES.map((s) => (
          <div key={s}>
            <strong>{tasks.filter((t) => t.status === s).length}</strong>
            <span className={"task-inline-status status-"+s}>{tr(statusLabels[s])}</span>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2>{tr("Hitos del proyecto")}</h2>
        <button className="text-button" onClick={() => setHito(!hito)}>
          <Plus size={16} />{tr("Nuevo hito")}</button>
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
          <p className="muted">{tr("Sin hitos definidos. Añade un resultado que merezca celebrarse.")}</p>
        )}
      </div>
      <div className="section-heading">
        <h2>{tr("Próximos pasos")}</h2>
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
          placeholder={tr("Añadir una tarea a este proyecto…")}
          aria-label={tr("Nueva tarea del proyecto")}
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
        />
        <button className="button primary" disabled={!newTask.trim()}>
          <Plus size={16} />{tr("Añadir")}</button>
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
        <h2>{tr("Avances recientes")}</h2>
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
          <p className="muted">{tr("Tus próximas finalizaciones aparecerán aquí.")}</p>
        )}
      </div>
      <div className="section-heading">
        <h2>{tr("En tu diario")}</h2>
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
          <p className="muted">{tr("Aún no hay tareas de este proyecto vinculadas al diario.")}</p>
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
    [loading,setLoading]=useState(true),
    [retry,setRetry]=useState(0),
    [project, setProject] = useState("");
  const end =
    mode === "weekly"
      ? dateAdd(start, 7)
      : Temporal.PlainDate.from(start).add({ months: 1 }).toString();
  useEffect(() => {
    let active = true;
    setAnalytics(null);setError("");setLoading(true);
    read(`/api/analytics?start=${start}&end=${end}`)
      .then((a) => {
        if (active) { setAnalytics(a); setError(""); }
      })
      .catch((e) => { if(active)setError(e.message); })
      .finally(()=>{if(active)setLoading(false);});
    return () => {
      active = false;
    };
  }, [read, start, end, data, retry]);
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
        title={tr("Avances")}
        subtitle={tr("Resultados verificados del periodo.")}
        action={
          <div className="segmented">
            <button
              className={mode === "weekly" ? "selected" : ""}
              onClick={() => changeMode("weekly")}
            >{tr("Semana")}</button>
            <button
              className={mode === "monthly" ? "selected" : ""}
              onClick={() => changeMode("monthly")}
            >{tr("Mes")}</button>
          </div>
        }
      />
      <div className="analytics-period">
        <button
          className="icon-button"
          aria-label={tr("Periodo anterior")}
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
          aria-label={tr("Periodo siguiente")}
          onClick={() => setStart(end)}
        >
          <ChevronRight />
        </button>
        <span>{data.user.timezone}</span>
      </div>
      {error && (
        <div className="panel">
          <p role="alert" className="error-text">{translateError(error)}</p>
          <button className="button" onClick={()=>setRetry(value=>value+1)}>{tr("Reintentar")}</button>
        </div>
      )}
      {loading ? (
        <div className="panel" role="status">
          <LoaderCircle className="spin" />{tr(" Calculando avances…")}</div>
      ) : analytics ? (
        <>
          <div className="metrics-grid">
            <Metric
              label={tr("Tareas completadas")}
              value={analytics.completed}
              caption={tr("Tareas distintas con finalización verificada")}
            />
            <Metric
              label={tr("Nuevas tareas")}
              value={analytics.created}
              caption={tr("Creaciones reales en el periodo")}
            />
            <Metric
              label={tr("Reducción neta")}
              value={analytics.net}
              caption={tr("Completadas − creadas")}
            />
            <Metric
              label={tr("Backlog al cierre")}
              value={analytics.ending_backlog}
              caption={tr("Tareas abiertas al final del periodo")}
            />
          </div>
          <div className="analytics-notes">
            <span>{tr("Reaperturas: ")}<strong>{analytics.reopened}</strong>
            </span>
            <span>{tr("Cancelaciones: ")}<strong>{analytics.cancelled}</strong>
            </span>
            <span>{tr("Una misma tarea cuenta una vez por periodo.")}</span>
            <span>{tr("Capturar trabajo nuevo puede aumentar el backlog; no mide productividad.")}</span>
          </div>
          <div className="dashboard-grid">
            <section className="panel chart-panel">
              <PanelTitle
                icon={BarChart3}
                title={tr("Actividad diaria")}
                subtitle={tr("Creaciones y finalizaciones verificadas por día.")}
              />
              <div className="chart-legend">
                <span>
                  <i className="dot teal" />{tr("Completadas")}</span>
                <span>
                  <i className="dot slate" />{tr("Creadas")}</span>
              </div>
              <div
                className={"bar-chart" + (analytics.series.length > 14 ? " bar-chart-long" : "")}
                role="img"
                aria-label={tr("Tareas completadas y creadas por día")}
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
                      title={tr("{0}: {1} completadas, {2} creadas",s.date,s.completed,s.created)}
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
                <summary>{tr("Ver datos del gráfico")}</summary>
                <table>
                  <thead>
                    <tr>
                      <th>{tr("Día")}</th>
                      <th>{tr("Completadas")}</th>
                      <th>{tr("Creadas")}</th>
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
                title={tr("Cómo está tu espacio")}
                subtitle={tr("Distribución de tareas al cierre del periodo.")}
              />
              {STATUSES.filter(
                (s) => !["completed", "cancelled"].includes(s),
              ).map((s) => (
                <div className="distribution-row" key={s}>
                  <span>
                    <i className={"dot state-dot " + s} />
                    {tr(statusLabels[s])}
                  </span>
                  <strong>{analytics.distribution[s] ?? 0}</strong>
                </div>
              ))}
              <h3 className="mini-title">{tr("Por prioridad")}</h3>
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
            <h3>{tr("Trabajo abierto por proyecto")}</h3>
            {[
              ...data.projects.map((p) => ({ id: p.id, name: p.name })),
              { id: null, name: tr("Bandeja de entrada") },
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
            <h2>{tr("Lo que has conseguido")}</h2>
            <select
              aria-label={tr("Filtrar logros por proyecto")}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">{tr("Todos los proyectos")}</option>
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
                    <span className="achievement-type">{tr("Tarea completada")}</span>
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
                        : tr("Fecha desconocida / importada")}
                    </small>
                  </div>
                  <span className="achievement-type">{tr("Hito conseguido")}</span>
                </div>
              ))}
            {!analytics.achievements.length && !analytics.milestones.length && (
              <Empty
                title={tr("Sin logros en este periodo")}
                text={tr("Cambia el periodo para consultar otras finalizaciones.")}
                icon={CheckCircle2}
              />
            )}
          </div>
        </>
      ) : null}
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
        title={tr("Tu archivo")}
        subtitle={tr("Tareas, hitos y diarios anteriores.")}
      />
      <div className="archive-tools">
        <div className="segmented">
          {[
            { key: "tasks", label: tr("Tareas") },
            { key: "milestones", label: tr("Hitos") },
            { key: "journals", label: tr("Diarios") },
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
        <label>{tr("Desde")}<input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>{tr("Hasta")}<input
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
              aria-label={tr("Buscar en el histórico")}
              placeholder={tr("Buscar en el histórico…")}
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </div>
          <select
            aria-label={tr("Proyecto del histórico")}
            value={historyProject}
            onChange={(e) => setHistoryProject(e.target.value)}
          >
            <option value="">{tr("Todos los proyectos")}</option>
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
                      {tr(statusLabels[t.status])}
                    </span>
                  }
                />
                <div className="archive-timestamp">
                  {t.completed_at
                    ? tr("Finalización: {0}", niceDate(t.completed_at, data.user.timezone))
                    : t.status === "completed"
                      ? tr("Fecha desconocida / importada")
                      : data.events.some(
                            (e) =>
                              e.task_id === t.id &&
                              e.event_type === "completed",
                          )
                        ? tr("Finalizada anteriormente; ver historial")
                        : t.cancelled_at
                          ? tr("Cancelación: {0}", niceDate(t.cancelled_at, data.user.timezone))
                          : tr("Sin fecha verificada")}{" "}
                  ·{" "}
                  <button
                    className="text-button"
                    onClick={() => props.openTask(t)}
                  >{tr("Ver historial y prioridad al completar")}</button>
                </div>
              </div>
            ))}
            {!tasks.length && (
              <Empty
                title={tr("No hay tareas en el archivo")}
                text={tr("Aquí encontrarás tareas completadas, canceladas y reabiertas. Prueba a ajustar los filtros.")}
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
              title={tr("Sin hitos logrados")}
              text={tr("Aparecerán aquí cuando los marques como logrados.")}
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
                  }{" "}{tr("bloques")}</span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          {!data.journals.length && (
            <Empty
              title={tr("Sin entradas de diario")}
              text={tr("Las entradas guardadas aparecerán aquí.")}
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
    [language, setSelectedLanguage] = useState(data.user.language),
    [view, setView] = useState(data.user.preferred_task_view),
    [week, setWeek] = useState(data.user.week_start_day),
    [success, setSuccess] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  useEffect(() => { setSelectedLanguage(data.user.language); }, [data.user.language]);
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
        title={tr("Configuración")}
        subtitle={tr("Preferencias y exportación de datos.")}
      />
      <div className="settings-grid">
        <section className="panel">
          <PanelTitle
            icon={Settings}
            title={tr("Mi espacio")}
            subtitle={tr("Preferencias personales y calendario.")}
          />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                Intl.DateTimeFormat(locale(), { timeZone: timezone });
                if (
                  await mutate("/api/preferences", "PATCH", {
                    display_name: name,
                    language,
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
            <label>{tr("Nombre")}<input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>{tr("Zona horaria IANA")}<input
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
              <small>{tr("Los días y semanas se calculan en esta zona.")}</small>
            </label>
            <div className="form-grid">
              <label>{tr("Idioma")}<select value={language} onChange={(e) => setSelectedLanguage(e.target.value as typeof language)}>
                  <option value="es">{tr("Español")}</option>
                  <option value="en">{tr("English")}</option>
                </select>
              </label>
              <label>{tr("Apariencia")}<select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as typeof theme)}
                >
                  <option value="light">{tr("Clara")}</option>
                  <option value="dark">{tr("Oscura")}</option>
                  <option value="system">{tr("Seguir al sistema")}</option>
                </select>
              </label>
              <label>{tr("Vista de tareas")}<select
                  value={view}
                  onChange={(e) => setView(e.target.value as typeof view)}
                >
                  <option value="board">{tr("Kanban")}</option>
                  <option value="table">{tr("Tabla")}</option>
                </select>
              </label>
              <label>{tr("La semana empieza en")}<select
                  value={week}
                  onChange={(e) => setWeek(Number(e.target.value))}
                >
                  <option value={1}>{tr("Lunes")}</option>
                  <option value={0}>{tr("Domingo")}</option>
                </select>
              </label>
            </div>
            <button className="button primary" disabled={props.busy}>{tr("Guardar preferencias")}<Check size={16} />
            </button>
          </form>
        </section>
        <div>
          <section className="panel">
            <PanelTitle
              icon={Inbox}
              title={tr("Exportar datos")}
              subtitle={tr("Descarga archivos de tu espacio, cuando quieras.")}
            />
            <p className="settings-copy">{tr("El JSON conserva identificadores, proyectos, objetivos, hitos, tareas, eventos, bloques de diario y focos. Incluye versión de esquema para facilitar futuras migraciones.")}</p>
            <div className="export-options">
              <button className="button" onClick={() => download("json")}>
                <ArrowDown size={16} />{tr("Exportar todo · JSON")}</button>
              <button className="button" onClick={() => download("csv")}>
                <ArrowDown size={16} />{tr("Exportar tareas · CSV")}</button>
            </div>
            <div className="import-preview">
              <h3>{tr("Validar una exportación")}</h3>
              <p>{tr("Solo lectura. No importa ni modifica datos.")}</p>
              <label className="button file-button">{tr("Seleccionar JSON")}<input
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
              {preview && <p role="status">{translateError(preview)}</p>}
            </div>
          </section>
          <section className="panel privacy-panel">
            <Leaf size={21} />
            <h3>{tr("Privado por diseño.")}</h3>
            <p>{tr("Sin conexión a Notion. Sin datos públicos. Las operaciones se limitan a tu espacio autenticado.")}</p>
            <p>{tr("Para eliminar una tarea, abre su detalle y confirma la eliminación. Archivar un proyecto conserva su historia.")}</p>
          </section>
        </div>
      </div>
      {success && (
        <div className="success-message" role="status">
          <CheckCircle2 size={17} />
          {tr(success)}
        </div>
      )}
      {error && (
        <div role="alert" className="error-text">
          {translateError(error)}
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
