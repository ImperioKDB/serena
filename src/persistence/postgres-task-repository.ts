import postgres from 'postgres';

import type { BrowserReadResult } from '../core/result.js';
import type { CreateTaskInput, ResearchTaskRecord, TaskRepository } from './task-repository.js';

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

  public async markCompleted(taskId: string, result: BrowserReadResult): Promise<void> {
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
