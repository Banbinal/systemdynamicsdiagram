# System Dynamics Diagram Tool

An interactive web-based tool for creating, visualizing, and simulating system dynamics models using a custom Domain Specific Language (DSL).

## Features

- **Custom DSL**: Define models using an intuitive domain-specific language
- **Interactive Diagram**: Visualize your system dynamics model in real-time
- **Simulation Engine**: Run simulations to see how your model behaves over time
- **Interpretation**: Get insights and analysis of simulation results
- **Reporting**: Generate PDF and HTML reports of your models and simulations
- **A/B Testing**: Compare different parameter values to evaluate interventions

## Getting Started

### Local Usage

1. Clone this repository:
   ```
   git clone https://github.com/Banbinal/systemdiagram.git
   cd systemdiagram
   ```

2. Open `index.html` in your web browser - no server required!

## Model Syntax Example

```
# Minimal Population Model
title Simple Population & Resources Model

# Stocks
stock Population = 1000
stock Resources = 5000

# Parameters
param BirthRate = 0.05
param ResourceConsumptionRate = 1.2

# Flows
flow Births = Population * BirthRate * (Resources / 5000)
flow Deaths = Population * (1 - Resources / 10000)
flow ResourceDepletion = Population * ResourceConsumptionRate

# Connections
connect Births -> Population
connect Deaths <- Population
connect ResourceDepletion <- Resources

# Simulation settings
sim 0 40 0.5

# A/B test different consumption rates
abtest param ResourceConsumptionRate = [1.2, 0.8]
```

## Documentation

See the [full documentation](documentation.html) for detailed information on the DSL syntax and available features.

## Technology Stack

- Pure JavaScript for the simulation engine and UI
- [Mermaid.js](https://mermaid.js.org/) for diagram rendering
- [Chart.js](https://www.chartjs.org/) for simulation result visualization
- [CodeMirror](https://codemirror.net/) for the code editor
- [html2pdf](https://github.com/eKoopmans/html2pdf.js) for report generation

## License

[MIT](https://github.com/Banbinal/systemdiagram/blob/master/LICENSE)

## Credits

Developed as an educational tool for teaching and learning system dynamics modeling and simulation. 
