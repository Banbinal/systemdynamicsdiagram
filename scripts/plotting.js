/**
 * Plotting Module for System Dynamics Tool
 * Implements Chart.js visualizations for simulation results
 */

/**
 * Plots standard simulation results with Chart.js
 * @param {Object} results - Simulation results
 * @param {Object} model - The model definition
 * @returns {Object|null} - Chart instance or null if plot fails
 */
function plotResults(results, model) {
    if (!results || !results.time || results.time.length === 0) {
        console.warn("Plot skip: No results.");
        return null;
    }
    
    const datasets = [];
    const stockColors = ['#1d4ed8', '#c2410c', '#15803d', '#a16207', '#7e22ce', '#be185d'];
    const auxColors = ['#60a5fa', '#fdba74', '#86efac', '#fde047', '#d8b4fe', '#fda4af'];
    let stockColorIndex = 0;
    let auxColorIndex = 0;

    let timeDecimalPlaces = 0;
    if (model.simSettings.dt > 0 && model.simSettings.dt < 1) { 
        const ds = model.simSettings.dt.toString().split('.')[1]; 
        timeDecimalPlaces = ds ? ds.length + 1 : 1; 
    } else if (model.simSettings.dt !== 1) { 
        timeDecimalPlaces = 1; 
    } 
    timeDecimalPlaces = Math.min(timeDecimalPlaces, 4);
    const timeLabels = results.time.map(t => t.toFixed(timeDecimalPlaces));

    // Add stock datasets
    for (const stockName in results.stocks) {
        if (results.stocks[stockName]?.length === timeLabels.length) {
            datasets.push({
                label: stockName, 
                data: results.stocks[stockName],
                borderColor: stockColors[stockColorIndex % stockColors.length], 
                tension: 0.1, 
                borderWidth: 2.5, 
                pointRadius: timeLabels.length > 100 ? 0 : 2, 
                pointHoverRadius: 4, 
                fill: false, 
                yAxisID: 'yPrimary'
            });
            stockColorIndex++;
        } else { 
            console.warn(`Plot Warn: Stock '${stockName}' length mismatch.`); 
        }
    }

    // Add auxiliary datasets
    const hasAuxData = Object.keys(results.auxiliaries || {}).length > 0 && 
                      Object.values(results.auxiliaries).some(arr => arr?.length === timeLabels.length);
    
    if (hasAuxData) {
        for (const auxName in results.auxiliaries) {
            if (results.auxiliaries[auxName]?.length === timeLabels.length) {
                datasets.push({
                    label: auxName, 
                    data: results.auxiliaries[auxName],
                    borderColor: auxColors[auxColorIndex % auxColors.length], 
                    tension: 0.1, 
                    borderWidth: 1.5, 
                    pointRadius: 0, 
                    pointHoverRadius: 4, 
                    fill: false, 
                    hidden: true, // Hide auxiliaries by default
                    yAxisID: 'ySecondary'
                });
                auxColorIndex++;
            } else { 
                console.warn(`Plot Warn: Aux '${auxName}' length mismatch.`); 
            }
        }
    }

    if (datasets.length === 0) { 
        console.warn("Plot skip: No data."); 
        return null; 
    }

    const scalesConfig = { 
        x: { 
            title: { display: true, text: 'Time' }, 
            ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 15 } 
        }, 
        yPrimary: { 
            type: 'linear', 
            display: true, 
            position: 'left', 
            title: { display: true, text: 'Stock Values' }, 
            beginAtZero: true, 
            grid: { drawOnChartArea: true } 
        } 
    };
    
    if (hasAuxData) { 
        scalesConfig.ySecondary = { 
            type: 'linear', 
            display: true, 
            position: 'right', 
            title: { display: true, text: 'Auxiliary Values' }, 
            grid: { drawOnChartArea: false }, 
            beginAtZero: false 
        }; 
    }

    // Set up chart configuration
    const chartConfig = {
        type: 'line',
        data: { labels: timeLabels, datasets: datasets },
        options: {
            responsive: true, 
            maintainAspectRatio: false, 
            scales: scalesConfig,
            plugins: {
                title: { display: true, text: 'Simulation Results' },
                tooltip: { 
                    mode: 'index', 
                    intersect: false, 
                    callbacks: { 
                        label: (ctx) => `${ctx.dataset.label || ''}: ${ctx.parsed.y?.toLocaleString(undefined,{maximumFractionDigits:4})||'N/A'}` 
                    } 
                },
                legend: { position: 'top' }
            },
            animation: { duration: 300 }, 
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    };

    return chartConfig;
}

/**
 * Plots A/B test simulation results comparatively
 * @param {Object} abResults - A/B test results containing scenarios A and B
 * @param {Object} model - The model definition
 * @returns {Object|null} - Chart configuration or null if plot fails
 */
function plotABResults(abResults, model) {
    if (!abResults || !model || !abResults.A?.time || !abResults.B?.time || abResults.A.time.length === 0) {
        console.warn("Plot A/B skip: No results.");
        return null;
    }
    
    const datasets = [];
    const stockColors = ['#1d4ed8', '#c2410c', '#15803d', '#a16207', '#7e22ce', '#be185d']; // Paired colors might be better
    const auxColors = ['#60a5fa', '#fdba74', '#86efac', '#fde047', '#d8b4fe', '#fda4af'];
    let stockColorIndex = 0;
    let auxColorIndex = 0;

    let timeDecimalPlaces = 0;
    if (model.simSettings.dt > 0 && model.simSettings.dt < 1) { 
        const ds = model.simSettings.dt.toString().split('.')[1]; 
        timeDecimalPlaces = ds ? ds.length + 1 : 1; 
    } else if (model.simSettings.dt !== 1) { 
        timeDecimalPlaces = 1; 
    } 
    timeDecimalPlaces = Math.min(timeDecimalPlaces, 4);
    const timeLabels = abResults.A.time.map(t => t.toFixed(timeDecimalPlaces)); // Assume times are the same

    const paramName = abResults.paramName;
    const valueA = abResults.values[0];
    const valueB = abResults.values[1];

    // Plot Stocks for A and B
    for (const stockName in abResults.A.stocks) {
        if (abResults.A.stocks[stockName]?.length === timeLabels.length && abResults.B.stocks[stockName]?.length === timeLabels.length) {
            const color = stockColors[stockColorIndex % stockColors.length];
            datasets.push({
                label: `${stockName} (A: ${valueA})`, 
                data: abResults.A.stocks[stockName],
                borderColor: color, 
                tension: 0.1, 
                borderWidth: 2.5, 
                pointRadius: timeLabels.length > 100 ? 0 : 2, 
                pointHoverRadius: 4, 
                fill: false, 
                yAxisID: 'yPrimary'
            });
            datasets.push({
                label: `${stockName} (B: ${valueB})`, 
                data: abResults.B.stocks[stockName],
                borderColor: color, 
                borderDash: [5, 5], 
                tension: 0.1, 
                borderWidth: 2.5, 
                pointRadius: timeLabels.length > 100 ? 0 : 2, 
                pointHoverRadius: 4, 
                fill: false, 
                yAxisID: 'yPrimary'
            });
            stockColorIndex++;
        } else { 
            console.warn(`Plot A/B Warn: Stock '${stockName}' length mismatch.`); 
        }
    }

    // Plot Auxiliaries for A and B (optional, check if data exists)
    const hasAuxA = Object.keys(abResults.A.auxiliaries || {}).length > 0 && Object.values(abResults.A.auxiliaries).some(arr => arr?.length === timeLabels.length);
    const hasAuxB = Object.keys(abResults.B.auxiliaries || {}).length > 0 && Object.values(abResults.B.auxiliaries).some(arr => arr?.length === timeLabels.length);
    const hasAuxData = hasAuxA && hasAuxB;

    if (hasAuxData) {
        for (const auxName in abResults.A.auxiliaries) {
            if (abResults.A.auxiliaries[auxName]?.length === timeLabels.length && abResults.B.auxiliaries[auxName]?.length === timeLabels.length) {
                const color = auxColors[auxColorIndex % auxColors.length];
                datasets.push({
                    label: `${auxName} (A: ${valueA})`, 
                    data: abResults.A.auxiliaries[auxName],
                    borderColor: color, 
                    tension: 0.1, 
                    borderWidth: 1.5, 
                    pointRadius: 0, 
                    pointHoverRadius: 4, 
                    fill: false, 
                    hidden: true, // Hide by default
                    yAxisID: 'ySecondary'
                });
                datasets.push({
                    label: `${auxName} (B: ${valueB})`, 
                    data: abResults.B.auxiliaries[auxName],
                    borderColor: color, 
                    borderDash: [5, 5], 
                    tension: 0.1, 
                    borderWidth: 1.5, 
                    pointRadius: 0, 
                    pointHoverRadius: 4, 
                    fill: false, 
                    hidden: true, // Hide by default
                    yAxisID: 'ySecondary'
                });
                auxColorIndex++;
            } else { 
                console.warn(`Plot A/B Warn: Aux '${auxName}' length mismatch.`); 
            }
        }
    }

    if (datasets.length === 0) { 
        console.warn("Plot A/B skip: No data."); 
        return null; 
    }

    const scalesConfig = { 
        x: { 
            title: { display: true, text: 'Time' }, 
            ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 15 } 
        }, 
        yPrimary: { 
            type: 'linear', 
            display: true, 
            position: 'left', 
            title: { display: true, text: 'Stock Values' }, 
            beginAtZero: true, 
            grid: { drawOnChartArea: true } 
        } 
    };
    if (hasAuxData) { 
        scalesConfig.ySecondary = { 
            type: 'linear', 
            display: true, 
            position: 'right', 
            title: { display: true, text: 'Auxiliary Values' }, 
            grid: { drawOnChartArea: false }, 
            beginAtZero: false 
        }; 
    }

    // Set up chart configuration
    const chartConfig = {
        type: 'line',
        data: { labels: timeLabels, datasets: datasets },
        options: {
            responsive: true, 
            maintainAspectRatio: false, 
            scales: scalesConfig,
            plugins: {
                title: { display: true, text: `A/B Test Results for ${paramName}` },
                tooltip: { 
                    mode: 'index', 
                    intersect: false, 
                    callbacks: { 
                        label: (ctx) => `${ctx.dataset.label || ''}: ${ctx.parsed.y?.toLocaleString(undefined,{maximumFractionDigits:4})||'N/A'}` 
                    } 
                },
                legend: { position: 'top' }
            },
            animation: { duration: 300 }, 
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    };

    return chartConfig;
}

export { plotResults, plotABResults }; 