import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_CLIENT_METHODS,
  inspectAppServerContract,
  schemaMethods
} from './codex-compat-contract.mjs';

function schemaFor(methods) {
  return {
    oneOf: methods.map((method) => ({
      properties: { method: { enum: [method] } }
    }))
  };
}

test('schemaMethods extracts JSON-RPC methods from generated app-server schemas', () => {
  assert.deepEqual(
    [...schemaMethods(schemaFor(['thread/list', 'thread/read']))],
    ['thread/list', 'thread/read']
  );
});

test('app-server contract reports an exact missing method list', () => {
  const result = inspectAppServerContract({
    clientRequest: schemaFor(REQUIRED_CLIENT_METHODS.filter((method) => method !== 'turn/steer')),
    serverNotification: schemaFor([]),
    serverRequest: schemaFor([])
  });

  assert.equal(result.compatible, false);
  assert.deepEqual(result.missing.clientMethods, ['turn/steer']);
  assert.ok(result.missing.notificationMethods.includes('thread/status/changed'));
  assert.ok(result.missing.serverRequestMethods.includes('item/tool/requestUserInput'));
});
