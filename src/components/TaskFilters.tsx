import { Search } from "lucide-react";
import { STATUSES, PRIORITIES, statusLabels, priorityLabels, type Snapshot } from "../../shared/contracts";
import { t as tr } from "../i18n";

type FilterProps = {
  activeOnly?:boolean; onClear?:()=>void; extraActive?:boolean;
  data: Snapshot;
  search?: string;
  setSearch?: (s: string) => void;
  projectFilter: string;
  setProjectFilter: (s: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  priorityFilter: string;
  setPriorityFilter: (s: string) => void;
};

export function Filters(p: FilterProps) {
  const active=Boolean(p.search||p.projectFilter||p.statusFilter||p.priorityFilter||p.extraActive);
  const advanced=Boolean(p.projectFilter||p.statusFilter||p.priorityFilter);
  const clear=()=>{p.setSearch?.("");p.setProjectFilter("");p.setStatusFilter("");p.setPriorityFilter("");p.onClear?.();};
  const controls = <>
        <select aria-label={tr("Filtrar por proyecto")} value={p.projectFilter} onChange={event=>p.setProjectFilter(event.target.value)}>
          <option value="">{tr(p.activeOnly ? "Proyecto" : "Todos los proyectos")}</option><option value="inbox">{tr("Bandeja de entrada")}</option>
          {p.data.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select aria-label={tr("Filtrar por estado")} value={p.statusFilter} onChange={event=>p.setStatusFilter(event.target.value)}>
          <option value="">{p.activeOnly?tr("Estado"):tr("Todos los estados")}</option>
          {STATUSES.filter(status=>!p.activeOnly||!["completed","cancelled"].includes(status)).map(status=><option key={status} value={status}>{tr(statusLabels[status])}</option>)}
        </select>
        <select aria-label={tr("Filtrar por prioridad")} value={p.priorityFilter} onChange={event=>p.setPriorityFilter(event.target.value)}>
          <option value="">{tr(p.activeOnly ? "Prioridad" : "Toda prioridad")}</option>{PRIORITIES.map(priority=><option key={priority} value={priority}>{tr(priorityLabels[priority])}</option>)}
        </select>
  </>;
  if (p.activeOnly) return <div className="filters task-visible-filters">
    {controls}
    {active&&<button type="button" className="text-button" onClick={clear}>{tr("Limpiar filtros")}</button>}
  </div>;
  return <div className="task-filter-tools">
    <div className="filters filter-search-row">
      <div className="search-field"><Search size={16}/><input aria-label={tr("Buscar tareas")} placeholder={tr("Buscar tareas…")} value={p.search ?? ""} onChange={event=>p.setSearch?.(event.target.value)}/></div>
      {active&&<button type="button" className="text-button" onClick={clear}>{tr("Limpiar filtros")}</button>}
    </div>
    <details className="advanced-filters" open={advanced||undefined}>
      <summary>{tr("Filtros avanzados")}{advanced?" · activos":""}</summary>
      <div className="filters">{controls}</div>
    </details>
  </div>;
}
