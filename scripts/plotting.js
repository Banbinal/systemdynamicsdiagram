/**
 * Plotting Module for System Dynamics Tool v1.2
 * Handles plotting of simulation results
 */

// Define chart colors directly here since config.js might not exist
const CHART_COLORS = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
    '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
];

let currentChart = null;

/**
 * Main plotting function - determines result type and calls specific plotter.
 * Now handles the AllResults structure with multiple variations.
 * @param {AllResults | Object} resultsInput - Simulation results (AllResults structure or older formats for backward compatibility).
 * @param {CanvasRenderingContext2D} ctx - Canvas context for the chart.
 * @param {HTMLElement} chartContainer - The container div for the chart canvas.
 * @param {HTMLElement} placeholder - The placeholder element shown when no chart is visible.
 * @param {Object} model - The original parsed model definition (used for context).
 */
function plotResults(resultsInput, ctx, chartContainer, placeholder, model) {
    if (!resultsInput) {
        console.error("[ERROR] No results provided to plotResults.");
        showPlaceholder(placeholder, chartContainer, 'No simulation results to plot.');
        return { comparisonChart: null, detailCharts: {} };
    }

    // Destroy previous chart
    if (currentChart) { 
        currentChart.destroy(); 
        currentChart = null; 
    }

    // Check if it's the new AllResults structure
    if (resultsInput.variations && typeof resultsInput.variations === 'object') {
        console.log("[DEBUG] Plotting multiple variations...");
        return plotVariations(resultsInput, ctx, chartContainer, placeholder, model);
    } 
     // --- Keep older checks for potential partial compatibility or testing ---
     // Check if it's old sweep results (now less likely to be passed directly)
     else if (resultsInput.runs && Array.isArray(resultsInput.runs) && resultsInput.paramName) {
        console.warn("[WARN] Plotting legacy sweep structure. Should use AllResults.");
        return plotSweepResults(resultsInput, ctx, chartContainer, placeholder, model);
    } 
    // Check if it's a wrapped single run (e.g., from old sweep runner)
    else if (resultsInput.baseRun && resultsInput.baseRun.results && resultsInput.baseRun.results.time) {
        console.warn("[WARN] Plotting legacy baseRun structure. Should use AllResults.");
        const simOutput = resultsInput.baseRun.simulationOutput || resultsInput.baseRun;
        return plotSimulationResults(simOutput, ctx, chartContainer, placeholder, model); 
    } 
    // Check if it's a direct single run results object (less likely now)
    else if (resultsInput.results && resultsInput.results.time) { 
         console.warn("[WARN] Plotting legacy direct results structure. Should use AllResults.");
         return plotSimulationResults(resultsInput, ctx, chartContainer, placeholder, model); 
    } 
    else {
        console.error("[ERROR] Unrecognized results structure for plotting.", resultsInput);
        showPlaceholder(placeholder, chartContainer, 'Cannot plot unrecognized results format.');
        return { comparisonChart: null, detailCharts: {} };
    }
}

/** Helper to show placeholder text and hide chart */
function showPlaceholder(placeholder, chartContainer, message) {
    placeholder.textContent = message;
    placeholder.classList.remove('hidden');
    chartContainer.classList.add('hidden');
    if (currentChart) { currentChart.destroy(); currentChart = null; }
}

/**
 * Prepares datasets for a Chart.js chart from simulation results.
 * @param {object} model - The parsed model.
 * @param {object} resultsData - The simulation results data (stocks, calcs).
 * @param {string[]} labels - The time labels.
 * @returns {object[]} - Array of Chart.js dataset objects.
 */
function prepareDatasets(model, resultsData, labels) {
    const datasets = [];
    let colorIndex = 0;
    const allDataToPlot = { ...(resultsData?.stocks || {}), ...(resultsData?.calcs || {}) }; // Use ?. for safety

    Object.keys(allDataToPlot).forEach(varName => {
        const seriesData = allDataToPlot[varName];
        if (varName !== 'time' && Array.isArray(seriesData) && seriesData.length === labels.length) {
            const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
            const isStock = model?.stocks && model.stocks[varName]; // Use ?. for safety
            datasets.push({
                label: varName,
                data: seriesData,
                borderColor: color,
                backgroundColor: color + '1A',
                fill: false,
                tension: 0.1,
                borderWidth: isStock ? 2 : 1,
                pointRadius: 0,
                hidden: !isStock
            });
            colorIndex++;
        }
    });
    return datasets;
}

/**
 * Plots results from multiple variations contained in the AllResults object.
 * @param {AllResults} allResults - The aggregated results object.
 * @param {CanvasRenderingContext2D} ctx - Canvas context.
 * @param {HTMLElement} chartContainer - Chart container element.
 * @param {HTMLElement} placeholder - Placeholder element.
 * @param {Object} model - The original parsed model definition (for context).
 */
function plotVariations(allResults, ctx, chartContainer, placeholder, model) {
    const variations = allResults.variations;
    const identifiers = Object.keys(variations);

    if (identifiers.length === 0) {
        showPlaceholder(placeholder, chartContainer, 'No variations found in results to plot.');
        return { comparisonChart: null, detailCharts: {} };
    }

    // Find the first successful run to get time labels and potential variables
    let firstGoodRunOutput = null;
    for (const id of identifiers) {
        const output = variations[id];
        if (output && !output.error && output.results && output.results.time && output.results.time.length > 0) {
            firstGoodRunOutput = output;
            break;
        }
    }

    if (!firstGoodRunOutput) {
        showPlaceholder(placeholder, chartContainer, 'No successful simulation variations to plot.');
        return { comparisonChart: null, detailCharts: {} };
    }

    const labels = firstGoodRunOutput.results.time;
    
    // --- Generate Parameter Comparison Chart --- 
    console.log("[DEBUG] Generating parameter comparison chart...");
    const comparisonDatasets = [];
    let colorIndex = 0;

    // Determine the variable to compare
    let variableToCompare = null;
    if (model.plotTargets && model.plotTargets.length > 0) {
        variableToCompare = model.plotTargets[0]; // Use the first specified plot target
        console.log(`[DEBUG] Using plot target from DSL: ${variableToCompare}`);
    } else {
        console.log("[DEBUG] No plot target in DSL, finding default...");
        // Default logic: Find the first stock variable (or first calc if no stocks)
        variableToCompare = Object.keys(model.stocks || {})[0];
        if (!variableToCompare) {
            variableToCompare = Object.keys(model.calcs || {})[0];
        }
        if (!variableToCompare && firstGoodRunOutput.results) {
            // Fallback: find first plottable variable from results
            variableToCompare = Object.keys(firstGoodRunOutput.results).find(key => 
                key !== 'time' && key !== 'errors' && key !== 'warnings' && Array.isArray(firstGoodRunOutput.results[key])
            );
        }
        console.log(`[DEBUG] Default comparison variable: ${variableToCompare}`);
    }

    if (!variableToCompare) {
        showPlaceholder(placeholder, chartContainer, 'Cannot determine a variable to compare across variations.');
        return { comparisonChart: null, detailCharts: {} };
    }
    console.log(`[DEBUG] Comparing variable: ${variableToCompare}`);

    identifiers.forEach((identifier) => {
        const simOutput = variations[identifier];
        // Check if results and the specific variable data exist within stocks or calcs
        const resultsData = simOutput?.results;
        const seriesData = resultsData?.stocks?.[variableToCompare] || resultsData?.calcs?.[variableToCompare];
        
        if (seriesData && seriesData.length === labels.length) {
            const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
            comparisonDatasets.push({
                label: identifier, // Label dataset with variation ID
                data: seriesData, // Use the extracted seriesData
                borderColor: color,
                backgroundColor: color + '1A',
                fill: false,
                tension: 0.1,
                borderWidth: 1.5,
                pointRadius: 0,
            });
            colorIndex++;
        } else {
             console.log(`[DEBUG] Variable '${variableToCompare}' missing or length mismatch in variation: ${identifier}`);
        }
    });

    if (comparisonDatasets.length === 0) {
        showPlaceholder(placeholder, chartContainer, `No data found for variable '${variableToCompare}' across variations.`);
        return { comparisonChart: null, detailCharts: {} };
    }

    placeholder.classList.add('hidden');
    chartContainer.classList.remove('hidden');

    console.log(`[DEBUG] Creating comparison chart with ${comparisonDatasets.length} datasets.`);
    
    // Destroy previous chart instance if it exists
    if (currentChart) { 
        currentChart.destroy(); 
    } 

    const comparisonChartInstance = createComparisonChart(ctx, labels, comparisonDatasets);
    currentChart = comparisonChartInstance; // Keep track globally if needed

    // Ensure placeholder is hidden and canvas is visible
    placeholder.classList.add('hidden');
    ctx.canvas.classList.remove('hidden'); // Remove hidden class
    ctx.canvas.style.display = ''; // Clear any inline style

    console.log(`[DEBUG] Chart created. Canvas display: ${window.getComputedStyle(ctx.canvas).display}, Container display: ${window.getComputedStyle(chartContainer).display}, Container height: ${chartContainer.offsetHeight}`);

    // --- Generate Variation Detail Charts --- 
    console.log("[DEBUG] Generating variation detail charts...");
    let currentDetailCharts = {}; // Use a local variable

    const detailChartsContainerId = 'detailChartsContainer';
    let detailContainer = document.getElementById(detailChartsContainerId);
    const simulationTabPanel = document.getElementById('simulationTabPanel'); // Get parent panel

    if (!simulationTabPanel) {
        console.error("[ERROR] Cannot find simulation tab panel (#simulationTabPanel) to add detail charts.");
        // Still return the comparison chart
        return { comparisonChart: comparisonChartInstance, detailCharts: {} }; 
    }

    // Create or clear the container for detail charts
    if (!detailContainer) {
        detailContainer = document.createElement('div');
        detailContainer.id = detailChartsContainerId;
        detailContainer.classList.add('mt-8', 'space-y-6');
        chartContainer.parentNode.insertBefore(detailContainer, chartContainer.nextSibling);
    } else {
        detailContainer.innerHTML = ''; // Clear previous detail charts
    }

    identifiers.forEach((identifier) => {
        const simOutput = variations[identifier];
        if (!simOutput || simOutput.error) {
            console.log(`[DEBUG] Skipping detail chart for errored/missing variation: ${identifier}`);
            return;
        }

        const detailResultsData = simOutput.results;
        if (!detailResultsData) {
            console.warn(`[WARN] No results object found for detail chart: ${identifier}`);
            return;
        }

        // Create container and canvas
        const variationChartContainer = document.createElement('div');
        variationChartContainer.classList.add('p-4', 'border', 'rounded', 'bg-white', 'detail-chart-wrapper');
        const titleElement = document.createElement('h3');
        titleElement.textContent = `Details: ${identifier}`;
        titleElement.classList.add('text-lg', 'font-semibold', 'mb-2');
        variationChartContainer.appendChild(titleElement);
        const canvasElement = document.createElement('canvas');
        const canvasId = `detail-chart-${identifier.replace(/\W/g, '_')}`;
        canvasElement.id = canvasId;
        variationChartContainer.appendChild(canvasElement);
        detailContainer.appendChild(variationChartContainer);
        const detailCtx = canvasElement.getContext('2d');

        // Prepare datasets
        const detailDatasets = prepareDatasets(model, detailResultsData, labels);

        if (detailDatasets.length > 0) {
            console.log(`[DEBUG] Creating detail chart for variation: ${identifier}`);
            const detailChartInstance = createDetailChart(detailCtx, labels, detailDatasets);
            currentDetailCharts[identifier] = detailChartInstance;
        } else {
             console.warn(`[WARN] No data to plot for detail chart: ${identifier}`);
             variationChartContainer.remove(); 
        }
    });
    console.log(`[DEBUG] Generated ${Object.keys(currentDetailCharts).length} detail charts.`);

    // Return both chart instances
    return { comparisonChart: comparisonChartInstance, detailCharts: currentDetailCharts };
}

/**
 * Plots the results of a standard simulation run.
 * @param {Object} simOutput - The simulation output object { results: {...}, error: bool }.
 * @param {CanvasRenderingContext2D} ctx - Canvas context.
 * @param {HTMLElement} chartContainer - Chart container element.
 * @param {HTMLElement} placeholder - Placeholder element.
 * @param {Object} model - The parsed model definition for context.
 */
function plotSimulationResults(simOutput, ctx, chartContainer, placeholder, model) {
    console.log("[DEBUG] plotSimulationResults called with model:", !!model);
    
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    if (!simOutput || simOutput.error || !simOutput.results || !simOutput.results.time || simOutput.results.time.length === 0) {
        const errorMsg = simOutput?.results?.errors?.join('; ') || 'Simulation failed or produced no data.';
        console.error("[ERROR] Cannot plot simulation results:", errorMsg);
        showPlaceholder(placeholder, chartContainer, `Plotting failed: ${errorMsg}`);
        return { comparisonChart: null, detailCharts: {} };
    }

    const results = simOutput.results;
    const labels = results.time;
    const datasets = [];
    let colorIndex = 0;

    // Ensure model is available for context
    if (!model) {
        console.error("[ERROR] Model definition is required for plotSimulationResults heuristic.");
        showPlaceholder(placeholder, chartContainer, 'Plotting failed: Missing model context.');
        return { comparisonChart: null, detailCharts: {} };
    }

    // Use the passed model for context
    const dataSources = {
        stocks: Object.keys(results).filter(k => k !== 'time' && k !== 'errors' && k !== 'warnings' && !model.calcs?.[k] && !model.flows?.[k]),
        calcs: Object.keys(model.calcs || {})
    };

    // Heuristic using the passed model
    Object.keys(results).forEach(key => {
        if (key !== 'time' && key !== 'errors' && key !== 'warnings' && Array.isArray(results[key]) && results[key].length === labels.length) {
            const isStock = !model.calcs?.[key] && !model.flows?.[key]; // Use passed model
            datasets.push({
                label: key,
                data: results[key],
                borderColor: CHART_COLORS[colorIndex % CHART_COLORS.length],
                backgroundColor: CHART_COLORS[colorIndex % CHART_COLORS.length] + '33', // Add alpha
                fill: false,
                tension: 0.1,
                borderWidth: isStock ? 2 : 1, // Thicker lines for stocks
                pointRadius: 1,
                hidden: !isStock // Initially hide calcs/flows if needed
            });
            colorIndex++;
        }
    });

    if (datasets.length === 0) {
         showPlaceholder(placeholder, chartContainer, 'No variables found in results to plot.');
         return { comparisonChart: null, detailCharts: {} };
    }

    placeholder.classList.add('hidden');
    chartContainer.classList.remove('hidden');

    currentChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: 'Simulation Results' },
                legend: { display: true, position: 'top' },
                tooltip: { mode: 'index', intersect: false }
            },
            hover: { mode: 'nearest', intersect: true },
            scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Value' }, beginAtZero: false }
            },
            animation: {
                duration: 0 // Disable animation for performance
            }
        }
    });
    // Ensure placeholder is hidden and canvas is visible
    placeholder.classList.add('hidden');
    ctx.canvas.classList.remove('hidden'); // Remove hidden class
    ctx.canvas.style.display = ''; // Clear any inline style
    console.log("[DEBUG] Single run chart created successfully");
    return { comparisonChart: currentChart, detailCharts: {} };
}

/**
 * Plots the results of a parameter sweep.
 * @param {Object} sweepResults - Sweep results object from runParameterSweep.
 * @param {CanvasRenderingContext2D} ctx - Canvas context.
 * @param {HTMLElement} chartContainer - Chart container element.
 * @param {HTMLElement} placeholder - Placeholder element.
 * @param {Object} model - The *original* parsed model definition (used for context).
 */
function plotSweepResults(sweepResults, ctx, chartContainer, placeholder, model) {
    console.log("[DEBUG] plotSweepResults called with model:", !!model);

     if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    const { paramName, runs } = sweepResults;
    if (!runs || runs.length === 0) {
        showPlaceholder(placeholder, chartContainer, 'No sweep runs available to plot.');
        return { comparisonChart: null, detailCharts: {} };
    }

    // Find the first successful run to get time labels and variable names
    const firstGoodRun = runs.find(r => !r.simulationOutput.error && r.simulationOutput.results && r.simulationOutput.results.time);
    if (!firstGoodRun) {
        showPlaceholder(placeholder, chartContainer, 'No successful sweep runs to plot.');
        return { comparisonChart: null, detailCharts: {} };
    }

    const labels = firstGoodRun.simulationOutput.results.time;
    const datasets = [];
    let colorIndex = 0;

    // Determine which variables to plot (e.g., all stocks and maybe key calcs)
    const variablesToPlot = new Set();
     Object.keys(firstGoodRun.simulationOutput.results).forEach(key => {
        if (key !== 'time' && key !== 'errors' && key !== 'warnings' && Array.isArray(firstGoodRun.simulationOutput.results[key])) {
            // Use the original model passed in to check if it was defined as a stock or calc
            const isStock = model && model.stocks && model.stocks[key];
            const isCalc = model && model.calcs && model.calcs[key];
            // Decide what to plot - maybe all stocks and important calcs?
            // For now, plot everything found in results, maybe hide calcs later.
            variablesToPlot.add(key);
        }
    });
    console.log("[DEBUG] Variables to plot in sweep:", [...variablesToPlot]);


    variablesToPlot.forEach(varName => {
        runs.forEach((run, runIndex) => {
            const resultsData = run.simulationOutput?.results;
            if (resultsData && resultsData[varName] && resultsData[varName].length === labels.length) {
                 const paramValue = run.paramValue;
                 const color = CHART_COLORS[colorIndex % CHART_COLORS.length];
                 // Use different line styles or slightly vary color for different runs of the same variable
                 const dashPatterns = [ [], [5, 5], [10, 3], [3, 3], [15, 5, 5, 5] ];
                 const dash = dashPatterns[runIndex % dashPatterns.length];

                datasets.push({
                    label: `${varName} (${paramName}=${paramValue.toFixed ? paramValue.toFixed(2) : paramValue})`, // Format param value
                    data: resultsData[varName],
                    borderColor: color,
                    backgroundColor: color + '1A', // More transparent for sweeps
                    fill: false,
                    tension: 0.1,
                    borderWidth: 1.5,
                    pointRadius: 0, // No points for sweeps usually
                    borderDash: dash,
                    hidden: false // Show all sweep runs initially?
                });
            }
        });
        colorIndex++; // Change base color for each variable
    });

     if (datasets.length === 0) {
         showPlaceholder(placeholder, chartContainer, 'No data to plot from sweep runs.');
         return { comparisonChart: null, detailCharts: {} };
    }

    placeholder.classList.add('hidden');
    chartContainer.classList.remove('hidden');

    console.log(`[DEBUG] Creating sweep chart with ${datasets.length} datasets`);

    currentChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `Parameter Sweep Results (${paramName})` },
                legend: { display: true, position: 'top', labels: { boxWidth: 15, padding: 10 } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Value' }, beginAtZero: false }
            },
             animation: {
                duration: 0 // Disable animation
            }
        }
    });
    // Ensure placeholder is hidden and canvas is visible
    placeholder.classList.add('hidden');
    ctx.canvas.classList.remove('hidden'); // Remove hidden class
    ctx.canvas.style.display = ''; // Clear any inline style
    console.log("[DEBUG] Sweep chart created successfully");
    return { comparisonChart: currentChart, detailCharts: {} };
}

// Legacy plotting function (if needed, otherwise remove)
function plotABResults(resultsA, resultsB, param, values, ctx) {
     console.warn("[WARN] plotABResults is deprecated, use plotSweepResults.");
     // Basic implementation: Plot a key variable (e.g., first stock)
     const keyVar = Object.keys(resultsA.stocks)[0];
     if (!keyVar) return;

     if (currentChart) currentChart.destroy();

     currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: resultsA.time,
            datasets: [
                {
                    label: `${keyVar} (${param}=${values[0]})`,
                    data: resultsA.stocks[keyVar],
                    borderColor: CHART_COLORS[0],
                    fill: false
                },
                {
                    label: `${keyVar} (${param}=${values[1]})`,
                    data: resultsB.stocks[keyVar],
                    borderColor: CHART_COLORS[1],
                    fill: false
                }
            ]
        },
        options: { /* ... options ... */ }
     });
}

/**
 * Creates the main comparison chart.
 * @param {CanvasRenderingContext2D} ctx - The canvas context.
 * @param {string[]} labels - Time labels.
 * @param {object[]} datasets - Chart.js datasets.
 * @returns {Chart} The created Chart.js instance.
 */
function createComparisonChart(ctx, labels, datasets) {
    console.log(`[DEBUG] Creating comparison chart with ${datasets.length} datasets.`);
    const chart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: `Comparison Across Variations` }, // Generic title
                legend: { display: true, position: 'top' },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Value' }, beginAtZero: false }
            }
        }
    });
    return chart;
}

/**
 * Creates a detail chart for a single variation.
 * @param {CanvasRenderingContext2D} ctx - The canvas context.
 * @param {string[]} labels - Time labels.
 * @param {object[]} datasets - Chart.js datasets for this variation.
 * @returns {Chart} The created Chart.js instance.
 */
function createDetailChart(ctx, labels, datasets) {
    const chart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                 legend: { display: true, position: 'top' },
                 tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { title: { display: true, text: 'Time' } },
                y: { title: { display: true, text: 'Value' }, beginAtZero: false }
            }
        }
    });
    return chart;
}

export { plotResults, plotSimulationResults, plotSweepResults, plotABResults }; 