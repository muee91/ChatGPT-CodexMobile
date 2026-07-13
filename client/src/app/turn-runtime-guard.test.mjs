import assert from 'node:assert/strict';
import test from 'node:test';
import { hasVisibleAssistantForTurn, hasVisibleUserForTurn } from './session-utils.js';
import { loadedMessagesShouldReplaceCurrent, visibleAssistantTextForPayload } from './useTurnRuntime.js';

test('turn refresh does not treat an older assistant message as the current turn result', () => {
  const payload = { turnId: 'turn-new' };
  const loaded = [
    { id: 'u-old', role: 'user', turnId: 'turn-old', content: 'old question' },
    { id: 'a-old', role: 'assistant', turnId: 'turn-old', content: 'old answer' }
  ];

  assert.equal(hasVisibleAssistantForTurn(loaded, payload), false);
  assert.equal(visibleAssistantTextForPayload(loaded, payload), '');
});

test('turn refresh does not treat an older user message as the current turn input', () => {
  const payload = { turnId: 'turn-new' };
  const loaded = [
    { id: 'u-old', role: 'user', turnId: 'turn-old', content: 'old question' }
  ];

  assert.equal(hasVisibleUserForTurn(loaded, payload), false);
});

test('loaded snapshot with only older messages cannot replace the live current turn', () => {
  const payload = { turnId: 'turn-new' };
  const current = [
    { id: 'u-new', role: 'user', turnId: 'turn-new', content: 'new question' },
    { id: 'status-turn-new', role: 'activity', turnId: 'turn-new', status: 'running', content: 'running' }
  ];
  const loaded = [
    { id: 'u-old', role: 'user', turnId: 'turn-old', content: 'old question' },
    { id: 'a-old', role: 'assistant', turnId: 'turn-old', content: 'old answer' }
  ];

  assert.equal(loadedMessagesShouldReplaceCurrent(current, loaded, payload), false);
});

test('fallback latest-message detection still works when payload has no explicit turn id', () => {
  const payload = {};
  const loaded = [
    { id: 'u-1', role: 'user', content: 'hello' },
    { id: 'a-1', role: 'assistant', content: 'world' }
  ];

  assert.equal(hasVisibleUserForTurn(loaded, payload), true);
  assert.equal(hasVisibleAssistantForTurn(loaded, payload), true);
  assert.equal(visibleAssistantTextForPayload(loaded, payload), 'world');
});
