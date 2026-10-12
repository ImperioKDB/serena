import type { BrowserReadResult } from '../core/result.js';
import type { ResearchEvidenceRecord, ResearchSourceRecord } from '../research/types.js';
import type {
  CreateEvidenceInput,
  CreateTaskInput,
  ResearchTaskRecord,
  TaskRepository,
  TaskStatus,
} from './task-repository.js';

interface StoredTask extends ResearchTaskRecord {
  requestText: string;
  input: Record<string, unknown>;
  result?: BrowserReadResult;
  researchResult?: unknown;
  errorCode?: string;
  events: Array<{ eventType: string; payload: Record<string, unknown> }>;
  sources: ResearchSourceRecord[];
  evidence: ResearchEvidenceRecord[];
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, StoredTask>();

  public async createTask(input: CreateTaskInput): Promise<ResearchTaskRecord> {
    const id = `task_${crypto.randomUUID()}`;
    const task: StoredTask = {
      id,
      status: 'queued',
      requestText: input.requestText,
      input: input.input,
      events: [],
      sources: [],
      evidence: [],
    };
    this.tasks.set(id, task);
    return { id, status: task.status };
  }

  public async recordSource(
    taskId: string,
    result: BrowserReadResult,
  ): Promise<ResearchSourceRecord> {
    const task = this.requireTask(taskId);
    const source: ResearchSourceRecord = {
      id: `source_${crypto.randomUUID()}`,
      taskId,
      result,
    };
    task.sources.push(source);
    return source;
  }

  public async recordEvidence(
    taskId: string,
    sourceId: string,
    input: CreateEvidenceInput,
  ): Promise<ResearchEvidenceRecord> {
    const task = this.requireTask(taskId);
    const evidence: ResearchEvidenceRecord = {
      id: `evidence_${crypto.randomUUID()}`,
      taskId,
      sourceId,
      ...input,
    };
    task.evidence.push(evidence);
    return evidence;
  }

  public async appendEvent(
    taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const task = this.requireTask(taskId);
    task.events.push({ eventType, payload });
    if (eventType === 'task_started') {
      task.status = 'running';
    }
  }

  public async markCompleted(taskId: string, result: unknown): Promise<void> {
    const task = this.requireTask(taskId);
    task.status = 'completed';
    if (this.isBrowserReadResult(result)) {
      task.result = result;
    } else {
      task.researchResult = result;
    }
  }

  public async markFailed(taskId: string, errorCode: string): Promise<void> {
    const task = this.requireTask(taskId);
    task.status = 'failed';
    task.errorCode = errorCode;
  }

  public getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId)?.status;
  }

  public getSources(taskId: string): ResearchSourceRecord[] {
    return [...(this.tasks.get(taskId)?.sources ?? [])];
  }

  public getEvidence(taskId: string): ResearchEvidenceRecord[] {
    return [...(this.tasks.get(taskId)?.evidence ?? [])];
  }

  private requireTask(taskId: string): StoredTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} does not exist.`);
    }
    return task;
  }

  private isBrowserReadResult(result: unknown): result is BrowserReadResult {
    return (
      typeof result === 'object' && result !== null && 'finalUrl' in result && 'text' in result
    );
  }
}
