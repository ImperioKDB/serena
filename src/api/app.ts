import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { BrowserAdapter } from '../browser/browser-adapter.js';
import { BrowserReadError } from '../core/result.js';

const pageReadRequestSchema = z
  .object({
    target: z.string().url(),
    timeoutMs: z.number().int().min(100).max(30_000).optional(),
    allowedDomains: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict();

export interface AppOptions {
  apiKey?: string;
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
    case 'READ_FAILED':
      return { statusCode: 500, code: error.code, message: 'The browser reader failed.' };
  }
}

export function createApp(adapter: BrowserAdapter, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  app.addHook('onRequest', async (request, reply) => {
    if (!options.apiKey || request.url === '/health') {
      return;
    }

    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${options.apiKey}`) {
      await reply
        .code(401)
        .send(errorResponse(request.id, 'UNAUTHORIZED', 'A valid bearer token is required.'));
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

    try {
      const readOptions = {
        ...(parsed.data.timeoutMs === undefined ? {} : { timeoutMs: parsed.data.timeoutMs }),
        ...(parsed.data.allowedDomains === undefined
          ? {}
          : { allowedDomains: parsed.data.allowedDomains }),
      };
      const result = await adapter.readPage(parsed.data.target, readOptions);
      return reply.code(200).send({ data: result, requestId: request.id });
    } catch (error) {
      if (error instanceof BrowserReadError) {
        const mapped = mapBrowserError(error);
        return reply
          .code(mapped.statusCode)
          .send(errorResponse(request.id, mapped.code, mapped.message));
      }

      request.log.error({ err: error }, 'Unexpected page-read failure');
      return reply
        .code(500)
        .send(errorResponse(request.id, 'INTERNAL_ERROR', 'An unexpected error occurred.'));
    }
  });

  return app;
}
