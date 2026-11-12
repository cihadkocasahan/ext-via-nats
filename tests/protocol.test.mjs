import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, subjects, validateCommand } from '../src/protocol.js';
test('local/cloud endpoints and subject boundaries', () => {
  assert.equal(validateConfig({ url: 'ws://localhost:8222' }).url, 'ws://localhost:8222');
  assert.equal(validateConfig({ url: 'wss://cloud.example:443' }).url, 'wss://cloud.example:443');
  for (const url of ['nats://localhost:4222', 'https://localhost', 'ws://user:secret@localhost']) assert.throws(() => validateConfig({ url }));
  assert.throws(() => validateConfig({ prefix: 'mesh.>' }));
  assert.throws(() => validateConfig({ token: 'x', user: 'u' }));
  assert.throws(() => subjects('mesh.browser', 'other.*'));
  assert.throws(() => validateCommand({ id: 'x', steps: [] }));
});
