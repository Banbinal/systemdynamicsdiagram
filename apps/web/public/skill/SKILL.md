---
name: system-dynamics-diagram
description: Build System Dynamics models in the System Dynamics Diagram v2 DSL — stocks, flows, calcs, modules, scenarios, sweeps, lookup maps, subscripts, units, reference modes, Reality Check assertions, calibration — and return a signed share link to the simulator at https://banbinal.github.io/systemdynamicsdiagram/. Use this whenever the user wants to model a system, simulate scenarios, reason about feedback loops, stocks accumulating over time, rate-of-change relationships, delays, or any "what if I tweaked X" exploration. Trigger even when the user does not say "system dynamics" explicitly: phrases like "model the dynamics of…", "simulate…", "what happens to X over time when Y changes", "feedback loop", "growth model", "tipping point", "sensitivity to a parameter", or describing a problem in terms of accumulating quantities and the rates that change them are all strong signals. Do not use this for static spreadsheet calculations, one-shot algebra, or modeling tasks that are clearly agent-based or discrete-event in nature.
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
- `subscript` — a 1D dimension (e.g. `Region = North, South, East, West`) for fan-out
- `reference` — Sterman-style expected behaviour over time, drawn as a chart overlay
- `check` — Reality Check assertion: a property the model must satisfy under given inputs
- `calibrate` — fits free constants to the model's `reference` modes via Nelder-Mead
- `exogenous constant` — boundary marker: input from outside the modelled system

When you encounter a feedback loop in the user's description, that is *almost always* a flow whose magnitude depends on the stock it changes. That dependency is the loop.

## Workflow

1. **Read the user's description.** Identify what accumulates (→ stocks) and what changes those things (→ flows). Note any non-linearities (use `map`), delays (use `smooth` or `delay3`), one-shot events (use `step` or `pulse`), parameters they want to vary (→ scenarios or sweeps), cohorts/regions (→ subscripts), invariants the model must obey (→ checks), expected behaviour the user can describe (→ reference modes), and observed data they want to fit to (→ reference modes + calibrate).
2. **Ask clarifying questions only when a major modeling decision is genuinely ambiguous.** If the user describes the system in enough detail to model it, just model it. Make reasonable choices for time horizon, time step, and units; call them out as comments at the top of the file. Good reasons to ask: the user said "predict population" but never said over what horizon and the answer changes the model (years vs. centuries), or they said "feedback" without specifying which direction. Bad reasons to ask: small parameter values they obviously expect you to invent, or stylistic choices like flow names.
3. **Write the model.** Save it as a `.sd` file in a sensible location (default: `./model.sd` in the current working directory, unless the user asked for a specific path). Stay close to the patterns in `references/examples.md` and `references/patterns.md` — they are battle-tested.
4. **Add discipline annotations whenever justified** (see the "Discipline features" section below).
5. **Sign and return the share URL.** Pipe the model into `scripts/sign_share.mjs`. The script writes a `share_url.txt` next to the model and prints an open-command hint on stderr. Hand the user the file path plus the `Start-Process` one-liner along with a one-paragraph summary of what the model does and a short list of the scenarios/sweeps/checks it includes. Opening the URL loads the model into the simulator.

## Quick syntax reference

You will use this syntax constantly. Read `references/grammar.md` for the full surface, but most models only need this much:

```
StartTime = 0
EndTime   = 50
TimeStep  = 0.25

constant <Name> = <number-or-expr>
constant <Name> = <number-or-expr> [<unit-expr>]    # optional units annotation
exogenous constant <Name> = <expr>                  # boundary marker

stock <Name> = <init-expr>
stock <Name> = <init-expr> [<unit-expr>]

calc <Name> = <expr>

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

### Discipline features (encourage when relevant)

```
# Reference mode — declare the behaviour you expect or have observed.
reference <Stock>:
    (<t>, <value>)
    (<t>, <value>)

# Reality Check — assert an invariant under stated inputs. The simulator
# runs an isolated simulation per check with the `when` overrides applied.
check <Name>:
    when <Constant> = <value>          # zero or more constant overrides
    then <expr> <op> <expr> always     # operators: >= <= > < == !=
    # or: ... at t = <number>

# Calibrate — fit constants to the reference modes. Bounds clamp each
# free parameter; Nelder-Mead minimises RMSE.
calibrate:
    bounds <Constant> = [<low>, <high>]
    bounds <Constant> = [<low>, <high>]

# Subscripts — declare a 1D dimension and use it on declarations + refs.
subscript <Name> = <Element>, <Element>, <Element>, <Element>
constant <Name>[<Sub>] = <value>                       # uniform across elements
constant <Name>[<Sub>] = [<v1>, <v2>, <v3>, <v4>]      # per-element values
stock    <Name>[<Sub>] = <init>
flow     <Name>[<Sub>]:
    <expr-using-Name[Sub]> -+> <Name[Sub]>
calc     Total = <Name>[<Element1>] + <Name>[<Element2>]   # literal-element ref
```

Indentation must be **spaces, not tabs**. Module/flow/map/scenario/check/calibrate/reference/subscript bodies require an indent.

### Built-in functions you can call inside expressions

`abs sqrt exp log log10 sin cos tan` (1 arg), `min max pow` (2 args), and the **time-aware** quartet:

- `step(height, t0)` — 0 before `t0`, `height` after
- `pulse(height, t0, width)` — `height` for the window `[t0, t0+width)`, else 0
- `smooth(x, tau)` — exponentially-smoothed value of `x` with time constant `tau`
- `delay3(x, tau)` — third-order distributed delay (smooth pipeline) with mean `tau`

The variable `time` is always available and represents the current simulation time.

### Polarity at a glance

`expr -+> Stock` means `dStock/dt += expr`. `expr --> Stock` means `dStock/dt -= expr`. The magnitude on the left should always be **positive in normal operation** — let the arrow carry the sign. Births are `Population * BirthRate -+> Population`; deaths are `Population * DeathRate --> Population`.

### Units annotation at a glance

`[unit-expr]` after the value of a `constant` or `stock`. Grammar inside the brackets:

- Bare identifier: `[people]`, `[year]`, `[m]`
- Power: `[m^3]`
- Reciprocal: `[1/year]`
- Combination: `[people/year]`, `[m^3/(s)]` — `*` and `/` allowed

Phase 1 has **no unit conversion**: `year` and `month` are different dimensions and mixing them produces a warning. Use one consistent time unit per model.

The compiler infers units bottom-up and warns on `+`/`−`/comparison mismatches. Numeric literals are silently promoted (so `Population >= 0` does not warn).

## Discipline features

Add these whenever the user's request gives you the relevant signal — they make the simulator immediately more useful by surfacing the discipline in dedicated tabs.

### When to add `reference`

The user mentioned **what they expect to happen** (target trajectory) or **what was observed** (data points). Even rough sketches help — Sterman: *"if you can't draw a reference mode, you don't have a problem"*. The simulator overlays the reference as a dashed line on the chart so the modeller sees the gap to close.

```
reference Population:
    (0, 100)
    (10, 220)
    (50, 480)
```

### When to add `check`

The user described **a constraint that must hold** ("population can't go negative", "inventory must stay positive", "the bullwhip must dampen by t=80"). Each `check` runs its own isolated simulation with its `when` overrides, then asserts the property on every recorded step (`always`) or at one moment (`at t = N`). Surfaced in a "Checks" tab with pass/fail badges.

```
check Population_nonneg:
    then Population >= 0 always

check Crash_when_births_off:
    when BirthRate = 0
    then Population <= 50 at t = 100
```

### When to add `calibrate`

The user **provided observed data** that the model should fit (and ideally already declared `reference` modes for it). The simulator's "Calibrate" tab runs Nelder-Mead on the bounded constants, reports RMSE before/after, and offers a "Apply to live tweak" button to push fitted values into the SyntheSim sliders.

```
calibrate:
    bounds BirthRate = [0.01, 0.5]
    bounds CarryingCapacity = [100, 2000]
```

A `calibrate` block needs at least one `reference` mode to fit against — pair them.

### When to add units `[…]`

The user **mentioned units explicitly** ("rate per year", "people", "dollars per month") or you can infer a clear physical meaning. Units annotations turn `+` mistakes into warnings and document intent. **Do not** annotate when the model is purely abstract or units would be guesses.

```
constant BirthRate = 0.05 [1/year]
stock Population = 1000 [people]
constant Inflow = 200 [people/year]
```

### When to add `exogenous constant`

The user described **inputs that come from outside the modelled system** (tax rate set by government, oil price set by markets, weather). Tagging them with `exogenous` makes the boundary explicit; the renderer marks them with a dashed border and an "exo" badge.

```
exogenous constant TaxRate = 0.20
exogenous constant FuelPrice = 1.50
```

### When to use `subscript`

The user described **multiple instances of the same structure** with the same equations but different parameters: regions, age cohorts, product lines, risk classes. Subscripts let you write the structure once and have the compiler expand it.

```
subscript Region = North, South, East, West
constant BirthRate[Region] = [0.06, 0.04, 0.05, 0.03]
stock Population[Region] = 100 [people]
flow Births[Region]:
    Population[Region] * BirthRate[Region] -+> Population[Region]

calc TotalPopulation = Population[North] + Population[South] + Population[East] + Population[West]
```

After expansion the model has 4 separate `Population_*` stocks and `Births_*` flows; the simulator treats them as independent.

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
> Scénarios : `EnlargedReserve` (capacité 8000). Sweep : aucun. Checks : `Population_nonneg`, `Stays_below_capacity`. Reference mode sur `Population` calibré sur 4 points 2010-2024.
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

When iterating, **upgrade the discipline annotations** as the user gives you more signal:
- They mention an observation → add or extend a `reference`.
- They mention an invariant → add a `check`.
- They give actual data → add `calibrate`.
- They mention regions/cohorts/categories → refactor to `subscript`.
- They identify a parameter as out-of-system → mark it `exogenous`.

## Reference files

- `references/grammar.md` — full DSL grammar, every keyword, error codes, indentation rules. Read this first the first time you build a non-trivial model, then again whenever you hit a SD00xx diagnostic from the user.
- `references/patterns.md` — recipes for common modeling moves (positive/negative feedback loops, capacitated growth, delays, policy step-changes, two-module coupling, units, checks, subscripts, calibration). Skim this before drafting; copying a pattern usually beats rederiving it.
- `references/examples.md` — annotated end-to-end examples. Copy structurally, do not copy literally.

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
- **Subscript array literal length must match the subscript's element count.** `subscript Region = North, South` requires `[v1, v2]`, not `[v1, v2, v3]`.
- **Subscript bracket inside an equation only resolves where it makes sense.** Inside a subscripted decl `flow Births[Region]: ... Population[Region] ...`, `[Region]` binds to the current expansion's element. Outside any subscripted decl, `Population[Region]` is an error — use a literal element name like `Population[North]`.
- **`bounds` in `calibrate` requires `low ≤ high`.** Reverse-ordered bounds are SD0046.
- **Reality Check `then` clauses must be exactly one per `check`.** Multiple `then` lines in a single check are SD0034.
- **Units annotations are warnings, never errors.** They never block simulation. The dimensional check is opt-in: add `[unit]` only when you mean it.
- **`year` and `month` are different dimensions** in the units check. Pick one time unit per model and stick to it.
