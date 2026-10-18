import { useState } from "react";
import { ArrowUpRight, BookOpen, ChevronLeft, Flag, FolderOpen, LayoutGrid, List, Plus, Target } from "lucide-react";
import { STATUSES, PRIORITIES, statusLabels, type Project, type Goal } from "../../shared/contracts";
import { TaskTable } from "../components/TaskViews";
import { t as tr } from "../i18n";
import { type Page } from "../app/navigation";
import { type WorkspaceProps } from "../app/types";
import { niceDate } from "../lib/dates";
import { requestId } from "../lib/tasks";
import { PageHeading, Empty, TaskLine } from "../components/WorkspaceUI";
import { GoalCard, ProjectCard, MilestoneList } from "../components/WorkspaceCards";
import { EntityForm } from "../components/EntityForm";

export function ProjectsPage({
  selectedId,
  go,
  ...props
}: WorkspaceProps & {
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

function GoalsManager(props: WorkspaceProps) {
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

function ProjectDetail({
  project,
  go,
  ...props
}: WorkspaceProps & { project: Project; go: (p: Page, path?: string) => void }) {
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
