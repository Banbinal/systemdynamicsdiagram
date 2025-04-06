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

### Online Deployment

To deploy on a web server:

1. Upload the following files to your web hosting provider:
   - `index.html`
   - `documentation.html`
   - The entire `scripts/` directory
   - The entire `styles/` directory

2. Access the tool through your domain: `https://yourdomain.com/`

## Model Syntax Example

```
title Simple Population Model

# Stocks
stock Population = 1000

# Parameters
param BirthRate = 0.05
param DeathRate = 0.03

# Flows
flow Births = Population * BirthRate
flow Deaths = Population * DeathRate

# Connections
connect Births -> Population
connect Deaths <- Population

# Simulation settings
sim 0 100 1
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

MIT

## Credits

Developed as an educational tool for teaching and learning system dynamics modeling and simulation. 