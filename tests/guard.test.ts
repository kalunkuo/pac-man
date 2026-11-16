import { describe, expect, it } from 'vitest';
import { checkRequest } from '../src/server/guard';

const json = { 'content-type': 'application/json' };

describe('checkRequest', () => {
  it('allows loopback hosts on any port, case-insensitively', () => {
    for (const host of ['localhost:5173', '127.0.0.1:8787', 'LOCALHOST', 'localhost']) {
      expect(checkRequest('GET', { host })).toEqual({ ok: true });
    }
  });

  it('rejects foreign or missing hosts with 403', () => {
    for (const host of ['evil.com', 'localhost.evil.com', '127.0.0.1.evil.com:80', undefined]) {
      expect(checkRequest('GET', { host })).toEqual({ ok: false, status: 403, error: 'forbidden host' });
    }
  });

  it('requires a JSON content type for POST', () => {
    const bad = { ok: false, status: 415, error: 'content-type must be application/json' };
    expect(checkRequest('POST', { host: 'localhost:8787' })).toEqual(bad);
    expect(checkRequest('POST', { host: 'localhost:8787', 'content-type': 'text/plain' })).toEqual(bad);
    expect(checkRequest('POST', { host: 'localhost:8787', ...json })).toEqual({ ok: true });
    expect(
      checkRequest('POST', { host: 'localhost:8787', 'content-type': 'application/json; charset=utf-8' }),
    ).toEqual({ ok: true });
  });

  it('does not require a content type for GET', () => {
    expect(checkRequest('GET', { host: 'localhost:8787' })).toEqual({ ok: true });
  });
});
