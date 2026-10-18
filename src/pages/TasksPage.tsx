import { LayoutGrid, List } from "lucide-react";
import { Board, TaskTable } from "../components/TaskViews";
import { filterTask, matchesQuickFilter, type QuickFilter } from "../task-filters";
import { t as tr } from "../i18n";
import { type WorkspaceProps } from "../app/types";
import { PageHeading } from "../components/WorkspaceUI";
import { Filters } from "../components/TaskFilters";

type TasksPageProps = WorkspaceProps & {
  openCount: number;
  taskView: "board" | "table";
  setTaskView: (view: "board" | "table") => void;
  quickFilter: QuickFilter;
  setQuickFilter: (filter: QuickFilter) => void;
  projectFilter: string;
  setProjectFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  priorityFilter: string;
  setPriorityFilter: (value: string) => void;
};

export function TasksPage({
  openCount, taskView, setTaskView, quickFilter, setQuickFilter,
  projectFilter, setProjectFilter, statusFilter, setStatusFilter,
  priorityFilter, setPriorityFilter, ...shared
}: TasksPageProps) {
  const {data,today}=shared;
  const advancedFilters={search:"",project:projectFilter,status:statusFilter,priority:priorityFilter};
  const todayIds=new Set(data.focus.filter(item=>item.period_type==="daily"&&item.period_start===today).map(item=>item.task_id));
  const taskResults=data.tasks.filter(task=>filterTask(task,advancedFilters)&&matchesQuickFilter(task,quickFilter,todayIds));
  const taskFiltersActive=Boolean(projectFilter||statusFilter||priorityFilter||quickFilter!=="all");
  const clearTaskFilters=()=>{setProjectFilter("");setStatusFilter("");setPriorityFilter("");setQuickFilter("all");};
  return (
    <>
      <PageHeading
        title={tr("Tareas")}
        badge={<span className="count task-count" role="status"
          aria-label={tr("{0} tareas abiertas",openCount)}
          title={tr("{0} tareas abiertas",openCount)}>{openCount}</span>}
        action={
          <div className="segmented">
            <button
              className={taskView === "board" ? "selected" : ""}
              onClick={() => setTaskView("board")}
            >
              <LayoutGrid size={16} />{tr("Kanban")}</button>
            <button
              className={taskView === "table" ? "selected" : ""}
              onClick={() => setTaskView("table")}
            >
              <List size={16} />{tr("Tabla")}</button>
          </div>
        }
      />
      <div className="quick-filters" role="group" aria-label={tr("Filtros rápidos")}>
        {([
          ["all",tr("Todas")],["inbox",tr("Bandeja")],["today",tr("Hoy")],
          ["priority",tr("Prioritarias")],["waiting",tr("En espera")],["blocked",tr("Bloqueadas")],
        ] as const).map(([key,label])=><button type="button" key={key} className="filter-chip" aria-pressed={quickFilter===key} onClick={()=>setQuickFilter(key)}>{label}</button>)}
      </div>
      <Filters
        activeOnly
        onClear={clearTaskFilters}
        extraActive={quickFilter!=="all"}
        data={data}
        {...{
          projectFilter,
          setProjectFilter,
          statusFilter,
          setStatusFilter,
          priorityFilter,
          setPriorityFilter,
        }}
      />
      {taskView === "board" ? (
        <Board
          tasks={taskResults}
          emptyFiltered={taskFiltersActive}
          onClearFilters={clearTaskFilters}
          {...shared}
          showAll={false}
        />
      ) : (
        <TaskTable
          tasks={taskResults}
          emptyFiltered={taskFiltersActive}
          onClearFilters={clearTaskFilters}
          {...shared}
        />
      )}
    </>
  );
}
