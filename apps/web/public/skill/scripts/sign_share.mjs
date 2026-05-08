#!/usr/bin/env node
// Sign a sysdyn .sd model into a share URL (HS256 JWT, base64url, no padding).
// Mirrors apps/web/src/lib/share.ts so the resulting URL is consumed by the web app's
// `consumeShareTokenFromHash` → `decodeShare` flow.
//
// IMPORTANT: do not echo the URL into a chat/CLI response. Long base64url URLs get
// silently mangled by some terminal renderers (a missing or duplicated character is
// enough to invalidate the HMAC and the web app shows "token invalid or tampered").
// Instead, write the URL to a file (`--out`) and tell the user to open it via
// `Start-Process` (Windows) / `open` (macOS) / `xdg-open` (Linux). The script prints
// a ready-to-paste shell snippet on stderr to make this easy.
//
// Usage:
//   node sign_share.mjs --source path/to/model.sd [--out share_url.txt] [--model-id slot] [--base-url https://...]
//   echo "<dsl source>" | node sign_share.mjs --stdin [--out share_url.txt] [--model-id slot]
//
// Output:
//   stdout — the full share URL on a single line (kept for scriptability).
//   stderr — a short report block with the file path and an open command.

import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// Must match SECRET in apps/web/src/lib/share.ts.
const SECRET = 'sysdyn.web.share.v1.public-key-only-for-tamper-evidence';

// Default base URL. The web app builds share URLs as `${origin}${pathname}#t=...`,
// so this should end with `/`. The deployed simulator lives at
// https://banbinal.github.io/systemdynamicsdiagram/ — that's what we sign for by
// default. Pass `--base-url http://localhost:5174/` for local Vite dev.
const DEFAULT_BASE_URL = 'https://banbinal.github.io/systemdynamicsdiagram/';

function parseArgs(argv) {
  const out = { source: null, modelId: null, baseUrl: DEFAULT_BASE_URL, stdin: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--model-id') out.modelId = argv[++i];
    else if (a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--stdin') out.stdin = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'sign_share.mjs --source <file> [--out <file>] [--model-id <slot>] [--base-url <url>]\n' +
        '             | --stdin [--out <file>] [--model-id <slot>] [--base-url <url>]\n',
      );
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let source;
  if (args.stdin) {
    source = await readStdin();
  } else if (args.source) {
    source = readFileSync(args.source, 'utf8');
  } else {
    process.stderr.write('Need either --source <file> or --stdin\n');
    process.exit(2);
  }

  if (!source.trim()) {
    process.stderr.write('Source is empty\n');
    process.exit(2);
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  // v=2: source is deflate-raw'd then base64url'd. Mirrors apps/web/src/lib/share.ts so
  // the browser's CompressionStream('deflate-raw') decodes it cleanly. Without this,
  // typical .sd files produce 2.5–6 kB URLs that get truncated by chat clients and
  // some clipboards.
  const compressed = deflateRawSync(Buffer.from(source, 'utf8'), { level: 9 });
  const payload = {
    v: 2,
    iat: Math.floor(Date.now() / 1000),
    s: b64url(compressed),
    model: args.modelId,
  };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = b64url(createHmac('sha256', SECRET).update(signingInput).digest());
  const jwt = `${signingInput}.${sig}`;

  // The web app builds URLs as `${origin}${pathname}#t=${jwt}`. We accept any base
  // URL ending in `/` and append `#t=` directly.
  const base = args.baseUrl.endsWith('#') ? args.baseUrl : args.baseUrl;
  const url = `${base}#t=${jwt}`;

  // Choose where to write the URL. If --out wasn't given but --source was, drop a
  // sibling `share_url.txt` next to the model — that's the canonical "open me" file.
  let outPath = args.out;
  if (!outPath && args.source) outPath = resolve(dirname(args.source), 'share_url.txt');

  if (outPath) {
    const abs = isAbsolute(outPath) ? outPath : resolve(process.cwd(), outPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, url);
    // Print delivery hint on stderr so the URL on stdout stays clean for piping.
    process.stderr.write([
      '',
      '── share URL written ──────────────────────────────────',
      `  file: ${abs}`,
      `  size: ${url.length} chars`,
      '',
      '  Open in default browser (PowerShell):',
      `    Start-Process (Get-Content '${abs}' -Raw).Trim()`,
      '',
      '  Or (bash / WSL):',
      `    xdg-open "$(cat '${abs}')"   # Linux`,
      `    open "$(cat '${abs}')"       # macOS`,
      '',
      '  Do NOT paste this URL through chat output — long base64url',
      '  strings get silently mangled by some terminal renderers.',
      '───────────────────────────────────────────────────────',
      '',
    ].join('\n'));
  }

  process.stdout.write(url + '\n');
}

main().catch((err) => {
  process.stderr.write(`sign_share.mjs failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
