import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';

import type { BrowserAdapter } from '../browser/browser-adapter.js';
import { BrowserReadError } from '../core/result.js';
import type { AuthVerifier } from './supabase-auth.js';
import type { RequestAdmissionStore } from '../persistence/request-admission-store.js';
import type { TaskRepository } from '../persistence/task-repository.js';
import type { ClaimExtractor } from '../research/claim-extractor.js';
import type { SearchProvider } from '../search/search-provider.js';
import { ResearchService } from '../research/research-service.js';

const pageReadRequestSchema = z
  .object({
    target: z.string().url(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
    allowedDomains: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict();

const researchRequestSchema = z
  .object({
    request: z.string().trim().min(1).max(2_000),
    sources: z.array(z.string().url()).min(1).max(5).optional(),
    sourceMode: z.enum(['provided', 'discover']).optional(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
    allowedDomains: z.array(z.string().min(1)).max(20).optional(),
    requiresApproval: z.literal(false).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.sourceMode === 'discover' && value.sources === undefined) ||
      (value.sourceMode !== 'discover' && value.sources !== undefined),
    { message: 'Provide sources or choose discovery mode, but not both.' },
  );

export interface AppOptions {
  apiKey?: string;
  authVerifier?: AuthVerifier;
  corsOrigins?: readonly string[];
  requestAdmission?: RequestAdmissionStore;
  taskRepository?: TaskRepository;
  claimExtractor?: ClaimExtractor;
  searchProvider?: SearchProvider;
}

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

function normalizeCorsOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid CORS origin configuration: ${origin}`);
  }
  const isLocalDevelopmentOrigin =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== 'https:' && !isLocalDevelopmentOrigin)
  ) {
    throw new Error(`CORS entries must be HTTPS origins (or localhost for development): ${origin}`);
  }
  return parsed.origin;
}

function errorResponse(requestId: string, code: string, message: string) {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}

function mapBrowserError(error: BrowserReadError): {
  statusCode: number;
  code: string;
  message: string;
} {
  switch (error.code) {
    case 'INVALID_TARGET':
      return { statusCode: 400, code: error.code, message: error.message };
    case 'NAVIGATION_TIMEOUT':
      return {
        statusCode: 504,
        code: error.code,
        message: 'The page did not respond before the timeout.',
      };
    case 'NAVIGATION_FAILED':
      return { statusCode: 502, code: error.code, message: 'The page could not be read.' };
    case 'RESPONSE_TOO_LARGE':
      return {
        statusCode: 502,
        code: error.code,
        message: 'The page exceeded Serena’s response-size limit.',
      };
    case 'REQUEST_BUDGET_EXCEEDED':
      return {
        statusCode: 502,
        code: error.code,
        message: 'The page exceeded Serena’s request budget.',
      };
    case 'READ_FAILED':
      return { statusCode: 500, code: error.code, message: 'The browser reader failed.' };
  }
}

export function createApp(
  adapter: BrowserAdapter,
  options: AppOptions = {},
  app: FastifyInstance = Fastify({
    logger: true,
    bodyLimit: MAX_REQUEST_BODY_BYTES,
    requestTimeout: 15_000,
  }),
): FastifyInstance {
  const allowedOrigins = [
    'https://hoppscotch.io',
    'https://www.hoppscotch.io',
    'http://localhost:3000',
    'http://localhost:5173',
    ...(options.corsOrigins ?? []),
  ].map(normalizeCorsOrigin);
  void app.register(cors, {
    origin: [...new Set(allowedOrigins)],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  const activeLeases = new WeakMap<FastifyRequest, string>();
  const authenticatedUsers = new WeakMap<FastifyRequest, string>();
  const requestPrincipals = new WeakMap<FastifyRequest, string>();

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.method === 'OPTIONS') {
      return;
    }

    if (options.authVerifier || options.apiKey) {
      const match = /^Bearer\s+([^\s]+)$/iu.exec(request.headers.authorization ?? '');
      const token = match?.[1];
      if (!token) {
        await reply
          .code(401)
          .send(errorResponse(request.id, 'UNAUTHORIZED', 'A valid sign-in session is required.'));
        return;
      }
      const expectedKey = options.apiKey;
      const tokenBuffer = Buffer.from(token);
      const keyBuffer = expectedKey === undefined ? undefined : Buffer.from(expectedKey);
      const isLegacyApiKey =
        keyBuffer !== undefined &&
        tokenBuffer.byteLength === keyBuffer.byteLength &&
        timingSafeEqual(tokenBuffer, keyBuffer);
      if (isLegacyApiKey && expectedKey) {
        requestPrincipals.set(
          request,
          createHmac('sha256', expectedKey).update('serena-legacy-api-key-v1').digest('hex'),
        );
      } else if (options.authVerifier) {
        try {
          const user = await options.authVerifier(token);
          if (!user) {
            await reply
              .code(401)
              .send(
                errorResponse(
                  request.id,
                  'UNAUTHORIZED',
                  'The sign-in session is invalid or expired.',
                ),
              );
            return;
          }
          authenticatedUsers.set(request, user.id);
          requestPrincipals.set(request, createHash('sha256').update(user.id).digest('hex'));
        } catch (error) {
          request.log.error({ err: error }, 'Supabase Auth verification unavailable');
          await reply
            .code(503)
            .send(
              errorResponse(
                request.id,
                'AUTH_UNAVAILABLE',
                'Sign-in verification is temporarily unavailable.',
              ),
            );
          return;
        }
      } else {
        await reply
          .code(401)
          .send(errorResponse(request.id, 'UNAUTHORIZED', 'A valid bearer token is required.'));
        return;
      }
    }

    const limiterKey = requestPrincipals.get(request);
    if (!limiterKey || !options.requestAdmission) return;

    const leaseId = randomUUID();
    let decision;
    try {
      decision = await options.requestAdmission.acquireRequest(leaseId, limiterKey);
    } catch (error) {
      request.log.error({ err: error }, 'Request admission store unavailable');
      await reply
        .code(503)
        .send(
          errorResponse(
            request.id,
            'REQUEST_GUARD_UNAVAILABLE',
            'Serena is temporarily unavailable.',
          ),
        );
      return;
    }

    if (decision !== 'admitted') {
      const isRateLimited = decision === 'rate_limited';
      await reply
        .header('retry-after', isRateLimited ? '60' : '5')
        .code(isRateLimited ? 429 : 503)
        .send(
          errorResponse(
            request.id,
            isRateLimited ? 'RATE_LIMITED' : 'CONCURRENCY_LIMITED',
            isRateLimited
              ? 'The request rate limit has been reached; retry shortly.'
              : 'Serena is at its active-request limit; retry shortly.',
          ),
        );
      return;
    }
    activeLeases.set(request, leaseId);
  });

  app.addHook('onResponse', async (request) => {
    const leaseId = activeLeases.get(request);
    if (!leaseId || !options.requestAdmission) return;
    activeLeases.delete(request);
    try {
      await options.requestAdmission.releaseRequest(leaseId);
    } catch (error) {
      request.log.error({ err: error }, 'Could not release request admission lease');
    }
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/v1/page-reads', async (request, reply) => {
    const parsed = pageReadRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request.id,
            'INVALID_REQUEST',
            'Request body does not match the page-read schema.',
          ),
        );
    }

    let taskId: string | undefined;
    try {
      if (options.taskRepository) {
        const task = await options.taskRepository.createTask({
          ...(authenticatedUsers.has(request) ? { ownerId: authenticatedUsers.get(request)! } : {}),
          requestText: `Read public page: ${parsed.data.target}`,
          input: {
            target: parsed.data.target,
            ...(parsed.data.timeoutMs === undefined ? {} : { timeoutMs: parsed.data.timeoutMs }),
            ...(parsed.data.allowedDomains === undefined
              ? {}
              : { allowedDomains: parsed.data.allowedDomains }),
          },
        });
        taskId = task.id;
        await options.taskRepository.appendEvent(task.id, 'task_started', {
          target: parsed.data.target,
        });
      }

      const readOptions = {
        ...(parsed.data.timeoutMs === undefined ? {} : { timeoutMs: parsed.data.timeoutMs }),
        ...(parsed.data.allowedDomains === undefined
          ? {}
          : { allowedDomains: parsed.data.allowedDomains }),
      };
      const result = await adapter.readPage(parsed.data.target, readOptions);
      if (taskId && options.taskRepository) {
        await options.taskRepository.markCompleted(taskId, result);
        await options.taskRepository.appendEvent(taskId, 'task_completed', {
          finalUrl: result.finalUrl,
        });
      }
      return reply.code(200).send({
        data: result,
        requestId: request.id,
        ...(taskId === undefined ? {} : { taskId }),
      });
    } catch (error) {
      if (error instanceof BrowserReadError) {
        if (taskId && options.taskRepository) {
          await options.taskRepository.markFailed(taskId, error.code);
          await options.taskRepository.appendEvent(taskId, 'task_failed', {
            errorCode: error.code,
          });
        }
        const mapped = mapBrowserError(error);
        return reply
          .code(mapped.statusCode)
          .send(errorResponse(request.id, mapped.code, mapped.message));
      }

      if (taskId && options.taskRepository) {
        await options.taskRepository.markFailed(taskId, 'INTERNAL_ERROR');
        await options.taskRepository.appendEvent(taskId, 'task_failed', {
          errorCode: 'INTERNAL_ERROR',
        });
      }
      request.log.error({ err: error }, 'Unexpected page-read failure');
      return reply
        .code(500)
        .send(errorResponse(request.id, 'INTERNAL_ERROR', 'An unexpected error occurred.'));
    }
  });

  app.post('/v1/research-tasks', async (request, reply) => {
    const parsed = researchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request.id,
            'INVALID_REQUEST',
            'Request body does not match the research schema.',
          ),
        );
    }

    if (!options.taskRepository) {
      return reply
        .code(503)
        .send(
          errorResponse(
            request.id,
            'PERSISTENCE_UNAVAILABLE',
            'Research persistence is not configured.',
          ),
        );
    }

    try {
      if (parsed.data.sourceMode === 'discover' && !options.searchProvider) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request.id,
              'SEARCH_UNAVAILABLE',
              'Automatic search is not configured yet. Add a server-side search provider key or use public URLs you already know.',
            ),
          );
      }
      const service = new ResearchService(
        adapter,
        options.taskRepository,
        options.claimExtractor,
        options.searchProvider,
      );
      const execution = await service.run({
        request: parsed.data.request,
        ...(parsed.data.sources === undefined ? {} : { sources: parsed.data.sources }),
        ...(parsed.data.sourceMode === undefined ? {} : { sourceMode: parsed.data.sourceMode }),
        ...(authenticatedUsers.has(request) ? { ownerId: authenticatedUsers.get(request)! } : {}),
        ...(parsed.data.timeoutMs === undefined ? {} : { timeoutMs: parsed.data.timeoutMs }),
        ...(parsed.data.allowedDomains === undefined
          ? {}
          : { allowedDomains: parsed.data.allowedDomains }),
      });
      return reply.code(200).send({
        data: execution.result,
        requestId: request.id,
        taskId: execution.taskId,
      });
    } catch (error) {
      if (error instanceof BrowserReadError) {
        const mapped = mapBrowserError(error);
        return reply
          .code(mapped.statusCode)
          .send(errorResponse(request.id, mapped.code, mapped.message));
      }

      request.log.error({ err: error }, 'Unexpected research failure');
      return reply
        .code(500)
        .send(errorResponse(request.id, 'INTERNAL_ERROR', 'An unexpected error occurred.'));
    }
  });

  return app;
}
