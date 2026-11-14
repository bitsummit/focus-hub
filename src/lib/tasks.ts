import { statusLabels, priorityLabels, type Snapshot, type Task, type Status } from "../../shared/contracts";
import { t as tr } from "../i18n";

export const requestId = () => crypto.randomUUID();

export function eventLabel(type: string) {
  return (
    (
      {
        created: tr("Tarea creada"),
        completed: tr("Tarea completada"),
        reopened: tr("Tarea reabierta"),
        cancelled: tr("Tarea cancelada"),
        status_changed: tr("Estado actualizado"),
        priority_changed: tr("Prioridad actualizada"),
        project_changed: tr("Proyecto actualizado"),
        title_changed: tr("Título actualizado"),
        deleted: tr("Tarea eliminada"),
        restored: tr("Tarea restaurada"),
      } as Record<string, string>
    )[type] ?? tr("Tarea actualizada")
  );
}

export function eventValue(json: string, data: Snapshot) {
  try {
    const v = JSON.parse(json);
    if (typeof v === "string")
      { const label=statusLabels[v as Status] ?? priorityLabels[v as Task["priority"]]; return label ? tr(label) : v; }
    if (v && typeof v === "object") {
      return [
        v.status && tr(statusLabels[v.status as Status]),
        v.priority &&
          tr("Prioridad: ") + tr(priorityLabels[v.priority as Task["priority"]]),
        "project_id" in v &&
          tr("Proyecto: ") +
            (data.projects.find((p) => p.id === v.project_id)?.name ??
              tr("Bandeja de entrada")),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return "";
  } catch {
    return "";
  }
}
