import React, { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, Circle, Flag, Inbox } from "lucide-react";
import { PRIORITIES, STATUSES, priorityLabels, statusLabels, type Project, type Snapshot, type Status, type Task } from "../../shared/contracts";
import { locale, t } from "../i18n";
import "./task-views.css";
import { ProjectSelect } from "./ProjectSelect";

type UpdateTask = (id: string, fields: Partial<Task>) => Promise<boolean>;
type SharedProps = {
  data: Snapshot;
  updateTask: UpdateTask;
  openTask: (task: Task) => void;
  busy?: boolean;
  emptyFiltered?: boolean;
  onClearFilters?: () => void;
};

function useCompactViewport() {
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

function useTaskMutations(updateTask: UpdateTask) {
  const inflight = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const update = useCallback(async (id: string, fields: Partial<Task>) => {
    if (inflight.current.has(id)) return false;
    inflight.current.add(id);
    setPending(new Set(inflight.current));
    try { return await updateTask(id, fields); }
    finally {
      inflight.current.delete(id);
      setPending(new Set(inflight.current));
    }
  }, [updateTask]);
  return { update, pending };
}

function formatDate(value: string, timezone?: string) {
  const calendarDate = value.length === 10;
  return new Intl.DateTimeFormat(locale(), {
    day: "numeric", month: "short", year: "numeric",
    ...(calendarDate ? { timeZone: "UTC" } : { hour: "2-digit", minute: "2-digit", timeZone: timezone }),
  }).format(new Date(calendarDate ? value + "T12:00:00Z" : value));
}

export function StatusControl({ task, updateTask, disabled = false }: {
  task: Task; updateTask: UpdateTask; disabled?: boolean;
}) {
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  return <select
    aria-label={t("Estado de ") + task.title}
    className={"status-select status-" + task.status}
    title={t(statusLabels[task.status])}
    value={task.status}
    disabled={disabled || pending}
    onClick={(event) => event.stopPropagation()}
    onChange={async (event) => {
      if (saving.current) return;
      const status = event.target.value as Status;
      saving.current = true;
      setPending(true);
      try { await updateTask(task.id, { status }); }
      finally { saving.current = false; setPending(false); }
    }}
  >{STATUSES.map((status) => <option key={status} value={status}>{t(statusLabels[status])}</option>)}</select>;
}

export function Priority({ value, compact = false }: { value: Task["priority"]; compact?: boolean }) {
  return <span className={"priority priority-" + value + (compact ? " v11-priority-compact" : "")}
    title={t("Prioridad ") + t(priorityLabels[value])}>
    <Flag size={compact ? 16 : 13} aria-hidden="true" />
    <span className={compact ? "v11-visually-hidden" : undefined}>{t(priorityLabels[value])}</span>
  </span>;
}

function PriorityControl({ task, updateTask, disabled }: { task: Task; updateTask: UpdateTask; disabled: boolean }) {
  return <span className={"v11-priority-control priority-" + task.priority} title={t("Prioridad: ") + t(priorityLabels[task.priority])}>
    <Flag size={17} aria-hidden="true" />
    <select aria-label={t("Prioridad de ") + task.title} value={task.priority} disabled={disabled}
      onChange={(event) => updateTask(task.id, { priority: event.target.value as Task["priority"] })}>
      {PRIORITIES.map((priority) => <option key={priority} value={priority}>{t(priorityLabels[priority])}</option>)}
    </select>
  </span>;
}

function CompleteControl({ task, updateTask, disabled }: { task: Task; updateTask: UpdateTask; disabled: boolean }) {
  const completed = task.status === "completed";
  return <button type="button" className="check-task v11-check-task" role="checkbox" aria-checked={completed}
    aria-label={t(completed ? "Reabrir " : "Completar ") + task.title} disabled={disabled}
    onClick={() => updateTask(task.id, { status: completed ? "pending" : "completed" })}>
    {completed ? <CheckCircle2 size={21} aria-hidden="true" /> : <Circle size={21} aria-hidden="true" />}
  </button>;
}

function ProjectControl({ task, projects, updateTask, disabled }: {
  task: Task; projects: Project[]; updateTask: UpdateTask; disabled: boolean;
}) {
  return <ProjectSelect className="v11-project-control" aria-label={t("Proyecto de ") + task.title}
    title={projects.find((project) => project.id === task.project_id)?.name ?? t("Bandeja de entrada")}
    value={task.project_id} disabled={disabled} projects={projects} taskTitle={task.title}
    onChange={projectId => updateTask(task.id, { project_id: projectId })} />;
}

// Group existing canonical records without changing filtering, status or metrics.
function taskHierarchy(tasks: Task[], data: Snapshot) {
  const records = new Map(data.tasks.filter(task => !task.deleted_at).map(task => [task.id, task]));
  const visible = new Set(tasks.map(task => task.id));
  const children = new Map<string, Task[]>();
  for (const task of records.values()) {
    if (!task.parent_task_id) continue;
    const siblings = children.get(task.parent_task_id) ?? [];
    siblings.push(task);
    children.set(task.parent_task_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const roots = tasks.filter(task => {
    let parent = task.parent_task_id;
    const visited = new Set([task.id]);
    while (parent && !visited.has(parent)) {
      if (visible.has(parent)) return false;
      visited.add(parent);
      parent = records.get(parent)?.parent_task_id ?? null;
    }
    return true;
  });
  return { roots, children };
}

type SubtaskProps = {
  childrenByParent: Map<string, Task[]>;
  pending: Set<string>;
};

function SubtaskList({ task, childrenByParent, pending, updateTask, openTask, ancestors = [] }: SubtaskProps & {
  task: Task; updateTask: UpdateTask; openTask: SharedProps["openTask"]; ancestors?: string[];
}) {
  const path = [...ancestors, task.id];
  const children = (childrenByParent.get(task.id) ?? []).filter(child => !path.includes(child.id));
  if (!children.length) return null;
  return <ul className="v11-subtasks" aria-label={t("Subtareas") + ": " + task.title}>
    {children.map(child => <li key={child.id} className="v11-subtask-item">
      <div className={"v11-subtask-row" + (child.status === "completed" ? " is-completed" : "")}>
        <CompleteControl task={child} updateTask={updateTask} disabled={pending.has(child.id)} />
        <button type="button" className="v11-subtask-title" onClick={() => openTask(child)}>{child.title}</button>
      </div>
      <SubtaskList task={child} childrenByParent={childrenByParent} pending={pending} updateTask={updateTask} openTask={openTask} ancestors={path} />
    </li>)}
  </ul>;
}

function CompactRow({ task, projects, updateTask, openTask, disabled, childrenByParent, pending }: SubtaskProps & {
  task: Task; projects: Project[]; updateTask: UpdateTask; openTask: SharedProps["openTask"]; disabled: boolean;
}) {
  return <article className={"v11-task-row status-" + task.status + (task.status === "completed" ? " is-completed" : "")}>
    <CompleteControl task={task} updateTask={updateTask} disabled={disabled} />
    <div className="v11-task-row-content">
      <button type="button" className="v11-task-title" onClick={() => openTask(task)}>
        {task.parent_task_id && <span aria-label={t("Subtarea")}>↳ </span>}{task.title}
      </button>
      <PriorityControl task={task} updateTask={updateTask} disabled={disabled} />
      <div className="v11-task-row-meta">
        <div className="v11-task-row-project"><ProjectControl task={task} projects={projects} updateTask={updateTask} disabled={disabled} /></div>
        <StatusControl task={task} updateTask={updateTask} disabled={disabled} />
      </div>
      {task.due_at && <span className="v11-task-date" title={t("Vencimiento")}><CalendarDays size={13} aria-hidden="true" />{formatDate(task.due_at.slice(0, 10))}</span>}
      <SubtaskList task={task} childrenByParent={childrenByParent} pending={pending} updateTask={updateTask} openTask={openTask} />
    </div>
  </article>;
}

function EmptyTasks({ emptyFiltered, onClearFilters }: Pick<SharedProps, "emptyFiltered" | "onClearFilters">) {
  return <div className="v11-task-empty" role="status">
    <Inbox size={23} aria-hidden="true" />
    <h3>{t(emptyFiltered ? "Ninguna tarea coincide con los filtros" : "No hay tareas abiertas")}</h3>
    <p>{t(emptyFiltered ? "Prueba otra búsqueda o limpia los filtros." : "Añade una tarea desde la captura rápida. Las completadas están en Archivo.")}</p>
    {emptyFiltered && onClearFilters && <button type="button" className="text-button" onClick={onClearFilters}>{t("Limpiar filtros")}</button>}
  </div>;
}

export function TaskTable({ tasks, defaultSort = "updated_at", ...props }: SharedProps & { tasks: Task[]; defaultSort?: string }) {
  const [sort, setSort] = useState(defaultSort);
  const [asc, setAsc] = useState(false);
  const compact = useCompactViewport();
  const { update, pending } = useTaskMutations(props.updateTask);
  const { roots, children } = taskHierarchy(tasks, props.data);
  const sorted = [...roots].sort((a, b) => {
    const av = sort === "priority" ? PRIORITIES.indexOf(a.priority) : String(a[sort as keyof Task] ?? "");
    const bv = sort === "priority" ? PRIORITIES.indexOf(b.priority) : String(b[sort as keyof Task] ?? "");
    return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
  });
  const head = (key: string, label: string) => <button type="button" onClick={() => {
    if (sort === key) setAsc(!asc); else { setSort(key); setAsc(true); }
  }}>{t(label)}{sort === key && (asc ? " ↑" : " ↓")}</button>;
  if (!tasks.length) return <EmptyTasks emptyFiltered={props.emptyFiltered} onClearFilters={props.onClearFilters} />;
  if (compact) return <div className="v11-task-list" role="region" aria-label={t("Lista de tareas")}>
    {sorted.map((task) => <CompactRow key={task.id} task={task} projects={props.data.projects} updateTask={update}
      openTask={props.openTask} disabled={pending.has(task.id)} childrenByParent={children} pending={pending} />)}
  </div>;
  return <div className="table-wrap v11-task-table"><table aria-label={t("Tabla de tareas")}>
    <thead><tr>{[["title", "Tarea"], ["priority", "Prioridad"], ["project_id", "Proyecto"], ["status", "Estado"], ["updated_at", "Actualizada"], ["due_at", "Vencimiento"]].map(([key, label]) =>
      <th key={key} scope="col" aria-sort={sort === key ? asc ? "ascending" : "descending" : undefined}>{head(key, label)}</th>)}<th scope="col">{t("En espera de")}</th></tr></thead>
    <tbody>{sorted.map((task) => <tr key={task.id}>
      <td><div className="table-task"><CompleteControl task={task} updateTask={update} disabled={pending.has(task.id)} />
        <button type="button" className="table-title" onClick={() => props.openTask(task)}>{task.parent_task_id && "↳ "}{task.title}</button></div>
        <SubtaskList task={task} childrenByParent={children} pending={pending} updateTask={update} openTask={props.openTask} /></td>
      <td className="v11-priority-cell"><PriorityControl task={task} updateTask={update} disabled={pending.has(task.id)} /></td>
      <td><ProjectControl task={task} projects={props.data.projects} updateTask={update} disabled={pending.has(task.id)} /></td>
      <td><StatusControl task={task} updateTask={update} disabled={pending.has(task.id)} /></td>
      <td className="muted">{formatDate(task.updated_at, props.data.user.timezone)}</td>
      <td><input type="date" aria-label={t("Vencimiento de ") + task.title} value={task.due_at?.slice(0, 10) ?? ""} disabled={pending.has(task.id)}
        onChange={(event) => update(task.id, { due_at: event.target.value || null })} /></td>
      <td className="muted v11-waiting-cell">{task.waiting_on || "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function Board({ tasks, showAll, ...props }: SharedProps & { tasks: Task[]; showAll: boolean }) {
  const compact = useCompactViewport();
  const { update, pending } = useTaskMutations(props.updateTask);
  const columns = STATUSES.filter((status) => showAll || !["completed", "cancelled"].includes(status));
  const groups = new Map<Status, Task[]>(columns.map((status) => [status, []]));
  const { roots, children } = taskHierarchy(tasks, props.data);
  roots.forEach((task) => groups.get(task.status)?.push(task));
  if (!tasks.length && props.emptyFiltered) return <EmptyTasks emptyFiltered onClearFilters={props.onClearFilters} />;
  return <div className={compact ? "v11-mobile-board" : "board v11-desktop-board"} aria-label={t("Tablero Kanban")} role="region">
    {columns.map((status) => {
      const group = groups.get(status)!;
      const heading = <><span className={"dot state-dot " + status} aria-hidden="true" /><span className="v11-column-title">{t(statusLabels[status])}</span><span className="v11-column-count">{group.length}</span></>;
      if (compact) return <details className={"v11-status-group status-" + status} key={status} open>
        <summary>{heading}<ChevronDown size={17} aria-hidden="true" /></summary>
        <div className="v11-status-group-tasks">{group.length ? group.map((task) => <CompactRow key={task.id} task={task} projects={props.data.projects}
          updateTask={update} openTask={props.openTask} disabled={pending.has(task.id)} childrenByParent={children} pending={pending} />) : <p className="v11-group-empty">{t("Sin tareas")}</p>}</div>
      </details>;
      return <section className={"board-column status-" + status} key={status} aria-label={t(statusLabels[status])}
        onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain");
          const task = tasks.find((candidate) => candidate.id === id);
          if (task && task.status !== status) void update(id, { status });
        }}>
        <h2 className="column-heading">{heading}</h2>
        <div className="column-cards">{group.map((task) => <article key={task.id} className="task-card v11-board-card" draggable={!pending.has(task.id)}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }}>
          <div className="v11-board-card-title"><CompleteControl task={task} updateTask={update} disabled={pending.has(task.id)} />
            <button type="button" className="task-card-title" onClick={() => props.openTask(task)}>{task.parent_task_id && "↳ "}{task.title}</button></div>
          <span className="project-dot v11-board-project" title={props.data.projects.find((project) => project.id === task.project_id)?.name ?? t("Bandeja de entrada")}>
            {props.data.projects.find((project) => project.id === task.project_id)?.name ?? t("Bandeja de entrada")}</span>
          <div className="card-meta"><PriorityControl task={task} updateTask={update} disabled={pending.has(task.id)} />
            {task.due_at && <small>{formatDate(task.due_at.slice(0, 10))}</small>}</div>
          {task.waiting_on && <div className="waiting-note">{t("En espera de ")}{task.waiting_on}</div>}
          {task.follow_up_at && <small>{t("Seguimiento: ")}{formatDate(task.follow_up_at.slice(0, 10))}</small>}
          <StatusControl task={task} updateTask={update} disabled={pending.has(task.id)} />
          <SubtaskList task={task} childrenByParent={children} pending={pending} updateTask={update} openTask={props.openTask} />
        </article>)}</div>
        {!group.length && <p className="column-empty">{t("Sin tareas")}</p>}
      </section>;
    })}
  </div>;
}
