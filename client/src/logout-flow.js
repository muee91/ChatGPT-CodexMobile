import { apiFetch } from './api.js';

export async function logoutCurrentDevice({
  apiFetchImpl = apiFetch,
  onLoggedOut = null
} = {}) {
  let error = null;
  try {
    await apiFetchImpl('/api/logout', { method: 'POST' });
  } catch (logoutError) {
    error = logoutError;
  }
  onLoggedOut?.();
  return {
    remoteLoggedOut: error == null,
    error
  };
}
