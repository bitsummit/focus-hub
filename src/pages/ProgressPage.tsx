import { useEffect, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, Flag, LayoutGrid, LoaderCircle } from "lucide-react";
import { STATUSES, PRIORITIES, statusLabels, type Analytics } from "../../shared/contracts";
import { Priority } from "../components/TaskViews";
import { t as tr, translateError } from "../i18n";
import { type WorkspaceProps } from "../app/types";
import { dateAdd, weekOf, niceDate } from "../lib/dates";
import { PageHeading, Empty, Metric, PanelTitle } from "../components/WorkspaceUI";

export function ProgressPage({
  read,
  ...props
}: WorkspaceProps & { read: (path: string) => Promise<any> }) {
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
