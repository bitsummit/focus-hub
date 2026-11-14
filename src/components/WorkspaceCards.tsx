import { useState } from "react";
import { EntityForm } from "./EntityForm";
import { type WorkspaceProps } from "../app/types";
import { ArrowUpRight, CheckCircle2, Circle, Flag, FolderOpen, Target } from "lucide-react";
import { type Snapshot, type Project, type Goal } from "../../shared/contracts";
import { t as tr } from "../i18n";
import { niceDate } from "../lib/dates";

export function GoalCard({ goal, data }: { goal: Goal; data: Snapshot }) {
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

export function ProjectCard({
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

export function MilestoneList({
  milestones,
  ...props
}: WorkspaceProps & { milestones: Snapshot["milestones"] }) {
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
