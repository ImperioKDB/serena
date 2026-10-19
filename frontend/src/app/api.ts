import type { ResearchApiResponse, ResearchHistoryPage, ResearchTaskDetail } from './types';

const DEFAULT_API_URL = 'https://serena-imperiokdbs-projects.vercel.app';

export class SerenaApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SerenaApiError';
  }
}

export async function submitResearch(input: {
  apiUrl: string;
  accessToken: string;
  request: string;
  sources: string[];
  sourceMode: 'provided' | 'discover';
}): Promise<ResearchApiResponse> {
  const response = await fetch(`${input.apiUrl.replace(/\/$/u, '')}/v1/research-tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request: input.request,
      sourceMode: input.sourceMode,
      ...(input.sourceMode === 'provided' ? { sources: input.sources } : {}),
      requiresApproval: false,
    }),
  });

  const body = (await response.json().catch(() => null)) as
    ResearchApiResponse | { error?: { message?: string } } | null;

  if (!response.ok) {
    const message =
      body && 'error' in body && body.error?.message
        ? body.error.message
        : `Serena API returned HTTP ${response.status}.`;
    throw new SerenaApiError(message, response.status);
  }

  if (!body || !('data' in body) || !body.data) {
    throw new SerenaApiError('Serena returned an invalid research response.', response.status);
  }

  return body;
}

async function responseError(response: Response): Promise<SerenaApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new SerenaApiError(
    body?.error?.message ?? `Serena API returned HTTP ${response.status}.`,
    response.status,
  );
}

export async function listResearchHistory(input: {
  apiUrl: string;
  accessToken: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<ResearchHistoryPage> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 20),
    offset: String(input.offset ?? 0),
  });
  const response = await fetch(
    `${input.apiUrl.replace(/\/$/u, '')}/v1/research-tasks?${query.toString()}`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: input.signal,
    },
  );
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as { data?: ResearchHistoryPage };
  if (!body.data || !Array.isArray(body.data.items)) {
    throw new SerenaApiError('Serena returned invalid research history.', response.status);
  }
  return body.data;
}

export async function getResearchTask(input: {
  apiUrl: string;
  accessToken: string;
  taskId: string;
  signal?: AbortSignal;
}): Promise<ResearchTaskDetail> {
  const response = await fetch(
    `${input.apiUrl.replace(/\/$/u, '')}/v1/research-tasks/${encodeURIComponent(input.taskId)}`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: input.signal,
    },
  );
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as { data?: ResearchTaskDetail };
  if (!body.data || body.data.id !== input.taskId) {
    throw new SerenaApiError('Serena returned an invalid research task.', response.status);
  }
  return body.data;
}

export async function deleteResearchTask(input: {
  apiUrl: string;
  accessToken: string;
  taskId: string;
}): Promise<void> {
  const response = await fetch(
    `${input.apiUrl.replace(/\/$/u, '')}/v1/research-tasks/${encodeURIComponent(input.taskId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${input.accessToken}` },
    },
  );
  if (!response.ok) throw await responseError(response);
}

export function getDefaultApiUrl(): string {
  return import.meta.env.VITE_SERENA_API_URL || DEFAULT_API_URL;
}
