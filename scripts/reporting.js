/**
 * Reporting Module for System Dynamics Tool
 * Handles report generation in HTML and PDF formats
 */

/**
 * Generates a report based on the current model, results and analysis
 * @param {Object} model - The model object
 * @param {Object} results - Simulation results (standard or A/B)
 * @param {Object} analysis - Analysis of the results
 * @param {Array} loops - Feedback loops
 * @param {String} dslCode - Original DSL code
 * @param {Object} options - Report options (sections to include)
 * @param {Object} chartImages - Optional object containing base64 chart images {comparison: string, details: {id: string}}
 * @returns {String} - HTML content for the report
 */
function generateReport(model, results, analysis, loops, dslCode, options, chartImages) {
    if (!model) return '<p>No valid model to generate report from.</p>';
    
    const hasABResults = results && results.A && results.B;
    const modelTitle = model?.title || 'System Dynamics Report';
    
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${modelTitle} - Report</title>
    <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; margin: 0; padding: 20px; }
        .container { max-width: 210mm; margin: 0 auto; }
        h1 { color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 10px; }
        h2 { color: #3498db; margin-top: 20px; }
        h3 { color: #2980b9; }
        table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        table, th, td { border: 1px solid #ddd; }
        th, td { padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .footer { margin-top: 30px; font-size: 0.8em; color: #7f8c8d; text-align: center; }
        pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
        .chart-container { margin: 20px 0; text-align: center; }
        .chart-container img { max-width: 100%; height: auto; }
        .timestamp { font-size: 0.8em; color: #7f8c8d; text-align: right; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${modelTitle}</h1>
        <p class="timestamp">Generated: ${new Date().toLocaleString()}</p>`;
    
    // Add model overview
    html += `<h2>Model Overview</h2>`;
    
    // Defensive checks: Ensure properties exist and are objects
    const stocks = model?.stocks && typeof model.stocks === 'object' ? model.stocks : {};
    const flows = model?.flows && typeof model.flows === 'object' ? model.flows : {};
    const auxiliaries = model?.auxiliaries && typeof model.auxiliaries === 'object' ? model.auxiliaries : {};
    const params = model?.params && typeof model.params === 'object' ? model.params : {};
    const simSettings = model?.simSettings && typeof model.simSettings === 'object' ? model.simSettings : {};
    
    const startTime = simSettings?.startTime ?? 'N/A';
    const endTime = simSettings?.endTime ?? 'N/A';
    const dt = simSettings?.dt ?? 'N/A';
    
    const stockCount = Object.keys(stocks).filter(s => !s.startsWith('_smooth_') && !s.startsWith('_delay3_')).length;
    const flowCount = Object.keys(flows).length;
    const auxCount = Object.keys(auxiliaries).length;
    const paramCount = Object.keys(params).length;
    
    html += `<p>This model contains ${stockCount} stocks, ${flowCount} flows, ${auxCount} auxiliaries, and ${paramCount} parameters.</p>`;
    html += `<p>Simulation period: ${startTime} to ${endTime} (dt=${dt})</p>`;
    
    if (model?.abTest) { // Also check abTest existence
        html += `<p>This model includes an A/B test comparing different values of <strong>${model.abTest.paramName}</strong>: ${model.abTest.values[0]} vs ${model.abTest.values[1]}</p>`;
    }
    
    // Model variables and equations (optional)
    if (options?.includeModelSummary) {
        html += `<h2>Model Variables & Equations</h2>`;
        
        // Stocks
        if (stockCount > 0) {
            html += `<h3>Stocks</h3>
            <table>
                <tr><th>Name</th><th>Initial Value</th></tr>`;
            for (const [name, stock] of Object.entries(stocks)) { // Use safe variable
                if (!name.startsWith('_smooth_') && !name.startsWith('_delay3_')) {
                    html += `<tr><td>${name}</td><td>${stock.initialValue ?? 'N/A'}</td></tr>`; // Add nullish coalescing
                }
            }
            html += `</table>`;
        }
        
        // Parameters
        if (paramCount > 0) {
            html += `<h3>Parameters</h3>
            <table>
                <tr><th>Name</th><th>Value</th></tr>`;
            for (const [name, value] of Object.entries(params)) { // Use safe variable
                html += `<tr><td>${name}</td><td>${value ?? 'N/A'}</td></tr>`; // Add nullish coalescing
            }
            html += `</table>`;
        }
        
        // Flows
        if (flowCount > 0) {
            html += `<h3>Flows</h3>
            <table>
                <tr><th>Name</th><th>Equation</th></tr>`;
            for (const [name, flow] of Object.entries(flows)) { // Use safe variable
                html += `<tr><td>${name}</td><td>${flow?.equation || flow?.originalEquation || 'N/A'}</td></tr>`; // Add safe navigation
            }
            html += `</table>`;
        }
        
        // Auxiliaries
        if (auxCount > 0) {
            html += `<h3>Auxiliaries</h3>
            <table>
                <tr><th>Name</th><th>Equation</th></tr>`;
            for (const [name, aux] of Object.entries(auxiliaries)) { // Use safe variable
                html += `<tr><td>${name}</td><td>${aux?.equation || aux?.originalEquation || 'N/A'}</td></tr>`; // Add safe navigation
            }
            html += `</table>`;
        }
    }
    
    // Simulation results (optional)
    if (options?.includeSimSummary && results && analysis) {
        html += `<h2>Simulation Results Summary</h2>`;

        // Handle different analysis types
        if (analysis.type === 'multi_variation') {
            html += `<h3>Comparison Summary</h3>`;
            html += `<p>${analysis.comparison?.summary || 'No comparison summary available.'}</p>`;
            if (analysis.comparison?.keyDifferences?.length > 0) {
                html += `<h4>Key Differences:</h4><ul>${analysis.comparison.keyDifferences.map(d => `<li>${d}</li>`).join('')}</ul>`;
            }
            if (analysis.comparison?.trends?.length > 0) {
                html += `<h4>Trends:</h4><ul>${analysis.comparison.trends.map(t => `<li>${t}</li>`).join('')}</ul>`;
            }
            if (analysis.comparison?.limitTimingHighlights?.length > 0) {
                html += `<h4>Limit Timing:</h4><ul>${analysis.comparison.limitTimingHighlights.map(l => `<li>${l}</li>`).join('')}</ul>`;
            }
            
            html += `<h3>Individual Variation Metrics</h3>`;
            for (const [varId, variationAnalysis] of Object.entries(analysis.variations)) {
                html += `<h4>Variation: ${varId}</h4>`;
                const metrics = variationAnalysis?.metrics;
                const patterns = variationAnalysis?.patterns;
                if (metrics && typeof metrics === 'object' && Object.keys(metrics).length > 0) {
                     html += `<table>
                         <tr><th>Stock/Variable</th><th>Initial</th><th>Final</th><th>Min</th><th>Max</th><th>Behavior Pattern</th></tr>`;
                     for (const [varName, metricValues] of Object.entries(metrics)) {
                         const patternText = patterns?.[varName]?.join(', ') || 'N/A';
                         html += `<tr>
                             <td>${varName}</td>
                             <td>${metricValues?.initial?.toFixed(2) ?? 'N/A'}</td>
                             <td>${metricValues?.final?.toFixed(2) ?? 'N/A'}</td>
                             <td>${metricValues?.min?.toFixed(2) ?? 'N/A'}</td>
                             <td>${metricValues?.max?.toFixed(2) ?? 'N/A'}</td>
                             <td>${patternText}</td>
                         </tr>`;
                     }
                     html += `</table>`;
                } else {
                     html += `<p>No detailed metrics found for this variation.</p>`;
                }
            }
        } else if (analysis.type === 'single_run' && analysis.summary) { // Handle single run
            // Assuming single run analysis has metrics directly under analysis.summary or similar structure
            const analysisData = analysis.summary; // Adjust if structure differs
            html += `<h3>Overall Metrics</h3>`;
             if (analysisData && typeof analysisData === 'object' && Object.keys(analysisData).length > 0) {
                 html += `<table>
                     <tr><th>Stock/Variable</th><th>Initial</th><th>Final</th><th>Min</th><th>Max</th><th>Behavior Pattern</th></tr>`;
                 for (const [varName, varAnalysis] of Object.entries(analysisData)) {
                     const metrics = varAnalysis?.metrics && typeof varAnalysis.metrics === 'object' ? varAnalysis.metrics : {};
                     const patterns = varAnalysis?.patterns && Array.isArray(varAnalysis.patterns) ? varAnalysis.patterns : [];
                     html += `<tr>
                         <td>${varName}</td>
                         <td>${metrics?.initial?.toFixed(2) ?? 'N/A'}</td>
                         <td>${metrics?.final?.toFixed(2) ?? 'N/A'}</td>
                         <td>${metrics?.min?.toFixed(2) ?? 'N/A'}</td>
                         <td>${metrics?.max?.toFixed(2) ?? 'N/A'}</td>
                         <td>${patterns.join(', ') || 'N/A'}</td>
                     </tr>`;
                 }
                 html += `</table>`;
            } else {
                html += `<p>No summary metrics found for this run.</p>`;
            }
        } else { 
            // Fallback if analysis structure is not recognized
            html += `<p>Analysis data structure not recognized or analysis is empty.</p>`;
        }
        
        // Embed Charts if option is checked and images are available
        const chartPlaceholder = html.indexOf('<div id="report-charts-placeholder"></div>');
        let chartsHtml = '';
        if (options?.includeCharts && chartImages) {
            chartsHtml += `<h3>Charts</h3>`;
            if (chartImages.comparison) {
                chartsHtml += `<div class="report-chart-container"><h4>Comparison Chart</h4><img src="${chartImages.comparison}" alt="Comparison Chart"></div>`;
            }
            if (chartImages.details && Object.keys(chartImages.details).length > 0) {
                chartsHtml += `<h4>Detail Charts</h4>`;
                for (const [id, imgData] of Object.entries(chartImages.details)) {
                     chartsHtml += `<div class="report-chart-container"><h5>${id}</h5><img src="${imgData}" alt="Detail Chart: ${id}"></div>`;
                }
            }
             if (!chartImages.comparison && (!chartImages.details || Object.keys(chartImages.details).length === 0)) {
                 chartsHtml += `<p>No chart images were captured for this report.</p>`;
             }
        } else if (options?.includeCharts) {
            chartsHtml = `<p>Charts were requested but no image data was found. Please run simulation again.</p>`;
        }

        // Replace placeholder with charts HTML
        if (chartPlaceholder !== -1) {
            html = html.slice(0, chartPlaceholder) + chartsHtml + html.slice(chartPlaceholder + '<div id="report-charts-placeholder"></div>'.length);
        } else {
            // Append if placeholder wasn't found (shouldn't happen but safe fallback)
            html += chartsHtml; 
        }

        html += `<p><em>Note: Interactive charts are available in the web application.</em></p>`;
    } else if (options?.includeSimSummary) {
        // Handle case where results or analysis is missing but summary was requested
        html += `<h2>Simulation Results Summary</h2><p>No simulation results or analysis data available to display.</p>`;
    }
    
    // Feedback loop analysis (optional)
    if (options?.includeLoops && loops && loops.length > 0) {
        html += `<h2>Feedback Loop Analysis</h2>`;
        
        const loopTypes = {
            '+': 'Reinforcing',
            '-': 'Balancing',
            '?': 'Ambiguous'
        };
        
        html += `<p>The model contains ${loops.length} feedback loops:</p>`;
        html += `<ul>`;
        
        // Limit to displaying top 20 loops to avoid overwhelming the report
        const loopsToDisplay = loops.slice(0, 20);
        loopsToDisplay.forEach(loop => {
            if (loop.nodes && Array.isArray(loop.nodes)) {
                // Use polarity property if it exists
                const loopPolarity = loop.polarity ?? '?'; // Default to ambiguous if undefined
                const loopType = loopTypes[loopPolarity] || 'Unknown'; 
                const nodes = loop.nodes.join(' → ') + ` → ${loop.nodes[0]}`;
                html += `<li><strong>${loopType} loop (${loopPolarity})</strong>: ${nodes}</li>`;
            } else if (Array.isArray(loop)) { // Handle old array format
                 const nodes = loop.join(' → ') + ` → ${loop[0]}`;
                 html += `<li><strong>Unknown loop</strong>: ${nodes}</li>`; // No polarity info in this format
            } else {
                html += `<li><strong>Feedback loop (unrecognized format)</strong>: ${JSON.stringify(loop)}</li>`;
            }
        });
        
        if (loops.length > loopsToDisplay.length) {
            html += `<li><em>... and ${loops.length - loopsToDisplay.length} more loops</em></li>`;
        }
        
        html += `</ul>`;
    }
    
    // Original DSL code (optional)
    if (options?.includeDsl && dslCode) {
        html += `<div class="report-section dsl-code-section">`;
        html += `<h2>Model Definition (DSL Code)</h2>`;
        html += `<div style="page-break-inside: avoid;"><pre class="pdf-pre-code">${dslCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>`;
        html += `</div>`;
    }
    
    // Footer
    html += `
        <div class="footer">
            <p>This report was generated by the System Dynamics Tool.</p>
        </div>
    </div>
</body>
</html>`;
    
    return html;
}

/**
 * Generates a PDF from HTML report content using html2pdf.js
 * @param {String} html - HTML content
 * @param {String} filename - Output filename
 * @returns {Promise} - Promise that resolves when PDF is generated and saved
 */
async function generatePDF(html, filename = 'system-dynamics-report.pdf') {
    // Ensure html2pdf is available (it's loaded from CDN in index.html)
    if (typeof html2pdf === 'undefined') {
        console.error("html2pdf library is not loaded.");
        throw new Error("PDF generation library not available.");
    }

    const options = {
        margin:       [10, 10, 10, 10], // margins [top, left, bottom, right] in mm
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.95 }, // Use jpeg for smaller size
        html2canvas:  { scale: 2, useCORS: true, logging: false }, // Scale for better resolution, disable logging
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] } // Try different modes to respect CSS
    };

    try {
        // Use the html2pdf instance directly
        await html2pdf().from(html).set(options).save();
        console.log("PDF generation initiated.");
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw error; // Re-throw to be caught by the caller
    }
}

/**
 * Saves an HTML report to a file for download
 * @param {String} html - HTML content
 * @param {String} filename - Output filename
 */
function saveHTML(html, filename = 'system-dynamics-report.html') {
    try {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a); // Append to body to ensure click works in all browsers
        a.click();
        
        // Clean up the temporary anchor and URL object
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("HTML download initiated and cleanup scheduled.");
        }, 100); // Delay cleanup slightly
    } catch (error) {
         console.error('Error saving HTML:', error);
         // Optionally display an error message to the user here
    }
}

// Ensure all necessary functions are exported
export { generateReport, generatePDF, saveHTML };