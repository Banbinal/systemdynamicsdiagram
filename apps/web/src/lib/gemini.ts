const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export interface GenerateOpts {
  readonly apiKey: string;
  readonly userPrompt: string;
  readonly skillContext: string;
  readonly signal?: AbortSignal;
}

export async function generateSdSource(opts: GenerateOpts): Promise<string> {
  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(opts.skillContext) }],
    },
    contents: [{ role: 'user', parts: [{ text: opts.userPrompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: 'text/plain',
    },
  };

  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  if (opts.signal) init.signal = opts.signal;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(
      `Network error reaching Gemini: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const text = await safeReadText(res);
    const apiMsg = extractApiErrorMessage(text);
    throw new Error(`Gemini API ${res.status}: ${apiMsg}`);
  }

  const data = await res.json();
  const text: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Gemini returned no text content.');
  }
  return extractDsl(text);
}

function buildSystemPrompt(skillContext: string): string {
  return `You are an expert in the System Dynamics Diagram v2 DSL. The user is interacting with a web simulator and will describe a system they want to model. Translate their description into a runnable .sd source.

Output rules — mandatory:
- Output ONLY a valid .sd source. No prose, no headings, no commentary.
- Do NOT wrap your output in markdown fences. The first character must be a comment line (#) or a valid DSL statement (typically StartTime = ...).
- ASCII only outside of # comments. No em-dash, no curly quotes, no ellipsis, no accented identifiers.
- Pick reasonable defaults for time horizon, time step and units, and call them out as # comments at the top.
- Prefer patterns from the references over reinventing them.

Reference documentation follows. Treat it as authoritative.

${skillContext}`;
}

function extractDsl(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:sd|sdyn|systemdynamics)?\s*\n([\s\S]*?)\n```\s*$/;
  const m = trimmed.match(fence);
  if (m && typeof m[1] === 'string') return m[1].trim();
  return trimmed;
}

async function safeReadText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function extractApiErrorMessage(rawBody: string): string {
  if (!rawBody) return 'no body';
  try {
    const j = JSON.parse(rawBody);
    const msg = j?.error?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  } catch {
    // not JSON
  }
  return rawBody.slice(0, 240);
}
