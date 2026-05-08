#!/usr/bin/env node
// Bundles apps/web/public/skill/** into apps/web/public/system-dynamics-diagram.zip
// so the web app can serve the skill as a single download.
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const here    = dirname(fileURLToPath(import.meta.url));
const srcDir  = resolve(here, '..', 'public', 'skill');
const outFile = resolve(here, '..', 'public', 'system-dynamics-diagram.zip');
const rootInZip = 'system-dynamics-diagram';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.isFile()) files.push(full);
  }
  return files;
}

async function main() {
  const exists = await stat(srcDir).then(() => true).catch(() => false);
  if (!exists) {
    console.error(`[build-skill-zip] skipped: ${srcDir} not found`);
    return;
  }

  const files = await walk(srcDir);
  const zip = new JSZip();
  for (const f of files) {
    const rel = relative(srcDir, f).split('\\').join('/');
    zip.file(`${rootInZip}/${rel}`, await readFile(f));
  }

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, buf);
  console.log(`[build-skill-zip] wrote ${relative(process.cwd(), outFile)} (${files.length} files, ${buf.length} bytes)`);
}

main().catch((err) => {
  console.error('[build-skill-zip] failed:', err);
  process.exit(1);
});
