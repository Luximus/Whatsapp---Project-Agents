import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const vitestRequire = createRequire(require.resolve('vitest/package.json'));
const { interceptorPlugin } = await import(pathToFileURL(vitestRequire.resolve('@vitest/mocker/node')).href);
const { resolveConfig } = await import(pathToFileURL(vitestRequire.resolve('vite')).href);

test('redirect mocks enforce the file allowlist before registering or reading files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'luxisoft-mocker-boundary-'));
  try {
    const root = join(directory, 'project');
    await mkdir(root);
    await writeFile(join(directory, 'outside.js'), 'export const outside = true;');
    await writeFile(join(root, '.env.security-fixture'), 'SYNTHETIC_ONLY=true');
    await writeFile(join(root, 'allowed.js'), 'export const allowed = true;');
    const handlers = new Map(), registered = new Map();
    const plugin = interceptorPlugin({ registry: {
      register(event) { registered.set(event.id, { ...event }); },
      getById(id) { return registered.get(id); },
    } });
    // Resolve Vite's real fs policy without creating or listening on a server.
    const config = await resolveConfig({ root, configFile: false, envFile: false,
      logLevel: 'silent', server: { fs: { strict: true, allow: [root], deny: ['**/.env*'] } } }, 'serve');
    plugin.configureServer({ config, ws: {
      on(name, callback) { handlers.set(name, callback); }, send() {},
    } });
    const register = handlers.get('vitest:interceptor:register');
    assert.equal(typeof register, 'function');
    for (const [id, redirect] of [['outside', 'mock:../outside.js'], ['denied', 'mock:.env.security-fixture']]) {
      register({ type: 'redirect', raw: id, url: `/${id}`, id, redirect });
      assert.equal(registered.has(id), false);
      assert.equal(await plugin.load.handler(id), undefined);
    }
    register({ type: 'redirect', raw: 'allowed', url: '/allowed', id: 'allowed', redirect: 'mock:allowed.js' });
    assert.equal(registered.has('allowed'), true);
    assert.equal(await plugin.load.handler('allowed'), 'export const allowed = true;');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
