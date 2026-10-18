import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { mock } from 'node:test';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

const blocked = () => { throw new Error('Network is forbidden in Firebase SDK fixtures'); };
mock.method(net.Socket.prototype, 'connect', blocked);
mock.method(tls, 'connect', blocked);
for (const transport of [http, https]) {
  mock.method(transport, 'request', blocked);
  mock.method(transport, 'get', blocked);
}
mock.method(globalThis, 'fetch', blocked);

const root = fileURLToPath(new URL('../', import.meta.url));
assert.equal(existsSync(path.join(root, '.env')), false, 'Run this fixture in a clean source checkout without application credentials');
assert.equal(existsSync(path.resolve('.env')), false, 'Fixture cwd must not contain application credentials');
process.env.DATABASE_URL = 'postgres://fixture:fixture@localhost:5432/fixture';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
const require = createRequire(new URL('../package.json', import.meta.url));
const admin = require('firebase-admin');
const { env } = await import('../src/env.ts');
const { getFirebaseAdminAuth } = await import('../src/lib/firebaseAdmin.ts');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { project_id: 'synthetic-offline-fixture', client_email: 'fixture@synthetic-offline-fixture.iam.gserviceaccount.com' };

for (const type of ['pkcs8', 'pkcs1']) {
  test(`the actual auth wrapper accepts ${type} and signs locally with Node crypto`, async () => {
    assert.equal(admin.apps.length, 0);
    env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ ...account, private_key: privateKey.export({ type, format: 'pem' }) });
    try {
      const auth = getFirebaseAdminAuth();
      assert.equal(getFirebaseAdminAuth(), auth, 'wrapper reuses the existing app');
      const token = await auth.createCustomToken('synthetic-user');
      const [header, payload, signature] = token.split('.');
      assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).uid, 'synthetic-user');
      assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
      await assert.rejects(auth.verifyIdToken('malformed-synthetic-token'), error => error.code === 'auth/argument-error');
    } finally {
      await Promise.all(admin.apps.map(app => app.delete()));
      env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
    }
  });
}

test('the actual auth wrapper rejects invalid PEM before creating an app', () => {
  env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ ...account, private_key: 'invalid-synthetic-pem' });
  try {
    assert.throws(() => getFirebaseAdminAuth(), error => error.code === 'app/invalid-credential');
    assert.equal(admin.apps.length, 0);
  } finally { env.FIREBASE_SERVICE_ACCOUNT_JSON = ''; }
});

test('the effective Firebase production dependency closure no longer uses node-forge', () => {
  function locate(resolver, name) {
    try { return resolver.resolve(`${name}/package.json`); } catch { /* Some packages hide their manifest with exports. */ }
    // ESM-only packages can intentionally hide package.json and a CJS entry.
    // Follow Node's dependency search paths without importing their code.
    for (const directory of resolver.resolve.paths(name) ?? []) {
      const file = path.join(directory, name, 'package.json');
      if (existsSync(file) && JSON.parse(readFileSync(file)).name === name) return file;
    }
    throw new Error(`Package manifest not found: ${name}`);
  }
  const queue = [locate(require, 'firebase-admin')], seen = new Set(), names = new Set();
  while (queue.length) {
    const file = realpathSync(queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    const pkg = JSON.parse(readFileSync(file)), resolver = createRequire(file);
    names.add(pkg.name);
    assert.notEqual(pkg.name, 'node-forge', 'Forge must not remain reachable through Firebase');
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      try { queue.push(locate(resolver, name)); } catch (error) {
        if (!Object.hasOwn(pkg.optionalDependencies ?? {}, name)) throw error;
      }
    }
  }
  assert.ok(names.has('google-auth-library'));
  assert.ok(names.has('jsonwebtoken'));
});
