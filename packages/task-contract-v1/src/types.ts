export const TASK_CAPABILITY = "task:v1" as const;

export type TaskStatus =
  | "pending"
  | "active"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled"
  | "deferred";

export type TaskEventKind =
  | "created"
  | "status_changed"
  | "assigned"
  | "noted"
  | "linked"
  | "blocked_by"
  | "unblocked";

export interface Task {
  "@type": "Task";
  "@id": string;
  title: string;
  status: TaskStatus;
  created_by: string | null;
  assigned_to: string | null;
  context_id: string | null;
  parent_task_id: string | null;
  created_at_ns: number;
  updated_at_ns: number;
}

export interface TaskEvent {
  "@type": "TaskEvent";
  "@id": string;
  task_id: string;
  event: TaskEventKind;
  actor: string;
  payload: Record<string, unknown>;
  timestamp_ns: number;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  assigned_to?: string;
  context_id?: string;
  parent_task_id?: string | null;
}

export interface TaskSummary {
  total: number;
  by_status: Record<TaskStatus, number>;
}

export interface TaskConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}

export interface TaskContractAdapter {
  create(
    task: Omit<Task, "@id" | "created_at_ns" | "updated_at_ns">,
  ): Promise<Task>;
  get(id: string): Promise<Task | null>;
  update(
    id: string,
    patch: Partial<Omit<Task, "@id" | "@type">>,
  ): Promise<Task>;
  appendEvent(
    event: Omit<TaskEvent, "@id" | "timestamp_ns">,
  ): Promise<TaskEvent>;
  query?(filter: TaskFilter): Promise<Task[]>;
  events?(taskId: string): Promise<TaskEvent[]>;
  summary?(): Promise<TaskSummary>;
}
