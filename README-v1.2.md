# System Dynamics DSL v1.2

This document explains the updated System Dynamics DSL (Domain Specific Language) v1.2, which adds new features and improves structure over v0.9.2.

## Overview

The v1.2 DSL is designed for describing continuous system dynamics models with improved modularity, explicit flow polarities, scenarios, response functions, and parameter sweeps. It provides a clean, expressive syntax that is both human-readable and precise.

## Key Features

- **Modules** for encapsulating related elements 
- **Groups** for organizing elements without affecting semantics
- **Explicit flow polarities** with `-+>` (positive) and `-->` (negative) syntax
- **Maps** (response curves) with different interpolation types
- **Scenarios** for testing different initial conditions
- **Parameter sweeps** for sensitivity analysis across multiple values
- **Explicit time configuration** with TimeStep, StartTime, and EndTime constants
- **Improved naming** (calc instead of aux, constant instead of param)

## Basic Structure

A model consists of a series of definitions:

```
program           ::= (time_config | group | module | stock | constant | calc | flow | scenario | sweep | map)*

time_config       ::= "constant" ("TimeStep" | "StartTime" | "EndTime") "=" number

group             ::= "group" identifier ":" INDENT program DEDENT

module            ::= "module" identifier ":" INDENT program DEDENT

stock             ::= "stock" identifier "=" expression
constant          ::= "constant" identifier "=" expression
calc              ::= "calc" identifier "=" expression

flow              ::= "flow" identifier ":" INDENT flow_effect+ DEDENT
flow_effect       ::= expression polarity identifier newline
polarity          ::= "-->" | "-+>"

scenario          ::= "scenario" identifier ":" INDENT override+ DEDENT
override          ::= ("constant" | "stock") identifier "=" expression

sweep             ::= "sweep" identifier "=" "[" number ("," number)+ "]"

map               ::= "map" identifier (":" interpolation_type)? ":" INDENT point+ DEDENT
interpolation_type ::= "linear" | "step" | "spline" (optional, default = linear)
point             ::= "(" number "," number ")" newline
```

## Examples

### Time Configuration

```
constant StartTime = 2020
constant EndTime = 2050
constant TimeStep = 0.25
```

### Basic Stock-Flow Model

```
stock Population = 1000
constant BirthRate = 0.03

flow Births:
  Population * BirthRate -+> Population

flow Deaths:
  Population * 0.01 --> Population
```

### Modules and Cross-Module References

```
module Demography:
  stock Population = 800
  constant BirthRate = 0.02

module Economy:
  constant Productivity = 10
  calc GDP = Demography.Population * Productivity
```

### Groups for Organization

```
group DemographicInputs:
  constant BirthRate = 0.03
  constant DeathRate = 0.01
```

### Scenarios for Alternative Simulations

```
scenario Crisis:
  stock Population = 500
  constant BirthRate = 0.01
```

### Parameter Sweeps for Sensitivity Analysis

```
sweep InterestRate = [0.01, 0.02, 0.03, 0.04]
```

This will run the simulation once for each value in the array, allowing you to see how different interest rates affect the model's behavior.

The parameter sweep feature provides:

- **Comparative Analysis**: Automatically runs multiple simulations with different parameter values
- **Visualization**: Plots results from all runs in a single chart for easy comparison
- **Insights**: Provides analysis of how the swept parameter affects key stocks and calculations
- **Identifying Key Values**: Helps find tipping points, thresholds, and optimal parameter values

A dedicated test page (`sweep_test.html`) is available for experimenting with parameter sweeps using example models:

- Loan Payoff Analysis with Interest Rate Sweep
- Business Growth Model with Marketing Effectiveness Sweep 
- Population Model with Resource Constraints

### Maps for Response Curves

```
map EducationEffect: linear
  (0.0, 0.0)
  (0.5, 0.8)
  (1.0, 1.0)

calc Effect = map(EducationEffect, EducationLevel)
```

## Differences from v0.9.2

| v0.9.2 | v1.2 | Notes |
|--------|------|-------|
| `param` | `constant` | More accurate name for a constant parameter |
| `aux` | `calc` | More descriptive name for calculated variable |
| `sim 0 10 0.25` | `constant StartTime = 0`<br>`constant EndTime = 10`<br>`constant TimeStep = 0.25` | More explicit time configuration |
| `flow X = expression`<br>`connect X -> Y`<br>`connect Y <- Z` | `flow X:`<br>`  expression -+> Y`<br>`  expression --> Z` | Explicit flow polarities |
| `graph Name ((x,y), (x,y))` | `map Name: linear`<br>`  (x, y)`<br>`  (x, y)` | Clearer format and interpolation options |
| `abtest param X = [a, b]` | `sweep X = [a, b, c, d, ...]` | Expanded to support multiple values |
| No modules | `module Name:`<br>`  contents` | Support for modular models |
| No scenarios | `scenario Name:`<br>`  overrides` | Support for what-if analysis |
| No grouping | `group Name:`<br>`  contents` | Visual organization |

## Parameter Sweeps vs. Scenarios

Both `sweep` and `scenario` allow you to explore alternative model configurations, but they serve different purposes:

- **Sweep**: Runs multiple simulations, each with a different value for a single parameter. Used for sensitivity analysis to see how a system responds across a range of values. Results in multiple simulation outputs that can be compared.

- **Scenario**: Defines a named set of parameter overrides that can be selected when running a single simulation. Used for testing specific "what-if" scenarios with multiple parameter changes at once.

**Limitations**:
- Only one sweep can be active in a model at a time
- Sweeps cannot be used inside scenarios
- Sweeps can only be applied to constants, not stocks

## Additional Function Support

The v1.2 DSL supports several built-in functions:

- `smooth(input, delay)` - Exponential smoothing of an input with a given delay time
- `delay3(input, delay)` - Third-order delay of an input with a given delay time
- `step(height, time)` - Step function that returns height when time >= specified time
- `pulse(magnitude, time, width)` - Pulse function generating a pulse of defined width
- `map(mapName, input)` - Evaluates a defined map at the input value
- `time` - Current simulation time (built-in variable)

## Best Practices

1. Always define flow effects with an explicit polarity arrow (`-+>` or `-->`)
2. Use modules to organize large models into logical components
3. Use groups to visually organize related elements
4. Prefer descriptive names for variables and flows
5. Use comments to document complex equations or model logic
6. Use scenarios to test alternative policies or initial conditions
7. Use parameter sweeps to understand model sensitivity and identify tipping points 