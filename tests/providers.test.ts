import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PROVIDER_RESPONSE_BYTES,
  ProviderCancelledError,
  ProviderStore,
  ProviderTimeoutError,
} from '../server/providers.ts';
import type { ProviderProfile } from '../src/providerProfiles.ts';

const mockedLookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: mockedLookup }));

const temporaryRoots: string[] = [];
const temporaryServers: ReturnType<typeof createServer>[] = [];

type ServerHandler = (request: IncomingMessage, response: ServerResponse) => void;

const startServer = async (handler: ServerHandler) => {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock provider did not bind.');
  temporaryServers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
};

const profileAt = (baseUrl: string, overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id: 'test-provider',
  name: 'Test Provider',
  kind: 'openai-compatible',
  baseUrl,
  modelId: 'test-model',
  maxContext: 128000,
  maxOutput: 8192,
  ...overrides,
});

const makeStore = async (options?: ConstructorParameters<typeof ProviderStore>[1]) => {
  const root = await mkdtemp(path.join(tmpdir(), 'story-provider-'));
  temporaryRoots.push(root);
  return new ProviderStore(path.join(root, 'providers.json'), options);
};

afterEach(async () => {
  await Promise.all(temporaryServers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  })));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  mockedLookup.mockReset();
  vi.restoreAllMocks();
});

describe('local provider store', () => {
  it.skipIf(process.platform === 'win32')('writes and replaces provider config with POSIX mode 0600', async () => {
    const store = await makeStore();
    const profile = profileAt('https://provider.synthetic/v1');
    await store.save(profile, 'mode-test-key');
    expect((await stat(store.file)).mode & 0o777).toBe(0o600);
    await store.save({ ...profile, name: 'Replaced Provider' }, 'mode-test-key-2');
    expect((await stat(store.file)).mode & 0o777).toBe(0o600);
  });

  it('keeps credentials server-side and uses them for test and generation', async () => {
    const requests: Array<{ url: string; authorization: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        requests.push({
          url: request.url ?? '',
          authorization: request.headers.authorization ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
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
      const messages = [
        { role: 'system' as const, content: 'synthetic system contract', blockIds: ['system:block'] },
        { role: 'user' as const, content: JSON.stringify({ target: 'synthetic-target', text: '继续写' }), blockIds: ['user:block'] },
      ];
      expect(await store.generate(profile.id, messages)).toBe('续写正文');
      expect(requests.map(({ url, authorization }) => ({ url, authorization }))).toEqual([
        { url: '/v1/models', authorization: 'Bearer private-test-key' },
        { url: '/v1/chat/completions', authorization: 'Bearer private-test-key' },
      ]);
      const generationBody = JSON.parse(requests[1]?.body ?? '{}') as { messages?: unknown };
      expect(generationBody.messages).toEqual(messages.map(({ role, content }) => ({ role, content })));
      expect(JSON.stringify(generationBody)).not.toContain('blockIds');
      expect(JSON.stringify(generationBody)).not.toContain('private-test-key');
      expect(await readFile(file, 'utf8')).toContain('private-test-key');
      expect(JSON.stringify(await store.list())).not.toContain('private-test-key');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('propagates an external cancellation to the Provider fetch', async () => {
    const store = await makeStore();
    const profile = profileAt('http://127.0.0.1:4311/v1');
    await store.save(profile, 'cancel-test-key');
    const controller = new AbortController();
    let resolveStarted: (signal: AbortSignal) => void = () => undefined;
    const fetchStarted = new Promise<AbortSignal>((resolve) => {
      resolveStarted = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Provider fetch did not receive an AbortSignal.');
      resolveStarted(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    });

    const pending = store.generate(profile.id, [{ role: 'user', content: 'synthetic request', blockIds: [] }], controller.signal);
    const providerSignal = await fetchStarted;
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(providerSignal.aborted).toBe(true);
  });

  it('reports Provider timeout separately and cleans up its timer', async () => {
    vi.useFakeTimers();
    try {
      const store = await makeStore();
      const profile = profileAt('http://127.0.0.1:4311/v1');
      await store.save(profile, 'timeout-test-key');
      let resolveStarted: (signal: AbortSignal) => void = () => undefined;
      const fetchStarted = new Promise<AbortSignal>((resolve) => {
        resolveStarted = resolve;
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Provider fetch did not receive an AbortSignal.');
        resolveStarted(signal);
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
        });
      });

      const pending = store.generate(profile.id, [{ role: 'user', content: 'synthetic request', blockIds: [] }]);
      const providerSignal = await fetchStarted;
      const result = expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);
      await vi.advanceTimersByTimeAsync(180_000);
      await result;

      expect(providerSignal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses a key only for the same provider identity', async () => {
    const requests: string[] = [];
    const { baseUrl } = await startServer((request, response) => {
      requests.push(request.headers.authorization ?? '');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    });
    const store = await makeStore();
    const profile = profileAt(baseUrl);
    await store.save(profile, 'identity-test-key');

    const changed = { ...profile, baseUrl: `${baseUrl}/other` };
    let error: unknown;
    try {
      await store.test(changed);
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain('API Key');
    expect(String(error)).not.toContain('identity-test-key');
    await expect(store.save(changed)).rejects.toThrow('API Key');
    expect(requests).toEqual([]);

    const sameIdentity = { ...profile, baseUrl: `${baseUrl}/` };
    expect(await store.test(sameIdentity)).toEqual({ ok: true, modelId: 'test-model' });
    expect(requests).toEqual(['Bearer identity-test-key']);
    expect(JSON.stringify(await store.list())).not.toContain('identity-test-key');
  });

  it('allows a temporary profile only with its current key and drops fake secrets', async () => {
    const requests: string[] = [];
    const { baseUrl } = await startServer((request, response) => {
      requests.push(request.headers.authorization ?? '');
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    });
    const store = await makeStore();
    const temporaryProfile = profileAt(baseUrl);
    expect(await store.test(temporaryProfile, 'temporary-test-key')).toEqual({
      ok: true,
      modelId: 'test-model',
    });
    expect(requests).toEqual(['Bearer temporary-test-key']);
    expect(JSON.stringify(await store.list())).not.toContain('temporary-test-key');

    await store.save(temporaryProfile, 'saved-test-key');
    await store.save({ ...temporaryProfile, kind: 'fake' });
    expect(await store.test({ ...temporaryProfile, kind: 'fake' })).toEqual({
      ok: true,
      modelId: 'test-model',
    });
    expect(await readFile(store.file, 'utf8')).not.toContain('saved-test-key');
  });

  it('rejects credentials, metadata, link-local, private, and public HTTP targets', async () => {
    const store = await makeStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const blocked = [
      'https://user:password@example.com/v1',
      'https://169.254.169.254/v1',
      'https://100.100.100.200/v1',
      'https://192.168.1.10/v1',
      'http://192.168.1.10/v1',
      'http://8.8.8.8/v1',
    ];
    for (const baseUrl of blocked) {
      await expect(store.test(profileAt(baseUrl), 'synthetic-test-key')).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates every DNS result and supports explicit private-network opt-in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const store = await makeStore();
    mockedLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.10', family: 4 },
    ] as never);
    await expect(store.test(profileAt('https://provider.synthetic/v1'), 'synthetic-test-key'))
      .rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();

    mockedLookup.mockResolvedValue([{ address: '192.168.1.10', family: 4 }] as never);
    const optedInStore = await makeStore({ allowPrivateNetwork: true });
    expect(await optedInStore.test(profileAt('https://provider.synthetic/v1'), 'synthetic-test-key'))
      .toEqual({ ok: true, modelId: 'test-model' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('allows public HTTPS and fails closed when DNS resolution fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    mockedLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '1.1.1.1', family: 4 },
    ] as never);
    const store = await makeStore();
    expect(await store.test(profileAt('https://provider.synthetic/v1'), 'synthetic-test-key'))
      .toEqual({ ok: true, modelId: 'test-model' });
    expect(fetchSpy).toHaveBeenCalledOnce();

    mockedLookup.mockRejectedValue(new Error('synthetic DNS failure'));
    await expect(store.test(profileAt('https://unresolvable.synthetic/v1'), 'synthetic-test-key'))
      .rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('allows HTTP localhost only when every DNS result is loopback', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    mockedLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ] as never);
    const store = await makeStore();
    expect(await store.test(profileAt('http://localhost/v1'), 'localhost-test-key'))
      .toEqual({ ok: true, modelId: 'test-model' });
    expect(mockedLookup).toHaveBeenCalledWith('localhost', { all: true, verbatim: true });
    expect(fetchSpy).toHaveBeenCalledOnce();

    fetchSpy.mockClear();
    mockedLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ] as never);
    await expect(store.test(profileAt('http://localhost/v1'), 'localhost-test-key')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('applies the IPv6 policy, including mapped IPv4 private addresses', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const store = await makeStore();
    const blocked = [
      'https://[fe80::1]/v1',
      'https://[fd00:ec2::254]/v1',
      'https://[fd12::10]/v1',
      'https://[::ffff:192.168.1.10]/v1',
    ];
    for (const baseUrl of blocked) {
      await expect(store.test(profileAt(baseUrl), 'ipv6-test-key')).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(await store.test(profileAt('https://[2001:4860:4860::8888]/v1'), 'ipv6-test-key'))
      .toEqual({ ok: true, modelId: 'test-model' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('does not follow redirects or send a key to the redirect target', async () => {
    let firstAuthorization = '';
    let secondRequests = 0;
    const { baseUrl } = await startServer((request, response) => {
      if (request.url === '/v1/models') {
        firstAuthorization = request.headers.authorization ?? '';
        response.statusCode = 302;
        response.setHeader('location', '/second');
        response.end();
        return;
      }
      secondRequests += 1;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    });
    const store = await makeStore();
    await expect(store.test(profileAt(baseUrl), 'redirect-test-key')).rejects.toThrow();
    expect(firstAuthorization).toBe('Bearer redirect-test-key');
    expect(secondRequests).toBe(0);
  });

  it('rejects provider responses over the fixed size limit without exposing the key', async () => {
    const hugeBody = `{"data":[{"id":"test-model"}]}${'x'.repeat(MAX_PROVIDER_RESPONSE_BYTES)}`;
    const { baseUrl } = await startServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(hugeBody);
    });
    const store = await makeStore();
    let error: unknown;
    try {
      await store.test(profileAt(baseUrl), 'oversized-test-key');
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain('oversized-test-key');
    expect(String(error)).toContain('过大');
  });
});
