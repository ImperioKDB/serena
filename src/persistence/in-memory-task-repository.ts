import type { BrowserReadResult } from '../core/result.js';
import type { ResearchEvidenceRecord, ResearchSourceRecord } from '../research/types.js';
import type {
  CreateEvidenceInput,
  CreateTaskInput,
  ResearchTaskRecord,
  TaskRepository,
  TaskStatus,
} from './task-repository.js';
import {
  API_REQUEST_LIMITS,
  type AdmissionDecision,
  type RequestAdmissionStore,
} from './request-admission-store.js';

interface StoredTask extends ResearchTaskRecord {
  ownerId?: string;
  requestText: string;
  input: Record<string, unknown>;
  result?: BrowserReadResult;
  researchResult?: unknown;
  errorCode?: string;
  events: Array<{ eventType: string; payload: Record<string, unknown> }>;
  sources: ResearchSourceRecord[];
  evidence: ResearchEvidenceRecord[];
}

export class InMemoryTaskRepository implements TaskRepository, RequestAdmissionStore {
  private readonly tasks = new Map<string, StoredTask>();
  private readonly requestWindows = new Map<
    string,
    { windowStartedAt: number; requestCount: number; leases: Map<string, number> }
  >();
  private readonly leaseKeys = new Map<string, string>();

  public async createTask(input: CreateTaskInput): Promise<ResearchTaskRecord> {
    const id = `task_${crypto.randomUUID()}`;
    const task: StoredTask = {
      id,
      status: 'queued',
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
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

  public async acquireRequest(requestId: string, keyHash: string): Promise<AdmissionDecision> {
    const now = Date.now();
    let state = this.requestWindows.get(keyHash);
    if (!state) {
      state = { windowStartedAt: now, requestCount: 0, leases: new Map() };
      this.requestWindows.set(keyHash, state);
    } else if (now - state.windowStartedAt >= API_REQUEST_LIMITS.windowSeconds * 1000) {
      state.windowStartedAt = now;
      state.requestCount = 0;
    }
    for (const [leaseId, expiresAt] of state.leases) {
      if (expiresAt <= now) {
        state.leases.delete(leaseId);
        this.leaseKeys.delete(leaseId);
      }
    }
    if (state.requestCount >= API_REQUEST_LIMITS.requestsPerWindow) return 'rate_limited';
    if (state.leases.size >= API_REQUEST_LIMITS.concurrentRequests) return 'concurrency_limited';

    state.requestCount += 1;
    state.leases.set(requestId, now + API_REQUEST_LIMITS.leaseSeconds * 1000);
    this.leaseKeys.set(requestId, keyHash);
    return 'admitted';
  }

  public async releaseRequest(requestId: string): Promise<void> {
    const keyHash = this.leaseKeys.get(requestId);
    if (!keyHash) return;
    this.requestWindows.get(keyHash)?.leases.delete(requestId);
    this.leaseKeys.delete(requestId);
  }

  public getTaskStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId)?.status;
  }

  public getTaskOwner(taskId: string): string | undefined {
    return this.tasks.get(taskId)?.ownerId;
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
