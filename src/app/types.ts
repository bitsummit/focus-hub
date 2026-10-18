import { type Snapshot, type Task } from "../../shared/contracts";

export type WorkspaceProps = {
  data: Snapshot;
  mutate: (path: string, method?: string, body?: unknown) => Promise<boolean>;
  updateTask: (id: string, fields: Partial<Task>) => Promise<boolean>;
  openTask: (task: Task) => void;
  today: string;
  busy: boolean;
};
