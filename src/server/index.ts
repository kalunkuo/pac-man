import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Budget } from './budget';
import { handleDecide } from './decide';
import { listResults, saveResults } from './results-store';

const PORT = Number(process.env.PORT ?? 8787);
const RESULTS_DIR = 'results';
const budget = new Budget();

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

function send(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}

if (!process.env.OPENROUTER_API_KEY) {
  console.warn('OPENROUTER_API_KEY is not set (copy config/.env.example to config/.env). Baselines still work.');
}

createServer(async (req, res) => {
  try {
    const url = req.url ?? '';
    if (req.method === 'POST' && url === '/api/decide') {
      const r = await handleDecide(await readJson(req), {
        apiKey: process.env.OPENROUTER_API_KEY ?? '',
        budget,
        fetchImpl: fetch,
      });
      return send(res, r.status, r.json);
    }
    if (url === '/api/budget' && req.method === 'GET') return send(res, 200, budget.snapshot());
    if (url === '/api/budget' && req.method === 'POST') {
      const b = (await readJson(req)) as { budgetUsd?: unknown; maxCalls?: unknown } | null;
      if (!b || typeof b.budgetUsd !== 'number' || typeof b.maxCalls !== 'number' || b.budgetUsd < 0 || b.maxCalls < 0) {
        return send(res, 400, { error: 'invalid request' });
      }
      budget.reset(b.budgetUsd, b.maxCalls);
      return send(res, 200, budget.snapshot());
    }
    if (url === '/api/results' && req.method === 'GET') return send(res, 200, await listResults(RESULTS_DIR));
    if (url === '/api/results' && req.method === 'POST') {
      const b = (await readJson(req)) as { runId?: unknown; results?: unknown } | null;
      if (!b || typeof b.runId !== 'string') return send(res, 400, { error: 'invalid request' });
      await saveResults(RESULTS_DIR, b.runId, b.results);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'not found' });
  } catch {
    send(res, 500, { error: 'server error' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`pacman-arena proxy on http://127.0.0.1:${PORT}`));
