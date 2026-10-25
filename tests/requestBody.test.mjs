import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequestBody } from '../server/requestBody.mjs';

test('request body parser accepts JSON objects and an empty body', () => {
  assert.deepEqual(parseRequestBody('{"username":"cashier"}'), { username: 'cashier' });
  assert.deepEqual(parseRequestBody(''), {});
});

test('request body parser rejects malformed JSON with a client error', () => {
  assert.throws(() => parseRequestBody('{bad json'), error => error.status === 400 && /valid JSON/.test(error.message));
});

test('request body parser rejects valid JSON values that are not objects', () => {
  for (const raw of ['null', '[]', '"text"', '42', 'true']) {
    assert.throws(() => parseRequestBody(raw), error => error.status === 400 && /JSON object/.test(error.message), raw);
  }
});
