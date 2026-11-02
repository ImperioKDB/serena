import { GeminiResearchProvider } from './gemini-research-provider.js';
import {
  ModelProviderChain,
  type ModelProviderFailureDiagnostic,
} from './model-provider.js';
import { OpenAiCompatibleClaimExtractor, type ClaimExtractor } from './claim-extractor.js';

export interface ModelProviderEnvironment {
  GEMINI_ENABLED?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  LLM_API_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  SERENA_MODEL_PROVIDER_ORDER?: string;
}

export interface ModelProviderFactoryOptions {
  environment: ModelProviderEnvironment;
  onFailure?: (diagnostic: ModelProviderFailureDiagnostic) => void;
}

function parseGeminiEnabled(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error('GEMINI_ENABLED must be either true or false.');
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseProviderOrder(value: string): Array<'gemini' | 'openai-compatible'> {
  const entries = value
    .split(',')
    .map((item) => item.trim().toLocaleLowerCase())
    .filter(Boolean);
  if (entries.length === 0 || entries.some((item) => item !== 'gemini' && item !== 'openai-compatible')) {
    throw new Error(
      'SERENA_MODEL_PROVIDER_ORDER may contain only gemini and openai-compatible, separated by commas.',
    );
  }
  if (new Set(entries).size !== entries.length) {
    throw new Error('SERENA_MODEL_PROVIDER_ORDER must not list a provider more than once.');
  }
  return entries as Array<'gemini' | 'openai-compatible'>;
}

export function createModelProvider(
  options: ModelProviderFactoryOptions,
): ClaimExtractor | undefined {
  const environment = options.environment;
  const geminiEnabled = parseGeminiEnabled(environment.GEMINI_ENABLED);
  const geminiApiKey = nonEmpty(environment.GEMINI_API_KEY);
  const geminiModel = nonEmpty(environment.GEMINI_MODEL) ?? 'gemini-3.8-flash';
  const openAiApiUrl = nonEmpty(environment.LLM_API_URL);
  const openAiApiKey = nonEmpty(environment.LLM_API_KEY);
  const openAiModel = nonEmpty(environment.LLM_MODEL) ?? 'gpt-5-mini';

  if (geminiEnabled && !geminiApiKey) {
    throw new Error('GEMINI_API_KEY is required when GEMINI_ENABLED=true.');
  }
  if (Boolean(openAiApiUrl) !== Boolean(openAiApiKey)) {
    throw new Error('LLM_API_URL and LLM_API_KEY must both be configured to enable the OpenAI-compatible provider.');
  }

  const explicitlyConfiguredOrder = nonEmpty(environment.SERENA_MODEL_PROVIDER_ORDER);
  const order = explicitlyConfiguredOrder
    ? parseProviderOrder(explicitlyConfiguredOrder)
    : geminiEnabled
      ? (['gemini'] as const)
      : openAiApiUrl && openAiApiKey
        ? (['openai-compatible'] as const)
        : [];
  if (order.length === 0) return undefined;

  const providers: ClaimExtractor[] = order.map((provider) => {
    if (provider === 'gemini') {
      if (!geminiEnabled || !geminiApiKey) {
        throw new Error(
          'The Gemini provider is in the explicit order but is not enabled with a server-side API key.',
        );
      }
      return new GeminiResearchProvider(geminiApiKey, geminiModel);
    }
    if (!openAiApiUrl || !openAiApiKey) {
      throw new Error(
        'The OpenAI-compatible provider is in the explicit order but LLM_API_URL and LLM_API_KEY are not configured.',
      );
    }
    return new OpenAiCompatibleClaimExtractor(openAiApiKey, openAiApiUrl, openAiModel);
  });

  return new ModelProviderChain(providers, options.onFailure);
}
