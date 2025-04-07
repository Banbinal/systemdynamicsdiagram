# System Dynamics Diagram Tool

A web-based tool for creating, visualizing, simulating, and analyzing system dynamics models using a custom domain-specific language (DSL).

## Overview

This tool allows you to:

1. **Create** system dynamics models using a simple, expressive DSL
2. **Visualize** stock-and-flow diagrams automatically from your model description
3. **Simulate** the behavior of your model over time
4. **Analyze** the results with plots and automated interpretations
5. **Share** your models via URL or downloadable reports

The tool supports two versions of the DSL:
- **v1.2** (Current): Enhanced with modules, explicit flow polarities, scenarios, and response functions
- **v0.9.2** (Legacy): Original version with simpler syntax

## Getting Started

1. Open `index.html` in a modern web browser
2. Select your preferred DSL version
3. Enter your model definition in the editor
4. Click "Simulate" to run the model and see results

## DSL v1.2 Syntax Highlights

```
# Time configuration
constant StartTime = 2020
constant EndTime = 2050
constant TimeStep = 0.25

# Define a stock (state variable)
stock Population = 1000

# Define a constant parameter
constant BirthRate = 0.03

# Define a calculation (auxiliary variable)
calc PopulationDensity = Population / Area

# Define a flow with explicit polarity
flow Births:
  Population * BirthRate -+> Population

flow Deaths:
  Population * DeathRate --> Population

# Define a module to organize related variables
module Economy:
  constant GDPPerCapita = 50000
  calc GDP = Population * GDPPerCapita

# Define a response curve (map)
map ResourceResponse: linear
  (0.0, 1.2)  # Low resource usage: abundance
  (0.5, 1.0)  # Medium usage: normal
  (1.0, 0.8)  # Full usage: scarcity
  (1.5, 0.5)  # Over usage: severe scarcity

# Define a scenario for what-if analysis
scenario HighGrowth:
  constant BirthRate = 0.05

# Run multiple simulations with different parameter values
sweep InterestRate = [0.02, 0.03, 0.04, 0.05, 0.06]
```

## Features

### Visualization

The tool automatically generates stock-and-flow diagrams using Mermaid.js, with appropriate visual styling for different element types:
- Stocks (blue rectangles)
- Flows (orange rounded rectangles)
- Constants (gray dashed rectangles)
- Calculations (green rounded rectangles)
- Flow polarities (green/red arrows)

### Simulation

The tool uses a 4th-order Runge-Kutta numerical integration method for accurate simulation of continuous system dynamics models. Features include:
- Configurable start time, end time, and time step
- Support for scenarios to test multiple parameter sets
- Parameter sweeps for sensitivity analysis
- Built-in system dynamics functions (smooth, delay3, step, pulse)

### Analysis

After simulation, the tool provides:
- Time series plots of all model variables
- Automated interpretation of model behavior
- Identification of feedback loops and their types
- Summary statistics on key variables

### Reports

You can create downloadable reports of your models in PDF or HTML format, including:
- Model structure diagram
- Simulation results
- Variable listings and equations
- Interpretation of results

## Example Models

The repository includes several example models:
- `examples/population_model_v1_2.txt`: Basic population model with resource constraints
- `examples/population_model_legacy.txt`: Legacy version of the population model
- `examples/economic_model_v1_2.txt`: Complex economic model with environmental feedback
- `examples/loan_payoff_sweep_v1_2.txt`: Loan analysis with interest rate parameter sweep
- `examples/business_growth_sweep_v1_2.txt`: Business growth model with marketing effectiveness sweep

## Documentation

Complete documentation for the DSL syntax and tool features:
- DSL v1.2 Reference: `README-v1.2.md`
- Interactive documentation: `documentation.html`
- Testing page: `test.html`

## Technical Details

The tool is built using:
- JavaScript (ES6+) modules
- Mermaid.js for diagrams
- Chart.js for plotting
- CodeMirror for the code editor
- HTML/CSS for the UI

No server-side dependencies are required - everything runs in the browser.

## Development

The codebase is organized into modules:
- `scripts/parser.js`: Handles DSL parsing
- `scripts/simulation.js`: Implements simulation logic
- `scripts/visualization.js`: Generates model diagrams
- `scripts/plotting.js`: Creates results charts
- `scripts/analysis.js`: Interprets simulation results
- `scripts/app.js`: Main application logic and UI

## License

MIT License

## Acknowledgements

Inspired by system dynamics modeling tools like Stella, Vensim, and InsightMaker. 
