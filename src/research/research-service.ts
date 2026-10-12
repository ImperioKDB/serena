import type { BrowserAdapter, BrowserReadOptions } from '../browser/browser-adapter.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { ResearchResult } from './types.js';

const MAX_EVIDENCE_CHARS = 500;

export interface ResearchServiceInput {
  request: string;
  sources: string[];
  timeoutMs?: number;
  allowedDomains?: string[];
}

export class ResearchService {
  public constructor(
    private readonly adapter: BrowserAdapter,
    private readonly repository: TaskRepository,
  ) {}

  public async run(
    input: ResearchServiceInput,
  ): Promise<{ taskId: string; result: ResearchResult }> {
    const task = await this.repository.createTask({
      requestText: input.request,
      input: {
        request: input.request,
        sources: input.sources,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
      },
    });
    await this.repository.appendEvent(task.id, 'task_started', {
      sourceCount: input.sources.length,
    });

    const sourceResults: ResearchResult['sources'] = [];
    const evidence: ResearchResult['evidence'] = [];
    const readOptions: BrowserReadOptions = {
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
    };

    try {
      for (const sourceUrl of input.sources) {
        const page = await this.adapter.readPage(sourceUrl, readOptions);
        const source = await this.repository.recordSource(task.id, page);
        const evidenceRecord = await this.repository.recordEvidence(task.id, source.id, {
          excerpt: page.text.slice(0, MAX_EVIDENCE_CHARS),
          locator: 'body visible-text prefix',
          extractionMethod: 'visible-text-prefix',
          verificationStatus: 'unverified',
        });

        sourceResults.push({
          id: source.id,
          url: page.url,
          finalUrl: page.finalUrl,
          title: page.title,
          retrievedAt: page.retrievedAt,
        });
        evidence.push({
          id: evidenceRecord.id,
          sourceId: source.id,
          excerpt: page.text.slice(0, MAX_EVIDENCE_CHARS),
          locator: evidenceRecord.locator,
          verificationStatus: evidenceRecord.verificationStatus,
        });
        await this.repository.appendEvent(task.id, 'source_completed', {
          sourceId: source.id,
          url: page.finalUrl,
        });
      }

      const result: ResearchResult = {
        request: input.request,
        sources: sourceResults,
        evidence,
        findings: [],
      };
      await this.repository.markCompleted(task.id, result);
      await this.repository.appendEvent(task.id, 'task_completed', {
        sourceCount: sourceResults.length,
        evidenceCount: evidence.length,
      });
      return { taskId: task.id, result };
    } catch (error) {
      await this.repository.markFailed(
        task.id,
        error instanceof Error ? error.name : 'RESEARCH_FAILED',
      );
      await this.repository.appendEvent(task.id, 'task_failed', {
        errorType: error instanceof Error ? error.name : 'RESEARCH_FAILED',
      });
      throw error;
    }
  }
}
