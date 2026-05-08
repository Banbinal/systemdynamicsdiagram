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
