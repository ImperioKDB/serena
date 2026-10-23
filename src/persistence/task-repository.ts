import type { BrowserReadResult } from '../core/result.js';
import type {
  EvidenceVerificationStatus,
  ResearchEvidenceRecord,
  ResearchSourceRecord,
} from '../research/types.js';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CreateTaskInput {
  ownerId?: string;
  requestText: string;
  input: Record<string, unknown>;
}

export interface ResearchTaskRecord {
  id: string;
  status: TaskStatus;
}

export interface ResearchTaskSummary {
  id: string;
  status: TaskStatus;
  requestText: string;
  createdAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  sourceCount: number;
  findingCount: number;
}

export interface ResearchTaskDetail extends ResearchTaskSummary {
  result: unknown | null;
}

export interface ListOwnedTasksOptions {
  limit: number;
  offset: number;
}

export interface CreateEvidenceInput {
  excerpt: string;
  locator: string;
  extractionMethod: 'visible-text-prefix';
  verificationStatus: EvidenceVerificationStatus;
}

export interface TaskRepository {
  createTask(input: CreateTaskInput): Promise<ResearchTaskRecord>;
  listOwnedTasks(ownerId: string, options: ListOwnedTasksOptions): Promise<ResearchTaskSummary[]>;
  getOwnedTask(ownerId: string, taskId: string): Promise<ResearchTaskDetail | undefined>;
  deleteOwnedTask(ownerId: string, taskId: string): Promise<boolean>;
  recordSource(taskId: string, result: BrowserReadResult): Promise<ResearchSourceRecord>;
  recordEvidence(
    taskId: string,
    sourceId: string,
    input: CreateEvidenceInput,
  ): Promise<ResearchEvidenceRecord>;
  appendEvent(taskId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  markCompleted(taskId: string, result: unknown): Promise<void>;
  markFailed(taskId: string, errorCode: string): Promise<void>;
}
