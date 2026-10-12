import { describe, expect, it } from 'vitest';

import { InMemoryTaskRepository } from '../src/persistence/in-memory-task-repository.js';

const keyHash = 'a'.repeat(64);

describe('request admission store', () => {
  it('caps active requests and releases leases explicitly', async () => {
    const store = new InMemoryTaskRepository();

    expect(await store.acquireRequest('lease-1', keyHash)).toBe('admitted');
    expect(await store.acquireRequest('lease-2', keyHash)).toBe('admitted');
    expect(await store.acquireRequest('lease-3', keyHash)).toBe('concurrency_limited');

    await store.releaseRequest('lease-1');
    expect(await store.acquireRequest('lease-3', keyHash)).toBe('admitted');
  });

  it('caps successful acquisitions in a fixed window independently of active leases', async () => {
    const store = new InMemoryTaskRepository();

    for (let index = 0; index < 20; index += 1) {
      const requestId = `request-${index}`;
      expect(await store.acquireRequest(requestId, keyHash)).toBe('admitted');
      await store.releaseRequest(requestId);
    }

    expect(await store.acquireRequest('request-21', keyHash)).toBe('rate_limited');
  });
});
