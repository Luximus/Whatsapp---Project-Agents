#!/usr/bin/env node
import { readFile, writeFile, rename, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
const file = process.argv[2];
if (!file || !isAbsolute(file) || basename(file) !== 'whatsapp-bridge.env.json') throw Error('expected_bridge_runtime_environment');
const original = await readFile(file, 'utf8');
const values = JSON.parse(original);
if (values.DEMAND_PROJECT_ENV !== '/var/www/whatsapp/.env') throw Error('bridge_environment_contract_mismatch');
await access('/tmp', constants.W_OK | constants.X_OK);
if (!(await stat('/tmp')).isDirectory()) throw Error('temporary_root_unavailable');
const before = values.TMPDIR ?? null;
values.TMPDIR = '/tmp';
const changed = before !== values.TMPDIR;
if (changed && process.argv.includes('--apply')) {
  // Preserve only the non-secret changed key; never copy the credential snapshot.
  await writeFile(file + '.temp-root-before.json', JSON.stringify({ TMPDIR:before, sha256:createHash('sha256').update(original).digest('hex') })+'\n', { mode:0o600, flag:'wx' });
  if (await readFile(file,'utf8') !== original) throw Error('runtime_environment_changed_concurrently');
  await writeFile(file+'.temp-root-next',JSON.stringify(values,null,2)+'\n',{mode:(await stat(file)).mode&0o777});
  await rename(file+'.temp-root-next',file);
}
console.log(JSON.stringify({changed,applied:changed&&process.argv.includes('--apply'),previousTempRoot:before,tempRoot:values.TMPDIR}));
