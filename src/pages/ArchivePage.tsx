import { MilestoneList } from "../components/WorkspaceCards";
import React, { useState } from "react";
import { ArrowUpRight, BookOpen, Flag, Inbox, Search } from "lucide-react";
import { statusLabels, type Task } from "../../shared/contracts";
import { t as tr } from "../i18n";
import { type Page } from "../app/navigation";
import { type WorkspaceProps } from "../app/types";
import { niceDate, localDate } from "../lib/dates";
import { PageHeading, Empty, TaskLine } from "../components/WorkspaceUI";

export function ArchivePage({
  filterTasks,
  filters,
  go,
  ...props
}: WorkspaceProps & {
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
