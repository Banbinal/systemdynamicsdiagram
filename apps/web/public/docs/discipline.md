# Discipline features

The features in this section don't change *what* the simulator computes — they change *what you can ask of your model*. Each one corresponds to a recognised practice in the System Dynamics literature, often locked behind expensive desktop tiers (Vensim DSS, Stella Architect) in other tools.

You opt in. A bare `.sd` file with stocks and flows runs fine without any of these. Add them as your model matures and you start asking harder questions.

## When to add what

| Signal in the user's request | Feature to add |
|---|---|
| "Population can't go negative", "inventory must stay positive" | `check` |
| "We expect about 500 by year 50", or here's some data | `reference` |
| Has actual observed data, wants the model to fit it | `calibrate` (with `reference` modes as targets) |
| Mentions units explicitly ("rate per year", "people") | `[unit]` annotations |
| "This rate comes from outside the model" (tax rate, oil price, weather) | `exogenous constant` |
| Multiple regions/cohorts/products with the same structure | `subscript` |

## Reference modes

The simplest discipline upgrade. Sterman: *"if you can't draw a reference mode, you don't have a problem."*

A reference mode is a graph of the behaviour you expect (or have observed) over the simulation horizon. Encoded as a list of `(t, value)` points:

```
reference Population:
    (0, 100)
    (10, 220)
    (25, 380)
    (50, 480)
    (100, 490)
```

The simulator overlays this as a **dashed line** on the chart with the same colour as the simulated stock. Open circles mark each declared point. The visual gap between simulation and reference is then the explicit modelling target.

At least two points required. Times can be in any order — the simulator sorts them.

Reference modes also serve as the calibration target — pair them with a `calibrate:` block when you have enough data to fit.

**When NOT to use**: when you genuinely don't know what to expect. Don't fabricate reference modes — that defeats the purpose.

## Reality Check assertions

Vensim DSS calls this "Reality Check" — properties the model must satisfy across simulation runs, not just visually. Each `check` block runs an isolated simulation with its `when` overrides applied, then evaluates an assertion at every recorded step (`always`) or at one moment (`at t = N`).

```
check Population_nonneg:
    then Population >= 0 always

check Crash_when_births_off:
    when BirthRate = 0
    when DeathRate = 0.1
    then Population <= 50 at t = 100

check Stays_within_capacity:
    then Population <= CarryingCapacity * 1.05 always
```

Operators: `>=`, `<=`, `>`, `<`, `==`, `!=`. Temporal qualifiers: `always` (every step) or `at t = N` (the recorded step closest to N).

The simulator surfaces results in a **Checks** tab with pass/fail badges. A failure shows the offending step + the actual values of `lhs` and `rhs`.

Common patterns:

- `then <stock> >= 0 always` — non-negativity of a population/inventory.
- `then <stock> <= <capacity> always` — capacity respected.
- `then <stock> > <threshold> after t = N` — equilibrium reached (use `at t = N` since `after` isn't supported in v1).
- `when <Constant> = <extreme>` — extreme-condition test (Sterman's classical validation pattern).

**When NOT to use**: trivially true assertions don't help. Pick conditions where the model could reasonably fail under modification.

## Calibration

When you have observed data and you want the model to fit it: declare `reference` modes for the targets (the data) and a `calibrate` block for the free parameters (the constants you want fitted):

```
reference Population:
    (0, 100)
    (10, 220)
    (50, 480)
    (100, 490)

calibrate:
    bounds BirthRate = [0.01, 0.5]
    bounds CarryingCapacity = [100, 2000]
```

The **Calibrate** tab in the simulator runs Nelder-Mead (200 iterations, 1e-4 tolerance) and minimises RMSE between the simulated trajectory and every `reference` mode's points. Multiple reference modes are aggregated into a single scalar cost.

Results show:

- **RMSE before / after** — the quantitative improvement.
- **Initial → fitted values** for each parameter, with a range bar showing where the fitted value sits in the declared bounds.
- An **Apply to live tweak** button that pushes the fitted values into the SyntheSim sliders and switches to the Simulation tab.

**Choosing bounds**: pick a comfortable range that contains the plausible answer. Too narrow and the optimiser hits the wall. Too wide and it may drift into nonsense. Order-of-magnitude headroom on each side is typical.

**Limitations (v1)**:

- Nelder-Mead only — no gradient-based methods, no global search, no constraints beyond the bounds. Multiple runs from different starting points can help if you suspect local minima.
- Point estimates only — no posterior, no uncertainty quantification. (See the v2 gap analysis for the Bayesian extension on the roadmap.)

## Units annotations

Optional `[unit-expr]` after the value of a `constant` or `stock`. Units don't affect the simulation; they let the compiler flag dimensional inconsistencies as warnings.

```
constant BirthRate = 0.05 [1/year]
constant Pop = 1000 [people]
constant Inflow = 200 [people/year]
constant Volume = 50 [m^3]
```

Grammar inside the brackets:

- Bare identifier: `[people]`, `[year]`, `[m]`
- Power: `[m^3]`
- Reciprocal: `[1/year]`
- Combination: `[people/year]`, `[m^3/s]` — `*` and `/` allowed, no parens

The compiler infers units bottom-up:

- `mul` / `div` (i.e. `*` / `/`) combine units exponent-wise.
- `+` / `−` / comparisons require matching units. Warnings: SD0091 on mismatch.
- `exp`, `log`, `sin`, `cos`, `tan` require dimensionless arguments.
- Numeric literals are silently promoted to whichever units the other side carries — so `Population >= 0` doesn't warn even though `Population` is `[people]` and `0` is technically dimensionless.

**Phase 1 limitations**:

- **No unit conversion**. `year` and `month` are different dimensions; mixing them produces a warning. Pick one consistent time unit per model.
- **Calc units are not inferred**. The check focuses on declared annotations; unannotated calcs and stocks are "unknown" and skip mismatch checks.
- **No dimensional check on flow → stock integration** (would require treating time as a special dimension; not in v1).

**When NOT to use**: purely abstract or pedagogical models with no real-world units. Annotating those would just add bracket noise.

## Exogenous tag

```
exogenous constant TaxRate = 0.20 [1/year]
exogenous constant FuelPrice = 1.50 [USD/L]
```

Identical to `constant` at runtime. The prefix flags the variable as an **input from outside the modelled system** — the diagram renders it with a dashed border and an "exo" badge.

This is the boundary-diagram convention from Sterman: every variable is either endogenous (the model determines its dynamics), exogenous (input from outside), or excluded (out of scope). Tagging exogenous variables makes the model's boundary explicit at a glance.

**When NOT to use**: when the constant is a pure parameter you'd happily endogenise later (a target ratio, a behavioural lag) — those are internal.

## Subscripts (1D dimensions)

When you'd otherwise copy-paste the same structure N times for N regions / N age cohorts / N product lines:

```
subscript Region = North, South, East, West

constant BirthRate[Region] = [0.06, 0.04, 0.05, 0.03] [1/year]
constant DeathRate[Region] = [0.02, 0.03, 0.025, 0.04] [1/year]
stock Population[Region] = 100 [people]

flow Births[Region]:
    Population[Region] * BirthRate[Region] -+> Population[Region]

flow Deaths[Region]:
    Population[Region] * DeathRate[Region] --> Population[Region]

calc TotalPopulation = Population[North] + Population[South] + Population[East] + Population[West]
```

The compiler **expands** these into N independent variables before any other pass:

- `Population[Region]` becomes `Population_North`, `Population_South`, `Population_East`, `Population_West`.
- The flow expansion produces 4 separate flows (`Births_North` etc.) with the same structure.
- Per-element values via array literal: `[0.06, 0.04, 0.05, 0.03]` matches the order of the subscript declaration. Length must match exactly.
- Uniform values via plain expression: `constant BirthRate[Region] = 0.05` gives every region the same rate.

**References**:

- `Population[Region]` — only inside a subscripted decl that uses `Region`. Binds to the current expansion's element.
- `Population[North]` — anywhere. Refers to the specific expanded variable. Used in scalar contexts like the `TotalPopulation` calc above.

**Phase 1 limitations**:

- Only **one** subscript per declaration. Multi-dim arrays (`Trade[Origin, Dest]`) not supported.
- Subscripts must be declared at top level, not inside a `module`.
- `limit`, `plot`, `sweep` don't auto-broadcast: write `limit Population[North] min = 0`, not `limit Population min = 0`. (Per-element clamp is rarely needed since flows on subscripted stocks usually behave reasonably.)

**When NOT to use**: when the cohorts have genuinely different structures (the youngest cohort has no births, the oldest has no further ageing). Then write them as separate stocks, or use a `module` per cohort.

---

## A worked example combining all of them

```
title Multi-region demographics with discipline annotations

StartTime = 0
EndTime   = 50
TimeStep  = 0.25

subscript Region = North, South, East, West

constant BirthRate[Region] = [0.06, 0.04, 0.05, 0.03] [1/year]
constant DeathRate[Region] = [0.02, 0.03, 0.025, 0.04] [1/year]
constant CarryingCapacity = 800 [people]

exogenous constant FederalIncentive = 0.01 [1/year]

stock Population[Region] = 100 [people]

calc EffectiveBirthRate[Region] = BirthRate[Region] + FederalIncentive

flow Births[Region]:
    Population[Region] * EffectiveBirthRate[Region] * (1 - Population[Region] / CarryingCapacity) -+> Population[Region]

flow Deaths[Region]:
    Population[Region] * DeathRate[Region] --> Population[Region]

limit Population[North] min = 0
limit Population[South] min = 0
limit Population[East] min = 0
limit Population[West] min = 0

calc TotalPopulation = Population[North] + Population[South] + Population[East] + Population[West]

plot Population[North]
plot TotalPopulation

reference Population[North]:
    (0, 100)
    (10, 220)
    (25, 460)
    (40, 700)
    (50, 760)

check Population_nonneg_North:
    then Population[North] >= 0 always

check Stays_below_capacity:
    then TotalPopulation <= CarryingCapacity * 4 * 1.05 always

check Crash_when_zero_incentive:
    when FederalIncentive = 0
    then Population[West] <= 50 at t = 50

calibrate:
    bounds BirthRate[North] = [0.01, 0.2]
    bounds CarryingCapacity = [200, 2000]
```

This single file uses every discipline feature: subscripts (`Region`), per-element array literals, units annotations, an exogenous boundary input, a reference mode on a literal-element stock, three Reality Checks (one with `when` overrides), and a calibration of two free parameters.

The Checks tab will show three checks. The Calibrate tab will fit `BirthRate[North]` and `CarryingCapacity` to minimise the gap between the simulated `Population[North]` trajectory and the declared reference points.

Try it: copy this into a new model in the workbench and play with it.
