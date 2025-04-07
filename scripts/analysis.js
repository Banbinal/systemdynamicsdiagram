/**
 * Analysis Module for System Dynamics Tool v1.3
 * Implements result interpretation (single run and sweep)
 */

// --- Helper Functions ---

/**
 * Calculates basic metrics for a time series.
 * @param {Array<number>} timeSeries - Array of numerical values.
 * @param {Array<number>} timeData - Array of corresponding time points.
 * @returns {Object} Object with metrics (initial, final, min, max, avg).
 */
function calculateTimeSeriesMetrics(timeSeries, timeData) {
    if (!timeSeries || timeSeries.length === 0) {
        return { initial: NaN, final: NaN, min: NaN, max: NaN, avg: NaN };
    }
    // Ensure all values are numbers before calculation
    const finiteSeries = timeSeries.filter(v => isFinite(v));
    if (finiteSeries.length === 0) {
         return { initial: NaN, final: NaN, min: NaN, max: NaN, avg: NaN };
    }

    const metrics = {
        initial: isFinite(timeSeries[0]) ? timeSeries[0] : NaN,
        final: isFinite(timeSeries[timeSeries.length - 1]) ? timeSeries[timeSeries.length - 1] : NaN,
        min: Math.min(...finiteSeries),
        max: Math.max(...finiteSeries),
        avg: finiteSeries.reduce((sum, val) => sum + val, 0) / finiteSeries.length
    };
    return metrics;
}

/**
 * Detects simple patterns in a time series (e.g., growth, decay, oscillation).
 * Placeholder implementation - can be significantly enhanced.
 * @param {Array<number>} timeSeries - Array of numerical values.
 * @param {Array<number>} timeData - Array of corresponding time points.
 * @returns {Array<string>} Array of detected pattern descriptions.
 */
function detectPatterns(timeSeries, timeData) {
    if (!timeSeries || timeSeries.length < 3) {
        return ['Insufficient data'];
    }
    const patterns = [];
    const initial = timeSeries[0];
    const final = timeSeries[timeSeries.length - 1];

    if (!isFinite(initial) || !isFinite(final)) {
        return ['Invalid data'];
    }

    const netChange = final - initial;
    const significantChangeThreshold = Math.abs(initial) * 0.1 + 1e-6; // 10% change or small absolute value

    if (Math.abs(netChange) < significantChangeThreshold) {
        patterns.push('Stable');
    } else if (netChange > 0) {
        patterns.push('Growth');
    } else {
        patterns.push('Decay');
    }

    // Basic oscillation check (look for sign changes in difference)
    let signChanges = 0;
    for (let i = 2; i < timeSeries.length; i++) {
        const diff1 = timeSeries[i] - timeSeries[i-1];
        const diff2 = timeSeries[i-1] - timeSeries[i-2];
        if (Math.sign(diff1) !== 0 && Math.sign(diff2) !== 0 && Math.sign(diff1) !== Math.sign(diff2)) {
            signChanges++;
        }
    }
     // Consider it oscillating if there are at least 3 sign changes
    if (signChanges >= 3) {
        // Remove 'Stable/Growth/Decay' if oscillating
        const basicPatternIndex = patterns.findIndex(p => ['Stable', 'Growth', 'Decay'].includes(p));
        if (basicPatternIndex !== -1) patterns.splice(basicPatternIndex, 1);
        patterns.push('Oscillating');
    }


    // Add more sophisticated pattern detection (e.g., S-shaped, goal seeking) here later
    return patterns.length > 0 ? patterns : ['No clear pattern'];
}

/**
 * Performs simple linear regression.
 * @param {Array<number>} x - Independent variable values.
 * @param {Array<number>} y - Dependent variable values.
 * @returns {Object} Object containing slope, intercept, and rSquared.
 */
function simpleLinearRegression(x, y) {
    const n = x.length;
    if (n === 0 || n !== y.length) {
        return { slope: 0, intercept: 0, rSquared: 0 };
    }

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;

    for (let i = 0; i < n; i++) {
        // Ensure values are numbers
        const xi = Number(x[i]);
        const yi = Number(y[i]);
        if (!isFinite(xi) || !isFinite(yi)) {
             console.warn("[WARN] Non-finite value encountered in linear regression. Skipping point.");
             // Or handle differently? For now, skipping might skew results if common.
             // Alternative: return error state?
             return { slope: NaN, intercept: NaN, rSquared: NaN };
        }
        sumX += xi;
        sumY += yi;
        sumXY += xi * yi;
        sumXX += xi * xi;
        sumYY += yi * yi;
    }

    const denominator = (n * sumXX - sumX * sumX);
    if (Math.abs(denominator) < 1e-10) { // Avoid division by zero if all x are the same
        return { slope: 0, intercept: sumY / n, rSquared: 0 };
    }

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    const ssr = Math.pow((n * sumXY - sumX * sumY), 2) / denominator; // Regression sum of squares
    const sst = n * sumYY - sumY * sumY; // Total sum of squares
    const rSquared = Math.abs(sst) < 1e-10 ? 1 : ssr / sst; // Avoid division by zero for SST

    return { slope, intercept, rSquared };
}


// --- Analysis Entry Point ---

/**
 * Analyzes simulation results (potentially multiple variations) to extract insights.
 * @param {AllResults | Object} allResultsInput - The simulation results (new AllResults or older structure).
 * @param {Object} model - The original parsed model definition.
 * @returns {Object} - An analysis object containing metrics, patterns, insights.
 */
function analyzeSimulationResults(allResultsInput, model) {
    console.log("[DEBUG] analyzeSimulationResults received:", allResultsInput);
    let analysis = {
        type: 'unknown',
        summary: "Analysis could not be performed.",
        variations: {}, // Store per-variation analysis
        comparison: null // Store comparison insights if multiple variations
    };

    if (!allResultsInput) {
        analysis.summary = "Error: No simulation results provided for analysis.";
        return analysis;
    }

    let variationsToAnalyze = {};
    let isMultiVariation = false;
    let sourceDescription = "Unknown Source";

    // Adapt input: Check if it's the new AllResults structure
    if (allResultsInput.variations && typeof allResultsInput.variations === 'object') {
        variationsToAnalyze = allResultsInput.variations;
        isMultiVariation = Object.keys(variationsToAnalyze).length > 1;
        analysis.type = isMultiVariation ? 'multi_variation' : 'single_variation';
        sourceDescription = `Processed ${Object.keys(variationsToAnalyze).length} variations.`;
         if (allResultsInput.limitReached) {
             analysis.warning = `Analysis performed on the first ${Object.keys(variationsToAnalyze).length} variations due to limit.`;
         }
    } 
    // --- Handle older structures for backward compatibility? ---
    else if (allResultsInput.runs && Array.isArray(allResultsInput.runs)) { // Old Sweep
        analysis.type = 'multi_variation'; // Treat old sweep as multi-variation
        console.warn("[WARN] Analyzing legacy sweep structure.");
        sourceDescription = `Legacy Sweep: ${allResultsInput.paramName}`;
        allResultsInput.runs.forEach((run, index) => {
            // Ensure simulationOutput exists
            if (run.simulationOutput) {
                 const id = `${allResultsInput.paramName}=${run.paramValue}`;
                 variationsToAnalyze[id] = run.simulationOutput;
            } else {
                 console.warn(`[WARN] Missing simulationOutput for sweep run index ${index}, value ${run.paramValue}`);
            }
        });
         isMultiVariation = true;
    } else if (allResultsInput.baseRun) { // Old single run wrapped
        analysis.type = 'single_variation';
         console.warn("[WARN] Analyzing legacy baseRun structure.");
         sourceDescription = "Legacy Single Run (Wrapped)";
         // Ensure simulationOutput exists
         variationsToAnalyze['Baseline'] = allResultsInput.baseRun.simulationOutput || allResultsInput.baseRun;
    } else if (allResultsInput.results && allResultsInput.results.time) { // Old direct single run results
         analysis.type = 'single_variation';
         console.warn("[WARN] Analyzing legacy direct results structure.");
         sourceDescription = "Legacy Single Run (Direct)";
         // Wrap it to match expected structure { error: bool, results: {...} }
         variationsToAnalyze['Run'] = { error: false, results: allResultsInput.results }; 
    } else {
         analysis.summary = "Error: Unrecognized results structure for analysis.";
         console.error("[ERROR] Unrecognized results structure:", allResultsInput);
         return analysis;
    }
    
    // --- Perform Analysis --- 
    let overallSummary = [];
    let successfulRunCount = 0;
    const variationIdentifiers = Object.keys(variationsToAnalyze);

    console.log(`[DEBUG] Starting analysis loop for ${variationIdentifiers.length} variations.`);

    for (const identifier in allResultsInput.variations) {
        console.log(`[DEBUG] Analyzing variation: ${identifier}`);
        const variationEntry = allResultsInput.variations[identifier];
        let singleAnalysis = {};

        // Check if the variation itself had an error during simulation
        if (variationEntry.error || !variationEntry.results) {
            console.warn(`[WARN] Skipping analysis for failed/incomplete variation: ${identifier}`);
            singleAnalysis = {
                summary: `Analysis skipped: ${variationEntry.message || 'Simulation failed or produced no results.'}`, 
                metrics: {},
                patterns: {},
                limitEvents: {},
                equilibria: null,
                error: true 
            };
        } else {
            try {
                // Pass the actual simulation results (time, stocks, calcs)
                singleAnalysis = analyzeSingleRun(variationEntry.results, model);
                if (!singleAnalysis.error) successfulRunCount++;
            } catch (error) {
                console.error(`[ERROR] Error during single run analysis for ${identifier}:`, error);
                singleAnalysis = { 
                    summary: `Analysis failed: ${error.message}`,
                    metrics: {},
                    patterns: {},
                    limitEvents: {},
                    equilibria: null, 
                    error: true 
                };
            }
        }
        analysis.variations[identifier] = singleAnalysis;
        overallSummary.push(`Variation [${identifier}]: ${singleAnalysis.summary}`);
    }

    analysis.summary = `Analysis complete. ${successfulRunCount} of ${variationIdentifiers.length} variations analyzed successfully. Source: ${sourceDescription}.`;
    if (overallSummary.length > 0) {
         analysis.detailedSummary = overallSummary.join('\n');
    }

    // --- Add Comparison Logic (if multiple successful variations) ---
    if (isMultiVariation && successfulRunCount > 1) {
        console.log("[DEBUG] Performing comparison analysis...");
        try {
            analysis.comparison = compareVariations(analysis.variations, model);
            if (analysis.comparison && analysis.comparison.summary) {
                analysis.summary += " " + analysis.comparison.summary;
            }
        } catch (comparisonError) {
             console.error("[ERROR] Comparison analysis failed:", comparisonError);
             analysis.comparison = { error: true, summary: `Comparison failed: ${comparisonError.message}` };
             analysis.summary += " Comparison analysis encountered an error.";
        }
    }

    console.log("[DEBUG] Final Analysis Object:", analysis);
    return analysis;
}

/**
 * Analyzes a single simulation run's results.
 * @param {Object} results - The results data (time series for variables).
 * @param {Object} model - The model definition (for context).
 * @returns {Object} - Analysis for the single run.
 */
function analyzeSingleRun(results, model) {
    let singleAnalysis = {
        summary: "No significant patterns detected.",
        metrics: {},
        patterns: {},
        limitEvents: {}, // Added to store limit hit info
        equilibria: null,
        error: false
    };

    try {
        if (!results || !results.time || !results.stocks) { // Check for stocks object
             throw new Error("Results data, time array, or stocks object missing.");
        }
        const time = results.time;
        if (time.length < 2) {
             return { summary: "Insufficient time points for analysis.", metrics: {}, patterns: {}, error: false };
        }

        // Identify stock names present in results that are also defined in the model
        const stockNames = Object.keys(results.stocks)
                                .filter(k => model.stocks && model.stocks[k] !== undefined); 
                                
        if (stockNames.length === 0) {
            console.log("[DEBUG] Model stocks:", Object.keys(model.stocks || {}));
            console.log("[DEBUG] Results stocks keys:", Object.keys(results.stocks || {}));
            return { summary: "No stocks found in results that match stocks defined in the model.", metrics: {}, patterns: {}, error: false };
        }

        const dt = time[1] - time[0];
        const finalTime = time[time.length - 1];

        let overallBehavior = [];
        let equilibriumDetected = false;

        stockNames.forEach(stock => {
            const series = results.stocks[stock]; // Access data from results.stocks
            if (!series || series.length !== time.length) {
                console.warn(`[WARN] Data missing or length mismatch for stock '${stock}' in results.stocks. Skipping analysis for this stock.`);
                return; 
            }

            const metrics = calculateTimeSeriesMetrics(series, time);
            singleAnalysis.metrics[stock] = metrics;

            const patterns = detectPatterns(series, time);
            singleAnalysis.patterns[stock] = patterns;

            // Check for limit events
            if (model.limits && model.limits[stock]) {
                const limits = model.limits[stock];
                let firstMinHitTime = null;
                let firstMaxHitTime = null;
                const tolerance = 1e-9; // Tolerance for floating point comparison

                for (let i = 0; i < series.length; i++) {
                    // Check min limit
                    if (firstMinHitTime === null && limits.min !== undefined && Math.abs(series[i] - limits.min) < tolerance) {
                        firstMinHitTime = time[i];
                    }
                    // Check max limit
                    if (firstMaxHitTime === null && limits.max !== undefined && Math.abs(series[i] - limits.max) < tolerance) {
                        firstMaxHitTime = time[i];
                    }
                    // Stop searching if both found
                    if (firstMinHitTime !== null && firstMaxHitTime !== null) break;
                    // Optimization: if only one limit exists, stop when found
                    if (limits.min !== undefined && limits.max === undefined && firstMinHitTime !== null) break;
                    if (limits.max !== undefined && limits.min === undefined && firstMaxHitTime !== null) break;
                }

                if (firstMinHitTime !== null || firstMaxHitTime !== null) {
                    singleAnalysis.limitEvents[stock] = {};
                    if (firstMinHitTime !== null) {
                        singleAnalysis.limitEvents[stock].min = { value: limits.min, time: firstMinHitTime };
                    }
                    if (firstMaxHitTime !== null) {
                        singleAnalysis.limitEvents[stock].max = { value: limits.max, time: firstMaxHitTime };
                    }
                }
            }

            // Basic summary based on metrics and patterns
            let netChange = (metrics.final - metrics.initial);
            let behavior = `${stock}: Start=${metrics.initial.toFixed(2)}, End=${metrics.final.toFixed(2)}, Change=${netChange.toFixed(2)}.`; // Recalculate netChange here for clarity
            
            // Check patterns using the detected patterns array
            if (patterns.includes('Stable')) { 
                behavior += ` Reached equilibrium.`;
                equilibriumDetected = true;
            } else if (patterns.includes('Growth')) {
                behavior += ` Exhibited growth.`;
            } else if (patterns.includes('Decay')) {
                 behavior += ` Exhibited decay.`;
            }
            if (patterns.includes('Oscillating')) behavior += " Showed oscillations.";
            
            overallBehavior.push(behavior);
        });

        if (overallBehavior.length > 0) {
             singleAnalysis.summary = overallBehavior.join(' ');
        } else {
             singleAnalysis.summary = "Analysis could not be performed on any stocks (data mismatch?).";
        }
        if (equilibriumDetected) {
            singleAnalysis.equilibria = "System potentially reached equilibrium.";
        }

    } catch (error) {
        console.error("[ERROR] Error during single run analysis:", error);
        singleAnalysis.summary = `Analysis failed: ${error.message}`;
        singleAnalysis.error = true;
    }

    return singleAnalysis;
}

/**
 * Compares analysis results across multiple variations.
 * @param {Object.<string, Object>} variationAnalyses - Map from identifier to single run analysis.
 * @param {Object} model - The original model definition.
 * @returns {Object} - Comparison insights.
 */
function compareVariations(variationAnalyses, model) {
    let comparison = {
        summary: "Comparison analysis performed.",
        keyDifferences: [],
        trends: [], 
        patternChanges: [], 
        limitTimingHighlights: [], // Added for limit timing
        error: false
    };
    
    try {
        const successfulAnalysesEntries = Object.entries(variationAnalyses).filter(([id, analysis]) => analysis && !analysis.error);

        if (successfulAnalysesEntries.length < 2) {
            comparison.summary = "Insufficient successful variations for comparison.";
            return comparison;
        }

        // Attempt to identify sweep parameters from identifiers
        let sweepInfo = identifySweepParameters(successfulAnalysesEntries);

        // --- Key Differences (Final Values) --- (Keep existing logic)
        const stockNames = model.stocks ? Object.keys(model.stocks) : [];
        if (stockNames.length > 0) {
        stockNames.forEach(stock => {
                let minFinal = Infinity, maxFinal = -Infinity, minId = null, maxId = null, validValuesCount = 0;
                let variationData = []; // Store {id, value, patterns} for later analysis

                successfulAnalysesEntries.forEach(([id, varAnalysis]) => {
                    if (varAnalysis.metrics && varAnalysis.metrics[stock] && typeof varAnalysis.metrics[stock].final === 'number') {
                        const finalVal = varAnalysis.metrics[stock].final;
                    if (finalVal < minFinal) { minFinal = finalVal; minId = id; }
                    if (finalVal > maxFinal) { maxFinal = finalVal; maxId = id; }
                    validValuesCount++;
                        // Store data needed for pattern change analysis
                        variationData.push({ id: id, value: finalVal, patterns: varAnalysis.patterns?.[stock] || [] });
                } else {
                     console.warn(`[WARN] Missing metrics or final value for stock '${stock}' in variation '${id}' during comparison.`);
                }
            });

                if (validValuesCount >= 2 && minId && maxId && Math.abs(maxFinal - minFinal) > 1e-6) { 
                comparison.keyDifferences.push(
                    `${stock}: Final value ranged from ${minFinal.toFixed(2)} [${minId}] to ${maxFinal.toFixed(2)} [${maxId}].`
                );
            } else if (validValuesCount < 2) {
                console.log(`[DEBUG] Insufficient valid data points (<2) to compare final values for stock '${stock}'.`);
                }
                
                // --- Pattern Change Analysis for this stock ---
                if (validValuesCount >= 2) {
                    analyzePatternChanges(stock, variationData, comparison.patternChanges);
                }
            });
        } else {
             // If no stocks, maybe compare calcs?
        }

        // --- Trend Analysis (if sweep detected) ---
        if (sweepInfo.sweepDetected && stockNames.length > 0) {
             console.log(`[DEBUG] Analyzing trends for sweep parameter: ${sweepInfo.paramName}`);
             stockNames.forEach(stock => {
                 analyzeSweepTrend(stock, sweepInfo, successfulAnalysesEntries, comparison.trends);
             });
        }

        // --- Limit Timing Comparison --- 
        if (stockNames.length > 0) {
            stockNames.forEach(stock => {
                if (!(model.limits && model.limits[stock])) return; // Skip if no limits for this stock
                
                const limits = model.limits[stock];
                let minHitTimes = [];
                let maxHitTimes = [];

                successfulAnalysesEntries.forEach(([id, varAnalysis]) => {
                    const events = varAnalysis.limitEvents?.[stock];
                    if (events?.min?.time !== undefined) {
                        minHitTimes.push({ id: id, time: events.min.time });
                    }
                    if (events?.max?.time !== undefined) {
                        maxHitTimes.push({ id: id, time: events.max.time });
                    }
                });

                // Analyze Min Limit Hits
                if (limits.min !== undefined && minHitTimes.length >= 2) {
                    minHitTimes.sort((a, b) => a.time - b.time);
                    const earliest = minHitTimes[0];
                    const latest = minHitTimes[minHitTimes.length - 1];
                    if (Math.abs(earliest.time - latest.time) > 1e-6) { // Check if times actually differ
                        comparison.limitTimingHighlights.push(
                            `${stock} hit min limit (${limits.min}) earliest at t=${earliest.time.toFixed(2)} [${earliest.id}] and latest at t=${latest.time.toFixed(2)} [${latest.id}].`
                        );
                    } else if (minHitTimes.length === successfulAnalysesEntries.length) {
                         // comparison.limitTimingHighlights.push(`${stock} hit min limit (${limits.min}) at approximately the same time (t=${earliest.time.toFixed(2)}) across all variations.`);
                    }
                } else if (limits.min !== undefined && minHitTimes.length === 1) {
                     comparison.limitTimingHighlights.push(`${stock} hit min limit (${limits.min}) only in variation [${minHitTimes[0].id}] at t=${minHitTimes[0].time.toFixed(2)}.`);
                }
                
                // Analyze Max Limit Hits (similar logic)
                if (limits.max !== undefined && maxHitTimes.length >= 2) {
                     maxHitTimes.sort((a, b) => a.time - b.time);
                     const earliest = maxHitTimes[0];
                     const latest = maxHitTimes[maxHitTimes.length - 1];
                     if (Math.abs(earliest.time - latest.time) > 1e-6) {
                         comparison.limitTimingHighlights.push(
                             `${stock} hit max limit (${limits.max}) earliest at t=${earliest.time.toFixed(2)} [${earliest.id}] and latest at t=${latest.time.toFixed(2)} [${latest.id}].`
                         );
                     } 
                 } else if (limits.max !== undefined && maxHitTimes.length === 1) {
                      comparison.limitTimingHighlights.push(`${stock} hit max limit (${limits.max}) only in variation [${maxHitTimes[0].id}] at t=${maxHitTimes[0].time.toFixed(2)}.`);
                 }
            });
        }

        // --- Refine Overall Summary --- 
        let summaryParts = [];
        if (comparison.keyDifferences.length > 0) summaryParts.push("Key differences observed in final stock values.");
        if (comparison.trends.length > 0) summaryParts.push("Trends identified based on swept parameter.");
        if (comparison.patternChanges.length > 0) summaryParts.push("Changes in behavior patterns observed.");
        if (comparison.limitTimingHighlights.length > 0) summaryParts.push("Differences in limit hitting times observed."); // Added
        
        if (summaryParts.length > 0) {
            comparison.summary = summaryParts.join(' ');
        } else {
            comparison.summary = "No significant differences, trends, or pattern changes identified across variations.";
        }

    } catch(error) {
         console.error("[ERROR] Error during comparison analysis:", error);
         comparison.summary = `Comparison analysis failed: ${error.message}`;
         comparison.error = true;
    }
    return comparison;
}

// --- New Helper Functions for Comparison ---

/** Parses variation IDs to find if a single parameter sweep was likely run */
function identifySweepParameters(successfulAnalysesEntries) {
    let potentialParams = {};
    let baseIdentifier = null;
    const identifierRegex = /^(.*?)\s*\(([^=]+)=([^\)]+)\)$/; // Matches "Base (Param=Value)"

    for (const [id] of successfulAnalysesEntries) {
        const match = id.match(identifierRegex);
        if (match) {
            const [, base, param, valueStr] = match;
            const value = parseFloat(valueStr);
            if (!isNaN(value)) {
                if (baseIdentifier === null) baseIdentifier = base;
                if (base !== baseIdentifier) return { sweepDetected: false }; // Mixed base names

                if (!potentialParams[param]) potentialParams[param] = new Set();
                potentialParams[param].add(value);
            } else { return { sweepDetected: false }; } // Non-numeric sweep value?
        } else {
            // Allow one non-parameterized ID (like 'Baseline') if others are sweeps
            if (successfulAnalysesEntries.length > 1 && !baseIdentifier) { 
                baseIdentifier = id;
            } else if (id !== baseIdentifier) {
                 return { sweepDetected: false }; // Mix of non-sweep and sweep, or multiple baselines
            }
        }
    }
    
    const sweptParams = Object.keys(potentialParams);
    if (sweptParams.length === 1 && potentialParams[sweptParams[0]].size >= 2) {
         // Found a single parameter swept over multiple values
         const paramName = sweptParams[0];
         const values = Array.from(potentialParams[paramName]).sort((a, b) => a - b);
         return { sweepDetected: true, paramName: paramName, values: values, baseIdentifier: baseIdentifier };
    }

    return { sweepDetected: false }; // No single parameter sweep detected
}

/** Analyzes trend of a variable based on sweep parameter values */
function analyzeSweepTrend(variableName, sweepInfo, successfulAnalysesEntries, trendsArray) {
    const xValues = []; // Sweep parameter values
    const yValues = []; // Corresponding final variable values

    // Map variation ID back to sweep value
    const idValueMap = new Map();
    // Corrected Regex construction
    const pattern = `^${sweepInfo.baseIdentifier}\s*\\(${sweepInfo.paramName}=([^\\)]+)\\)$`;
    const identifierRegex = new RegExp(pattern); 
    
    sweepInfo.values.forEach(val => {
         // Construct likely ID (might need refinement if baseIdentifier is complex)
         // This assumes format like "Baseline (Param=Value)"
         const targetId = `${sweepInfo.baseIdentifier} (${sweepInfo.paramName}=${val})`; 
         idValueMap.set(targetId, val);
         // Also check if baseIdentifier itself corresponds to a sweep value (e.g., baseline run is one of the sweeps)
         if (sweepInfo.baseIdentifier === targetId) idValueMap.set(sweepInfo.baseIdentifier, val);
    });
     // Handle case where baseline might be one of the sweep values but not explicitly named
     if (!idValueMap.has(sweepInfo.baseIdentifier) && successfulAnalysesEntries.some(([id]) => id === sweepInfo.baseIdentifier)){
        // Find which sweep value the baseline corresponds to (tricky without more info)
        // For now, skip baseline if its value isn't obvious from the naming convention
     }

    successfulAnalysesEntries.forEach(([id, varAnalysis]) => {
        if (idValueMap.has(id) && varAnalysis.metrics?.[variableName]?.final !== undefined) {
            const sweepValue = idValueMap.get(id);
            const finalValue = varAnalysis.metrics[variableName].final;
            if (!isNaN(sweepValue) && !isNaN(finalValue)) {
                 xValues.push(sweepValue);
                 yValues.push(finalValue);
            }
        }
    });

    if (xValues.length < 3) {
        // Not enough data points for regression
        if (xValues.length === 2) {
             const slope = (yValues[1] - yValues[0]) / (xValues[1] - xValues[0]);
             if (Math.abs(slope) > 1e-6) { // Check if slope is non-negligible
                  trendsArray.push(`${variableName} ${slope > 0 ? 'increased' : 'decreased'} as ${sweepInfo.paramName} increased (from ${xValues[0]} to ${xValues[1]}).`);
             }
        }
        return;
    }

    // Perform linear regression
    const regression = simpleLinearRegression(xValues, yValues);
    if (regression && !isNaN(regression.slope) && Math.abs(regression.slope) > 1e-6 && regression.rSquared > 0.5) {
        trendsArray.push(
            `${variableName} showed a ${regression.slope > 0 ? 'positive' : 'negative'} trend with increasing ${sweepInfo.paramName} (Slope: ${regression.slope.toFixed(2)}, R²: ${regression.rSquared.toFixed(2)}).`
        );
    } else if (regression && !isNaN(regression.slope)) {
        console.log(`[DEBUG] Trend for ${variableName} vs ${sweepInfo.paramName} not strong/linear (Slope: ${regression.slope.toFixed(2)}, R²: ${regression.rSquared.toFixed(2)}).`);
    }
}

/** Analyzes changes in detected patterns across variations */
function analyzePatternChanges(variableName, variationData, patternChangesArray) {
    if (variationData.length < 2) return;

    const firstPatterns = new Set(variationData[0].patterns);
    let changed = false;
    let changeDescription = [];

    for (let i = 1; i < variationData.length; i++) {
        const currentPatterns = new Set(variationData[i].patterns);
        if (firstPatterns.size !== currentPatterns.size || ![...firstPatterns].every(p => currentPatterns.has(p))) {
            changed = true;
            changeDescription.push(`behavior changed between [${variationData[0].id}] (${[...firstPatterns].join(', ')}) and [${variationData[i].id}] (${[...currentPatterns].join(', ')}).`);
            // Break after finding the first change for simplicity, or collect all changes?
            break; 
        }
    }

    if (changed) {
        patternChangesArray.push(`${variableName}: ${changeDescription[0]}`);
    }
}


// --- Display Entry Point ---

/**
 * Displays the interpretation of the analysis results.
 * @param {Object} analysis - The analysis object from analyzeSimulationResults.
 * @param {HTMLElement} targetElement - The HTML element to display the interpretation in.
 * @param {Object} model - The original parsed model definition.
 * @param {Array} lastLoops - Array of loop objects found in the model.
 */
function displayInterpretation(analysis, targetElement, model, lastLoops) {
    if (!analysis || !targetElement) {
        console.error("Missing analysis or target element for displayInterpretation");
        if (targetElement) targetElement.innerHTML = '<p class="text-red-500">Error: Cannot display interpretation (missing data).</p>';
        return;
    }

    let html = '';

    try {
        // Display overall summary and warnings
        html += `<h3 class="text-lg font-semibold mb-2">Analysis Summary</h3>`;
        html += `<p class="mb-2">${analysis.summary || "No summary available."}</p>`;
        if (analysis.warning) {
            html += `<p class="text-orange-600 mb-2">Warning: ${analysis.warning}</p>`;
        }

        // Display comparison results if available and successful
        if (analysis.comparison && !analysis.comparison.error) {
            html += `<h4 class="text-md font-semibold mt-3 mb-1">Comparison Highlights</h4>`;
            if (analysis.comparison.keyDifferences && analysis.comparison.keyDifferences.length > 0) {
                html += `<h5 class="text-sm font-semibold mt-2 mb-1">Key Differences:</h5>`;
                html += `<ul class="list-disc list-inside mb-2 text-sm">`;
                analysis.comparison.keyDifferences.forEach(diff => { html += `<li>${diff}</li>`; });
                html += `</ul>`;
            }
             if (analysis.comparison.trends && analysis.comparison.trends.length > 0) {
                html += `<h5 class="text-sm font-semibold mt-2 mb-1">Parameter Trends:</h5>`;
                html += `<ul class="list-disc list-inside mb-2 text-sm">`;
                analysis.comparison.trends.forEach(trend => { html += `<li>${trend}</li>`; });
                html += `</ul>`;
            }
             if (analysis.comparison.patternChanges && analysis.comparison.patternChanges.length > 0) {
                html += `<h5 class="text-sm font-semibold mt-2 mb-1">Pattern Changes:</h5>`;
                html += `<ul class="list-disc list-inside mb-2 text-sm">`;
                analysis.comparison.patternChanges.forEach(change => { html += `<li>${change}</li>`; });
                html += `</ul>`;
            }

            // Add limit timing highlights
            if (analysis.comparison.limitTimingHighlights && analysis.comparison.limitTimingHighlights.length > 0) {
                html += `<h5 class="text-sm font-semibold mt-2 mb-1">Limit Event Timing:</h5>`;
                html += `<ul class="list-disc list-inside mb-2 text-sm">`;
                analysis.comparison.limitTimingHighlights.forEach(hit => { html += `<li>${hit}</li>`; });
            html += `</ul>`;
            }

            // Calculate how many comparison sections were actually added
            const comparisonHighlightsCount = 
                (analysis.comparison.keyDifferences?.length || 0) +
                (analysis.comparison.trends?.length || 0) +
                (analysis.comparison.patternChanges?.length || 0) +
                (analysis.comparison.limitTimingHighlights?.length || 0); // Added limit highlights count

            // Add message if no specific highlights found but comparison was done
            if (comparisonHighlightsCount === 0) { 
                 html += `<p class="text-sm text-gray-600 mb-2">${analysis.comparison.summary || "Comparison analysis performed, but no specific highlights detected."}</p>`;
            }
        } else if (analysis.comparison && analysis.comparison.error) {
             html += `<p class="text-red-500 mb-2">Comparison analysis failed: ${analysis.comparison.summary}</p>`;
        }

        // Display details for each variation
        html += `<h4 class="text-md font-semibold mt-3 mb-1">Variation Details</h4>`;
        const variationIds = analysis.variations ? Object.keys(analysis.variations) : [];
        if (variationIds.length > 0) {
            html += `<ul class="list-disc list-inside space-y-1">`;
            variationIds.forEach(id => {
                const varAnalysis = analysis.variations[id];
                let detailHtml = `<li><strong>[${id}]</strong>: `;
                if (!varAnalysis) {
                     detailHtml += `<span class="text-gray-500">No analysis data found.</span></li>`;
                } else if (varAnalysis.error) {
                    detailHtml += `<span class="text-red-500">Failed: ${varAnalysis.summary || 'Unknown error'}</span></li>`;
                } else {
                    detailHtml += `${varAnalysis.summary || "No details."}`;
                    // Add limit event details
                    if (varAnalysis.limitEvents) {
                        const events = [];
                        Object.entries(varAnalysis.limitEvents).forEach(([stock, limitsHit]) => {
                            if (limitsHit.min) events.push(`${stock} hit min (${limitsHit.min.value}) at t=${limitsHit.min.time.toFixed(2)}`);
                            if (limitsHit.max) events.push(`${stock} hit max (${limitsHit.max.value}) at t=${limitsHit.max.time.toFixed(2)}`);
                        });
                        if (events.length > 0) {
                            detailHtml += ` (${events.join('; ')}).`;
                        }
                    }
                    detailHtml += `</li>`;
                }
                html += detailHtml;
            });
            html += `</ul>`;
        } else {
            html += `<p>No variation details available.</p>`;
        }

        // Display loop interpretation if loops were found
        if (lastLoops && lastLoops.length > 0) {
            html += `<h4 class="text-md font-semibold mt-3 mb-1">Feedback Loops</h4>`;
            html += `<ul class="list-disc list-inside space-y-1">`;
            lastLoops.forEach((loop, index) => {
                const explanation = explainLoop(loop, model); // Will use the stub for now
                html += `<li>Loop ${index + 1}: ${explanation}</li>`;
            });
            html += `</ul>`;
        }

    } catch (displayError) {
         console.error("[ERROR] Failed to render interpretation HTML:", displayError);
         html = `<p class="text-red-500">Error displaying interpretation: ${displayError.message}</p>`;
    }

    targetElement.innerHTML = html;
}


// --- Feedback Loop Analysis --- 

/**
 * Builds the influence graph from the model.
 * @param {Object} model - The parsed model.
 * @returns {Object} Adjacency list: { nodeName: [ { target: targetName, linkPolarity: polarity } ], ... }
 */
function buildInfluenceGraph(model) {
    const graph = {};
    const allNodes = new Set([
        ...Object.keys(model.stocks || {}),
        ...Object.keys(model.flows || {}),
        ...Object.keys(model.calcs || {}),
        ...Object.keys(model.constants || {})
    ]);

    // Initialize graph with all nodes
    allNodes.forEach(node => graph[node] = []);

    // Add edges based on model.influences (generated during compileExpressions)
    if (model.influences) {
        for (const target in model.influences) {
            if (!graph[target]) graph[target] = []; // Ensure target node exists
            for (const source in model.influences[target]) {
                if (!graph[source]) graph[source] = []; // Ensure source node exists
                const polarity = model.influences[target][source]; // Polarity: '+', '-', '?'
                // Add edge: source -> target
                graph[source].push({ target: target, linkPolarity: polarity });
                // console.log(`[Graph] Edge: ${source} -> ${target} (${polarity})`);
            }
        }
    }
    
    // Add edges for Flow -> Stock connections (explicit structural polarity)
    if (model.flows) {
        for (const flowName in model.flows) {
            if (!graph[flowName]) graph[flowName] = [];
            model.flows[flowName].effects.forEach(effect => {
                if (!graph[effect.target]) graph[effect.target] = [];
                // Polarity from flow effect arrow (using simulation logic: --> is -, -+> is +)
                const polarity = effect.polarity === '-->' ? '-' : '+'; 
                // Add edge: flowName -> targetStock
                graph[flowName].push({ target: effect.target, linkPolarity: polarity });
                 // console.log(`[Graph] Edge (Flow): ${flowName} -> ${effect.target} (${polarity})`);
            });
        }
    }

    // Remove nodes with no connections? Optional.
    return graph;
}

/**
 * Finds all elementary cycles in a directed graph using DFS.
 * @param {Object} graph - Adjacency list.
 * @returns {Array} Array of cycles, where each cycle is { nodes: [String], polarities: [String], overallPolarity: String }
 */
function findCycles(graph) {
    const cycles = [];
    const path = [];
    const pathEdges = [];
    const onStack = new Set();
    const visited = new Set(); // Keep track of nodes globally visited to start DFS

    function dfs(node) {
        path.push(node);
        onStack.add(node);

        if (graph[node]) {
            for (const edge of graph[node]) {
                const neighbor = edge.target;
                if (onStack.has(neighbor)) {
                    // Cycle detected
                    const cycleStartIndex = path.indexOf(neighbor);
                    if (cycleStartIndex !== -1) {
                        const cycleNodes = path.slice(cycleStartIndex);
                        // Get polarities for the edges in this cycle
                        const cyclePolarities = [];
                        const currentPathEdges = pathEdges.slice(cycleStartIndex);
                        currentPathEdges.push(edge.linkPolarity);
                         // Edge from last node back to first node in cycleNodes
                         const closingEdge = graph[cycleNodes[cycleNodes.length - 1]]?.find(e => e.target === cycleNodes[0]);
                         const closingPolarity = closingEdge ? closingEdge.linkPolarity : '?';
                         cyclePolarities.push(...currentPathEdges.map(p => p || '?')); // Use 'p || \'?'\' to handle undefined/null
                         // Find the actual edge polarity for the closing link - this needs refinement, use edge info directly?
                        // Let's reconstruct polarities more carefully based on the actual cycle path edges
                        const finalCyclePolarities = [];
                        let polarityUncertain = false;
                        let negativeCount = 0;
                        for (let i = 0; i < cycleNodes.length; i++) {
                            const u = cycleNodes[i];
                            const v = cycleNodes[(i + 1) % cycleNodes.length]; // Next node in cycle
                            const cycleEdge = graph[u]?.find(e => e.target === v);
                            const linkPolarity = cycleEdge ? cycleEdge.linkPolarity : '?';
                            finalCyclePolarities.push(linkPolarity);
                            if (linkPolarity === '-') {
                                negativeCount++;
                            }
                            if (linkPolarity === '?') {
                                polarityUncertain = true;
                            }
                        }

                        let overallPolarity = '?';
                        if (!polarityUncertain) {
                            overallPolarity = (negativeCount % 2 === 0) ? 'R' : 'B';
                        }
                        
                        cycles.push({ 
                            nodes: cycleNodes, 
                            polarities: finalCyclePolarities, 
                            overallPolarity: overallPolarity 
                        });
                    }
                } else if (!visited.has(neighbor)) {
                     pathEdges.push(edge.linkPolarity); // Store polarity as we traverse
                     dfs(neighbor);
                     pathEdges.pop(); // Backtrack edge polarity
                }
            }
        }

        path.pop();
        onStack.delete(node);
    }

    for (const node in graph) {
        if (!visited.has(node)) {
            // Clear path/stack for new DFS tree, but keep global visited set?
            // Resetting path/stack implicitly handled by recursion start/end
            // Visited set needs care - maybe we need to allow revisiting if part of a different path?
            // For elementary cycles, once a node is fully explored from a starting point, we might not need to start DFS from it again.
            // Let's stick to basic DFS for now. If we miss cycles, refine visited logic.
             dfs(node);
             // Mark node as fully explored *after* its DFS completes
             // This simple approach might miss cycles if not starting from the right node.
             // A more robust approach (e.g., Johnson's algorithm or Tarjan's) is complex.
             // Let's try marking visited *after* full exploration from that root.
             visited.add(node); // Add to global visited only after exploring all paths from it
        }
    }
    
    // Filter out duplicate cycles (can happen with simple DFS)
    const uniqueCycles = [];
    const seenCycles = new Set();
    cycles.forEach(cycle => {
        // Create a canonical representation (e.g., sorted node string)
        const canonical = [...cycle.nodes].sort().join('->');
        if (!seenCycles.has(canonical)) {
            uniqueCycles.push(cycle);
            seenCycles.add(canonical);
        }
    });

    return uniqueCycles;
}

/**
 * Find feedback loops in the model (Replaces Stub).
 * @param {Object} model - The model definition
 * @returns {Array} - Array of feedback loop objects found
 */
function findFeedbackLoops(model) {
    console.log("[INFO] Finding feedback loops using graph analysis.");
    try {
        const graph = buildInfluenceGraph(model);
        const cycles = findCycles(graph);
        console.log(`[INFO] Found ${cycles.length} unique feedback loops.`);
        return cycles;
    } catch (error) {
        console.error("[ERROR] Failed to find feedback loops:", error);
        return []; // Return empty array on error
    }
}

/**
 * Generates a human-readable explanation of a feedback loop (Replaces Stub).
 * @param {Object} loop - The loop object { nodes: [], polarities: [], overallPolarity: 'R'|'B'|'?' }
 * @param {Object} model - The model definition for context
 * @returns {String} - Human-readable explanation
 */
function explainLoop(loop, model) {
    if (!loop || !loop.nodes || loop.nodes.length === 0) {
        return "Invalid loop data.";
    }
    const polarityText = loop.overallPolarity === 'R' ? 'Reinforcing' : (loop.overallPolarity === 'B' ? 'Balancing' : 'Uncertain polarity');
    // Create a string showing the path with polarities
    let pathString = loop.nodes[0];
    for (let i = 0; i < loop.nodes.length; i++) {
        const nextNodeIndex = (i + 1) % loop.nodes.length;
        const polarity = loop.polarities[i] || '?';
        pathString += ` --(${polarity})--> ${loop.nodes[nextNodeIndex]}`;
    }
    // return `A ${polarityText} loop involving: ${loop.nodes.join(' -> ')}.`;
    return `(${polarityText}) ${pathString}`;
}


// --- Exports ---
// Ensure the main displayInterpretation function is exported
export {
    analyzeSimulationResults, // Main entry point for analysis
    displayInterpretation, // Main entry point for display
    findFeedbackLoops, // Keep loop finding if needed elsewhere
    explainLoop // Keep loop explanation if needed elsewhere
}; 