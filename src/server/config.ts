import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findAppRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name === 'glaneur') return dir;
      } catch {
        // keep walking up
      }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on|oui)$/i.test(value.trim());
}

function int(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const appRoot = findAppRoot();
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version: string };

export const config = {
  appRoot,
  version: pkg.version,
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(appRoot, process.env.DATA_DIR || 'data'),
  webDir: path.join(appRoot, 'dist', 'web'),
  authMode: (process.env.GLANEUR_AUTH || 'password').toLowerCase() === 'none' ? ('none' as const) : ('password' as const),
  initialPassword: process.env.GLANEUR_PASSWORD || '',
  chromiumPath: process.env.CHROMIUM_PATH || '',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  concurrency: int(process.env.MAX_CONCURRENCY, 3),
  browserConcurrency: int(process.env.BROWSER_CONCURRENCY, 1),
  isDev: process.env.NODE_ENV === 'development',
};
