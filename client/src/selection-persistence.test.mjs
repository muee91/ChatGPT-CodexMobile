import assert from 'node:assert/strict';
import test from 'node:test';

import { selectedSessionFromStoredSelection } from './app/selection-persistence.js';

test('selectedSessionFromStoredSelection keeps the current session when preserveSelection is enabled', () => {
  const sessions = [
    { id: 'thread-a', projectId: 'project-1' },
    { id: 'thread-b', projectId: 'project-1' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    preserveSelection: true,
    currentSession: { id: 'thread-b', projectId: 'project-1' },
    storedSessionId: 'thread-a',
    chooseLatest: true
  });

  assert.equal(selected?.id, 'thread-b');
});

test('selectedSessionFromStoredSelection restores stored session before choosing latest', () => {
  const sessions = [
    { id: 'thread-latest', projectId: 'project-1' },
    { id: 'thread-stored', projectId: 'project-1' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    preserveSelection: false,
    currentSession: null,
    storedSessionId: 'thread-stored',
    chooseLatest: true
  });

  assert.equal(selected?.id, 'thread-stored');
});

test('selectedSessionFromStoredSelection chooses latest only when there is no current or stored session', () => {
  const sessions = [
    { id: 'thread-latest', projectId: 'project-1' },
    { id: 'thread-older', projectId: 'project-1' }
  ];

  const selected = selectedSessionFromStoredSelection(sessions, {
    preserveSelection: false,
    currentSession: null,
    storedSessionId: '',
    chooseLatest: true
  });

  assert.equal(selected?.id, 'thread-latest');
});
