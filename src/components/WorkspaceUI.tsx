import React from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Leaf } from "lucide-react";
import { statusLabels, type Snapshot, type Task } from "../../shared/contracts";
import { Priority } from "./TaskViews";
import { t as tr } from "../i18n";
import { type WorkspaceProps } from "../app/types";
import { dateAdd, niceDate } from "../lib/dates";

export function PageHeading({
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

export function Empty({
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

export function TaskLine({
  task,
  data,
  openTask,
  updateTask,
  extra,
}: {
  task: Task;
  data: Snapshot;
  openTask: WorkspaceProps["openTask"];
  updateTask: WorkspaceProps["updateTask"];
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

export function Metric({
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

export function PanelTitle({
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

export function PeriodNav({
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
