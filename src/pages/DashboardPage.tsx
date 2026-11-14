import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { ArrowDown, ArrowUp, ArrowUpRight, CheckCircle2, FolderOpen, Plus, Target, X } from "lucide-react";
import { t as tr, locale } from "../i18n";
import { type Page } from "../app/navigation";
import { type WorkspaceProps } from "../app/types";
import { dateAdd, weekOf, localDate } from "../lib/dates";
import { PageHeading, Empty, TaskLine, Metric, PanelTitle, PeriodNav } from "../components/WorkspaceUI";
import { GoalCard, ProjectCard } from "../components/WorkspaceCards";

export function DashboardPage(props: WorkspaceProps & { go: (p: Page, path?: string) => void }) {
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

function FocusPanel({
  type,
  date,
  ...props
}: WorkspaceProps & { type: "daily" | "weekly"; date: string }) {
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
