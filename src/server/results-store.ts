import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ID_RE = /^[\w-]{1,64}$/;

export async function saveResults(dir: string, runId: string, results: unknown): Promise<void> {
  if (!ID_RE.test(runId)) throw new Error('invalid run id');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${runId}.json`), JSON.stringify(results, null, 2));
}

export async function listResults(dir: string): Promise<{ runId: string; results: unknown }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: { runId: string; results: unknown }[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      out.push({ runId: name.slice(0, -5), results: JSON.parse(await readFile(join(dir, name), 'utf8')) });
    } catch {
      /* skip unreadable or corrupt files */
    }
  }
  return out;
}
