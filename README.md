# systemdiagram

System Dynamics modeling — a deterministic TypeScript simulator, an interactive web workbench, and a Claude Code skill that writes runnable models.

**Live app:** <https://banbinal.github.io/systemdynamicsdiagram/>

## Repository layout

```
systemdiagram/
├─ packages/
│  ├─ core/        # @sysdyn/core — DSL parser, compiler, simulator (TS, no DOM)
│  └─ cli/         # @sysdyn/cli — `sysdyn run model.sd --csv out.csv`
├─ apps/
│  └─ web/         # @sysdyn/web — React + Vite workbench, deployed to GitHub Pages
└─ examples/v2/    # Reference models: classics, system archetypes, multi-region
```

Requires Node ≥ 20 and pnpm 10.

```bash
pnpm install
pnpm test                       # core + cli test suites
pnpm build                      # build all packages
pnpm --filter @sysdyn/web dev   # local workbench at http://localhost:5173
```

## The DSL

A model is stocks (state that accumulates) and flows (rates that change stocks). Everything else is plumbing.

```
title Simple Population Model

StartTime = 0
EndTime   = 100
TimeStep  = 0.25

stock Population = 100 [people]

constant BirthRate        = 0.05 [1/year]
constant DeathRate        = 0.02 [1/year]
constant CarryingCapacity = 500  [people]

calc Pressure        = Population / CarryingCapacity
calc ActualBirthRate = BirthRate * (1 - Pressure * 0.7)

flow Births: Population * ActualBirthRate -+> Population
flow Deaths: Population * DeathRate        --> Population

limit Population min = 0
plot  Population

reference Population:
    (0, 100)  (50, 400)  (100, 490)

check Population_nonneg:
    then Population >= 0 always

calibrate:
    bounds BirthRate        = [0.01, 0.2]
    bounds CarryingCapacity = [100, 1500]
```

### Top-level statements

| Statement   | Purpose |
| ---         | --- |
| `stock`     | Accumulating state — integrated over time |
| `flow`      | Rate that adds (`-+>`) or subtracts (`-->`) one or more stocks |
| `constant`  | Parameter; prefix `exogenous` to mark a model boundary |
| `calc`      | Auxiliary expression, recomputed every step |
| `map`       | Lookup table — `linear`, `step`, or `spline` |
| `module`    | Namespace — group related declarations under a path |
| `subscript` | 1D dimension for fan-out (regions, cohorts) |
| `scenario`  | Set of overrides applied at simulation time |
| `sweep`     | Run one simulation per parameter value |
| `limit`     | Clamp a stock to `min` / `max` after every step |
| `plot`      | Pre-select variables for charts and reports |
| `reference` | Sterman reference mode — expected behaviour as `(t, value)` points |
| `check`     | Reality-check assertion under stated `when` overrides |
| `calibrate` | Fit free constants to reference modes via Nelder-Mead |

Built-in functions: `abs`, `sqrt`, `exp`, `log`, `log10`, `sin`, `cos`, `tan`, `min`, `max`, `pow`, plus the time-aware `step`, `pulse`, `smooth`, `delay3`. The variable `time` is always in scope.

Units annotations like `[people]`, `[1/year]`, `[m^3/s]` flow bottom-up; the compiler warns on mismatches in `+`, `-`, and comparisons.

## The web workbench

A React + Vite editor with live parse + simulate. Tabs:

- **Model** — CodeMirror editor with diagnostics, plus a System Dynamics-shaped diagram (React Flow + ELK auto-layout) with stock gauges, animated flow tokens, a time scrubber, and a Causal Lens for polarity-coloured influence edges. Detected reinforcing/balancing loops animate as the simulation plays (loop dominance).
- **Simulation** — multi-series chart, phase plot for `(X(t), Y(t))` trajectories in state space, and SyntheSim live-tweak sliders that re-simulate as you drag.
- **Compare** — diff scenarios side-by-side.
- **Checks** — pass/fail badges for every `check` block, each run in its own isolated simulation.
- **Sensitivity** — Tornado bar chart, one-at-a-time perturbation of each constant.
- **Calibrate** — Nelder-Mead fit of bounded constants against reference modes; reports RMSE before/after and pushes fitted values into the SyntheSim sliders.

Plus, across the workbench:

- **Loops AI explainer** — Gemini explains each detected R/B loop in 2–3 sentences (BYOK).
- **AI Assist** — generate or modify a model from a prompt (BYOK Gemini).
- **XMILE import/export** — round-trip with Stella, Insight Maker, Simlin.
- **Share links** — signed URL fragments capture model + tab.
- **Embed mode** — `?embed=1[&tab=…]` for embedding in articles or docs.
- **PDF export** — printable report with model, chart, and diagram.
- **First-run tour** — guided onboarding across the major tabs.
- **Skill bundle** — downloadable Claude Code skill zip that teaches the DSL and returns signed share URLs to the simulator.

## CLI

```bash
sysdyn run   model.sd --csv out.csv
sysdyn run   model.sd --scenario Pessimistic
sysdyn run   model.sd --sweep BirthRate=0.02,0.04,0.08
sysdyn run   model.sd --all -o ./out          # cartesian product of scenarios × sweeps
sysdyn check model.sd                          # parse + compile, exit 1 on diagnostics
sysdyn print model.sd                          # structural summary
```

Solvers: RK4 (default) and Euler. Pipe a model in via `-` to read from stdin.

## License

MIT — see [LICENSE](LICENSE).
