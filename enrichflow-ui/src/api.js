const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  status: (locationId) => request('/oauth/status', { params: { locationId } }),
  subscription: (locationId) => request('/api/subscription/status', { params: { locationId } }),
  usage: (locationId) => request('/api/analytics/usage', { params: { locationId } }),
  contacts: (params) => request('/api/contacts', { params }),
  preview: (input, providers) => request('/api/enrich/preview', { method: 'POST', body: { input, ...providers } }),
  enrich: (body) => request('/api/enrich', { method: 'POST', body }),
  decryptUserData: (encryptedData) =>
    request('/api/auth/decrypt-user-data', { method: 'POST', body: { encryptedData } }),
  authorizeUrl: () => `${BASE}/oauth/authorize`
};
