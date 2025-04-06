/**
 * Visualization Module for System Dynamics Tool
 * Handles rendering of model diagrams using mermaid
 */

/**
 * Generates Mermaid syntax for a system dynamics model
 * @param {Object} model - The parsed model object
 * @returns {String} - Mermaid syntax string
 */
function generateMermaidSyntax(model) {
    if (!model || model.errors?.length > 0) {
        return 'graph TD; Error["Parsing failed or model invalid."];';
    }
    
    // Use TD (top-down) orientation
    let mermaidStr = 'graph TD;\n';
    
    // Add direction setting to improve layout
    mermaidStr += '    direction TB;\n';
    
    const stockNames = Object.keys(model.stocks).filter(s => !s.startsWith('_smooth_') && !s.startsWith('_delay3_'));
    const flowNames = Object.keys(model.flows);
    const auxNames = Object.keys(model.auxiliaries);
    const paramNames = Object.keys(model.params);
    const graphNames = Object.keys(model.graphs);
    const addedLinks = new Set();
    const linksToStyle = [];
    let linkIndex = 0;
    
    mermaidStr += '\n    %% Stocks\n';
    stockNames.forEach(s => {
        mermaidStr += `    ${s}["${s}<br>${model.stocks[s].initialValue}"]\n`;
        mermaidStr += `    style ${s} fill:#99d1ff,stroke:#1668b2,stroke-width:2px,border-radius:10px\n`;
    });
    
    mermaidStr += '\n    %% Flows\n';
    flowNames.forEach(f => {
        mermaidStr += `    ${f}["${f}"]\n`;
        mermaidStr += `    style ${f} fill:#ffcc99,stroke:#cc5500,stroke-width:2px,border-radius:0px\n`;
    });
    
    mermaidStr += '\n    %% Auxiliaries\n';
    auxNames.forEach(a => {
        mermaidStr += `    ${a}["${a}"]\n`;
        mermaidStr += `    style ${a} fill:#d9f2d9,stroke:#006600,stroke-width:1px,border-radius:8px\n`;
    });
    
    mermaidStr += '\n    %% Parameters\n';
    paramNames.forEach(p => {
        mermaidStr += `    ${p}["${p}<br>${model.params[p]}"]\n`;
        mermaidStr += `    style ${p} fill:#f9f9f9,stroke:#666666,stroke-width:1px,stroke-dasharray:5 2,border-radius:5px\n`;
    });
    
    mermaidStr += '\n    %% Parameter & Auxiliary connections\n';
    // Add influence links (aux -> aux, aux -> flow, param -> aux, param -> flow, stock -> aux)
    for (const targetName in model.influences) {
        const influences = model.influences[targetName];
        for (const sourceName in influences) {
            const polarity = influences[sourceName] || '?';
            const linkKey = `${sourceName}-influence->${targetName}`;
            if (!addedLinks.has(linkKey)) {
                const label = (polarity === '+') ? '"➕ Influences"' : (polarity === '-') ? '"➖ Influences"' : '"? Influences"';
                mermaidStr += `    ${sourceName} -.->|${label}| ${targetName}\n`;
                linksToStyle.push({ index: linkIndex, polarity: polarity });
                addedLinks.add(linkKey);
                linkIndex++;
            }
        }
    }
    
    mermaidStr += '\n    %% Stock-Flow connections\n';
    model.connections.forEach(conn => {
        if (model.flows[conn.flow] && model.stocks[conn.stock] && !conn.stock.startsWith('_smooth_') && !conn.stock.startsWith('_delay3_')) { 
            let linkKey = ''; 
            if (conn.direction === 'in') { 
                linkKey = `${conn.flow}-add->${conn.stock}`; 
                if (!addedLinks.has(linkKey)) { 
                    mermaidStr += `    ${conn.flow} ==>|"Adds to"| ${conn.stock}\n`; 
                    addedLinks.add(linkKey); 
                    linkIndex++; 
                } 
            } else { 
                linkKey = `${conn.flow}-subtract->${conn.stock}`; 
                if (!addedLinks.has(linkKey)) { 
                    mermaidStr += `    ${conn.flow} ==>|"Subtracts from"| ${conn.stock}\n`; 
                    addedLinks.add(linkKey); 
                    linkIndex++; 
                } 
                const influenceLinkKey = `${conn.stock}-influence->${conn.flow}`; 
                if (!addedLinks.has(influenceLinkKey) && model.influences[conn.flow]?.[conn.stock]) { 
                    const polarity = model.influences[conn.flow][conn.stock] || '?'; 
                    const label = (polarity === '+') ? '"➕ Influences"' : (polarity === '-') ? '"➖ Influences"' : '"? Influences"'; 
                    mermaidStr += `    ${conn.stock} -.->|${label}| ${conn.flow}\n`; 
                    linksToStyle.push({ index: linkIndex, polarity: polarity }); 
                    addedLinks.add(influenceLinkKey); 
                    linkIndex++; 
                } 
            } 
        } 
    });
    
    mermaidStr += '\n    %% Link Styles\n'; 
    linksToStyle.forEach(linkInfo => { 
        if (linkInfo.polarity === '+') { 
            mermaidStr += `    linkStyle ${linkInfo.index} stroke:#00b300,stroke-width:2px;\n`; 
        } else if (linkInfo.polarity === '-') { 
            mermaidStr += `    linkStyle ${linkInfo.index} stroke:#ff3b3b,stroke-width:2px;\n`; 
        } 
    });
    
    mermaidStr += '\n    %% Class Definitions for Better Spacing\n';
    mermaidStr += '    classDef stock fill:#99d1ff,stroke:#1668b2,stroke-width:2px,border-radius:10px;\n';
    mermaidStr += '    classDef flow fill:#ffcc99,stroke:#cc5500,stroke-width:2px,border-radius:0px;\n';
    mermaidStr += '    classDef auxiliary fill:#d9f2d9,stroke:#006600,stroke-width:1px,border-radius:8px;\n';
    mermaidStr += '    classDef parameter fill:#f9f9f9,stroke:#666666,stroke-width:1px,stroke-dasharray:5 2,border-radius:5px;\n';
    
    stockNames.forEach(s => mermaidStr += `    class ${s} stock;\n`);
    flowNames.forEach(f => mermaidStr += `    class ${f} flow;\n`);
    auxNames.forEach(a => mermaidStr += `    class ${a} auxiliary;\n`);
    paramNames.forEach(p => mermaidStr += `    class ${p} parameter;\n`);
    
    if (!mermaidStr.endsWith('\n')) mermaidStr += '\n'; 
    return mermaidStr;
}

/**
 * Renders a mermaid diagram in the specified container
 * @param {String} syntax - Mermaid syntax to render
 * @param {HTMLElement} container - Container element for the diagram
 */
function renderMermaid(syntax, container) {
    if (!container) {
        console.error("Mermaid container not found.");
        return;
    }
    
    // Clear previous content and add a loading message
    container.innerHTML = `<div class="mermaid">graph TD; Loading["Rendering diagram..."];</div>`;
    
    // Force a small delay to ensure the DOM is updated before rendering
    setTimeout(() => {
        // Set innerHTML with the actual diagram syntax
        container.innerHTML = `<div class="mermaid">${syntax}</div>`;
        
        try {
            // Explicitly trigger mermaid rendering on the specific element
            const element = container.querySelector(".mermaid");
            if (element) {
                // Reset any previous diagram to prevent issues
                element.removeAttribute('data-processed');
                
                // Use both methods for maximum compatibility
                // First try mermaid.run (for newer versions)
                if (typeof mermaid.run === 'function') {
                    mermaid.run({
                        nodes: [element],
                        suppressErrors: false
                    }).catch(err => {
                        console.error("Mermaid rendering error:", err);
                        // Fall back to mermaid.init if run fails
                        try {
                            mermaid.init(undefined, [element]);
                        } catch (err2) {
                            console.error("Mermaid init fallback also failed:", err2);
                            container.innerHTML = `<div class="error-message">Diagram rendering failed: ${err.message || err}</div>`;
                        }
                    });
                } else {
                    // Fall back to mermaid.init for older versions
                    mermaid.init(undefined, [element]);
                }
            } else {
                console.error("Could not find .mermaid element after setting innerHTML.");
                container.innerHTML = `<div class="error-message">Diagram container not found</div>`;
            }
        } catch (err) {
            console.error("Error initializing mermaid:", err);
            container.innerHTML = `<div class="error-message">Mermaid initialization error: ${err.message || err}</div>`;
        }
    }, 50); // Small delay to ensure DOM is updated
}

export { generateMermaidSyntax, renderMermaid };