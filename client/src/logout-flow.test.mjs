import assert from 'node:assert/strict';
import test from 'node:test';
import { logoutCurrentDevice } from './logout-flow.js';

test('logoutCurrentDevice still clears local auth when remote logout fails', async () => {
  let loggedOut = 0;
  const failure = new Error('server unreachable');

  const result = await logoutCurrentDevice({
    apiFetchImpl: async () => {
      throw failure;
    },
    onLoggedOut: () => {
      loggedOut += 1;
    }
  });

  assert.equal(loggedOut, 1);
  assert.equal(result.remoteLoggedOut, false);
  assert.equal(result.error, failure);
});

test('logoutCurrentDevice reports remote success and clears local auth', async () => {
  let loggedOut = 0;

  const result = await logoutCurrentDevice({
    apiFetchImpl: async () => ({ success: true }),
    onLoggedOut: () => {
      loggedOut += 1;
    }
  });

  assert.equal(loggedOut, 1);
  assert.equal(result.remoteLoggedOut, true);
  assert.equal(result.error, null);
});
