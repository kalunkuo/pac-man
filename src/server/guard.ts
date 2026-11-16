export type GuardResult = { ok: true } | { ok: false; status: number; error: string };

const HOST_RE = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

/**
 * Blocks DNS-rebinding (Host check) and CORS-free cross-site POSTs (JSON content type
 * forces a preflight, and the server sends no CORS headers).
 */
export function checkRequest(method: string, headers: Record<string, string | string[] | undefined>): GuardResult {
  const host = headers.host;
  if (typeof host !== 'string' || !HOST_RE.test(host)) return { ok: false, status: 403, error: 'forbidden host' };
  if (method === 'POST') {
    const type = headers['content-type'];
    if (typeof type !== 'string' || !type.toLowerCase().startsWith('application/json')) {
      return { ok: false, status: 415, error: 'content-type must be application/json' };
    }
  }
  return { ok: true };
}
