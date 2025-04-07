# Parameter Sweep Testing Guide

This guide explains how to use the parameter sweep testing page to experiment with the System Dynamics DSL v1.2 sweep functionality.

## Running the Test Page

1. Make sure you have Node.js installed on your system
2. Open a terminal/command prompt in the project directory
3. Run the test server:
   ```
   node run_test_page.js
   ```
4. The test page should automatically open in your default browser
5. If it doesn't open automatically, navigate to http://localhost:3000 in your browser

## Using the Test Page

The test page provides a simple interface to test parameter sweeps in system dynamics models:

1. **Select an Example**: Click one of the example buttons to load a pre-defined model with a parameter sweep:
   - **Loan Payoff Example**: Tests how different interest rates affect loan payoff time
   - **Business Growth Example**: Tests how marketing effectiveness impacts customer acquisition
   - **Population Model Example**: Tests how birth rate affects population growth with resource constraints

2. **Edit the Model**: You can modify the model code directly in the text area. Feel free to:
   - Change parameter values
   - Edit the sweep range
   - Add new calculations or flows
   - Try different sweep parameters

3. **Run the Simulation**: Click the "Run Simulation" button to parse the model, run the sweep simulations, and display the results.

4. **View Results**: The results will be displayed in two sections:
   - **Chart**: Shows time series data for key variables across all parameter values
   - **Analysis**: Provides insights about how the swept parameter affects model behavior

## Understanding Sweep Syntax

The parameter sweep syntax is straightforward:

```
sweep ParameterName = [value1, value2, value3, ...]
```

For example:
```
sweep InterestRate = [0.03, 0.04, 0.05, 0.06, 0.07]
```

Important notes:
- The parameter must be defined as a constant in the model
- You can only have one sweep in a model at a time
- Values should be numeric and in ascending or descending order
- Using 5-7 values is recommended for readability

## Troubleshooting

If you encounter issues:

1. **Parse errors**: Check your DSL syntax for typos or invalid constructs
2. **Simulation errors**: Ensure your model is mathematically valid and doesn't divide by zero
3. **Visualization issues**: Try fewer sweep values if the chart is too cluttered
4. **Server issues**: Make sure port 3000 is not in use by another application

## Next Steps

After testing, you can:

1. Integrate sweep functionality into your own models
2. Explore different parameter ranges to find optimal values
3. Use sweep results to identify tipping points or thresholds
4. Combine insights from multiple sweep tests to improve model understanding 