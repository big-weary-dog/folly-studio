// A focused test, named so that node --test never runs it.
import { test } from 'node:test';
import { execFile } from 'node:child_process';
test.only('focused', () => {});
test('options', { only: true }, () => {});
console.log('tests may log', execFile);
