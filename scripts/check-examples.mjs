#!/usr/bin/env node
// Type-checks every example under examples/ and then executes each one with
// Node's built-in type stripping. Files whose basename starts with "_" are
// helpers imported by other examples and are not executed on their own.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = join(root, 'examples');
const tsc = join(root, 'node_modules', '.bin', 'tsc');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(path));
    else if (entry.name.endsWith('.ts') && !basename(entry.name).startsWith('_')) out.push(path);
  }
  return out.sort();
}

const tscStatus = run(tsc, ['-p', 'examples/tsconfig.json']);
if (tscStatus !== 0) {
  console.error(`\ntsc failed (exit ${tscStatus})`);
  process.exit(tscStatus);
}

const files = collect(examplesDir);
const results = [];
for (const file of files) {
  const name = relative(root, file);
  console.log(`\n▶ ${name}`);
  const status = run(process.execPath, [file]);
  results.push({ name, status });
}

console.log('\nexamples:');
let failed = 0;
for (const { name, status } of results) {
  const ok = status === 0;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ` (exit ${status})`}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
