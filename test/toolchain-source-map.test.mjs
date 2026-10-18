import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
// Exercise the copy used by Vite's CSS processor, including nested resolution.
const viteRequire = createRequire(require.resolve('vite'));
const postcssRequire = createRequire(viteRequire.resolve('postcss'));
const { SourceMapConsumer, SourceMapGenerator } = postcssRequire('source-map-js');
const flat = { version: 3, sources: ['input.ts'], names: [], mappings: 'AAAA' };
const indexed = (line, column = 0, map = flat) => ({
  version: 3, sections: [{ offset: { line, column }, map }],
});

test('indexed source maps reject invalid or excessive section offsets before conversion', () => {
  for (const offset of [-1, 0.5, NaN, Infinity, '1', 10_000_001]) {
    assert.throws(() => new SourceMapConsumer(indexed(offset)), /offset/i);
  }
  assert.throws(() => new SourceMapConsumer(indexed(0, -1)), /offset/i);
});

test('nested indexed maps cannot bypass the cumulative offset limit', () => {
  assert.throws(() => new SourceMapConsumer(indexed(6_000_000, 0, indexed(6_000_000))), /offset/i);
});

test('valid indexed maps retain original positions and generated mappings', () => {
  const generator = new SourceMapGenerator({ file: 'output.js' });
  generator.addMapping({ generated: { line: 1, column: 0 }, original: { line: 2, column: 3 }, source: 'input.ts' });
  generator.setSourceContent('input.ts', '\n   const value = 1;');
  const consumer = new SourceMapConsumer(indexed(2, 0, generator.toJSON()));
  assert.deepEqual(consumer.originalPositionFor({ line: 3, column: 1 }), {
    source: 'input.ts', line: 2, column: 3, name: null,
  });
  const mappings = [];
  consumer.eachMapping(mapping => mappings.push(mapping));
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].generatedLine, 3);
  assert.equal(mappings[0].originalLine, 2);
  assert.equal(mappings[0].originalColumn, 3);
  assert.equal(consumer.sourceContentFor('input.ts'), '\n   const value = 1;');
});
