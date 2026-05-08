# For LLMs — the Claude Code skill bundle

The workbench ships with a [Claude Code](https://claude.com/claude-code) skill: drop it into Claude's `~/.claude/skills/` directory and Claude can write `.sd` models for you, hand back signed share links, and iterate on changes you describe in plain language.

## Installing

1. Click **Download skill (.zip)** in the header (or [download directly](./system-dynamics-diagram.zip)).
2. Unzip into your Claude Code skills directory:
   - **macOS / Linux**: `~/.claude/skills/system-dynamics-diagram/`
   - **Windows**: `%USERPROFILE%\.claude\skills\system-dynamics-diagram\`
3. Restart Claude Code (or run `/skills reload`).

The zip contains the skill's `SKILL.md` (the entry point Claude reads), `references/grammar.md`, `references/patterns.md`, `references/examples.md`, `evals/` (smoke-test models for the skill author), and `scripts/sign_share.mjs` (the JWT signer).

## What it does

When you ask Claude something like:

> Model the dynamics of a software team adopting a new code-review practice. We have 50 engineers, the practice spreads via word-of-mouth, but reviewer fatigue grows with the number of pending reviews.

…the skill triggers, Claude writes a `.sd` file in your current working directory, runs the bundled signer to produce a signed share URL, and hands back a one-line command you can paste into PowerShell / bash to open the model in your browser.

## Trigger phrases

The skill kicks in on any prompt that mentions:

- **System Dynamics** explicitly ("model in SD", "stock-and-flow")
- **Dynamics-style framing** without naming SD: "model the dynamics of", "simulate over time", "what happens to X when Y changes", "feedback loop", "growth curve", "tipping point", "sensitivity to a parameter"
- **Anything involving accumulating quantities** (population, inventory, debt, capital, opinion, infection) **and the rates that change them** (birth/death, inflow/outflow, payoff, depreciation, infection/recovery)

It does NOT trigger on:

- Static spreadsheet calculations
- Pure agent-based or discrete-event modelling tasks
- Algebraic problem solving with no temporal dimension

## What you get back

A typical Claude response after invoking the skill:

> Model created: *Software team adopting code review with reviewer fatigue* (one-paragraph summary).
>
> Scenarios: `AggressiveAdoption` (faster word-of-mouth), `Burnout` (lower fatigue threshold). Sweep: `WordOfMouthRate`. Checks: `Adoption_nonneg`, `Reviewers_dont_collapse`.
>
> URL signed and written to `C:\Users\me\projects\code-review.sd_share_url.txt`. Open with:
>
> ```powershell
> Start-Process (Get-Content 'C:\Users\me\projects\code-review.sd_share_url.txt' -Raw).Trim()
> ```
>
> Source:
>
> ```sd
> title Software team adoption with reviewer fatigue
>
> StartTime = 0
> EndTime   = 60
> TimeStep  = 0.25
>
> stock Adopters = 5 [engineers]
> stock NonAdopters = 45 [engineers]
> ...
> ```

The full source is always pasted inline so you can review what the skill generated before opening the link.

## When you ask for changes

Just say "make the fatigue stronger" or "add a stock for senior reviewers". Claude edits the `.sd` file, re-runs the signer, hands you a fresh URL.

The skill encourages adding **discipline annotations** as you give it more signal:

- You mention an observation → it adds a `reference` mode.
- You mention an invariant → it adds a `check`.
- You hand it data → it adds a `calibrate` block.
- You mention regions/cohorts → it refactors to `subscript`.
- You identify a parameter as out-of-system → it marks it `exogenous`.
- You mention units → it adds `[unit]` annotations and the simulator will warn you of any inconsistencies on the next save.

## Why a separate URL instead of pasting the source in chat

Two reasons:

1. The Claude Code CLI renderer occasionally mangles long base64url strings (silently dropped or duplicated characters). One bad character invalidates the JWT's HMAC and the simulator refuses the link as tampered. Writing the URL to a file and opening it via a one-liner round-trips bytes safely.

2. Most users want the model open in a tab, not pasted as text. The link does that in one keystroke.

## What's in the skill

If you want to read what Claude is reading:

- **SKILL.md** — workflow, syntax surface, when to add discipline features, hand-off rules.
- **references/grammar.md** — the formal DSL reference. Every keyword, every diagnostic code, every indentation rule.
- **references/patterns.md** — recipes for common modelling moves. Logistic growth, antibiotic resistance, supply chain bullwhip, drifting goals — plus the discipline-feature patterns (units, checks, references, subscripts, calibration).
- **references/examples.md** — four end-to-end annotated examples. The fourth uses every discipline feature in one model.

You can also just read these via the Docs page you're on right now — the **Grammar / Patterns / Examples** sections of these docs are the same files (sourced live from the bundled skill).

## Customising

Drop the skill in any other Claude Code skills directory and it works the same way. If you want to fork it (different default solver, different examples, bound to your own deployment URL), the `scripts/sign_share.mjs` accepts a `--base-url` flag — point it at your own deployment of the simulator.

Source repository: <https://github.com/Banbinal/systemdynamicsdiagram>
