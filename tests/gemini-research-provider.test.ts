import { describe, expect, it, vi } from 'vitest';

import { GeminiProviderError, GeminiResearchProvider } from '../src/research/gemini-research-provider.js';
import { createModelProvider } from '../src/research/create-model-provider.js';
import type { ResearchEvidenceRecord } from '../src/research/types.js';

const evidence: ResearchEvidenceRecord[] = [{
  id: 'evidence-1',
  taskId: 'task-1',
  sourceId: 'source-1',
  excerpt: 'The program accepts applications from eligible undergraduate students.',
  locator: 'Section: Eligibility · passage 1 · characters 0-82',
  extractionMethod: 'mozilla-readability-passage',
  verificationStatus: 'unverified',
  articleTitle: 'Program eligibility',
  sourceDomain: 'example.org',
}];

function analysisPayload(evidenceId = 'evidence-1'): string {
  return JSON.stringify({
    findings: [{
      claim: 'The program accepts eligible undergraduate applications.',
      status: 'proposed',
      verificationMethod: 'llm-evidence-grounded',
      uncertainty: 'The saved page does not state a closing date.',
      evidenceIds: [evidenceId],
      reviewRequired: true,
    }],
    sourceAssessments: [{ sourceId: 'source-1', relevanceScore: 82, contentType: 'program-page' }],
    evidenceAssessments: [{ evidenceId, relevanceScore: 90, relation: 'supports' }],
    potentialContradictions: [],
    missingEvidence: ['A current application closing date.'],
  });
}

function makeProvider(
  create: ReturnType<typeof vi.fn>,
  timeout = 1_000,
  delay: (ms: number, signal?: AbortSignal) => Promise<void> = async () => undefined,
): GeminiResearchProvider {
  const client = { interactions: { create } } as never;
  return new GeminiResearchProvider('test-key', 'gemini-test-model', client, timeout, delay);
}

function analysisInput(signal?: AbortSignal) {
  return {
    request: 'Find undergraduate funding opportunities.',
    sources: [{ id: 'source-1', title: 'Program eligibility', domain: 'example.org', relevanceScore: 70 }],
    evidence,
    ...(signal === undefined ? {} : { signal }),
  };
}

describe('GeminiResearchProvider', () => {
  it('uses stateless structured output and validates results locally', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output_text: analysisPayload(),
      usage: { total_input_tokens: 120, total_output_tokens: 80 },
    });
    const result = await makeProvider(create).analyzeEvidence(analysisInput());

    expect(result.provider).toBe('gemini');
    expect(result.findings).toMatchObject([{ status: 'proposed', reviewRequired: true }]);
    expect(result.evidenceAssessments).toEqual([
      { evidenceId: 'evidence-1', relevanceScore: 90, relation: 'supports' },
    ]);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini-test-model',
      store: false,
      response_format: { mime_type: 'application/json' },
    });
    expect(create.mock.calls[0]?.[1]).toMatchObject({ timeout_ms: 1_000, retries: { strategy: 'none' } });
  });

  it('drops findings and assessments that cite IDs not supplied to this task', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output_text: analysisPayload('evidence-from-another-task'),
    });
    const result = await makeProvider(create).analyzeEvidence(analysisInput());

    expect(result.findings).toEqual([]);
    expect(result.evidenceAssessments).toEqual([]);
  });

  it('rejects malformed structured output and does not retry schema errors', async () => {
    const create = vi.fn().mockResolvedValue({ status: 'completed', output_text: '{"findings":[]}' });

    await expect(makeProvider(create).analyzeEvidence(analysisInput())).rejects.toMatchObject({
      kind: 'invalid_response',
    } satisfies Partial<GeminiProviderError>);
    expect(create).toHaveBeenCalledOnce();
  });

  it('classifies an unavailable model without silently changing model IDs', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('model not found'), { status: 404 }));

    await expect(makeProvider(create).analyzeEvidence(analysisInput())).rejects.toMatchObject({
      kind: 'model_unavailable',
      statusCode: 404,
    } satisfies Partial<GeminiProviderError>);
    expect(create).toHaveBeenCalledOnce();
  });

  it('retries one transient rate limit and then completes', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limit'), { status: 429 }))
      .mockResolvedValueOnce({ status: 'completed', output_text: analysisPayload() });

    expect((await makeProvider(create).analyzeEvidence(analysisInput())).findings).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries one transient 503 with bounded backoff and does not delegate retries to the SDK', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('service unavailable'), { status: 503 }))
      .mockResolvedValueOnce({ status: 'completed', output_text: analysisPayload() });
    const delay = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(
      async () => undefined,
    );

    await expect(
      makeProvider(create, 6_000, delay).analyzeEvidence(analysisInput()),
    ).resolves.toMatchObject({ provider: 'gemini' });

    expect(create).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledOnce();
    expect(delay.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(250);
    expect(delay.mock.calls[0]?.[0]).toBeLessThanOrEqual(500);
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      timeout_ms: 6_000,
      retries: { strategy: 'none' },
    });
  });

  it('passes caller cancellation to the SDK and reports cancellation', async () => {
    const create = vi.fn().mockImplementation((_payload: unknown, options: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true },
        );
      }),
    );
    const controller = new AbortController();
    const pending = makeProvider(create).analyzeEvidence(analysisInput(controller.signal));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' } satisfies Partial<GeminiProviderError>);
    expect(create).toHaveBeenCalledOnce();
  });
});

describe('model-provider configuration', () => {
  it('keeps Gemini disabled by default even if an API key is present', () => {
    expect(createModelProvider({ environment: { GEMINI_API_KEY: 'test-key' } })).toBeUndefined();
  });

  it('requires a server-side key when enabled and accepts a configurable model', () => {
    expect(() => createModelProvider({ environment: { GEMINI_ENABLED: 'true' } })).toThrow(
      'GEMINI_API_KEY is required when GEMINI_ENABLED=true.',
    );
    expect(createModelProvider({
      environment: { GEMINI_ENABLED: 'true', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-configured' },
    })).toMatchObject({ provider: 'gemini', model: 'gemini-configured' });
  });

  it('uses the existing OpenAI-compatible provider only when configured', () => {
    expect(createModelProvider({
      environment: {
        LLM_API_URL: 'https://api.example.test/v1',
        LLM_API_KEY: 'test-key',
        LLM_MODEL: 'example-model',
      },
    })).toMatchObject({ provider: 'openai-compatible', model: 'example-model' });
  });

  it('permits a paid fallback only in an explicit, validated provider order', () => {
    expect(createModelProvider({
      environment: {
        GEMINI_ENABLED: 'true',
        GEMINI_API_KEY: 'free-tier-key',
        LLM_API_URL: 'https://api.example.test/v1',
        LLM_API_KEY: 'paid-key',
        SERENA_MODEL_PROVIDER_ORDER: 'gemini,openai-compatible',
      },
    })).toMatchObject({ provider: 'gemini', supportsCandidateEvaluation: true });
    expect(() => createModelProvider({
      environment: {
        GEMINI_ENABLED: 'true',
        GEMINI_API_KEY: 'test-key',
        SERENA_MODEL_PROVIDER_ORDER: 'gemini,unlisted-provider',
      },
    })).toThrow('SERENA_MODEL_PROVIDER_ORDER may contain only gemini and openai-compatible, separated by commas.');
  });
});
