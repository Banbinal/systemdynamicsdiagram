# sysdyn v2 DSL — full grammar reference

## Table of contents

1. Top-level constructs
2. Expressions and operators
3. Polarity arrows
4. Built-in functions
5. Modules and scoping
6. Scenarios and sweeps
7. Subscripts (1D fan-out)
8. Reference modes
9. Reality Check assertions
10. Calibration
11. Units annotations
12. Indentation rules
13. Diagnostic codes (the errors you might cause)

---

## 1. Top-level constructs

A `.sd` file is a sequence of declarations. Order is mostly free, but conventionally: time block first, then constants, then stocks, then calcs, then flows, then maps, modules, scenarios, sweeps, plots, limits.

### Time block

```
StartTime = <number>
EndTime   = <number>
TimeStep  = <number>
```

All three should appear once. `StartTime` and `EndTime` define the simulation horizon; `TimeStep` is the integrator step size. Smaller step = more accurate, slower.

### Title (optional)

```
title <free text to end of line>
```

Documentation only; appears in the web app header.

### `constant`

```
constant <Name> = <expr>                     # plain
constant <Name> = <expr> [<unit-expr>]        # with units (see §11)
constant <Name>[<Sub>] = <expr>               # subscripted (see §7)
constant <Name>[<Sub>] = [<v1>, <v2>, ...]    # subscripted, per-element values
exogenous constant <Name> = <expr>            # boundary marker (input from outside)
```

Evaluated once at compile time. Override in scenarios with `constant <Path> = <value>`.

`exogenous constant` is identical to `constant` at runtime — the prefix only flags the variable as an input from outside the modelled system. The renderer marks exogenous constants with a dashed border + "exo" badge.

### `stock`

```
stock <Name> = <init-expr>                    # plain
stock <Name> = <init-expr> [<unit-expr>]       # with units
stock <Name>[<Sub>] = <init-expr>              # subscripted
```

State variable with an initial condition. Updated by flows during simulation. Override the *initial* value in scenarios with `stock <Path> = <value>`.

### `calc`

```
calc <Name> = <expr>                          # plain
calc <Name>[<Sub>] = <expr>                   # subscripted
```

A value derived from current stocks/calcs/constants/`time`. Recomputed every step. Cannot form a cycle with another calc — break cycles by routing through a stock (this is also how feedback loops are correctly modeled).

### `flow`

```
flow <Name>:                                  # plain
    <expr> -+> <Stock>
    <expr> --> <Stock>
    ...

flow <Name>[<Sub>]:                           # subscripted
    <expr-using-Sub> -+> <Stock>[<Sub>]
```

A flow's body is a list of *effects*. Each effect is `<magnitude-expr> <arrow> <target-stock>`. At least one effect required. A flow can hit multiple different stocks (one effect per line).

### `map`

```
map <Name>: linear        # or: step | spline
    (<x>, <y>)
    (<x>, <y>)
    ...
```

A 1-D lookup table. Call it as `<Name>(input)` inside any expression. Needs ≥2 points. `linear` interpolates between adjacent points; `step` is piecewise constant; `spline` uses cubic interpolation for smooth curves.

### `module`

```
module <Name>:
    <indented declarations>
```

A namespace. Declarations inside have qualified names like `<Name>.<Member>`. Modules can nest. Body must not be empty.

### `scenario`

```
scenario <Name>:
    constant <Path> = <value>
    stock    <Path> = <value>
    ...
```

Overrides applied at simulation time. The body may contain only `constant` and `stock` overrides (not `calc`, not `flow`). Body must not be empty.

### `sweep`

```
sweep <ConstantName> = [<v1>, <v2>, ...]
```

The simulator runs once per value, replacing the constant. List must be non-empty. Useful for sensitivity analysis.

### `plot`

```
plot <Variable>
```

Marks a variable for output. The web app charts plotted variables prominently; non-plotted ones are still simulated and accessible.

### `limit`

```
limit <Stock> min = <number>
limit <Stock> max = <number>
limit <Stock> min = <number> max = <number>
```

Clamps the stock after each integration step. At least one of `min`/`max` must be present. Use `min = 0` to enforce non-negativity on populations, inventories, etc.

---

## 2. Expressions and operators

Operator precedence from lowest to highest binding:

| Op            | Prec  | Assoc | Notes                        |
|---------------|-------|-------|------------------------------|
| `\|\|`        | 1     | left  | logical or                   |
| `&&`          | 2     | left  | logical and                  |
| `< <= > >= == !=` | 3 | left  | comparison (returns 0 or 1)  |
| `+ -` (binary)| 4     | left  | addition, subtraction        |
| `* / %`       | 5     | left  | multiply, divide, modulo     |
| `- + !` (unary)| 6    | prefix| negation, identity, not      |
| `^`           | 7     | right | exponentiation               |

Comparisons return numeric 0/1, so `(time >= T0) * height` is the standard idiom for "turn on at T0" — exactly how `step` desugars.

Number literals: `123`, `1.5`, `.5`, `1e3`, `1.5e-2`, `2E+10`. Integers are doubles internally — there is no separate int type.

Function calls: `f(a, b, c)`. Parens may also be used for grouping: `(a + b) * c`. Inside parens or square brackets, line breaks are allowed.

References: bare names look up by lexical scope. Qualified names (`A.B.C`) walk into modules.

---

## 3. Polarity arrows

Two arrow forms inside flows:

- `<expr> -+> <Stock>` — adds `expr` to `dStock/dt`
- `<expr> --> <Stock>` — subtracts `expr` from `dStock/dt`

Keep `expr` non-negative under normal operation. Polarity is carried by the arrow, not by the sign of the magnitude.

The compiler also infers a *symbolic* polarity along causal paths (used for diagnostics and visualization): an increase in A propagates as `+`, `-`, or `?` to a downstream variable, depending on the operators on the path. You don't write this — you just need to know that overly nonlinear or ambiguous operators (multiplying two non-constants, calling an unknown function) collapse to `?`.

---

## 4. Built-in functions

### Pure math

| Function   | Arity | Meaning                |
|------------|-------|------------------------|
| `abs(x)`   | 1     | absolute value         |
| `sqrt(x)`  | 1     | square root            |
| `exp(x)`   | 1     | e^x                    |
| `log(x)`   | 1     | natural log            |
| `log10(x)` | 1     | base-10 log            |
| `sin(x)`   | 1     | sine (radians)         |
| `cos(x)`   | 1     | cosine (radians)       |
| `tan(x)`   | 1     | tangent (radians)      |
| `min(a,b)` | 2     | minimum                |
| `max(a,b)` | 2     | maximum                |
| `pow(a,b)` | 2     | a^b (same as `a ^ b`)  |

### Time-aware (desugared)

| Function                     | Arity | Desugars to                                   |
|------------------------------|-------|-----------------------------------------------|
| `step(height, t0)`           | 2     | `(time >= t0) * height`                       |
| `pulse(height, t0, width)`   | 3     | `(time >= t0) * (time < t0 + width) * height` |
| `smooth(x, tau)`             | 2     | a synthetic stock that exponentially tracks `x` |
| `delay3(x, tau)`             | 2     | three cascaded synthetic stocks (third-order delay) |

`smooth` and `delay3` create *hidden* stocks named `__smooth_N`, `__delay3_N`, etc. You don't manage them — the desugar pass inserts them into the surrounding scope.

### Maps

A map is called like a function: `MyMap(x)`. Equivalent to `map(MyMap, x)`. You don't normally write `map(...)`; just call the map by name.

### The `time` variable

`time` is always available, holding the current simulation time in the same units as `StartTime`/`EndTime`. It is reserved — defining a constant or stock named `time` is an error (SD0042).

---

## 5. Modules and scoping

### Qualified names

Inside `module M`, declaring `stock S` creates a symbol with fully-qualified name `M.S`. Outside the module, refer to it as `M.S`. Inside the module, you can write either `S` (lexical lookup finds it) or `M.S` (explicit).

### Lookup rules

When a reference is resolved, the compiler searches scopes outward: current module → enclosing module → … → top level. Built-ins and `time` are always reachable.

### Cross-module references

Inside `module Economy`, a reference to `Demography.Population` is fine — the lookup walks up to root, then descends into `Demography`. There are no import statements; everything in the file is in one tree.

### Empty modules are an error

A module declaration with no body produces SD0028. This usually means you wrote `module M:` and forgot to indent the body, or the body is only comments.

---

## 6. Scenarios and sweeps

### Scenarios

```
scenario HighGrowth:
    constant BirthRate = 0.05
    stock Demography.Population = 1500
```

A scenario is a *named override set*. The simulator runs the base model first, then you can ask it to re-run with the scenario's overrides applied. Stocks are overridden at their initial value; constants are overridden everywhere they're read.

Only `constant` and `stock` overrides are valid in a scenario body.

### Sweeps

```
sweep BirthRate = [0.02, 0.03, 0.04, 0.05]
```

The simulator produces one trajectory per value. Sweeps cover *one* constant per declaration; for multi-axis sweeps, declare multiple `sweep` lines (the simulator caps the cartesian product to prevent runaway runs — SD0083).

---

## 7. Subscripts (1D fan-out)

A `subscript` declares a named dimension and a fixed list of element names:

```
subscript Region = North, South, East, West
```

Declarations can carry the dimension via `[<Sub>]`:

```
constant BirthRate[Region] = 0.05                    # uniform across elements
constant DeathRate[Region] = [0.02, 0.03, 0.025, 0.04]   # per-element values
stock Population[Region] = 100
flow Births[Region]:
    Population[Region] * BirthRate[Region] -+> Population[Region]
```

The compiler **expands** these into one variable per element before any other pass. After expansion, `Population[Region]` becomes four scalar stocks: `Population_North`, `Population_South`, `Population_East`, `Population_West`. Same for the constants and the flow.

References can use either form:
- `Population[Region]` — only inside a subscripted decl that uses `Region`. Binds to the current element.
- `Population[North]` — anywhere. Refers to the specific expanded variable. Common in scalar contexts:

```
calc TotalPopulation = Population[North] + Population[South] + Population[East] + Population[West]
```

Constraints (Phase 1):
- Only **one** subscript per declaration. No multi-dim arrays (`Trade[Origin, Dest]` not yet supported).
- Subscripts must be declared at top level, not inside a `module`.
- Per-element array literals must have exactly the same length as the subscript's element list (SD0050x).
- `[Region]` (the dimension name) outside a subscripted decl is an error (SD0048).

---

## 8. Reference modes

Sterman-style "expected behaviour over time": declare points the model should reproduce. Drawn as a dashed overlay on the simulation chart.

```
reference <Stock>:
    (<t>, <value>)
    (<t>, <value>)
    ...
```

At least two points required. Times can be in any order — the simulator sorts them. The target must resolve to a stock or calc.

```
reference Population:
    (0, 100)
    (10, 220)
    (50, 480)
    (100, 490)
```

Reference modes also serve as the target series for `calibrate` (§10).

---

## 9. Reality Check assertions

Each `check` block runs an isolated simulation with its `when` overrides applied, then evaluates the assertion at every recorded step (`always`) or at the step closest to a given time (`at t = N`).

```
check <Name>:
    when <Constant> = <expr>           # zero or more constant overrides
    then <lhs> <op> <rhs> always       # operators: >= <= > < == !=
    # or: ... at t = <number>
```

```
check Population_nonneg:
    then Population >= 0 always

check Crash_within_horizon:
    when BirthRate = 0
    when DeathRate = 0.1
    then Population <= 50 at t = 100
```

Constraints:
- Exactly one `then` clause per check (SD0034 if multiple).
- The `when` target must resolve to a `constant`.
- The lhs / rhs are arbitrary expressions; they're parsed without consuming the surrounding comparison op.

Surfaced in a "Checks" tab in the simulator with pass/fail badges.

---

## 10. Calibration

Fits free constants to the model's `reference` modes via Nelder-Mead. One block per program (last wins if duplicated). Each `bounds` line declares one free parameter and its allowed range.

```
calibrate:
    bounds <Constant> = [<low>, <high>]
    bounds <Constant> = [<low>, <high>]
    ...
```

```
calibrate:
    bounds BirthRate = [0.01, 0.5]
    bounds CarryingCapacity = [100, 2000]
```

Constraints:
- At least one `bounds` line (SD0045).
- `low` ≤ `high` (SD0046).
- The target must resolve to a `constant`.
- Needs at least one `reference` mode somewhere in the program — otherwise the runtime returns an error.

The simulator runs the calibration in its "Calibrate" tab, reports RMSE before/after, and offers a button to apply fitted values to the SyntheSim live tweak panel.

---

## 11. Units annotations

Optional `[unit-expr]` suffix on `constant` and `stock` values. Used by the compiler to flag dimensional mismatches in arithmetic (warnings, never errors).

```
constant <Name> = <expr> [<unit-expr>]
stock    <Name> = <init> [<unit-expr>]
```

Unit expression grammar (inside the brackets):

```
unit-expr := factor (('*' | '/') factor)*
factor    := IDENT ('^' INT)?
           | NUMBER     # only `1` is allowed (for `[1/year]`)
```

Examples:
```
constant BirthRate = 0.05 [1/year]
constant Pop = 1000 [people]
constant Inflow = 200 [people/year]
constant Volume = 50 [m^3]
constant Pressure = 0.1 [kg/(m*s^2)]   # not yet — only `*` and `/` infix, no parens
```

(Last example would need to be written `[kg/m/s^2]` — see grammar above. Phase 1 keeps the grammar flat.)

Algebra:
- `mul` / `div` add/subtract exponents per base name.
- `pow` (via `^`) scales exponents.
- `+` / `−` / comparisons require matching units (warning if mismatched).
- `exp` / `log` / `sin` / `cos` / `tan` require dimensionless arguments.
- `sqrt` halves exponents (allowed when all even).

Phase 1 has **no unit conversion**: `year` and `month` are different dimensions and mixing them produces a warning. Pick one consistent time unit per model.

Numeric literals are silently promoted to whatever units the other side carries: `Population >= 0` does not warn even though `Population` is `[people]` and `0` is technically dimensionless.

Diagnostic codes: SD0090 (invalid unit token), SD0091 (mismatch in `+`/`−`/comparison), SD0092 (declared vs inferred mismatch), SD0093 (malformed annotation).

---

## 12. Indentation rules

The lexer is Python-style indentation-sensitive:

- Use **spaces only** in leading whitespace. Tabs are an error (SD0011).
- Block bodies (`flow`, `map`, `module`, `scenario`) must be indented relative to the header line.
- Indentation level must match prior siblings — inconsistent dedent is an error (SD0012).
- Newlines are tokens, except inside `(...)` or `[...]` where they are absorbed (so multi-line expressions inside parens are fine).
- Blank lines and comment-only lines do not affect indentation tracking.
- Comments start with `#` and run to end of line.

A typical block:

```
flow Replenishment:
    DeliveryRate -+> Inventory
    Spoilage     --> Inventory
```

The two effect lines must be indented identically. The next top-level declaration must dedent back to column 0.

---

## 13. Diagnostic codes

When the user reports an error, look it up here.

### Lexer (SD001x)

| Code   | Meaning                                                |
|--------|--------------------------------------------------------|
| SD0010 | Unexpected character in source                         |
| SD0011 | Tabs in leading whitespace (use spaces)                |
| SD0012 | Inconsistent dedent — does not match a prior indent    |
| SD0013 | Malformed number literal (e.g. `1e` with no exponent)  |
| SD0014 | Unmatched / mismatched bracket                         |
| SD0015 | Unclosed bracket at EOF                                |

### Parser (SD002x – SD004x)

| Code   | Meaning                                                          |
|--------|------------------------------------------------------------------|
| SD0020 | Unexpected token at top level (unknown statement keyword)        |
| SD0021 | Expected token X, got Y (missing `=`, `:`, `(`, etc.)            |
| SD0022 | Expected expression                                              |
| SD0023 | Override target invalid (must be `constant` or `stock`)          |
| SD0024 | Map mode must be `linear`, `step`, or `spline`                   |
| SD0025 | Empty sweep value list                                           |
| SD0026 | Flow body has no effects                                         |
| SD0027 | Map has fewer than 2 points                                      |
| SD0028 | Module body is empty                                             |
| SD0029 | Scenario body is empty                                           |
| SD0030 | Duplicate `min` or `max` in `limit`                              |
| SD0033 | Inside a `check`, expected `when` or `then` (got something else) |
| SD0034 | A `check` has more than one `then` clause                        |
| SD0035 | A `check` has no `then` clause                                   |
| SD0036 | Expected comparison operator in check assertion                  |
| SD0037 | Expected temporal qualifier (`always` or `at t = N`)             |
| SD0038 | `exogenous` not followed by `constant`                           |
| SD0039 | `reference` block has fewer than 2 points                        |
| SD0044 | Inside `calibrate`, expected `bounds` (got something else)       |
| SD0045 | `calibrate` block has no `bounds` parameters                     |
| SD0046 | `bounds` reverse-ordered: `low` > `high`                         |
| SD0047 | `subscript` lists fewer than 2 elements                          |

### Semantic (SD004x, SD005x)

| Code    | Meaning                                                          |
|---------|------------------------------------------------------------------|
| SD0040  | Duplicate declaration in the same scope                          |
| SD0041  | Unresolved reference (typo, missing module prefix)               |
| SD0042  | Reserved name redefinition (`time`)                              |
| SD0048  | Subscript dimension referenced outside a subscripted decl        |
| SD0049  | Declaration references unknown subscript                         |
| SD0050  | Cycle in `calc`/`constant` dependencies                          |
| SD0050x | Subscript array literal length ≠ subscript element count         |

### Desugaring arity (SD007x)

| Code   | Meaning                                  |
|--------|------------------------------------------|
| SD0070 | `step` requires exactly 2 arguments      |
| SD0071 | `pulse` requires exactly 3 arguments     |
| SD0072 | `smooth` requires exactly 2 arguments    |
| SD0073 | `delay3` requires exactly 2 arguments    |

### IR lowering (SD006x)

| Code   | Meaning                                                  |
|--------|----------------------------------------------------------|
| SD0060 | Built-in called with wrong arity                         |
| SD0061 | Reference to a desugared built-in escaped desugaring     |
| SD0062 | Built-in used as a value (must be called)                |
| SD0063 | Map used as a value (must be invoked: `M(x)`)            |
| SD0064 | Symbol used in a context its kind doesn't support        |
| SD0065 | Array literal used outside a subscripted constant init    |

### Runtime (SD008x)

| Code   | Meaning                                                       |
|--------|---------------------------------------------------------------|
| SD0080 | Non-finite value produced (NaN/Inf — usually divide by zero)  |
| SD0081 | Unknown solver name                                           |
| SD0082 | Unknown scenario name                                         |
| SD0083 | Sweep cartesian product exceeds the variation cap             |

### Units check (SD009x)

All warnings — units annotations never block simulation.

| Code   | Meaning                                                       |
|--------|---------------------------------------------------------------|
| SD0090 | Invalid token inside a `[unit-expr]` annotation               |
| SD0091 | Dimensional mismatch in `+` / `−` / comparison                |
| SD0092 | Constant or stock declared units differ from inferred         |
| SD0093 | Malformed unit annotation (parse error in the brackets)       |
