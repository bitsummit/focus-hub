import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { STATUSES, PRIORITIES, statusLabels, priorityLabels, type Task } from "../../shared/contracts";
import { ProjectSelect } from "./ProjectSelect";
import { t as tr } from "../i18n";
import { type WorkspaceProps } from "../app/types";
import { niceDate } from "../lib/dates";
import { requestId, eventLabel, eventValue } from "../lib/tasks";
import { TaskLine } from "./WorkspaceUI";

export function TaskDialog({
  task,
  onClose,
  ...props
}: WorkspaceProps & { task: Task; onClose: () => void }) {
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
