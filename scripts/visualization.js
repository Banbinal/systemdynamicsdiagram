/**
 * Visualization Module for System Dynamics Tool v1.2
 * Handles rendering of model diagrams using mermaid
 */

/**
 * Generates Mermaid syntax for a system dynamics model
 * @param {Object} model - The parsed model object
 * @returns {String} - Mermaid syntax string
 */
export function generateMermaidSyntax(model) {
    // Remove initial error check - assume model object is always passed
    // if (!model || model.errors?.length > 0) {
    //     return 'graph TD; Error["Parsing failed or model invalid."];';
    // }
    
    // Check if model is v1.2 format
    const isV1_2 = model.constants !== undefined && model.calcs !== undefined;
    
    if (isV1_2) {
        return generateMermaidSyntaxV1_2(model);
    } else {
        return generateMermaidSyntaxLegacy(model);
    }
}

/**
 * Generates Mermaid syntax for a system dynamics model v1.2/v1.3
 * @param {Object} model - The parsed model object
 * @returns {String} - Mermaid syntax string
 */
function generateMermaidSyntaxV1_2(model) {
    console.log("[DEBUG] Generating Mermaid syntax for v1.2/v1.3 model");
    // Although called even with errors, check if model itself is fundamentally broken
    if (!model) { 
        return 'graph TD; Error["Model object is null or undefined."];';
    }
    // We proceed even if model.errors exists
    
    let mermaidStr = 'graph TD;\n';
    mermaidStr += '    direction TB;\n';
    
    // Use safe access with default empty objects
    const getSimpleName = (fullName) => fullName?.split('.')?.pop() || fullName || '';

    const stocks = model.stocks || {};
    const flows = model.flows || {};
    const calcs = model.calcs || {};
    const constants = model.constants || {};
    const maps = model.maps || {};
    const modules = model.modules || {};
    const influences = model.influences || {}; // Important for links

    const stockNames = Object.keys(stocks).filter(s => !s.startsWith('_smooth_') && !s.startsWith('_delay3_'));
    const flowNames = Object.keys(flows);
    const calcNames = Object.keys(calcs);
    const constantNames = Object.keys(constants);
    const mapNames = Object.keys(maps);
    const moduleNames = Object.keys(modules);
    
    // Track module colors for styling subgraphs
    const moduleColors = {};
    moduleNames.forEach((moduleName, index) => {
        const hue = (index * 137.5) % 360;
        moduleColors[moduleName] = `hsl(${hue}, 70%, 90%)`;
    });

    // --- Node Definitions ---
    mermaidStr += '\n    %% Node Definitions (Grouped by Module)\n';
    
    // Function to add node definition string
    const getNodeDefString = (name, type, value = null) => {
        const simpleName = getSimpleName(name);
        let label = simpleName;
        if (value !== null && value !== undefined && !isNaN(value)) {
            label += `<br>${Number(value).toFixed(2)}`;
        } else if (value !== null && value !== undefined) {
            label += `<br>${value}`;
        }
        
        let nodeStr = '';
        const escapedLabel = label.replace(/"/g, '#quot;'); // Escape quotes for Mermaid label

        switch(type) {
            case 'stock':    nodeStr = `    ${name}[\"${escapedLabel}\"]\n`; break;
            case 'flow':     nodeStr = `    ${name}{\"${escapedLabel}\"}\n`; break;
            case 'calc':     nodeStr = `    ${name}(\"${escapedLabel}\")\n`; break;
            case 'constant': nodeStr = `    ${name}[\"${escapedLabel}\"]\n`; break;
            case 'map':      nodeStr = `    ${name}[\"Map: ${escapedLabel}\"]\n`; break;
            default:         nodeStr = `    ${name}[\"${escapedLabel}\"]\n`;
        }
        return nodeStr;
    };
    
    // Define nodes within module subgraphs
    moduleNames.forEach(moduleName => {
        mermaidStr += `\n    subgraph ${moduleName}\n`;
        mermaidStr += `        direction TB;\n`; // Optional: direction within subgraph
        
        stockNames.filter(s => s.startsWith(`${moduleName}.`)).forEach(s => mermaidStr += getNodeDefString(s, 'stock', stocks[s]?.initialValue));
        flowNames.filter(f => f.startsWith(`${moduleName}.`)).forEach(f => mermaidStr += getNodeDefString(f, 'flow'));
        calcNames.filter(c => c.startsWith(`${moduleName}.`)).forEach(c => mermaidStr += getNodeDefString(c, 'calc'));
        constantNames.filter(c => c.startsWith(`${moduleName}.`)).forEach(c => mermaidStr += getNodeDefString(c, 'constant', constants[c]?.compiledValue));
        mapNames.filter(m => m.startsWith(`${moduleName}.`)).forEach(m => mermaidStr += getNodeDefString(m, 'map'));
        
        mermaidStr += `    end\n`;
        mermaidStr += `    style ${moduleName} fill:${moduleColors[moduleName]},stroke:#aaa,stroke-width:1px,rx:10,ry:10\n`;
    });

    // Define nodes not belonging to any module (top-level)
    mermaidStr += '\n    %% Top-Level Nodes\n';
    stockNames.filter(s => !s.includes('.')).forEach(s => mermaidStr += getNodeDefString(s, 'stock', stocks[s]?.initialValue));
    flowNames.filter(f => !f.includes('.')).forEach(f => mermaidStr += getNodeDefString(f, 'flow'));
    calcNames.filter(c => !c.includes('.')).forEach(c => mermaidStr += getNodeDefString(c, 'calc', calcs[c]?.expression || ''));
    constantNames.filter(c => !c.includes('.')).forEach(c => mermaidStr += getNodeDefString(c, 'constant', constants[c]?.compiledValue));
    mapNames.filter(m => !m.includes('.')).forEach(m => mermaidStr += getNodeDefString(m, 'map'));

    // --- Link Definitions ---
    const addedLinks = new Set();
    let linkIndex = 0;

    const getNodeType = (nodeName) => { // Define helper within scope
        if (stocks[nodeName]) return 'stock';
        if (flows[nodeName]) return 'flow';
        if (calcs[nodeName]) return 'calc';
        if (constants[nodeName]) return 'constant';
        if (maps[nodeName]) return 'map';
        return null;
    };

    mermaidStr += '\n    %% Flow Effects & Influences\n';
    const allModelVars = { ...stocks, ...constants, ...calcs, ...flows, ...maps };

    // 1. Draw Material Flows (Flow -> Stock)
    Object.entries(flows).forEach(([flowName, flowData]) => {
        if (flowData?.effects) {
                flowData.effects.forEach(effect => {
                const targetStock = effect?.target;
                if (targetStock && getNodeType(flowName) === 'flow' && getNodeType(targetStock) === 'stock') {
                        let label = '"?"';
                        let arrow = '==>';
                        let styleClass = `linkStyle ${linkIndex} stroke:#aaa,stroke-width:2px;\n`;
                        
                        if (effect.polarity === '-+>') {
                            label = '"Adds to"';
                            styleClass = `linkStyle ${linkIndex} stroke:#00b300,stroke-width:2px;\n`;
                        } else if (effect.polarity === '-->') {
                            label = '"Subtracts from"';
                            styleClass = `linkStyle ${linkIndex} stroke:#ff3b3b,stroke-width:2px;\n`;
                        }
                        
                    const linkKey = `${flowName}-${effect.polarity || ''}->${targetStock}`;
                        if (!addedLinks.has(linkKey)) {
                            mermaidStr += `    ${flowName} ${arrow}|${label}| ${targetStock}\n`;
                            mermaidStr += `    ${styleClass}`;
                            addedLinks.add(linkKey);
                            linkIndex++;
                        }
                    }
                });
            }
        });

    // 2. Draw Inferred Influence Links
    const drawInfluenceLinks = (targetName, expressionSource) => {
        if (!expressionSource || typeof expressionSource !== 'string') return;
        Object.keys(allModelVars).forEach(varName => {
            const simpleVarName = getSimpleName(varName);
            if (targetName !== varName && expressionSource.match(new RegExp(`\\b${simpleVarName}\\b`))) {
                const linkKey = `${varName}-->${targetName}`;
                if (!addedLinks.has(linkKey) && getNodeType(varName) && getNodeType(targetName)) {
                    const polarity = influences?.[targetName]?.[varName] || '?';
                    let label = '?';
                    let styleClass = `linkStyle ${linkIndex} stroke:#666,stroke-width:1px,stroke-dasharray:3 3;\n`;

                    if (polarity === '+') {
                        label = '➕';
                        styleClass = `linkStyle ${linkIndex} stroke:#00b300,stroke-width:1px,stroke-dasharray:3 3;\n`;
                    } else if (polarity === '-') {
                        label = '➖';
                        styleClass = `linkStyle ${linkIndex} stroke:#ff3b3b,stroke-width:1px,stroke-dasharray:3 3;\n`;
                    }

                    mermaidStr += `    ${varName} -.->|${label}| ${targetName}\n`;
                    mermaidStr += `    ${styleClass}`;
                    addedLinks.add(linkKey);
                    linkIndex++;
                }
            }
        });
    };
    
    // Add influences TO Flows (from variables in their effect expressions)
    Object.entries(flows).forEach(([flowName, flowData]) => {
        if (flowData?.effects) {
            const combinedExpression = flowData.effects.map(e => e?.expression || '').join(' ');
                drawInfluenceLinks(flowName, combinedExpression);
            }
        });
    // Add influences TO Calcs (from variables in their expressions)
    Object.entries(calcs).forEach(([calcName, calcData]) => {
        drawInfluenceLinks(calcName, calcData?.expression || '');
        });
    // Note: Influence links for map inputs are implicitly handled by the calc logic above
    // if a calc uses map(MapName, InputVar)

    // --- Class Definitions & Application ---
    mermaidStr += '\n    %% Node Styles & Class Definitions\n';
    mermaidStr += '    classDef stock fill:#ddeeff,stroke:#4a86e8,stroke-width:2px,border-radius:10px,padding:5px;\n';
    mermaidStr += '    classDef flow fill:#fff2cc,stroke:#f1c232,stroke-width:2px,border-radius:0px,padding:5px;\n';
    mermaidStr += '    classDef calc fill:#d9ead3,stroke:#6aa84f,stroke-width:1px,border-radius:8px,padding:5px;\n';
    mermaidStr += '    classDef constant fill:#f3f3f3,stroke:#666666,stroke-width:1px,stroke-dasharray:5 2,border-radius:5px,padding:5px;\n';
    mermaidStr += '    classDef map fill:#e2d8ff,stroke:#8e7cc3,stroke-width:1px,border-radius:5px,padding:5px;\n';

    stockNames.forEach(s => mermaidStr += `    class ${s} stock;\n`);
    flowNames.forEach(f => mermaidStr += `    class ${f} flow;\n`);
    calcNames.forEach(a => mermaidStr += `    class ${a} calc;\n`);
    constantNames.forEach(p => mermaidStr += `    class ${p} constant;\n`);
    mapNames.forEach(m => mermaidStr += `    class ${m} map;\n`);

    if (!mermaidStr.endsWith('\n')) mermaidStr += '\n';
    console.log("[DEBUG] Generated Mermaid Syntax (with Modules):\n" + mermaidStr);
    return mermaidStr;
}

/**
 * Generates Mermaid syntax for a legacy (v0.9.2) system dynamics model
 * @param {Object} model - The parsed model object
 * @returns {String} - Mermaid syntax string
 */
function generateMermaidSyntaxLegacy(model) {
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
export function renderMermaid(syntax, container) {
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