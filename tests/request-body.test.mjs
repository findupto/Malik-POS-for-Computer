import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestBody } from '../server/requestBody.mjs';

test('parses JSON objects without changing their values', () => {
  assert.deepEqual(parseRequestBody('{"name":"Milk","quantity":2}'), { name: 'Milk', quantity: 2 });
  assert.deepEqual(parseRequestBody(''), {});
  assert.deepEqual(parseRequestBody(undefined), {});
});

test('rejects malformed JSON with an HTTP 400 status', () => {
  assert.throws(() => parseRequestBody('{bad json'), error =>
    error.status === 400 && error.message === 'Request body must be valid JSON'
  );
});

test('rejects JSON primitives, arrays, and null as request objects', () => {
  for (const raw of ['null', '[]', '"text"', '1', 'true']) {
    assert.throws(() => parseRequestBody(raw), error =>
      error.status === 400 && error.message === 'Request body must be a JSON object'
    );
  }
});
