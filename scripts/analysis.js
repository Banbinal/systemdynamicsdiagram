/**
 * Analysis Module for System Dynamics Tool
 * Implements result interpretation and feedback loop analysis
 */

/**
 * Interprets simulation results to detect patterns and behaviors
 * @param {Object} results - Simulation results
 * @param {Object} model - The model definition
 * @returns {Object} - Analysis results with metrics and patterns
 */
function interpretSimulationResults(results, model) {
    if (!results || !results.time || results.time.length === 0) {
        return {};
    }
    
    const analysis = {};
    
    // Analyze each stock variable
    for (const stockName in results.stocks) {
        if (!results.stocks[stockName] || results.stocks[stockName].length === 0) continue;
        
        const values = results.stocks[stockName];
        
        // Calculate basic metrics
        const initial = values[0];
        const final = values[values.length - 1];
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
        const netChange = final - initial;
        const percentChange = initial !== 0 ? ((final - initial) / Math.abs(initial)) * 100 : (final > 0 ? 100 : final < 0 ? -100 : 0);
        
        // Detect patterns
        const patterns = [];
        
        // Check if stable
        const isStable = Math.abs(netChange) < Math.abs(initial) * 0.05; // Less than 5% change
        if (isStable) {
            patterns.push('Stable');
        }
        
        // Check for growth or decay
        const growthPoints = values.filter((v, i) => i > 0 && v > values[i-1]).length;
        const decayPoints = values.filter((v, i) => i > 0 && v < values[i-1]).length;
        const constantPoints = values.filter((v, i) => i > 0 && v === values[i-1]).length;
        
        const growthPct = growthPoints / (values.length - 1);
        const decayPct = decayPoints / (values.length - 1);
        const constantPct = constantPoints / (values.length - 1);
        
        if (growthPct > 0.7) {
            patterns.push('Growing');
            
            // Check if exponential or linear growth
            // Simple heuristic: if second half grows faster than first half
            const halfIdx = Math.floor(values.length / 2);
            const firstHalfChange = values[halfIdx] - values[0];
            const secondHalfChange = values[values.length - 1] - values[halfIdx];
            
            if (secondHalfChange > firstHalfChange * 1.5 && secondHalfChange > 0) {
                patterns.push('Exponential');
            } else if (firstHalfChange > 0) {
                patterns.push('Linear');
            }
        } else if (decayPct > 0.7) {
            patterns.push('Decaying');
            
            // Check if exponential decay
            const halfIdx = Math.floor(values.length / 2);
            const firstHalfChange = values[0] - values[halfIdx];
            const secondHalfChange = values[halfIdx] - values[values.length - 1];
            
            if (firstHalfChange > 0 && secondHalfChange > 0 && firstHalfChange > secondHalfChange * 1.5) {
                patterns.push('Exponential');
            }
        } else if (constantPct > 0.7) {
            patterns.push('Constant');
        }
        
        // Look for oscillations
        const diffValues = [];
        for (let i = 1; i < values.length; i++) {
            diffValues.push(values[i] - values[i-1]);
        }
        
        // Check for sign changes in the differences
        let signChanges = 0;
        for (let i = 1; i < diffValues.length; i++) {
            if ((diffValues[i] > 0 && diffValues[i-1] < 0) || (diffValues[i] < 0 && diffValues[i-1] > 0)) {
                signChanges++;
            }
        }
        
        const oscillationRatio = signChanges / (diffValues.length - 1);
        if (oscillationRatio > 0.2 && signChanges >= 3) {
            patterns.push('Oscillating');
            
            // Check for damping
            const peaks = [];
            const troughs = [];
            for (let i = 1; i < values.length - 1; i++) {
                if (values[i] > values[i-1] && values[i] > values[i+1]) {
                    peaks.push({ idx: i, value: values[i] });
                } else if (values[i] < values[i-1] && values[i] < values[i+1]) {
                    troughs.push({ idx: i, value: values[i] });
                }
            }
            
            if (peaks.length >= 2) {
                const peakRatios = [];
                for (let i = 1; i < peaks.length; i++) {
                    if (peaks[i-1].value !== 0) {
                        peakRatios.push(peaks[i].value / peaks[i-1].value);
                    }
                }
                
                const avgPeakRatio = peakRatios.reduce((sum, val) => sum + val, 0) / peakRatios.length;
                if (avgPeakRatio < 0.95) {
                    patterns.push('Damped');
                } else if (avgPeakRatio > 1.05) {
                    patterns.push('Amplifying');
                } else {
                    patterns.push('Sustained');
                }
            }
        }
        
        // Look for S-Shaped (Logistic) growth
        if (netChange > 0 && values.length > 10) {
            // Calculate first and second derivatives
            const firstDeriv = [];
            for (let i = 1; i < values.length; i++) {
                firstDeriv.push(values[i] - values[i-1]);
            }
            
            const secondDeriv = [];
            for (let i = 1; i < firstDeriv.length; i++) {
                secondDeriv.push(firstDeriv[i] - firstDeriv[i-1]);
            }
            
            // S-curve has initially increasing then decreasing first derivative
            const maxDerivIdx = firstDeriv.indexOf(Math.max(...firstDeriv));
            const relativeMaxPos = maxDerivIdx / firstDeriv.length;
            
            if (relativeMaxPos > 0.2 && relativeMaxPos < 0.8) {
                // Check if first derivative rises then falls
                const firstSection = firstDeriv.slice(0, maxDerivIdx);
                const secondSection = firstDeriv.slice(maxDerivIdx);
                
                const firstSectionRising = firstSection.length > 3 && firstSection[firstSection.length-1] > firstSection[0];
                const secondSectionFalling = secondSection.length > 3 && secondSection[secondSection.length-1] < secondSection[0];
                
                if (firstSectionRising && secondSectionFalling) {
                    patterns.push('S-Shaped');
                }
            }
        }
        
        // Look for goal-seeking behavior
        if (isStable && !patterns.includes('Constant')) {
            patterns.push('Goal-Seeking');
        }
        
        analysis[stockName] = {
            metrics: { initial, final, min, max, avg, netChange, percentChange },
            patterns: patterns
        };
    }
    
    return analysis;
}

/**
 * Find feedback loops in the model
 * @param {Object} model - The model definition
 * @returns {Array} - Array of feedback loops found
 */
function findFeedbackLoops(model) {
    if (!model) return [];
    
    // Build a directed graph representation
    const graph = {};
    const allNodes = new Set([
        ...Object.keys(model.stocks || {}).filter(n => !n.startsWith('_smooth_') && !n.startsWith('_delay3_')),
        ...Object.keys(model.flows || {}),
        ...Object.keys(model.auxiliaries || {}),
        ...Object.keys(model.params || {}),
        ...Object.keys(model.graphs || {})
    ]);
    
    // Add edges from influences
    for (const target in model.influences) {
        if (!allNodes.has(target)) continue;
        
        for (const source in model.influences[target]) {
            if (!allNodes.has(source)) continue;
            
            if (!graph[source]) graph[source] = [];
            if (!graph[source].includes(target)) {
                graph[source].push(target);
            }
        }
    }
    
    // Add connections between flows and stocks
    (model.connections || []).forEach(conn => {
        if (model.flows[conn.flow] && model.stocks[conn.stock]) {
            if (conn.direction === 'in') {
                // Flow adds to stock: Flow -> Stock
                const source = conn.flow;
                const target = conn.stock;
                if(!graph[source]) graph[source] = [];
                if (!graph[source].includes(target)) {
                    graph[source].push(target);
                }
            } else {
                // Flow drains from stock: 
                // 1. Stock -> Flow (stock influences flow)
                const source1 = conn.stock;
                const target1 = conn.flow;
                if (!graph[source1]) graph[source1] = [];
                if (!graph[source1].includes(target1)) {
                    graph[source1].push(target1);
                }
                
                // 2. Flow -> Stock (flow influences stock)
                const source2 = conn.flow;
                const target2 = conn.stock;
                if (!graph[source2]) graph[source2] = [];
                if (!graph[source2].includes(target2)) {
                    graph[source2].push(target2);
                }
            }
        }
    });
    
    // Find loops using DFS
    const loops = [];
    const uniqueLoopKeys = new Set();
    
    function dfs(path, node) {
        // If we've seen this node before in our path, we found a loop
        const pathIndex = path.indexOf(node);
        if (pathIndex !== -1) {
            // Extract just the loop part
            const loop = path.slice(pathIndex);
            
            // Only consider loops with more than 1 node (skip self-loops)
            if (loop.length > 1) {
                // Create a canonical representation to deduplicate
                const sortedLoop = [...loop].sort().join(',');
                if (!uniqueLoopKeys.has(sortedLoop)) {
                    loops.push(loop);
                    uniqueLoopKeys.add(sortedLoop);
                }
            }
            return;
        }
        
        // Stop if node isn't in the graph or path gets too long
        if (!graph[node] || path.length > allNodes.size + 2) {
            return;
        }
        
        // Continue DFS
        path.push(node);
        for (const neighbor of graph[node]) {
            dfs([...path], neighbor);
        }
    }
    
    // Search for loops from each node
    for (const node of allNodes) {
        if (graph[node]) {
            dfs([], node);
        }
    }
    
    // Filter loops to prioritize meaningful stock-flow loops
    // and ignore trivial self-loops or ones that are too complex
    return loops.filter(loop => 
        loop.length >= 2 && loop.length <= 10 &&
        // At least one element should be a stock or flow
        loop.some(node => model.stocks[node] || model.flows[node])
    );
}

/**
 * Generates a human-readable explanation of a feedback loop
 * @param {Object} loop - The loop object with nodes, edges, and polarity
 * @param {Object} model - The model definition for context
 * @returns {String} - Human-readable explanation
 */
function explainLoop(loop, model) {
    if (!loop || !Array.isArray(loop) || loop.length === 0) {
        return "Invalid loop data";
    }
    
    // Determine if this is a balancing or reinforcing loop
    let negativeCount = 0;
    let ambiguous = false;
    
    // Check each link in the loop for its polarity
    for (let i = 0; i < loop.length; i++) {
        const from = loop[i];
        const to = loop[(i + 1) % loop.length]; // Wrap around to first element
        let polarity = '?';
        
        // Check influence relationships
        if (model.influences && model.influences[to] && model.influences[to][from] !== undefined) {
            polarity = model.influences[to][from];
        } else {
            // Check connections (flow-stock relationships)
            const flowToStock = model.connections.find(c => 
                c.flow === from && c.stock === to && c.direction === 'in'
            );
            
            const stockToFlow = model.connections.find(c => 
                c.flow === to && c.stock === from && c.direction === 'out'
            );
            
            const flowDrainsStock = model.connections.find(c => 
                c.flow === from && c.stock === to && c.direction === 'out'
            );
            
            if (flowToStock) polarity = '+';
            else if (stockToFlow) polarity = '+';
            else if (flowDrainsStock) polarity = '-';
        }
        
        if (polarity === '-') negativeCount++;
        if (polarity === '?') ambiguous = true;
    }
    
    // Determine loop type based on number of negative links
    let type = ambiguous ? '? (Ambiguous)' : (negativeCount % 2 === 0) ? 'Reinforcing (R)' : 'Balancing (B)';
    
    // Generate the explanation
    const loopStr = loop.join(' → ');
    let explanation = `Loop detected: ${loopStr}. Type: ${type}.`;
    
    // Add additional context about the loop type
    if (!ambiguous) {
        if (type.includes('Reinforcing')) {
            explanation += " Reinforcing loops amplify change, leading to exponential growth or collapse.";
        } else {
            explanation += " Balancing loops seek equilibrium and resist change, often leading to goal-seeking behavior.";
        }
    } else {
        explanation += " The loop contains ambiguous links; its overall behavior cannot be automatically determined.";
    }
    
    return explanation;
}

/**
 * Displays interpretation for a standard simulation
 * @param {Object} model - The model definition
 * @param {Object} analysis - Analysis results
 * @param {Array} loops - Feedback loops found
 */
function displayInterpretation(model, analysis, loops) {
    let html = '<div class="interpretation-container">';
    
    // ----- MODEL SUMMARY SECTION -----
    html += '<div class="interpretation-section">';
    html += '<h2 class="section-heading">Variable Summary</h2>';
    
    // Stocks
    if (Object.keys(model.stocks).length > 0) { 
        html += '<h3 class="subsection-heading">Stocks:</h3>'; 
        html += '<ul class="variable-list">';
        for (const name in model.stocks) { 
            if (name.startsWith('_smooth_') || name.startsWith('_delay3_')) continue; 
            html += `<li><code>${name}</code> (Initial: ${model.stocks[name].initialValue})</li>`; 
        }
        html += '</ul>';
    }
    
    // Parameters
    if (Object.keys(model.params).length > 0) { 
        html += '<h3 class="subsection-heading">Parameters:</h3>'; 
        html += '<ul class="variable-list">';
        for (const name in model.params) { 
            html += `<li><code>${name}</code> = ${model.params[name]}</li>`; 
        }
        html += '</ul>';
    }
    
    // Auxiliaries
    if (Object.keys(model.auxiliaries).length > 0) { 
        html += '<h3 class="subsection-heading">Auxiliaries:</h3>'; 
        html += '<ul class="variable-list">';
        for (const name in model.auxiliaries) { 
            html += `<li><code>${name}</code> = ${model.auxiliaries[name].equation.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`; 
        }
        html += '</ul>';
    }
    
    // Flows
    if (Object.keys(model.flows).length > 0) { 
        html += '<h3 class="subsection-heading">Flows:</h3>'; 
        html += '<ul class="variable-list">';
        for (const name in model.flows) { 
            html += `<li><code>${name}</code> = ${model.flows[name].equation.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`; 
        }
        html += '</ul>';
    }
    
    // Graphs
    if (Object.keys(model.graphs).length > 0) { 
        html += '<h3 class="subsection-heading">Graphs:</h3>'; 
        html += '<ul class="variable-list">';
        for (const name in model.graphs) { 
            html += `<li><code>${name}</code> defined</li>`; 
        }
        html += '</ul>';
    }
    html += '</div>'; // End of Variable Summary section
    
    // ----- SIMULATION INSIGHTS SECTION -----
    html += '<div class="interpretation-section">';
    html += '<h2 class="section-heading">Simulation Insights</h2>';
    
    if (!analysis || Object.keys(analysis).length === 0) {
        html += '<p>No specific behavioral patterns detected for stocks.</p>';
    } else {
        html += '<ul class="insights-list">';
        for (const stockName in analysis) {
            const stockAnalysis = analysis[stockName];
            html += `<li><strong>${stockName}:</strong> `;
            html += `Initial: ${stockAnalysis.metrics.initial?.toFixed(2)}, `;
            html += `Final: ${stockAnalysis.metrics.final?.toFixed(2)}, `;
            html += `Min: ${stockAnalysis.metrics.min?.toFixed(2)}, `;
            html += `Max: ${stockAnalysis.metrics.max?.toFixed(2)}. `;
            
            if (stockAnalysis.patterns.length > 0) {
                html += `<span class="behavior-patterns">Behavior: ${stockAnalysis.patterns.join(', ')}.</span>`;
            } else {
                html += `<span class="behavior-patterns">Behavior: No distinct pattern detected.</span>`;
            }
            
            html += `</li>`;
        }
        html += '</ul>';
    }
    html += '</div>'; // End of Simulation Insights section
    
    // ----- FEEDBACK LOOPS SECTION -----
    html += '<div class="interpretation-section">';
    html += '<h2 class="section-heading">Feedback Loop Analysis</h2>';
    
    if (loops && loops.length > 0) {
        html += '<ul class="loops-list">';
        // Display top 10 loops at most (to avoid overwhelming)
        const loopsToDisplay = loops.slice(0, 10);
        loopsToDisplay.forEach(loop => {
            const explanation = explainLoop(loop, model);
            html += `<li>${explanation.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`;
        });
        if (loops.length > loopsToDisplay.length) {
            html += `<li class="additional-loops">... (${loops.length - loopsToDisplay.length} more loops detected)</li>`;
        }
        html += '</ul>';
    } else {
        html += '<p>No significant feedback loops detected (or polarity analysis was ambiguous).</p>';
    }
    html += '</div>'; // End of Feedback Loop Analysis section
    
    html += '</div>'; // End of interpretation-container
    
    // Add CSS styles for the interpretation sections
    html += `
    <style>
        .interpretation-container {
            font-family: sans-serif;
            line-height: 1.5;
            color: #333;
        }
        .interpretation-section {
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid #eee;
        }
        .section-heading {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 1rem;
            color: #2563eb;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #bfdbfe;
        }
        .subsection-heading {
            font-size: 1.2rem;
            font-weight: 600;
            margin-top: 1rem;
            margin-bottom: 0.5rem;
            color: #4b5563;
        }
        .variable-list {
            list-style-type: none;
            padding-left: 1.5rem;
            margin-top: 0.5rem;
        }
        .variable-list li {
            margin-bottom: 0.3rem;
        }
        .insights-list li {
            margin-bottom: 0.8rem;
            padding-left: 0.5rem;
            border-left: 3px solid #93c5fd;
            padding: 0.5rem;
            background-color: #f8fafc;
        }
        .behavior-patterns {
            font-weight: 500;
            color: #1e40af;
        }
        .loops-list li {
            margin-bottom: 1rem;
            padding: 0.8rem;
            background-color: #f0f9ff;
            border-left: 3px solid #38bdf8;
            border-radius: 0 4px 4px 0;
        }
        code {
            font-family: monospace;
            background-color: #f1f5f9;
            padding: 0.1rem 0.3rem;
            border-radius: 0.25rem;
            font-size: 0.9em;
        }
        strong {
            font-weight: 600;
            color: #1e3a8a;
        }
        .additional-loops {
            font-style: italic;
            color: #64748b;
        }
    </style>`;
    
    // Set the interpretation content
    document.getElementById('interpretationContent').innerHTML = html;
}

/**
 * Displays interpretation for A/B test results
 * @param {Object} abResults - A/B test results containing scenarios A and B
 * @param {Object} model - The model definition
 */
function displayABInterpretation(abResults, model) {
    const interpretationContent = document.getElementById('interpretationContent');
    
    if (!abResults || !model) {
        interpretationContent.innerHTML = '<p class="text-red-500">Error displaying A/B interpretation.</p>';
        return;
    }

    const paramName = abResults.paramName;
    const valueA = abResults.values[0];
    const valueB = abResults.values[1];

    // Perform analysis for both scenarios
    const analysisA = interpretSimulationResults(abResults.A, model);
    const analysisB = interpretSimulationResults(abResults.B, model);
    const loops = findFeedbackLoops(model); // Loops are based on structure, use original model

    // --- Helper to generate HTML for one scenario ---
    const generateScenarioHtml = (scenarioLabel, value, analysis, baseModel, loopData) => {
        let html = `
        <div class="interpretation-section">
            <h2 class="scenario-heading">Scenario ${scenarioLabel}: ${baseModel.abTest.paramName} = ${value}</h2>
            
            <div class="subsection">
                <h3 class="subsection-heading">Simulation Insights</h3>`;
        
        if (!analysis || Object.keys(analysis).length === 0) { 
            html += '<p>No specific behavioral patterns detected for stocks.</p>'; 
        } else { 
            html += '<ul class="insights-list">'; 
            for (const stockName in analysis) { 
                const stockAnalysis = analysis[stockName]; 
                html += `<li><strong>${stockName}:</strong> `; 
                html += `Initial: ${stockAnalysis.metrics.initial?.toFixed(2)}, `; 
                html += `Final: ${stockAnalysis.metrics.final?.toFixed(2)}, `; 
                html += `Min: ${stockAnalysis.metrics.min?.toFixed(2)}, `; 
                html += `Max: ${stockAnalysis.metrics.max?.toFixed(2)}. `; 
                if (stockAnalysis.patterns.length > 0) { 
                    html += `<span class="behavior-patterns">Behavior: ${stockAnalysis.patterns.join(', ')}.</span>`; 
                } else { 
                    html += `<span class="behavior-patterns">Behavior: No distinct pattern detected.</span>`; 
                } 
                html += `</li>`; 
            } 
            html += '</ul>'; 
        }
        html += '</div>';

        html += `
            <div class="subsection">
                <h3 class="subsection-heading">Feedback Loop Analysis (Same for both scenarios)</h3>`;
        if (loopData && loopData.length > 0) { 
            html += '<ul class="loops-list">'; 
            const loopsToDisplay = loopData.slice(0, 10); 
            loopsToDisplay.forEach(loop => { 
                const explanation = explainLoop(loop, baseModel); 
                html += `<li>${explanation.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</li>`; 
            }); 
            if (loopData.length > loopsToDisplay.length) { 
                html += `<li class="additional-loops">... (${loopData.length - loopsToDisplay.length} more loops detected)</li>`; 
            } 
            html += '</ul>'; 
        } else { 
            html += '<p>No significant feedback loops detected (or polarity analysis was ambiguous).</p>'; 
        }
        html += '</div></div>';
        return html;
    };

    // --- Build UI ---
    let html = '<div class="interpretation-container">';
    
    // Controls for A/B scenarios
    html += `
        <div class="ab-controls-section">
            <button id="showInterpA" class="ab-btn active">Show Scenario A (${paramName}=${valueA})</button>
            <button id="showInterpB" class="ab-btn">Show Scenario B (${paramName}=${valueB})</button>
        </div>
        <div id="interpretationContainerA" class="ab-interp-container active">
            ${generateScenarioHtml('A', valueA, analysisA, model, loops)}
        </div>
        <div id="interpretationContainerB" class="ab-interp-container">
            ${generateScenarioHtml('B', valueB, analysisB, model, loops)}
        </div>
    `;
    
    // Add CSS styles for the interpretation sections
    html += `
    <style>
        .interpretation-container {
            font-family: sans-serif;
            line-height: 1.5;
            color: #333;
        }
        .ab-controls-section {
            margin-bottom: 1.5rem;
            padding: 0.75rem;
            background-color: #f8fafc;
            border-radius: 8px;
            display: flex;
            gap: 0.75rem;
        }
        .ab-btn {
            padding: 0.5rem 1rem;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            background-color: #f1f5f9;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.95rem;
            transition: all 0.2s ease;
        }
        .ab-btn:hover {
            background-color: #e2e8f0;
        }
        .ab-btn.active {
            background-color: #3b82f6;
            color: white;
            border-color: #2563eb;
        }
        .ab-interp-container {
            display: none;
        }
        .ab-interp-container.active {
            display: block;
        }
        .interpretation-section {
            margin-bottom: 2rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid #eee;
        }
        .scenario-heading {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 1.5rem;
            color: #1e40af;
            padding-bottom: 0.5rem;
            border-bottom: 2px solid #93c5fd;
        }
        .subsection {
            margin-bottom: 1.5rem;
        }
        .subsection-heading {
            font-size: 1.2rem;
            font-weight: 600;
            margin-top: 1rem;
            margin-bottom: 0.75rem;
            color: #4b5563;
        }
        .insights-list li {
            margin-bottom: 0.8rem;
            padding-left: 0.5rem;
            border-left: 3px solid #93c5fd;
            padding: 0.5rem;
            background-color: #f8fafc;
        }
        .behavior-patterns {
            font-weight: 500;
            color: #1e40af;
        }
        .loops-list li {
            margin-bottom: 1rem;
            padding: 0.8rem;
            background-color: #f0f9ff;
            border-left: 3px solid #38bdf8;
            border-radius: 0 4px 4px 0;
        }
        code {
            font-family: monospace;
            background-color: #f1f5f9;
            padding: 0.1rem 0.3rem;
            border-radius: 0.25rem;
            font-size: 0.9em;
        }
        strong {
            font-weight: 600;
            color: #1e3a8a;
        }
        .additional-loops {
            font-style: italic;
            color: #64748b;
        }
    </style>`;
    
    interpretationContent.innerHTML = html;

    // --- Add Event Listeners ---
    const btnA = document.getElementById('showInterpA');
    const btnB = document.getElementById('showInterpB');
    const containerA = document.getElementById('interpretationContainerA');
    const containerB = document.getElementById('interpretationContainerB');

    btnA.addEventListener('click', () => {
        containerA.classList.add('active');
        containerB.classList.remove('active');
        btnA.classList.add('active');
        btnB.classList.remove('active');
    });
    btnB.addEventListener('click', () => {
        containerB.classList.add('active');
        containerA.classList.remove('active');
        btnB.classList.add('active');
        btnA.classList.remove('active');
    });
}

export { 
    interpretSimulationResults, 
    findFeedbackLoops,
    explainLoop,
    displayInterpretation,
    displayABInterpretation
}; 