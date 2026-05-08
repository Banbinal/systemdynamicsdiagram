/**
 * Share-link encoding via signed JWT (HS256, Web Crypto).
 *
 *   encodeShare(source, modelId)  → JWT
 *   decodeShare(jwt)              → { source, modelId } | null
 *
 * The JWT is HMAC-signed with a fixed key baked into the bundle. This is
 * **not** real authentication — anyone can extract the key — it just gives
 * us tamper-evidence and a recognisable JWT shape. Sandboxed compilation
 * means a forged payload still goes through the same parser/IR/solver path,
 * so the security ceiling is "the recipient can run the model".
 *
 *   Layout: header.payload.signature (base64url, no padding)
 *   header  = { alg: "HS256", typ: "JWT" }
 *   payload (v=2): { v: 2, iat, s, model? }   — `s` is base64url(deflate-raw(utf8(source)))
 *   payload (v=1): { v: 1, iat, source, model? } — uncompressed; still decoded for old links
 *
 * encodeShare always emits v=2 so URLs are typically ~40% the size of v=1,
 * which keeps them under the chat/clipboard truncation thresholds we ran
 * into in practice. Decoding accepts both versions so already-shared v=1
 * links keep working.
 */

const SECRET = 'sysdyn.web.share.v1.public-key-only-for-tamper-evidence';

export interface SharePayload {
  readonly source: string;
  readonly modelId: string | null;
  /** Issued-at, unix seconds. */
  readonly iat?: number;
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const compressed = await deflateRaw(new TextEncoder().encode(payload.source));
  const body = {
    v: 2,
    iat: payload.iat ?? Math.floor(Date.now() / 1000),
    s: b64urlEncodeBytes(compressed),
    model: payload.modelId,
  };
  const headerB64 = b64urlEncodeStr(JSON.stringify(header));
  const payloadB64 = b64urlEncodeStr(JSON.stringify(body));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await hmacSign(SECRET, signingInput);
  return `${signingInput}.${sig}`;
}

export async function decodeShare(jwt: string): Promise<SharePayload | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    console.warn('[share] decode failed: jwt does not have 3 parts, got', parts.length);
    return null;
  }
  const [headerB64, payloadB64, sig] = parts as [string, string, string];

  const ok = await hmacVerify(SECRET, `${headerB64}.${payloadB64}`, sig);
  if (!ok) {
    console.warn('[share] decode failed: HMAC signature verification rejected');
    return null;
  }

  try {
    const headerJson = JSON.parse(b64urlDecodeStr(headerB64)) as { alg?: string };
    if (headerJson.alg !== 'HS256') {
      console.warn('[share] decode failed: unexpected alg', headerJson.alg);
      return null;
    }
    const body = JSON.parse(b64urlDecodeStr(payloadB64)) as {
      v?: unknown;
      source?: unknown;
      s?: unknown;
      model?: unknown;
      iat?: unknown;
    };
    console.info('[share] payload version', body.v, 'keys:', Object.keys(body));

    let source: string | null = null;
    if (body.v === 2 && typeof body.s === 'string') {
      try {
        const inflated = await inflateRaw(b64urlDecodeBytes(body.s));
        source = new TextDecoder().decode(inflated);
        console.info('[share] inflated source length', source.length);
      } catch (e) {
        console.error('[share] inflate failed', e);
        throw e;
      }
    } else if (typeof body.source === 'string') {
      // v=1 (or pre-`v` field) — uncompressed source.
      source = body.source;
    } else {
      console.warn('[share] decode failed: payload shape unrecognised', body);
    }
    if (source === null) return null;

    return {
      source,
      modelId: typeof body.model === 'string' ? body.model : null,
      ...(typeof body.iat === 'number' ? { iat: body.iat } : {}),
    };
  } catch (e) {
    console.warn('[share] decode failed: exception in payload processing', e);
    return null;
  }
}

/** Build a sharable URL using the current location origin and pathname. */
export function buildShareUrl(jwt: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#t=${jwt}`;
}

/** Read and consume a `#t=` token from the current URL. Clears it from history. */
export function consumeShareTokenFromHash(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#')) return null;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get('t');
  if (!token) return null;
  // Strip the token from the URL so reloads don't re-apply it.
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

/* ─── Web Crypto HMAC ────────────────────────────────────────────────────── */

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlEncodeBytes(new Uint8Array(sig));
}

async function hmacVerify(secret: string, data: string, sigB64: string): Promise<boolean> {
  const key = await getKey(secret);
  const sig = b64urlDecodeBytes(sigB64);
  // Web Crypto wants BufferSource; copy to a fresh ArrayBuffer to satisfy TS strict typing
  // (TS 5.7 treats Uint8Array<ArrayBufferLike> as not assignable to BufferSource).
  const sigBuf = sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer;
  const dataBuf = new TextEncoder().encode(data);
  const dataAB = dataBuf.buffer.slice(0) as ArrayBuffer;
  return crypto.subtle.verify('HMAC', key, sigBuf, dataAB);
}

/* ─── deflate-raw via CompressionStream ─────────────────────────────────── */

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ─── base64url helpers ─────────────────────────────────────────────────── */

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlEncodeStr(s: string): string {
  return b64urlEncodeBytes(new TextEncoder().encode(s));
}

function b64urlDecodeStr(s: string): string {
  return new TextDecoder().decode(b64urlDecodeBytes(s));
}
