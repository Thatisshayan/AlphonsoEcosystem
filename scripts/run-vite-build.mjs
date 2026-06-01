import { build } from 'vite';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);

const MAIN_CHUNK_BUDGET_BYTES = 500_000;

if (nodeMajor >= 25) {
  console.warn(
    `[build warning] Detected Node ${process.versions.node}. Vite 5 projects are usually validated on Node 18/20/22 LTS.`
  );
}

async function enforceMainChunkBudget() {
  const assetsDir = join(root, 'dist', 'assets');
  const entries = await readdir(assetsDir, { withFileTypes: true });
  const indexChunk = entries.find((entry) => entry.isFile() && /^index-.*\.js$/i.test(entry.name));

  if (!indexChunk) {
    throw new Error('Main index chunk not found after build.');
  }

  const bundlePath = join(assetsDir, indexChunk.name);
  const bundleStat = await stat(bundlePath);

  if (bundleStat.size > MAIN_CHUNK_BUDGET_BYTES) {
    throw new Error(`Main chunk budget exceeded: ${indexChunk.name} is ${(bundleStat.size / 1024).toFixed(1)} KB, budget is ${(MAIN_CHUNK_BUDGET_BYTES / 1024).toFixed(1)} KB.`);
  }
}

await build({
  configFile: join(root, 'vite.config.js'),
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

await enforceMainChunkBudget();
