async function req(method, url, body) {
  let r;
  try {
    r = await fetch('/api' + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the server. Is it running on port 4000?');
  }
  let data = null;
  try { data = await r.json(); } catch { /* non-json */ }
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  return data;
}

export const api = {
  health: () => req('GET', '/health'),
  list: () => req('GET', '/lessons'),
  create: (b) => req('POST', '/lessons', b),
  get: (id) => req('GET', `/lessons/${id}`),
  remove: (id) => req('DELETE', `/lessons/${id}`),
  runStep: (id, step) => req('POST', `/lessons/${id}/steps/${step}`),
  save: (id, lesson, label) => req('PUT', `/lessons/${id}/lesson`, { lesson, label }),
  restore: (id, v) => req('POST', `/lessons/${id}/versions/${v}/restore`),
  version: (id, v) => req('GET', `/lessons/${id}/versions/${v}`),
  issue: (id, layer, issueId, action) => req('POST', `/lessons/${id}/qc/${layer}/issues/${issueId}`, { action }),
};
