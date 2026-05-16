import type { GraphNode } from "@refarm.dev/node-contract-v1";

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

export interface Task extends GraphNode {
  "@type": "Task";
  /** title is required for tasks (narrows GraphNode's optional title). */
  title: string;
  status: TaskStatus;
  created_by: string | null;
  assigned_to: string | null;
  /** Overrides GraphNode.context_id to require explicit null (no undefined). */
  context_id: string | null;
  parent_task_id: string | null;
  /** Optional deadline in nanoseconds since Unix epoch. */
  due_at_ns?: number;
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
  created_by?: string;
  /** Return only tasks created after this timestamp (nanoseconds). */
  created_after_ns?: number;
  /** Return only tasks created before this timestamp (nanoseconds). */
  created_before_ns?: number;
  /** Return only tasks due before this timestamp (nanoseconds). */
  due_before_ns?: number;
  /** Return only tasks that include all of these tags. */
  tags?: string[];
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
  delete(id: string): Promise<void>;
  appendEvent(
    event: Omit<TaskEvent, "@id" | "timestamp_ns">,
  ): Promise<TaskEvent>;
  query?(filter: TaskFilter): Promise<Task[]>;
  events?(taskId: string): Promise<TaskEvent[]>;
  summary?(): Promise<TaskSummary>;
}
