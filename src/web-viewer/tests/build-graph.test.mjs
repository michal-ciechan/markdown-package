import {test} from 'node:test';
import assert from 'node:assert/strict';
import {budgetClosure} from '../build-graph.mjs';

test('budget counts nested startup imports, their shared dependencies and CSS once', () => {
  const edge = (path, kind = 'import-statement') => ({path, kind});
  const records = new Map([
    ['main', {imports: [edge('shared'), edge('startup', 'dynamic-import')], cssBundle: 'css'}],
    ['startup', {imports: [edge('shared'), edge('nested', 'dynamic-import')]}],
    ['nested', {imports: [edge('startup'), edge('git', 'dynamic-import')]}],
    ['git', {imports: [edge('shared')]}], ['shared', {}], ['css', {}],
  ]);
  assert.deepEqual([...budgetClosure(['main'], records)].sort(), ['css', 'git', 'main', 'nested', 'shared', 'startup']);
});

test('only an explicitly deferred dynamic entry is excluded; static imports still count', () => {
  const records = new Map([
    ['main', {imports: [{path: 'optional', kind: 'dynamic-import'}, {path: 'startup', kind: 'dynamic-import'}]}],
    ['optional', {entryPoint: 'fallback.js'}], ['startup', {entryPoint: 'session.js'}],
  ]);
  assert.deepEqual([...budgetClosure(['main'], records, new Set(['fallback.js']))], ['main', 'startup']);
  records.get('main').imports[0].kind = 'import-statement';
  assert.deepEqual([...budgetClosure(['main'], records, new Set(['fallback.js']))], ['main', 'optional', 'startup']);
  assert.throws(() => budgetClosure(['missing'], records), /Unresolved internal chunk/);
});
