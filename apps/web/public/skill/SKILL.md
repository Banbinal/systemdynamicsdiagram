---
name: system-dynamics-diagram
description: Build System Dynamics models in the System Dynamics Diagram v2 DSL — stocks, flows, calcs, modules, scenarios, sweeps, lookup maps — and return a signed share link to the simulator at https://banbinal.github.io/systemdynamicsdiagram/. Use this whenever the user wants to model a system, simulate scenarios, reason about feedback loops, stocks accumulating over time, rate-of-change relationships, delays, or any "what if I tweaked X" exploration. Trigger even when the user does not say "system dynamics" explicitly: phrases like "model the dynamics of…", "simulate…", "what happens to X over time when Y changes", "feedback loop", "growth model", "tipping point", "sensitivity to a parameter", or describing a problem in terms of accumulating quantities and the rates that change them are all strong signals. Do not use this for static spreadsheet calculations, one-shot algebra, or modeling tasks that are clearly agent-based or discrete-event in nature.
---

# system-dynamics-diagram

Translate a real-world system the user describes into a runnable model in the System Dynamics Diagram v2 DSL, then hand back a signed share link to the simulator at <https://banbinal.github.io/systemdynamicsdiagram/>.

## What the model represents

System Dynamics describes the world as **stocks** (state that accumulates) and **flows** (rates that change stocks). Everything else is plumbing:

- `constant` — a parameter the user might want to tweak across scenarios
- `calc` — a derived value, recomputed every step from current stocks/constants
- `flow` — adds to or subtracts from one or more stocks (`-+>` adds, `-->` subtracts)
- `map` — a lookup table for non-linear effects (e.g. a saturation curve)
- `module` — namespace grouping related stocks/flows/calcs
- `scenario` — a set of overrides applied at simulation time
- `sweep` — automatic parameter sweep producing one run per value
- `limit` — clamps a stock to `min` and/or `max` after each step

When you encounter a feedback loop in the user's description, that is *almost always* a flow whose magnitude depends on the stock it changes. That dependency is the loop.

## Workflow

1. **Read the user's description.** Identify what accumulates (→ stocks) and what changes those things (→ flows). Note any non-linearities (use `map`), delays (use `smooth` or `delay3`), one-shot events (use `step` or `pulse`), and parameters the user said they want to vary (→ scenarios or sweeps).
2. **Ask clarifying questions only when a major modeling decision is genuinely ambiguous.** If the user describes the system in enough detail to model it, just model it. Make reasonable choices for time horizon, time step, and units; call them out as comments at the top of the file. Good reasons to ask: the user said "predict population" but never said over what horizon and the answer changes the model (years vs. centuries), or they said "feedback" without specifying which direction. Bad reasons to ask: small parameter values they obviously expect you to invent, or stylistic choices like flow names.
3. **Write the model.** Save it as a `.sd` file in a sensible location (default: `./model.sd` in the current working directory, unless the user asked for a specific path). Stay close to the patterns in `references/examples.md` — they are battle-tested.
4. **Sign and return the share URL.** Pipe the model into `scripts/sign_share.mjs`. The script writes a `share_url.txt` next to the model and prints an open-command hint on stderr. Hand the user the file path plus the `Start-Process` one-liner (see "How to present the link to the user" below) along with a one-paragraph summary of what the model does and a short list of the scenarios/sweeps it includes. Opening the URL loads the model into the simulator at <https://banbinal.github.io/systemdynamicsdiagram/>.

## Quick syntax reference

You will use this syntax constantly. Read `references/grammar.md` for the full surface, but most models only need this much:

```
StartTime = 0
EndTime   = 50
TimeStep  = 0.25

constant <Name> = <number-or-expr>
stock    <Name> = <init-expr>
calc     <Name> = <expr>

flow <Name>:
    <expr> -+> <stock>      # adds
    <expr> --> <stock>      # subtracts

map <Name>: linear           # also: step | spline
    (<x>, <y>)
    (<x>, <y>)

module <Group>:
    <indented body>

scenario <Name>:
    constant <Path.To.Const> = <value>
    stock    <Path.To.Stock> = <value>

sweep <ConstantName> = [<v1>, <v2>, ...]
limit <Stock> min = 0 max = 1000
plot  <Variable>
```

Indentation must be **spaces, not tabs**. Module/flow/map/scenario bodies require an indent.

### Built-in functions you can call inside expressions

`abs sqrt exp log log10 sin cos tan` (1 arg), `min max pow` (2 args), and the **time-aware** quartet:

- `step(height, t0)` — 0 before `t0`, `height` after
- `pulse(height, t0, width)` — `height` for the window `[t0, t0+width)`, else 0
- `smooth(x, tau)` — exponentially-smoothed value of `x` with time constant `tau`
- `delay3(x, tau)` — third-order distributed delay (smooth pipeline) with mean `tau`

The variable `time` is always available and represents the current simulation time.

### Polarity at a glance

`expr -+> Stock` means `dStock/dt += expr`. `expr --> Stock` means `dStock/dt -= expr`. The magnitude on the left should always be **positive in normal operation** — let the arrow carry the sign. Births are `Population * BirthRate -+> Population`; deaths are `Population * DeathRate --> Population`.

## Producing the share URL

After writing `model.sd`, generate the share URL by running the bundled script. It signs an HS256 JWT and embeds the deflate-compressed source, so the resulting URL decodes natively in the browser via `DecompressionStream`. Typical URLs are 1–3 kB.

```bash
node "<SKILL_DIR>/scripts/sign_share.mjs" --source ./model.sd
# → writes ./share_url.txt and prints an open-command hint on stderr
# → also prints the URL itself on stdout (for piping/scripting)
```

`<SKILL_DIR>` is the directory containing this `SKILL.md`. Resolve it from your environment; on this machine it is `~/.claude/skills/system-dynamics-diagram/`.

By default the script writes the URL to a sibling `share_url.txt` next to the `--source` file. Override with `--out <path>` if you need a different location.

Optional flags:

- `--out <path>` — explicit destination for the URL file. Defaults to `<source-dir>/share_url.txt`.
- `--model-id <slot>` — hint to the web app which example slot to load the source into (e.g. `population_model`). If omitted the app uses its default slot.
- `--base-url <url>` — override the deployment URL. The script defaults to `https://banbinal.github.io/systemdynamicsdiagram/` (the deployed simulator). For local development against the Vite dev server, pass `--base-url http://localhost:5174/`.
- `--stdin` — read the source from stdin instead of `--source`.

### How to present the link to the user — DO NOT paste the URL in chat

The Claude Code CLI renderer has been observed to silently mangle long base64url URLs in chat output (a single dropped or duplicated character invalidates the HMAC, and the web app then refuses the link with "token invalid or tampered"). This affects raw URLs in code blocks AND markdown hyperlinks alike. **Do not write the URL itself in your response.** Instead, hand the user the *file path* and a one-liner that opens the URL straight from disk — that round-trip is byte-perfect.

For Windows (PowerShell), the canonical hand-off is:

````markdown
The model is signed and ready. Open it in your browser with:

```powershell
Start-Process (Get-Content '<absolute path to share_url.txt>' -Raw).Trim()
```

Or open `<absolute path to share_url.txt>` in any editor and click the URL inside.
````

Substitute the actual absolute path the script wrote (the script prints it on stderr — capture it). On macOS / Linux the equivalent is `open "$(cat 'path')"` / `xdg-open "$(cat 'path')"`.

If for some reason the user explicitly asks to see the URL itself, point them at the file path rather than embedding the URL — `cat` / `Get-Content` on the file gives them the canonical, uncorrupted bytes.

### Always include the full DSL source in the response

Below the link hand-off, paste the *entire* `.sd` source inside a fenced code block (use ```` ```sd ```` as the language tag if rendering supports it, otherwise plain ```` ``` ````). The user reads the model from the chat to verify what was built — the link is for *running* it, the inline code is for *reviewing* it. Don't summarize the source or show only excerpts; the whole file goes in.

A complete hand-off looks like:

> Modèle créé : *Logistic deer growth with periodic mortality shocks* (one-paragraph summary).
>
> Scénarios : `EnlargedReserve` (capacité 8000). Sweep : aucun.
>
> URL signée écrite dans `C:\Users\me\work\model_share_url.txt`. Pour ouvrir dans le simulateur :
>
> ```powershell
> Start-Process (Get-Content 'C:\Users\me\work\model_share_url.txt' -Raw).Trim()
> ```
>
> Source complète :
>
> ```sd
> StartTime = 0
> EndTime   = 50
> TimeStep  = 0.25
> ...
> ```

## When the user asks for changes

If the user replies "make the birth rate higher" or "add a stock for X", edit the `.sd` file and re-run the signing script to produce a fresh URL. Each invocation issues a new JWT with the current `iat` — that's expected.

## Reference files

- `references/grammar.md` — full DSL grammar, every keyword, error codes, indentation rules. Read this first the first time you build a non-trivial model, then again whenever you hit a SD00xx diagnostic from the user.
- `references/patterns.md` — recipes for common modeling moves (positive/negative feedback loops, capacitated growth, delays, policy step-changes, two-module coupling). Skim this before drafting; copying a pattern usually beats rederiving it.
- `references/examples.md` — three annotated end-to-end examples. Copy structurally, do not copy literally.

## Things to get right

- **ASCII only outside of comments.** The lexer rejects non-ASCII characters with SD0010 (`Unexpected character`) anywhere except inside `#` comments. This bites hardest in `title` lines, where it's tempting to drop in typographic punctuation. Concretely, do *not* use:
  - em-dash `—` (U+2014) or en-dash `–` (U+2013) → use `--` or `-`
  - curly quotes `"" '' « »` → use straight `"` and `'`
  - ellipsis `…` (U+2026) → use `...`
  - non-breaking space, zero-width joiner, emoji, accented letters in identifiers
  - In particular in identifiers and expressions, stick to `[A-Za-z0-9_]` and the documented operators. Comments after `#` accept Unicode (the lexer strips them before tokenising) — but everything else, including `title`, must be ASCII.
- **Don't accidentally re-define `time`** — it is a reserved built-in. If you need a "policy onset time" or similar, name it `PolicyStart` or `T0`, never `time`.
- **Every flow needs at least one effect line.** An empty flow body is a parse error.
- **Maps need at least two points.** A single-point map is a parse error.
- **Flows of opposite sign on the same stock are normal** — that's how births and deaths coexist.
- **A loop in `calc`/`constant` definitions is an error** (SD0050). If A depends on B and B depends on A, at least one of them must go through a `stock` to break the cycle. This is also the system-dynamics-correct way to model the feedback: the loop closes through state, not through algebra.
- **Module references use dotted paths** (`Demography.Population`). Scoping walks outward from the current module to the root.
- **Polarity arrows tell direction, not sign.** Keep magnitudes positive: write `Population * DeathRate --> Population`, never `-(Population * DeathRate) -+> Population`.
