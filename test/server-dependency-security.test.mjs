import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const Fastify = require('fastify');

test('serializer and validator retain their declared URI major and serialize schema references', () => {
  const fastifyRequire = createRequire(require.resolve('fastify'));
  const serializerRequire = createRequire(fastifyRequire.resolve('fast-json-stringify'));
  const validatorRequire = createRequire(createRequire(fastifyRequire.resolve('@fastify/ajv-compiler')).resolve('ajv'));
  assert.match(serializerRequire('fast-uri/package.json').version, /^4\./);
  assert.match(validatorRequire('fast-uri/package.json').version, /^3\./);
  const stringify = fastifyRequire('fast-json-stringify')({
    type: 'object', properties: { item: { $ref: '#/definitions/item' } },
    definitions: { item: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } }
  });
  assert.deepEqual(JSON.parse(stringify({ item: { label: 'fixture', private: 'omitted' } })), { item: { label: 'fixture' } });
});

test('malformed public URLs cannot enter an authenticated sibling fallback', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let privateReads = 0;
  app.register(async (scope) => {
    scope.get('/ok', async () => ({ ok: true }));
    scope.setNotFoundHandler(async (_, reply) => reply.code(404).send({ missing: true }));
  }, { prefix: '/public' });
  app.register(async (scope) => {
    scope.get('/ok', async () => ({ ok: true }));
    scope.setNotFoundHandler({ preHandler: async (request, reply) => {
      if (request.headers.authorization !== 'fixture-owner') return reply.code(401).send({ error: 'unauthorized' });
    } }, async () => { privateReads++; return { private: 'synthetic fixture' }; });
  }, { prefix: '/private' });
  await app.ready();
  for (const url of ['/public/%zz', '/public/%', '/private/%zz']) {
    const response = await app.inject({ method: 'POST', url });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(privateReads, 0);
  assert.equal((await app.inject('/private/missing')).statusCode, 401);
  assert.equal((await app.inject({ url: '/private/missing', headers: { authorization: 'fixture-owner' } })).statusCode, 200);
  assert.equal(privateReads, 1);
});

test('content-type whitespace cannot skip JSON body validation', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let calls = 0;
  app.post('/role', { schema: { body: { type: 'object', required: ['role'], properties: { role: { type: 'string', enum: ['member'] } } } } }, async () => {
    calls++; return { ok: true };
  });
  for (const type of [' application/json', '\tapplication/json', 'application/json\t']) {
    const response = await app.inject({ method: 'POST', url: '/role', headers: { 'content-type': type }, payload: '{"role":"admin"}' });
    assert.ok([400, 415].includes(response.statusCode));
  }
  assert.equal(calls, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/role', payload: { role: 'member' } })).statusCode, 200);
  assert.equal(calls, 1);
});

test('a validated primitive reaches the handler with its validated type', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  app.post('/quantity', { schema: { body: { type: 'integer', minimum: 1, maximum: 10 } } }, async (request) => ({ value: request.body, type: typeof request.body }));
  const response = await app.inject({ method: 'POST', url: '/quantity', headers: { 'content-type': 'application/json' }, payload: '"10"' });
  assert.ok([200, 400].includes(response.statusCode));
  if (response.statusCode === 200) assert.deepEqual(response.json(), { value: 10, type: 'number' });
  const valid = await app.inject({ method: 'POST', url: '/quantity', headers: { 'content-type': 'application/json' }, payload: '10' });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(valid.json(), { value: 10, type: 'number' });
  assert.equal((await app.inject({ method: 'POST', url: '/quantity', headers: { 'content-type': 'application/json' }, payload: '"11"' })).statusCode, 400);
});

test('restrictive proxy trust ignores forwarded host and protocol from other peers', async (t) => {
  const app = Fastify({ trustProxy: '127.0.0.1' });
  t.after(() => app.close());
  app.get('/', async (request) => ({ host: request.host, protocol: request.protocol }));
  const headers = { host: 'app.example', 'x-forwarded-host': 'proxy.example', 'x-forwarded-proto': 'https' };
  const untrusted = await app.inject({ url: '/', remoteAddress: '198.51.100.10', headers });
  assert.deepEqual(untrusted.json(), { host: 'app.example', protocol: 'http' });
  const trusted = await app.inject({ url: '/', remoteAddress: '127.0.0.1', headers });
  assert.deepEqual(trusted.json(), { host: 'proxy.example', protocol: 'https' });
});

const firebaseRequire = createRequire(require.resolve('firebase-admin'));
const Busboy = firebaseRequire('@fastify/busboy');
test('Firebase multipart response headers cannot collide with Object prototypes', { timeout: 2000 }, async () => {
  const parser = new Busboy.Dicer({ boundary: 'fixture' });
  let body = '';
  let headers;
  const finished = new Promise((resolve, reject) => {
    parser.once('error', reject);
    parser.on('part', part => {
      part.once('error', reject);
      part.on('header', value => { headers = value; });
      part.on('data', value => { body += value.toString(); });
    });
    parser.once('finish', resolve);
  });
  parser.end('--fixture\r\nContent-Disposition: form-data; name="field"\r\n__proto__: fixture\r\nconstructor: fixture\r\n\r\npayload\r\n--fixture--\r\n');
  await finished;
  assert.equal(body, 'payload');
  assert.ok(Object.hasOwn(headers, '__proto__'));
  assert.deepEqual(headers.__proto__, ['fixture']);
  assert.deepEqual(headers.constructor, ['fixture']);
});

for (const newline of ['\r', '\n']) {
  test(`multipart parser drops names containing ${JSON.stringify(newline)}`, { timeout: 2000 }, async () => {
    const parser = new Busboy({ headers: { 'content-type': 'multipart/form-data; boundary=fixture' } });
    const fields = [], files = [];
    const finished = new Promise((resolve, reject) => {
      parser.once('error', reject);
      parser.on('field', name => fields.push(name));
      parser.on('file', (name, stream, filename) => { files.push(filename); stream.resume(); });
      parser.once('finish', resolve);
    });
    parser.end(`--fixture\r\nContent-Disposition: form-data; name="valid"\r\n\r\nok\r\n--fixture\r\nContent-Disposition: form-data; name="invalid${newline}field"\r\n\r\nignored\r\n--fixture\r\nContent-Disposition: form-data; name="upload"; filename="invalid${newline}file"\r\nContent-Type: text/plain\r\n\r\nignored\r\n--fixture--\r\n`);
    await finished;
    assert.deepEqual(fields, ['valid']);
    assert.deepEqual(files, []);
  });
}

const nodemailer = require('nodemailer');
test('mail transport blocks raw file and URL reads when access is disabled', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true,
    disableFileAccess: true, disableUrlAccess: true });
  for (const path of ['/synthetic-do-not-read.eml', 'https://example.invalid/do-not-fetch.eml']) {
    await assert.rejects(transport.sendMail({ from: 'sender@example.invalid', to: 'recipient@example.invalid', raw: { path } }), /access rejected|access is disabled|not allowed/i);
  }
});

test('inline mail text and a Buffer attachment keep their MIME contents', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const sent = await transport.sendMail({ from: 'sender@example.invalid', to: 'recipient@example.invalid',
    subject: 'Synthetic attachment', text: 'Synthetic body',
    attachments: [{ filename: 'fixture.pdf', content: Buffer.from('synthetic buffer'), contentType: 'application/pdf' }] });
  assert.deepEqual(sent.envelope.to, ['recipient@example.invalid']);
  const body = sent.message.toString();
  assert.match(body, /application\/pdf/);
  assert.ok(body.includes(Buffer.from('synthetic buffer').toString('base64')));
});
