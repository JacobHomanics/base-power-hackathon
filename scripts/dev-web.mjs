import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = path.join(root, '.venv', 'bin', 'python');
const expoBin = path.join(root, 'node_modules', '.bin', 'expo');

let scorer = null;
if (existsSync(python)) {
  scorer = spawn(python, [path.join(root, 'scripts', 'score_server.py')], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      HF_HOME: path.join(root, '.cache', 'huggingface'),
      HF_HUB_DISABLE_TELEMETRY: '1',
    },
  });
  scorer.on('exit', (code) => {
    if (code) console.warn(`Photo checker stopped (${code}).`);
  });
} else {
  console.warn('Photo checker is missing. Run: python3 -m venv .venv && .venv/bin/pip install mlx-vlm pillow');
}

const expo = spawn(expoBin, ['start', '--web', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});

function stopScorer() {
  if (scorer && scorer.exitCode === null) scorer.kill('SIGTERM');
}

expo.on('exit', (code) => {
  stopScorer();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  stopScorer();
  expo.kill('SIGINT');
});
process.on('SIGTERM', () => {
  stopScorer();
  expo.kill('SIGTERM');
});
