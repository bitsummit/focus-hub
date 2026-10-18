import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, LoaderCircle, LogOut, Plus, Settings, X } from "lucide-react";
import { type Snapshot, type Session, type Task, type Status, type CaptureInput } from "../../shared/contracts";
import { BrandLogo } from "../components/BrandLogo";
import { MobileQuickCapture } from "../components/QuickCapture";
import { filterTask, type QuickFilter } from "../task-filters";
import { t as tr, getLanguage, setLanguage, subscribeLanguage, translateError } from "../i18n";
import { type Page, nav, pathState } from "./navigation";
import { todayIn } from "../lib/dates";
import { requestId } from "../lib/tasks";
import { Filters } from "../components/TaskFilters";
import { TaskDialog } from "../components/TaskDialog";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { JournalFeed, JournalPage } from "../pages/JournalPage";
import { ProjectsPage } from "../pages/ProjectsPage";
import { ProgressPage } from "../pages/ProgressPage";
import { ArchivePage } from "../pages/ArchivePage";
import { SettingsPage } from "../pages/SettingsPage";
import { TasksPage } from "../pages/TasksPage";

export function App() {
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
      <LoginPage
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
  
  const filterTasks = (tasks:Task[]) => tasks.filter(task=>filterTask(task,archiveFilters));
  
  
  
  
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
          {route.page === "home" && <DashboardPage {...shared} go={go} />}
          {route.page === "tasks" && <TasksPage {...shared} openCount={open.length}
            taskView={taskView} setTaskView={setTaskView} quickFilter={quickFilter} setQuickFilter={setQuickFilter}
            projectFilter={projectFilter} setProjectFilter={setProjectFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} />}
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
