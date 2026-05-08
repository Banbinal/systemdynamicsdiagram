# DSL guide

A `.sd` source file is a sequence of declarations. Order is mostly free, but the conventional layout is:

1. `title` (optional) and time block (`StartTime`, `EndTime`, `TimeStep`)
2. constants and exogenous inputs
3. stocks
4. calcs (derived values)
5. flows (the rate equations)
6. maps (lookup tables for non-linearities)
7. modules (namespaces grouping related declarations)
8. scenarios, sweeps, plots, limits
9. discipline features: subscripts, references, checks, calibration

Indentation is **spaces only** (tabs are an error). Block bodies (`flow`, `module`, `scenario`, `check`, `calibrate`, etc.) are indented relative to their header.

ASCII only outside of `#` comments — no em-dashes or curly quotes in identifiers or in `title` lines.

---

## Time block

```
StartTime = 0
EndTime   = 100
TimeStep  = 0.25
```

Smaller `TimeStep` means more accurate integration, slower simulation. RK4 is the default solver.

## Title

```
title Simple population dynamics
```

Free text to end of line. Shown in the workbench header and the PDF export.

## Constants

```
constant BirthRate = 0.05
constant DeathRate = 0.02
```

Evaluated once. Override at simulation time via `scenario` blocks.

Optional **units** annotation goes in brackets after the value:

```
constant BirthRate = 0.05 [1/year]
constant CarryingCapacity = 500 [people]
```

Optional **exogenous** prefix marks an input from outside the modelled system:

```
exogenous constant FuelPrice = 1.50 [USD/L]
```

Exogenous constants render with a dashed border and an "exo" badge in the diagram — visual cue for the model boundary.

## Stocks

```
stock Population = 100
stock Inventory = 200 [units]
```

A stock is a state variable; its value changes over time as flows hit it. The right-hand expression is the *initial* value at `StartTime`.

## Flows

```
flow Births:
    Population * BirthRate -+> Population
```

The body is one or more **effects**. Each effect is `<magnitude-expr> <arrow> <target-stock>`:

- `-+>` adds the magnitude to the target stock's rate (`dStock/dt += expr`)
- `-->` subtracts (`dStock/dt -= expr`)

The arrow carries the sign — keep the magnitude expression positive in normal operation:

```
flow Deaths:
    Population * DeathRate --> Population   # not: -(Population * DeathRate) -+> Population
```

A single flow can hit multiple stocks (one effect line per target):

```
flow CashTransfer:
    Amount --> CashAccountA
    Amount -+> CashAccountB
```

## Calcs (derived values)

```
calc Density = Population / Area
calc EffectiveBirthRate = BirthRate * (1 - Density)
```

Computed every step from the current stocks/constants/calcs. Cannot form a cycle with another calc — if you need `A = f(B)` *and* `B = g(A)`, route one of them through a stock (which is the system-dynamics-correct way to model true feedback anyway).

## Expressions

Standard infix arithmetic. Operator precedence (low → high):

| Op | Description |
|---|---|
| `\|\|` `&&` | logical (return 0/1) |
| `< <= > >= == !=` | comparison (return 0/1) |
| `+ -` (binary) | add / subtract |
| `* / %` | multiply / divide / modulo |
| `- + !` (unary) | negate / identity / not |
| `^` | exponentiation (right-associative) |

Comparisons return numeric 0/1, so `(time >= 10) * height` is the standard idiom for "turn on at t=10". The `step()` builtin is sugar for exactly this.

References can be qualified: `Demography.Population` reaches into a module.

## Built-in functions

**Pure math**: `abs(x)`, `sqrt(x)`, `exp(x)`, `log(x)` (natural), `log10(x)`, `sin(x)`, `cos(x)`, `tan(x)`, `min(a, b)`, `max(a, b)`, `pow(a, b)`.

**Time-aware** (these desugar to a primitive form before simulation):

- `step(height, t0)` — 0 before `t0`, then `height`. A one-time level shift.
- `pulse(height, t0, width)` — `height` for the window `[t0, t0+width)`, else 0.
- `smooth(x, tau)` — exponentially-smoothed value of `x` with time constant `tau`. Drawn with a `‖` delay marker on the arc.
- `delay3(x, tau)` — third-order distributed delay (smoother pipeline) with mean `tau`. Same `‖` marker.

The variable `time` is always available — it's the current simulation time in the same units as `StartTime` / `EndTime`.

## Maps (lookup tables)

```
map AdoptionCurve: linear
    (0, 0)
    (10, 0.05)
    (50, 0.40)
    (100, 0.95)
```

Modes: `linear` (interpolate adjacent points), `step` (piecewise constant), `spline` (smooth cubic). Call as `AdoptionCurve(input)` inside any expression.

## Modules

```
module Demography:
    stock Population = 100
    constant BirthRate = 0.05

    flow Births:
        Population * BirthRate -+> Population
```

A namespace. Inside `Demography`, `Population` is `Demography.Population`. Outside, refer to it by the qualified name. Modules can nest. References look up outwards (current scope → enclosing → root).

Use modules to group related concepts (a "demographics" sector, an "economy" sector). The diagram renders each module as a faintly-bordered cluster.

## Scenarios

```
scenario AggressiveGrowth:
    constant BirthRate = 0.08
    stock Population = 200
```

A named override set. The simulator runs the base case, plus once per scenario. Only `constant` and `stock` overrides are valid; you cannot redefine a `calc` or a `flow` in a scenario.

## Sweeps

```
sweep BirthRate = [0.02, 0.04, 0.06, 0.08]
```

Runs the simulation once per value, replacing the named constant. Show up in the **Compare** tab and (one-at-a-time amplitudes) in the **Sensitivity** tab.

Multi-axis sweeps are the cartesian product of all `sweep` lines, capped at 64 variations.

## Plots

```
plot Population
plot ActualBirthRate
```

Marks variables for prominent charting. Non-plotted variables are still simulated and accessible — `plot` is just a hint.

## Limits

```
limit Population min = 0
limit Inventory min = 0 max = 10000
```

Clamps the stock after every integration step. Common idiom: `limit X min = 0` to enforce non-negativity on populations, inventories, capital — anything that's physically nonsensical when negative.

## Discipline features

These are covered in detail in the **Discipline features** doc, but here's the surface:

```
# Boundary marker
exogenous constant TaxRate = 0.20 [1/year]

# Subscripted dimension
subscript Region = North, South, East, West
constant BirthRate[Region] = [0.06, 0.04, 0.05, 0.03] [1/year]
stock Population[Region] = 100 [people]
flow Births[Region]:
    Population[Region] * BirthRate[Region] -+> Population[Region]

# Reference mode (Sterman discipline)
reference Population:
    (0, 100)
    (50, 480)

# Reality Check assertion
check Population_nonneg:
    then Population >= 0 always

check Crash_when_births_off:
    when BirthRate = 0
    then Population <= 50 at t = 100

# Calibration (fits constants to reference modes)
calibrate:
    bounds BirthRate = [0.01, 0.5]
    bounds CarryingCapacity = [100, 2000]
```

---

## A few useful idioms

**Logistic growth** (R + B sharing a state):

```
constant BirthRate = 0.05
constant CarryingCapacity = 500
stock Population = 50

calc Pressure = Population / CarryingCapacity
calc EffectiveBirthRate = BirthRate * (1 - Pressure)

flow Births:
    Population * EffectiveBirthRate -+> Population
```

**Step shock at t=10**:

```
calc Demand = BaselineDemand + step(ShockSize, 10)
```

**First-order delay** (e.g. forecasting a noisy signal):

```
calc ExpectedDemand = smooth(CustomerOrders, 6)
```

**Distributed pipeline delay** (e.g. shipping):

```
calc Delivery = delay3(OrderRate, 4)
```

**Gating a flow on the source stock being non-empty**:

```
flow Withdraw:
    max(0, min(DesiredAmount, CashAccount)) --> CashAccount
```

---

For the full grammar reference, error code list, and edge cases, see the **For LLMs** section's `grammar.md` (it's the reference document Claude reads when writing models for you).
