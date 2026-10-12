import postgres from 'postgres';

import type { BrowserReadResult } from '../core/result.js';
import type { ResearchEvidenceRecord, ResearchSourceRecord } from '../research/types.js';
import type {
  CreateEvidenceInput,
  CreateTaskInput,
  ResearchTaskRecord,
  TaskRepository,
} from './task-repository.js';

export class PostgresTaskRepository implements TaskRepository {
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
      insert into research_tasks (request_text, input_json)
      values (${input.requestText}, ${this.sql.json(JSON.parse(JSON.stringify(input.input)))})
      returning id, status
    `;

    if (!task) {
      throw new Error('The database did not return the created task.');
    }

    return task;
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

  public async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
