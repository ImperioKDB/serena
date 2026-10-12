import type { ResearchApiResponse } from './types';

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
}): Promise<ResearchApiResponse> {
  const response = await fetch(`${input.apiUrl.replace(/\/$/u, '')}/v1/research-tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      request: input.request,
      sources: input.sources,
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

export function getDefaultApiUrl(): string {
  return import.meta.env.VITE_SERENA_API_URL || DEFAULT_API_URL;
}
