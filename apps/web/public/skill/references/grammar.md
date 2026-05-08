# sysdyn v2 DSL — full grammar reference

## Table of contents

1. Top-level constructs
2. Expressions and operators
3. Polarity arrows
4. Built-in functions
5. Modules and scoping
6. Scenarios and sweeps
7. Indentation rules
8. Diagnostic codes (the errors you might cause)

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
constant <Name> = <expr>
```

Evaluated once at compile time. Override in scenarios with `constant <Path> = <value>`.

### `stock`

```
stock <Name> = <init-expr>
```

State variable with an initial condition. Updated by flows during simulation. Override the *initial* value in scenarios with `stock <Path> = <value>`.

### `calc`

```
calc <Name> = <expr>
```

A value derived from current stocks/calcs/constants/`time`. Recomputed every step. Cannot form a cycle with another calc — break cycles by routing through a stock (this is also how feedback loops are correctly modeled).

### `flow`

```
flow <Name>:
    <expr> -+> <Stock>
    <expr> --> <Stock>
    ...
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

## 7. Indentation rules

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

## 8. Diagnostic codes

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

### Parser (SD002x)

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

### Semantic (SD004x, SD005x)

| Code   | Meaning                                                  |
|--------|----------------------------------------------------------|
| SD0040 | Duplicate declaration in the same scope                  |
| SD0041 | Unresolved reference (typo, missing module prefix)       |
| SD0042 | Reserved name redefinition (`time`)                      |
| SD0050 | Cycle in `calc`/`constant` dependencies                  |

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

### Runtime (SD008x)

| Code   | Meaning                                                       |
|--------|---------------------------------------------------------------|
| SD0080 | Non-finite value produced (NaN/Inf — usually divide by zero)  |
| SD0081 | Unknown solver name                                           |
| SD0082 | Unknown scenario name                                         |
| SD0083 | Sweep cartesian product exceeds the variation cap             |
