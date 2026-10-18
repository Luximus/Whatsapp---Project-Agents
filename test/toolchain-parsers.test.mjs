import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const eslintRequire = createRequire(require.resolve('eslint/package.json'));
const minimatchRequire = createRequire(eslintRequire.resolve('minimatch'));
const yaml = eslintRequire('js-yaml');
const estreeRequire = createRequire(require.resolve('@typescript-eslint/typescript-estree'));
const tsMinimatchRequire = createRequire(estreeRequire.resolve('minimatch'));
const tsBrace = tsMinimatchRequire('brace-expansion');

// Exercise the actual major versions used by the CSS/glob and lint trees.
for (const [name, expand] of [
  ['TypeScript ESLint glob', typeof tsBrace === 'function' ? tsBrace : tsBrace.expand],
  ['ESLint glob', minimatchRequire('brace-expansion')],
]) {
  test(`${name} preserves normal expansion and bounds nested/rewritten patterns`, () => {
    assert.deepEqual(expand('file-{a,b}-{1..2}.css'), [
      'file-a-1.css', 'file-a-2.css', 'file-b-1.css', 'file-b-2.css',
    ]);
    // Small explicit budgets reproduce the security boundary without a DoS.
    const nested = '{{{{a,b}}}}';
    assert.ok(expand(nested, { maxDepth: 1 }).some(value => value.includes('a,b')));
    assert.deepEqual(expand('{a},b}', { maxRewrites: 0 }), ['{a},b}']);
    assert.deepEqual(expand('{a},b}'), ['a}', 'b']);
  });
}

test('ESLint YAML counts empty merge sources against its work budget', () => {
  const source = 'sources: &sources [{}, {}, {}]\nvalue:\n  <<: *sources\n';
  assert.throws(() => yaml.load(source, { maxTotalMergeKeys: 2 }), /maxTotalMergeKeys/);
  assert.deepEqual(yaml.load('base: &base {label: safe}\nvalue: {<<: *base, count: 2}\n').value,
    { label: 'safe', count: 2 });
});
