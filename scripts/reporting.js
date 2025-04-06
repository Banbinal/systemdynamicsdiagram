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
 * @returns {String} - HTML content for the report
 */
function generateReport(model, results, analysis, loops, dslCode, options) {
    if (!model) return '<p>No valid model to generate report from.</p>';
    
    const hasABResults = results && results.A && results.B;
    const modelTitle = model.title || "System Dynamics Model";
    
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
    
    const stockCount = Object.keys(model.stocks).filter(s => !s.startsWith('_smooth_') && !s.startsWith('_delay3_')).length;
    const flowCount = Object.keys(model.flows).length;
    const auxCount = Object.keys(model.auxiliaries).length;
    const paramCount = Object.keys(model.params).length;
    
    html += `<p>This model contains ${stockCount} stocks, ${flowCount} flows, ${auxCount} auxiliaries, and ${paramCount} parameters.</p>`;
    html += `<p>Simulation period: ${model.simSettings.startTime} to ${model.simSettings.endTime} (dt=${model.simSettings.dt})</p>`;
    
    if (model.abTest) {
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
            for (const [name, stock] of Object.entries(model.stocks)) {
                if (!name.startsWith('_smooth_') && !name.startsWith('_delay3_')) {
                    html += `<tr><td>${name}</td><td>${stock.initialValue}</td></tr>`;
                }
            }
            html += `</table>`;
        }
        
        // Parameters
        if (paramCount > 0) {
            html += `<h3>Parameters</h3>
            <table>
                <tr><th>Name</th><th>Value</th></tr>`;
            for (const [name, value] of Object.entries(model.params)) {
                html += `<tr><td>${name}</td><td>${value}</td></tr>`;
            }
            html += `</table>`;
        }
        
        // Flows
        if (flowCount > 0) {
            html += `<h3>Flows</h3>
            <table>
                <tr><th>Name</th><th>Equation</th></tr>`;
            for (const [name, flow] of Object.entries(model.flows)) {
                html += `<tr><td>${name}</td><td>${flow.equation || flow.originalEquation || 'N/A'}</td></tr>`;
            }
            html += `</table>`;
        }
        
        // Auxiliaries
        if (auxCount > 0) {
            html += `<h3>Auxiliaries</h3>
            <table>
                <tr><th>Name</th><th>Equation</th></tr>`;
            for (const [name, aux] of Object.entries(model.auxiliaries)) {
                html += `<tr><td>${name}</td><td>${aux.equation || aux.originalEquation || 'N/A'}</td></tr>`;
            }
            html += `</table>`;
        }
    }
    
    // Simulation results (optional)
    if (options?.includeSimSummary && (results || hasABResults)) {
        html += `<h2>Simulation Results</h2>`;
        
        if (hasABResults) {
            // A/B Test Results
            html += `<h3>A/B Test: ${results.paramName} = ${results.values[0]} vs ${results.values[1]}</h3>`;
            
            // Analysis for scenario A
            if (analysis && analysis.A) {
                html += `<h4>Scenario A (${results.paramName} = ${results.values[0]})</h4>`;
                html += `<table>
                    <tr><th>Stock</th><th>Initial</th><th>Final</th><th>Min</th><th>Max</th><th>Behavior</th></tr>`;
                
                for (const [stockName, stockAnalysis] of Object.entries(analysis.A)) {
                    html += `<tr>
                        <td>${stockName}</td>
                        <td>${stockAnalysis.metrics.initial?.toFixed(2)}</td>
                        <td>${stockAnalysis.metrics.final?.toFixed(2)}</td>
                        <td>${stockAnalysis.metrics.min?.toFixed(2)}</td>
                        <td>${stockAnalysis.metrics.max?.toFixed(2)}</td>
                        <td>${stockAnalysis.patterns.join(', ') || 'No specific pattern'}</td>
                    </tr>`;
                }
                
                html += `</table>`;
            }
            
            // Analysis for scenario B
            if (analysis && analysis.B) {
                html += `<h4>Scenario B (${results.paramName} = ${results.values[1]})</h4>`;
                html += `<table>
                    <tr><th>Stock</th><th>Initial</th><th>Final</th><th>Min</th><th>Max</th><th>Behavior</th></tr>`;
                
                for (const [stockName, stockAnalysis] of Object.entries(analysis.B)) {
                    html += `<tr>
                        <td>${stockName}</td>
                        <td>${stockAnalysis.metrics.initial?.toFixed(2)}</td>
                        <td>${stockAnalysis.metrics.final?.toFixed(2)}</td>
                        <td>${stockAnalysis.metrics.min?.toFixed(2)}</td>
                        <td>${stockAnalysis.metrics.max?.toFixed(2)}</td>
                        <td>${stockAnalysis.patterns.join(', ') || 'No specific pattern'}</td>
                    </tr>`;
                }
                
                html += `</table>`;
            }
            
        } else if (results && analysis) {
            // Standard Results
            html += `<table>
                <tr><th>Stock</th><th>Initial</th><th>Final</th><th>Min</th><th>Max</th><th>Behavior</th></tr>`;
            
            for (const [stockName, stockAnalysis] of Object.entries(analysis)) {
                html += `<tr>
                    <td>${stockName}</td>
                    <td>${stockAnalysis.metrics.initial?.toFixed(2)}</td>
                    <td>${stockAnalysis.metrics.final?.toFixed(2)}</td>
                    <td>${stockAnalysis.metrics.min?.toFixed(2)}</td>
                    <td>${stockAnalysis.metrics.max?.toFixed(2)}</td>
                    <td>${stockAnalysis.patterns.join(', ') || 'No specific pattern'}</td>
                </tr>`;
            }
            
            html += `</table>`;
        }
        
        // Here you could also include charts, but that would require handling Canvas rendering to images
        // For now, we'll just mention that charts are available in the web app
        html += `<p><em>Note: Interactive charts are available in the web application.</em></p>`;
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
            // Handle both array format and object format loops
            if (Array.isArray(loop)) {
                // Simple array of node names format
                const nodes = loop.join(' → ') + ` → ${loop[0]}`;
                html += `<li><strong>Feedback loop</strong>: ${nodes}</li>`;
            } else if (loop.nodes && Array.isArray(loop.nodes)) {
                // Object format with nodes array and polarity property
                const loopType = loopTypes[loop.polarity] || 'Unknown';
                const nodes = loop.nodes.join(' → ') + ` → ${loop.nodes[0]}`;
                html += `<li><strong>${loopType} loop (${loop.polarity})</strong>: ${nodes}</li>`;
            } else {
                // Fallback for any other loop format
                html += `<li><strong>Feedback loop</strong>: ${JSON.stringify(loop)}</li>`;
            }
        });
        
        if (loops.length > loopsToDisplay.length) {
            html += `<li><em>... and ${loops.length - loopsToDisplay.length} more loops</em></li>`;
        }
        
        html += `</ul>`;
    }
    
    // Original DSL code (optional)
    if (options?.includeDsl && dslCode) {
        html += `<h2>Model Definition (DSL Code)</h2>`;
        html += `<pre>${dslCode.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
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
 * Generates a PDF from HTML report content
 * @param {String} html - HTML content
 * @param {String} filename - Output filename
 * @returns {Promise} - Promise that resolves when PDF is generated
 */
async function generatePDF(html, filename = 'system-dynamics-report.pdf') {
    const options = {
        margin: [10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    try {
        const pdf = await html2pdf().set(options).from(html).save();
        return pdf;
    } catch (error) {
        console.error('Error generating PDF:', error);
        throw error;
    }
}

/**
 * Saves an HTML report to a file for download
 * @param {String} html - HTML content
 * @param {String} filename - Output filename
 */
function saveHTML(html, filename = 'system-dynamics-report.html') {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

export { generateReport, generatePDF, saveHTML }; 