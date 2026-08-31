import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderStore } from '../server/providers.ts';
import type { ProviderProfile } from '../src/providerProfiles.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local provider store', () => {
  it('keeps credentials server-side and uses them for test and generation', async () => {
    const requests: Array<{ url: string; authorization: string }> = [];
    const server = createServer((request, response) => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization ?? '',
      });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
        return;
      }
      response.end(JSON.stringify({
        model: 'test-model',
        choices: [{ message: { content: '续写正文' } }],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Mock provider did not bind.');
      const root = await mkdtemp(path.join(tmpdir(), 'story-provider-'));
      temporaryRoots.push(root);
      const file = path.join(root, 'providers.json');
      const store = new ProviderStore(file);
      const profile: ProviderProfile = {
        id: 'test-provider',
        name: 'Test Provider',
        kind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        modelId: 'test-model',
        maxContext: 128000,
        maxOutput: 8192,
      };

      await store.save(profile, 'private-test-key');
      expect((await store.list()).find((item) => item.id === profile.id)).toEqual(profile);
      expect(await store.test(profile)).toEqual({ ok: true, modelId: 'test-model' });
      expect(await store.generate(profile.id, '继续写')).toBe('续写正文');
      expect(requests).toEqual([
        { url: '/v1/models', authorization: 'Bearer private-test-key' },
        { url: '/v1/chat/completions', authorization: 'Bearer private-test-key' },
      ]);
      expect(await readFile(file, 'utf8')).toContain('private-test-key');
      expect(JSON.stringify(await store.list())).not.toContain('private-test-key');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
