import postgres from 'postgres';

import type { BrowserReadResult } from '../core/result.js';
import type { ResearchEvidenceRecord, ResearchSourceRecord } from '../research/types.js';
import {
  API_REQUEST_LIMITS,
  type AdmissionDecision,
  type RequestAdmissionStore,
} from './request-admission-store.js';
import type {
  CreateEvidenceInput,
  CreateTaskInput,
  ListOwnedTasksOptions,
  ResearchTaskDetail,
  ResearchTaskRecord,
  ResearchTaskSummary,
  TaskRepository,
} from './task-repository.js';

interface TaskHistoryRow {
  id: string;
  status: ResearchTaskSummary['status'];
  requestText: string;
  createdAt: Date | string;
  finishedAt: Date | string | null;
  errorCode: string | null;
  sourceCount: number;
  findingCount: number;
  result?: unknown | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toTaskSummary(row: TaskHistoryRow): ResearchTaskSummary {
  const createdAt = toIsoString(row.createdAt);
  if (!createdAt) throw new Error('A stored research task has no creation timestamp.');
  return {
    id: row.id,
    status: row.status,
    requestText: row.requestText,
    createdAt,
    finishedAt: toIsoString(row.finishedAt),
    errorCode: row.errorCode,
    sourceCount: row.sourceCount,
    findingCount: row.findingCount,
  };
}

export class PostgresTaskRepository implements TaskRepository, RequestAdmissionStore {
  private readonly sql: ReturnType<typeof postgres>;

  public constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      ssl: 'require',
    });
  }

  public async createTask(input: CreateTaskInput): Promise<ResearchTaskRecord> {
    const [task] = await this.sql<{ id: string; status: ResearchTaskRecord['status'] }[]>`
      insert into research_tasks (owner_id, request_text, input_json)
      values (
        ${input.ownerId ?? null}::uuid,
        ${input.requestText},
        ${this.sql.json(JSON.parse(JSON.stringify(input.input)))}
      )
      returning id, status
    `;

    if (!task) {
      throw new Error('The database did not return the created task.');
    }

    return task;
  }

  public async listOwnedTasks(
    ownerId: string,
    options: ListOwnedTasksOptions,
  ): Promise<ResearchTaskSummary[]> {
    const rows = await this.sql<TaskHistoryRow[]>`
      select
        id,
        status,
        request_text as "requestText",
        created_at as "createdAt",
        finished_at as "finishedAt",
        error_code as "errorCode",
        case
          when jsonb_typeof(result_json -> 'sources') = 'array'
          then jsonb_array_length(result_json -> 'sources')
          else 0
        end as "sourceCount",
        case
          when jsonb_typeof(result_json -> 'findings') = 'array'
          then jsonb_array_length(result_json -> 'findings')
          else 0
        end as "findingCount"
      from public.research_tasks
      where owner_id = ${ownerId}::uuid
      order by created_at desc, id desc
      limit ${options.limit}
      offset ${options.offset}
    `;
    return rows.map(toTaskSummary);
  }

  public async getOwnedTask(
    ownerId: string,
    taskId: string,
  ): Promise<ResearchTaskDetail | undefined> {
    if (!UUID_PATTERN.test(taskId)) return undefined;
    const [row] = await this.sql<TaskHistoryRow[]>`
      select
        id,
        status,
        request_text as "requestText",
        created_at as "createdAt",
        finished_at as "finishedAt",
        error_code as "errorCode",
        case
          when jsonb_typeof(result_json -> 'sources') = 'array'
          then jsonb_array_length(result_json -> 'sources')
          else 0
        end as "sourceCount",
        case
          when jsonb_typeof(result_json -> 'findings') = 'array'
          then jsonb_array_length(result_json -> 'findings')
          else 0
        end as "findingCount",
        result_json as result
      from public.research_tasks
      where id = ${taskId}::uuid and owner_id = ${ownerId}::uuid
      limit 1
    `;
    if (!row) return undefined;
    return { ...toTaskSummary(row), result: row.result ?? null };
  }

  public async deleteOwnedTask(ownerId: string, taskId: string): Promise<boolean> {
    if (!UUID_PATTERN.test(taskId)) return false;
    const deleted = await this.sql<{ id: string }[]>`
      delete from public.research_tasks
      where id = ${taskId}::uuid and owner_id = ${ownerId}::uuid
      returning id
    `;
    return deleted.length > 0;
  }

  public async recordSource(
    taskId: string,
    result: BrowserReadResult,
  ): Promise<ResearchSourceRecord> {
    const [source] = await this.sql<ResearchSourceRecord[]>`
      insert into research_sources (task_id, url, final_url, title, retrieved_at, result_json)
      values (
        ${taskId},
        ${result.url},
        ${result.finalUrl},
        ${result.title},
        ${result.retrievedAt},
        ${this.sql.json(JSON.parse(JSON.stringify(result)))}
      )
      returning id, task_id as "taskId", result_json as result
    `;

    if (!source) {
      throw new Error('The database did not return the created source.');
    }

    return { ...source, result: source.result as unknown as BrowserReadResult };
  }

  public async recordEvidence(
    taskId: string,
    sourceId: string,
    input: CreateEvidenceInput,
  ): Promise<ResearchEvidenceRecord> {
    const [evidence] = await this.sql<ResearchEvidenceRecord[]>`
      insert into research_evidence (
        task_id, source_id, excerpt, locator, extraction_method, verification_status
      )
      values (
        ${taskId},
        ${sourceId},
        ${input.excerpt},
        ${input.locator},
        ${input.extractionMethod},
        ${input.verificationStatus}
      )
      returning
        id,
        task_id as "taskId",
        source_id as "sourceId",
        excerpt,
        locator,
        extraction_method as "extractionMethod",
        verification_status as "verificationStatus"
    `;

    if (!evidence) {
      throw new Error('The database did not return the created evidence.');
    }

    return evidence;
  }

  public async appendEvent(
    taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.sql`
      insert into execution_events (task_id, sequence_number, event_type, payload_json)
      values (
        ${taskId},
        (select coalesce(max(sequence_number), 0) + 1 from execution_events where task_id = ${taskId}),
        ${eventType},
        ${this.sql.json(JSON.parse(JSON.stringify(payload)))}
      )
    `;

    if (eventType === 'task_started') {
      await this.sql`
        update research_tasks
        set status = 'running', started_at = now()
        where id = ${taskId}
      `;
    }
  }

  public async markCompleted(taskId: string, result: unknown): Promise<void> {
    await this.sql`
      update research_tasks
      set status = 'completed', result_json = ${this.sql.json(JSON.parse(JSON.stringify(result)))}, finished_at = now()
      where id = ${taskId}
    `;
  }

  public async markFailed(taskId: string, errorCode: string): Promise<void> {
    await this.sql`
      update research_tasks
      set status = 'failed', error_code = ${errorCode}, finished_at = now()
      where id = ${taskId}
    `;
  }

  public async acquireRequest(requestId: string, keyHash: string): Promise<AdmissionDecision> {
    const [result] = await this.sql<{ decision: AdmissionDecision }[]>`
      select public.serena_admit_request(
        ${keyHash}::text,
        ${requestId}::uuid,
        ${API_REQUEST_LIMITS.windowSeconds}::integer,
        ${API_REQUEST_LIMITS.requestsPerWindow}::integer,
        ${API_REQUEST_LIMITS.concurrentRequests}::integer,
        ${API_REQUEST_LIMITS.leaseSeconds}::integer
      ) as decision
    `;
    if (!result) throw new Error('The database did not return an admission decision.');
    return result.decision;
  }

  public async releaseRequest(requestId: string): Promise<void> {
    await this.sql`select public.serena_release_request(${requestId}::uuid)`;
  }

  public async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
