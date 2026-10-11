import type { BrowserReadResult } from '../core/result.js';
import type {
  CreateTaskInput,
  ResearchTaskRecord,
  TaskRepository,
  TaskStatus,
} from './task-repository.js';

interface StoredTask extends ResearchTaskRecord {
  requestText: string;
  input: Record<string, unknown>;
  result?: BrowserReadResult;
  errorCode?: string;
  events: Array<{ eventType: string; payload: Record<string, unknown> }>;
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
    };
    this.tasks.set(id, task);
    return { id, status: task.status };
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

  public async markCompleted(taskId: string, result: BrowserReadResult): Promise<void> {
    const task = this.requireTask(taskId);
    task.status = 'completed';
    task.result = result;
  }

  public async markFailed(taskId: string, errorCode: string): Promise<void> {
    const task = this.requireTask(taskId);
    task.status = 'failed';
    task.errorCode = errorCode;
  }

  private requireTask(taskId: string): StoredTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} does not exist.`);
    }
    return task;
  }

  public getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId)?.status;
  }
}
