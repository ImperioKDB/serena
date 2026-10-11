import type { BrowserReadResult } from '../core/result.js';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CreateTaskInput {
  requestText: string;
  input: Record<string, unknown>;
}

export interface ResearchTaskRecord {
  id: string;
  status: TaskStatus;
}

export interface TaskRepository {
  createTask(input: CreateTaskInput): Promise<ResearchTaskRecord>;
  appendEvent(taskId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  markCompleted(taskId: string, result: BrowserReadResult): Promise<void>;
  markFailed(taskId: string, errorCode: string): Promise<void>;
}
