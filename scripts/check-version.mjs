// src/version.ts の EDITOR_VERSION と package.json の version が一致しているかを検査する(publish 前・typecheck と一緒に回す)
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const src = readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8');
const m = src.match(/EDITOR_VERSION\s*=\s*'([^']+)'/);
if (!m) { console.error('src/version.ts に EDITOR_VERSION がありません'); process.exit(1); }
if (m[1] !== pkg.version) {
  console.error(`版が食い違っています: package.json=${pkg.version} / src/version.ts=${m[1]}。両方を同じ値にしてください`);
  process.exit(1);
}
console.log(`version ok: ${pkg.version}`);
