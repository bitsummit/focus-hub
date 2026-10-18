import { useState } from "react";
import { Check } from "lucide-react";
import { type Snapshot } from "../../shared/contracts";
import { t as tr } from "../i18n";

export function EntityForm({
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
