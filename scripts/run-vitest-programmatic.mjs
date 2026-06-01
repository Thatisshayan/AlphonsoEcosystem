import { startVitest } from 'vitest/node';

function sanitizeNodeOptions(raw) {
  if (!raw) return '';
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => {
      const lower = token.toLowerCase();
      return lower !== '--localstorage-file' && !lower.startsWith('--localstorage-file=');
    })
    .join(' ');
}

const sanitizedNodeOptions = sanitizeNodeOptions(process.env.NODE_OPTIONS || '');
if (sanitizedNodeOptions) {
  process.env.NODE_OPTIONS = sanitizedNodeOptions;
} else {
  delete process.env.NODE_OPTIONS;
}

const sanitizedNpmNodeOptions = sanitizeNodeOptions(process.env.npm_config_node_options || '');
if (sanitizedNpmNodeOptions) {
  process.env.npm_config_node_options = sanitizedNpmNodeOptions;
} else {
  delete process.env.npm_config_node_options;
}

const filters = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const runMode = process.argv.includes('--watch') ? 'watch' : 'run';

const ctx = await startVitest(
  runMode,
  filters,
  {
    run: runMode === 'run',
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setupTests.js'],
    configFile: false
  },
  {
    configFile: false
  }
);

if (ctx && !ctx.shouldKeepServer()) {
  await ctx.exit();
}
