# Modeling patterns

Recipes for moves you'll make over and over. When you recognize one of these in the user's description, the matching pattern below is usually the right structural starting point. Compose them rather than starting from scratch.

## 1. Reinforcing (positive) feedback loop

The classic exponential growth shape: a stock drives a flow that adds back to itself.

```
stock Population = 1000
constant BirthRate = 0.03

flow Births:
    Population * BirthRate -+> Population
```

The loop is `Population → Births → Population`. The flow's *magnitude* depends on the *level* of the stock — that's what makes it a feedback loop, not just a constant inflow.

## 2. Balancing (negative) feedback loop — capacitated growth

A stock is pulled toward a target. The further from the target, the larger the corrective flow. Decays smoothly.

```
stock Inventory = 50
constant Target = 100
constant AdjustmentTime = 4

calc Gap = Target - Inventory
flow Replenish:
    Gap / AdjustmentTime -+> Inventory
```

`AdjustmentTime` is the time constant — roughly how long it takes to close 63% of the gap. Smaller `AdjustmentTime` = faster correction = more overshoot risk if combined with delays.

## 3. Logistic / carrying capacity

Reinforcing loop dampened by a balancing one as the stock approaches a ceiling.

```
stock Population = 100
constant IntrinsicGrowth = 0.05
constant CarryingCapacity = 5000

calc Pressure = Population / CarryingCapacity
calc EffectiveGrowth = IntrinsicGrowth * (1 - Pressure)

flow Growth:
    Population * EffectiveGrowth -+> Population
```

When `Population << CarryingCapacity` it grows nearly exponentially; near the cap it flatlines. Use a `map` instead of `(1 - Pressure)` if you want a non-linear ceiling response (see §6).

## 4. Two stocks, predator-prey style

Coupled stocks where the cross-product term `A * B` shows up in flows on both sides.

```
stock Prey = 100
stock Predator = 20

constant PreyBirth = 0.4
constant Predation = 0.012
constant PredatorDeath = 0.5
constant Conversion = 0.005

calc Encounters = Prey * Predator

flow PreyBirth:    Prey * PreyBirth -+> Prey
flow PreyDeath:    Encounters * Predation --> Prey
flow PredatorBirth: Encounters * Conversion -+> Predator
flow PredatorDeath: Predator * PredatorDeath --> Predator

limit Prey min = 0
limit Predator min = 0
```

Always clamp populations to `min = 0` — small numerical undershoot near zero is otherwise an unphysical disaster.

## 5. Delay (smooth or distributed)

A flow shouldn't react instantly to a signal — there's a forecast, a perception lag, or a pipeline.

```
calc Demand = BaselineDemand + step(ShockSize, ShockTime)
calc ExpectedDemand = smooth(Demand, ForecastTime)        # exponential lag
calc DeliveryRate = delay3(OrderRate, DeliveryDelay)      # third-order pipeline
```

- `smooth(x, tau)` — first-order exponential lag. Use for *expectations* and *perceptions*.
- `delay3(x, tau)` — third-order distributed delay. Use for *physical pipelines* (manufacturing, shipping). Sharper onset than `smooth` of the same `tau`.

These create hidden stocks behind the scenes. You don't have to plumb them by hand.

## 6. Non-linear effect via lookup map

When the user describes a saturation, threshold, or empirical relationship, reach for a `map`. Easier to read and tweak than fitted polynomials.

```
map FertilityResponse: linear
    (0.0, 0.3)
    (0.5, 0.8)
    (1.0, 1.0)
    (1.5, 1.1)
    (2.0, 1.0)

calc ActualBirthRate = BirthRate * FertilityResponse(WelfareIndex)
```

Pick `linear` for monotone curves, `spline` for smooth bell-shapes, `step` for policy thresholds.

## 7. One-off events: step, pulse

```
calc PolicyEffect    = step(PolicyStrength, PolicyStart)
calc DemandSpike     = pulse(SpikeMagnitude, SpikeTime, SpikeWidth)
calc BlackoutFactor  = 1 - pulse(1, BlackoutStart, BlackoutDuration)
```

- `step(h, t0)` switches on at `t0` and stays on. Use for permanent policy changes.
- `pulse(h, t0, w)` is non-zero on `[t0, t0+w)`. Use for shocks.

The third example is a multiplicative interrupt: `BlackoutFactor` is 1 normally and 0 during the blackout window.

## 8. Two-module coupled system

When two parts of the system are conceptually distinct (demography vs. economy, supply vs. demand), put each in its own `module`.

```
module Demography:
    stock Population = 1000
    constant BirthRate = 0.03
    flow Births:
        Population * BirthRate -+> Population

module Economy:
    constant ProductivityPerCapita = 1.0
    calc GDP = Demography.Population * ProductivityPerCapita
```

Cross-module references use dotted paths. Scenarios target qualified names: `constant Economy.ProductivityPerCapita = 1.5`.

## 9. Initial condition that depends on `time`'s start

Sometimes you want a calc to be "years since simulation start". `StartTime` is a parser-level config, not a value you can read in expressions — mirror it as a constant.

```
StartTime = 2000
constant SimStart = 2000
calc YearsElapsed = time - SimStart
```

Two declarations of the same value, but they live in different namespaces (one for the simulator, one for your expressions).

## 10. Flow that hits multiple stocks

A single flow can update several stocks if they're driven by the same magnitude. Put each effect on its own indented line.

```
flow Conversion:
    ConversionRate --> Prospects     # leaving Prospects
    ConversionRate -+> Customers     # arriving at Customers
```

Same magnitude, opposite signs, different stocks — exactly how you express conservation of mass between compartments.

## 11. Scenarios for "what if" exploration

Whenever the user mentions alternatives ("what if growth were faster?", "what if we doubled capacity?"), turn them into scenarios.

```
scenario AggressiveGrowth:
    constant BirthRate = 0.05

scenario Conservative:
    constant BirthRate = 0.02
    constant CarryingCapacity = 3000
```

Not every model needs scenarios, but if the user is exploring a decision, scenarios are the natural shape.

## 12. Sweep for sensitivity analysis

When the user wants to see how *one parameter* affects the trajectory across a range, use `sweep` instead of writing N scenarios.

```
sweep AdjustmentTime = [2, 4, 8, 16]
```

The simulator runs the base model once per value. Combine with `plot` of the variable of interest to see the family of curves.

## 13. Non-negativity and physical bounds

Real quantities cannot go negative. Don't trust integration to keep them positive — clamp explicitly.

```
limit Population min = 0
limit Inventory min = 0 max = 10000
```

`limit` runs after every integration step. It's the tidiest way to enforce constraints without inflating flow expressions with `max(0, ...)` everywhere.

## 14. Avoid divide-by-zero in calcs

If a calc divides by a stock that can reach zero, guard it.

```
calc Density = Population / max(Area, 1e-6)
```

Otherwise you'll see SD0080 at runtime. Better: use `limit` on the denominator stock so it never gets that low.

## 15. Breaking a calc cycle

If you find yourself wanting `calc A = f(B)` and `calc B = g(A)`, that's SD0050 (cycle in calcs). The fix is structural: one of the two should be a `stock` with a flow that closes the loop. This is also the right *modeling* fix — true feedback in the world is mediated by something that holds state (inventory, opinion, capital), and that thing is a stock.

## 16. Annotating units

Add `[<unit-expr>]` after the value of a `constant` or `stock`. The compiler infers units bottom-up and warns on mismatched arithmetic.

```
constant BirthRate = 0.05 [1/year]
constant DeathRate = 0.02 [1/year]
constant CarryingCapacity = 500 [people]
stock Population = 100 [people]
```

The flow `Population * BirthRate -+> Population` then has rate units `people/year`, which matches the stock's `people` after time-integration (the time dimension cancels with `dt`). The check pass doesn't enforce the integration relationship in v1 — it focuses on `+`/`−`/comparison consistency, which is where most user mistakes happen.

When NOT to annotate: purely abstract models with no real-world units (sandboxes, archetypes, pedagogical demos). Annotating those would just add bracket noise.

Pick **one time unit per model** and stick to it: `year` and `month` are different dimensions in v1 (no auto-conversion).

## 17. Tagging exogenous inputs

When a constant represents something **external** to the modelled system — a tax rate set by government, a market price the firm doesn't influence, an environmental input — flag it with `exogenous`:

```
exogenous constant TaxRate = 0.20
exogenous constant FuelPrice = 1.50
```

Runtime behaviour is identical to a regular `constant`. The renderer marks exogenous variables with a dashed border + "exo" badge, making the model's boundary obvious at a glance. Aligns with Sterman's boundary-diagram convention.

## 18. Adding reference modes

When the user describes the **expected behaviour** ("population should reach ~500 at carrying capacity by year 50") or hands you **observed data**, encode it as a `reference` block:

```
reference Population:
    (0, 100)
    (10, 220)
    (25, 380)
    (50, 480)
    (100, 490)
```

The simulator overlays the reference as a dashed line on the chart with the same colour as the simulated stock — the gap between simulation and reference is then literally visible. At least 2 points required.

Reference modes also serve as the calibration target — pair them with a `calibrate` block when you have enough data to fit.

## 19. Reality Check assertions

Encode invariants the model must satisfy. Each `check` runs an isolated simulation with its `when` overrides applied, then evaluates the assertion at every recorded step (`always`) or at one moment (`at t = N`).

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

Use them whenever the user describes a **constraint** that must hold ("inventory must stay positive", "the bullwhip must dampen by t=80"). The simulator surfaces them in a Checks tab with pass/fail badges; failures show the failing step + the offending values.

Patterns:
- `then <stock> >= 0 always` — non-negativity of a population/inventory.
- `then <stock> <= <capacity> always` — bound respected.
- `then <stock> > <threshold> after t = <N>` — equilibrium reached.
- `when <Constant> = <extreme>` — extreme-condition test (Sterman's classical validation).

## 20. Calibration

When the user provides **observed data** and wants the model to fit it, declare `reference` modes for the targets and a `calibrate` block for the free parameters:

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

Nelder-Mead minimises RMSE between simulation and reference. The simulator's "Calibrate" tab shows RMSE before/after, fitted values with position-in-bounds bars, and offers an "Apply to live tweak" button to push fitted values into the SyntheSim sliders.

Pick `bounds` that comfortably contain the plausible range. Too narrow → optimiser hits the wall. Too wide → may drift into nonsense. Order of magnitude headroom on each side is typical.

## 21. Subscripts (cohorts, regions, products)

When you'd otherwise copy-paste the same structure N times for N regions / N age cohorts / N product lines, use a `subscript`:

```
subscript Region = North, South, East, West

constant BirthRate[Region] = [0.06, 0.04, 0.05, 0.03]
constant DeathRate[Region] = [0.02, 0.03, 0.025, 0.04]
stock Population[Region] = 100 [people]

flow Births[Region]:
    Population[Region] * BirthRate[Region] -+> Population[Region]

flow Deaths[Region]:
    Population[Region] * DeathRate[Region] --> Population[Region]

calc TotalPopulation = Population[North] + Population[South] + Population[East] + Population[West]
```

The compiler expands the subscripted statements into 4 independent `Population_*` stocks etc. before any other pass — runtime sees a flat scalar program.

When NOT to use subscripts: when the cohorts have genuinely different structures (e.g. the youngest cohort has no births, the oldest has no further ageing). Then write them as separate stocks, or use a `module` per cohort.
