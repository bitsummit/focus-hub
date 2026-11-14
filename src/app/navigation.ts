import { BarChart3, BookOpen, FolderOpen, Home, Inbox, LayoutDashboard, Settings } from "lucide-react";
import { validDate } from "../lib/dates";

export type Page =
  | "home"
  | "tasks"
  | "projects"
  | "journal"
  | "progress"
  | "archive"
  | "settings";

export const nav: { key: Page; path: string; label: string; icon: typeof Home }[] = [
  { key: "tasks", path: "/tasks", label: "Tareas", icon: Home },
  { key: "home", path: "/dashboard", label: "Mi espacio", icon: LayoutDashboard },
  { key: "journal", path: "/journal", label: "Diario", icon: BookOpen },
  { key: "progress", path: "/progress", label: "Avances", icon: BarChart3 },
  { key: "projects", path: "/projects", label: "Proyectos", icon: FolderOpen },
  { key: "archive", path: "/archive", label: "Archivo", icon: Inbox },
  { key: "settings", path: "/settings", label: "Ajustes", icon: Settings },
];

export function pathState() {
  const path = location.pathname;
  const page = Number(new URLSearchParams(location.search).get("page") ?? 1);
  const section = nav.find((n) => path === n.path || path.startsWith(n.path + "/"));
  return {
    page: section?.key ?? "tasks",
    journalPage: Number.isSafeInteger(page) && page > 0 ? page : 1,
    projectId: path.startsWith("/projects/") ? path.split("/")[2] : null,
    journalDate:
      /^\/journal\/\d{4}-\d{2}-\d{2}$/.test(path) &&
      validDate(path.split("/")[2])
        ? path.split("/")[2]
        : null,
  };
}
