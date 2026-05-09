const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── BYOK storage ─────────────────────────────────────────────────────────
// The user pastes their key once into AiAssistModal (or any feature that
// needs it); we cache it in localStorage so subsequent one-click features
// (loop explanation, model chat) don't re-prompt.
const STORAGE_KEY = 'sysdyn:gemini-api-key';

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(STORAGE_KEY, key.trim());
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // sandbox / private mode: silently no-op.
  }
}

export type GenerateMode = 'create' | 'modify';

export interface GenerateOpts {
  readonly apiKey: string;
  readonly userPrompt: string;
  readonly skillContext: string;
  readonly mode: GenerateMode;
  /** Required when `mode === 'modify'`. The current editor source the model edits. */
  readonly currentSource?: string;
  readonly signal?: AbortSignal;
}

export async function generateSdSource(opts: GenerateOpts): Promise<string> {
  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(opts.apiKey)}`;
  const userMessage = buildUserMessage(opts);
  const body = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(opts.skillContext, opts.mode) }],
    },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
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

// ── Loop explanation ─────────────────────────────────────────────────────
// Free-form prose, NOT a DSL response. Used by the Loops sidebar's "Explain"
// button: takes the model source + the detected loop's nodes/polarities and
// asks Gemini to describe the dynamic in 2-3 sentences a non-modeller can
// follow. No skill context needed — the loop's structure tells the LLM
// everything it needs about the DSL.

export interface ExplainLoopOpts {
  readonly apiKey: string;
  readonly source: string;
  readonly loop: {
    readonly id: string;
    readonly kind: 'R' | 'B';
    readonly nodes: readonly string[];
    readonly edgePolarities: readonly ('+' | '-' | '?')[];
  };
  readonly signal?: AbortSignal;
}

export async function explainLoop(opts: ExplainLoopOpts): Promise<string> {
  const url = `${GEMINI_ENDPOINT}?key=${encodeURIComponent(opts.apiKey)}`;
  const userMessage = buildLoopExplainMessage(opts);
  // gemini-2.5-flash counts internal "thinking" tokens against
  // maxOutputTokens. With dynamic thinking on (the default) and a tight
  // output budget, the model can burn most of the budget reasoning and only
  // emit a half-sentence of visible prose. This task — a 2-3 sentence
  // explanation — does not need deep reasoning, so we set thinkingBudget=0
  // and keep the budget generous for the actual response.
  const body = {
    systemInstruction: {
      parts: [{ text: LOOP_EXPLAIN_SYSTEM }],
    },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 1024,
      responseMimeType: 'text/plain',
      thinkingConfig: { thinkingBudget: 0 },
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
    throw new Error(`Gemini API ${res.status}: ${extractApiErrorMessage(text)}`);
  }
  const data = await res.json();
  const text: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Gemini returned no text content.');
  }
  return text.trim();
}

const LOOP_EXPLAIN_SYSTEM = `You are an expert in System Dynamics. The user will give you a model
source and a single feedback loop detected in it (R = reinforcing,
B = balancing). Explain in 2-3 short sentences what this loop does and
why — what runs the loop, what amplifies or dampens it, what behaviour
it produces over time.

Output rules:
- Plain prose. No markdown, no bullet points, no headings.
- Reference variables by their short name (the part after the last dot).
- 2-3 sentences total. Be precise about cause-and-effect.
- Use the polarities + the kind (R or B) to derive the dynamic, not
  generic SD platitudes.`;

function buildLoopExplainMessage(opts: ExplainLoopOpts): string {
  const path = opts.loop.nodes
    .map((n, i) => {
      const pol = opts.loop.edgePolarities[i] ?? '?';
      const polWord = pol === '+' ? 'positive' : pol === '-' ? 'negative' : 'unknown';
      const next = opts.loop.nodes[(i + 1) % opts.loop.nodes.length] ?? '?';
      return `  ${shortName(n)} —(${polWord})→ ${shortName(next)}`;
    })
    .join('\n');
  const kindWord = opts.loop.kind === 'R' ? 'reinforcing (R)' : 'balancing (B)';
  return `Model source:
\`\`\`
${opts.source}
\`\`\`

Detected loop ${opts.loop.id} (${kindWord}):
${path}

Explain what this loop does and what behaviour it produces, in 2-3 sentences.`;
}

function shortName(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function buildSystemPrompt(skillContext: string, mode: GenerateMode): string {
  const taskLine =
    mode === 'modify'
      ? 'The user is interacting with a web simulator and will describe a change to apply to an existing .sd model. Apply the change and return the FULL updated source — do not omit anything.'
      : 'The user is interacting with a web simulator and will describe a system they want to model. Translate their description into a runnable .sd source.';

  return `You are an expert in the System Dynamics Diagram v2 DSL. ${taskLine}

Output rules — mandatory:
- Output ONLY a valid .sd source. No prose, no headings, no commentary.
- Do NOT wrap your output in markdown fences. The first character must be a comment line (#) or a valid DSL statement (typically StartTime = ...).
- ASCII only outside of # comments. No em-dash, no curly quotes, no ellipsis, no accented identifiers.
- Pick reasonable defaults for time horizon, time step and units, and call them out as # comments at the top.
- Prefer patterns from the references over reinventing them.

Reference documentation follows. Treat it as authoritative.

${skillContext}`;
}

function buildUserMessage(opts: GenerateOpts): string {
  if (opts.mode === 'modify' && opts.currentSource && opts.currentSource.trim()) {
    return `Apply the requested change to the model below. Return the full updated .sd source.

=== Existing model ===
${opts.currentSource.trim()}
=== End existing model ===

Requested change:
${opts.userPrompt}`;
  }
  return opts.userPrompt;
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
