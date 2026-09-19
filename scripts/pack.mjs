// Creates release/glaneur.tar.gz: sources only (no node_modules, dist or data), with Unix line endings
// so that the shell scripts and the systemd unit work on Linux even when edited on Windows.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const releaseDir = path.join(root, 'release');
const stage = path.join(releaseDir, 'glaneur');
const SKIP = new Set(['node_modules', 'dist', 'data', 'release', '.git']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|css|json|md|html|yml|yaml|sh|service|example|svg|txt)$|^(Dockerfile|\.gitignore|\.dockerignore|\.gitattributes)$/;

function copy(rel = '') {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const from = path.join(root, rel, entry.name);
    const to = path.join(stage, rel, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copy(path.join(rel, entry.name));
    } else if (TEXT.test(entry.name)) {
      fs.writeFileSync(to, fs.readFileSync(from, 'utf8').replace(/\r\n/g, '\n'));
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
copy();

const archive = path.join(releaseDir, 'glaneur.tar.gz');
fs.rmSync(archive, { force: true });
const result = spawnSync('tar', ['-czf', 'glaneur.tar.gz', '-C', 'glaneur', '.'], { cwd: releaseDir, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });
if (result.status !== 0) {
  console.error('La création de l’archive a échoué (la commande tar est-elle disponible ?).');
  process.exit(result.status ?? 1);
}
console.log(`Archive prête : release/glaneur.tar.gz (${Math.round(fs.statSync(archive).size / 1024)} Ko)`);
