/**
 * DSL Parser for System Dynamics Tool v0.9.2
 * Handles parsing of system dynamics models in the DSL format
 */

function parseDSL(dslText) {
    const model = {
        nodes: {},
        influences: {},
        params: {},
        vars: {},
        stocks: {},
        flows: {},
        auxiliaries: {},
        graphs: {},
        connections: [],
        smoothStates: {},
        delay3States: {},
        manualPolarity: {},
        simSettings: { startTime: 0, endTime: 10, dt: 1 },
        errors: [],
        warnings: [],
        abTest: null, // Store single A/B test definition here
        title: null // Added for the new 'title' attribute
    };

    const lines = dslText.split('\n');
    const stockRegex = /^\s*stock\s+(\w+)\s*=\s*(-?\d+(\.\d+)?)\s*(#.*)?$/;
    const paramRegex = /^\s*param\s+(\w+)\s*=\s*(-?\d+(\.\d+)?)\s*(#.*)?$/;
    const auxFlowRegex = /^\s*(aux|flow)\s+(\w+)\s*=\s*(.+?)\s*(?:\[(.*?)\])?\s*(#.*)?$/;
    const graphRegex = /^\s*graph\s+(\w+)\s*\(\s*(\(.*\))\s*\)\s*(#.*)?$/;
    const pointRegex = /\(\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*\)/g;
    const connectInRegex = /^\s*connect\s+(\w+)\s*->\s*(\w+)\s*(#.*)?$/;
    const connectOutRegex = /^\s*connect\s+(\w+)\s*<-\s*(\w+)\s*(#.*)?$/;
    const simRegex = /^\s*sim\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s+(\d+(\.\d+)?)\s*(#.*)?$/;
    const abTestRegex = /^\s*abtest\s+param\s+(\w+)\s*=\s*\[\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*\]\s*(#.*)?$/; // A/B Test Regex
    const commentRegex = /^\s*#/;
    const emptyRegex = /^\s*$/;
    const definedNames = new Set();

    // Internal model title variable (new feature)
    let modelTitle = "Untitled Model";

    // Pass 1: Define elements and find A/B test
    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        let match;
        if (emptyRegex.test(line) || commentRegex.test(line)) return;
        const checkName = (name, type) => {
            if (!/^[a-zA-Z_]\w*$/.test(name)) {
                model.errors.push(`Line ${lineNumber}: Invalid ${type} name '${name}'.`);
                return false;
            }
            if (definedNames.has(name)) {
                model.errors.push(`Line ${lineNumber}: Duplicate name '${name}'.`);
                return false;
            }
            return true;
        };
        if ((match = line.match(stockRegex))) {
            const n = match[1];
            if (checkName(n, 'stock')) {
                model.stocks[n] = { initialValue: parseFloat(match[2]), value: parseFloat(match[2]) };
                definedNames.add(n);
            }
        } else if ((match = line.match(paramRegex))) {
            const n = match[1];
            if (checkName(n, 'param')) {
                model.params[n] = parseFloat(match[2]);
                definedNames.add(n);
            }
        } else if ((match = line.match(auxFlowRegex))) {
            const type = match[1];
            const n = match[2];
            if (checkName(n, type)) {
                let eq = match[3].trim();
                const polarityStr = match[4];
                if (type === 'aux') {
                    model.auxiliaries[n] = { equation: eq };
                } else {
                    model.flows[n] = { equation: eq };
                }
                if (polarityStr) {
                    const polarityEntries = polarityStr.split(',').map(s => s.trim());
                    for (const entry of polarityEntries) {
                        const [varName, polarity] = entry.split(/\s+/);
                        if (varName && polarity) {
                            if (!['+', '-'].includes(polarity)) {
                                model.errors.push(`Line ${lineNumber}: Invalid polarity '${polarity}' for ${varName}. Use + or -.`);
                                continue;
                            }
                            // Initialize manual polarity structure if needed
                            if (!model.manualPolarity[n]) model.manualPolarity[n] = {};
                            model.manualPolarity[n][varName] = polarity;
                        }
                    }
                }
                definedNames.add(n);
            }
        } else if ((match = line.match(graphRegex))) {
            const name = match[1];
            if (checkName(name, 'graph')) {
                const pointsStr = match[2];
                let points = [];
                let parseError = false;
                let lastX = -Infinity;
                let pointMatch;
                while ((pointMatch = pointRegex.exec(pointsStr)) !== null) {
                    const x = parseFloat(pointMatch[1]);
                    const y = parseFloat(pointMatch[3]);
                    if (isNaN(x) || isNaN(y)) {
                        model.errors.push(`Line ${lineNumber}: Invalid point (${pointMatch[1]}, ${pointMatch[3]}) in graph '${name}'.`);
                        parseError = true;
                        break;
                    }
                    if (x <= lastX) {
                        model.errors.push(`Line ${lineNumber}: X-values in graph '${name}' must be increasing.`);
                        parseError = true;
                        break;
                    }
                    points.push([x, y]);
                    lastX = x;
                }
                if (!parseError && points.length < 2) {
                    model.errors.push(`Line ${lineNumber}: Graph '${name}' needs at least two points.`);
                    parseError = true;
                }
                if (!parseError) {
                    model.graphs[name] = { points: points };
                    definedNames.add(name);
                }
            }
        } else if ((match = line.match(connectInRegex))) {
            model.connections.push({ flow: match[1], stock: match[2], direction: 'in', line: lineNumber });
        } else if ((match = line.match(connectOutRegex))) {
            model.connections.push({ flow: match[1], stock: match[2], direction: 'out', line: lineNumber });
        } else if ((match = line.match(simRegex))) {
            model.simSettings.startTime = parseFloat(match[1]);
            model.simSettings.endTime = parseFloat(match[3]);
            model.simSettings.dt = parseFloat(match[5]);
            if (model.simSettings.dt <= 0) model.errors.push(`Line ${lineNumber}: dt must be positive.`);
            if (model.simSettings.endTime <= model.simSettings.startTime) model.errors.push(`Line ${lineNumber}: endTime must be > startTime.`);
        } else if ((match = line.match(abTestRegex))) {
            // A/B Test Parsing Logic
            if (model.abTest) {
                model.errors.push(`Line ${lineNumber}: Only one 'abtest' definition is allowed per model. (Previous definition on line ${model.abTest.line})`);
            } else {
                const paramName = match[1];
                const valueA = parseFloat(match[2]);
                const valueB = parseFloat(match[4]);
                if (isNaN(valueA) || isNaN(valueB)) {
                     model.errors.push(`Line ${lineNumber}: Invalid number in A/B test values for '${paramName}'.`);
                } else {
                    model.abTest = {
                        paramName: paramName,
                        values: [valueA, valueB],
                        line: lineNumber
                    };
                    // Validation for parameter existence will happen after all params are parsed
                }
            }
        } else if ((match = line.match(/^title\s+(.+)$/i))) {
            modelTitle = match[1].trim();
            // Store the title in the model object
            model.title = modelTitle;
        } else {
            model.errors.push(`Line ${lineNumber}: Unrecognized syntax: "${line.trim()}"`);
        }
    });

    // Pass 2: Validate connections, manual polarity sources, and A/B test parameter
    model.connections.forEach(c => {
        if (!model.flows[c.flow]) model.errors.push(`Line ${c.line}: Flow '${c.flow}' not defined.`);
        if (!model.stocks[c.stock]) model.errors.push(`Line ${c.line}: Stock '${c.stock}' not defined.`);
    });
    const allKnownVarsCheck = new Set([...Object.keys(model.stocks), ...Object.keys(model.params), ...Object.keys(model.auxiliaries), ...Object.keys(model.flows), ...Object.keys(model.graphs)]);
    for (const targetVar in model.manualPolarity) {
        for (const sourceVar in model.manualPolarity[targetVar]) {
            if (!allKnownVarsCheck.has(sourceVar)) {
                model.errors.push(`Polarity override for '${targetVar}': Source variable '${sourceVar}' is not defined.`);
            }
        }
    }
    // Validate A/B test parameter exists
    if (model.abTest && !model.params.hasOwnProperty(model.abTest.paramName)) {
         model.errors.push(`Line ${model.abTest.line}: A/B test parameter '${model.abTest.paramName}' is not defined as a 'param'.`);
    }

    if (model.errors.length > 0) {
        return model; // Return model with errors
    }

    // Compile equation strings into executable functions
    const stockNames = Object.keys(model.stocks);
    const paramNames = Object.keys(model.params);
    const auxNames = Object.keys(model.auxiliaries);
    const graphNames = Object.keys(model.graphs);
    const allowedBuiltIns = ['STEP', 'PULSE', 'SMOOTH', 'DELAY3'];
    const allowedGlobals = ['Date', 'Infinity', 'NaN'];
    const stepFnStr = `function STEP(h, st) { return t >= st ? h : 0; }`;
    const pulseFnStr = `function PULSE(mag, st, width) { const w = (width === undefined || width === null || width <= 0) ? dt : width; const endTime = st + w; if (t >= st && t < endTime) { return w > 1e-9 ? (mag / w) : 0; } else { return 0; } }`;
    const interpolateFnStr = `function _interpolate(p, x) { if (!p || p.length < 2) return NaN; if (x <= p[0][0]) return p[0][1]; if (x >= p[p.length - 1][0]) return p[p.length - 1][1]; let i = 1; while (i < p.length && p[i][0] < x) { i++; } const x1 = p[i - 1][0], y1 = p[i - 1][1], x2 = p[i][0], y2 = p[i][1]; return (x2 === x1) ? y1 : y1 + (y2 - y1) * (x - x1) / (x2 - x1); }`;

    const originalEquations = {};
    Object.entries(model.auxiliaries).forEach(([k, v]) => originalEquations[k] = v.equation);
    Object.entries(model.flows).forEach(([k, v]) => originalEquations[k] = v.equation);

    // Preprocess and analyze equations for influences and compile functions
    const analyzeAndCompileEquation = (eqName, eqObj, eqType) => {
        try {
            const originalEquation = eqObj.equation;
            let processedEq = originalEquation;
            let fnSourceCode = '';
            const influences = {};

            // Special cases for built-in functions like SMOOTH or DELAY3
            if (processedEq.startsWith('SMOOTH(')) {
                const smoothMatch = processedEq.match(/SMOOTH\(\s*(.+?)\s*,\s*(.+?)\s*\)/);
                if (!smoothMatch) throw new Error(`Invalid SMOOTH syntax: ${processedEq}`);
                
                const smoothInput = smoothMatch[1];
                const smoothDelay = smoothMatch[2];
                const stateName = `_smooth_${eqName}`;
                
                model.stocks[stateName] = { initialValue: 0, value: 0 };
                model.smoothStates[eqName] = { 
                    stateName,
                    inputExpr: smoothInput,
                    delayExpr: smoothDelay
                };

                // Compile input and delay expressions to functions
                const inputFn = new Function('state', 'params', 'auxs', 'M', 't', 'dt', 
                    `"use strict"; 
                    ${stockNames.length > 0 ? `var ${stockNames.join(', ')};\n${stockNames.map(s => `${s} = state["${s}"]`).join(';\n')};` : ''}
                    ${paramNames.length > 0 ? `var ${paramNames.join(', ')};\n${paramNames.map(p => `${p} = params["${p}"]`).join(';\n')};` : ''}
                    ${auxNames.length > 0 ? `var ${auxNames.join(', ')};\n${auxNames.map(a => `${a} = auxs["${a}"]`).join(';\n')};` : ''}
                    const Math = M;
                    ${stepFnStr}
                    ${pulseFnStr}
                    ${interpolateFnStr}
                    ${graphNames.map(g => `const ${g} = x => _interpolate(${JSON.stringify(model.graphs[g].points)}, x);`).join('\n')}
                    return ${smoothInput};`
                );

                const delayFn = new Function('state', 'params', 'auxs', 'M', 't', 'dt', 
                    `"use strict"; 
                    ${stockNames.length > 0 ? `var ${stockNames.join(', ')};\n${stockNames.map(s => `${s} = state["${s}"]`).join(';\n')};` : ''}
                    ${paramNames.length > 0 ? `var ${paramNames.join(', ')};\n${paramNames.map(p => `${p} = params["${p}"]`).join(';\n')};` : ''}
                    ${auxNames.length > 0 ? `var ${auxNames.join(', ')};\n${auxNames.map(a => `${a} = auxs["${a}"]`).join(';\n')};` : ''}
                    const Math = M;
                    ${stepFnStr}
                    ${pulseFnStr}
                    ${interpolateFnStr}
                    ${graphNames.map(g => `const ${g} = x => _interpolate(${JSON.stringify(model.graphs[g].points)}, x);`).join('\n')}
                    return ${smoothDelay};`
                );

                model.smoothStates[eqName].inputFn = inputFn;
                model.smoothStates[eqName].delayFn = delayFn;

                // The auxiliary output is just the current state value, simple pass-through
                fnSourceCode = `return state["${stateName}"];`;
            } 
            else if (processedEq.startsWith('DELAY3(')) {
                const delay3Match = processedEq.match(/DELAY3\(\s*(.+?)\s*,\s*(.+?)\s*\)/);
                if (!delay3Match) throw new Error(`Invalid DELAY3 syntax: ${processedEq}`);
                
                const delay3Input = delay3Match[1];
                const delay3Time = delay3Match[2];
                const stateName1 = `_delay3_${eqName}_1`;
                const stateName2 = `_delay3_${eqName}_2`;
                const stateName3 = `_delay3_${eqName}_3`;
                
                model.stocks[stateName1] = { initialValue: 0, value: 0 };
                model.stocks[stateName2] = { initialValue: 0, value: 0 };
                model.stocks[stateName3] = { initialValue: 0, value: 0 };
                
                model.delay3States[eqName] = {
                    stateName1,
                    stateName2,
                    stateName3,
                    inputExpr: delay3Input,
                    delayExpr: delay3Time
                };

                // Compile input and delay expressions to functions
                const inputFn = new Function('state', 'params', 'auxs', 'M', 't', 'dt', 
                    `"use strict"; 
                    ${stockNames.length > 0 ? `var ${stockNames.join(', ')};\n${stockNames.map(s => `${s} = state["${s}"]`).join(';\n')};` : ''}
                    ${paramNames.length > 0 ? `var ${paramNames.join(', ')};\n${paramNames.map(p => `${p} = params["${p}"]`).join(';\n')};` : ''}
                    ${auxNames.length > 0 ? `var ${auxNames.join(', ')};\n${auxNames.map(a => `${a} = auxs["${a}"]`).join(';\n')};` : ''}
                    const Math = M;
                    ${stepFnStr}
                    ${pulseFnStr}
                    ${interpolateFnStr}
                    ${graphNames.map(g => `const ${g} = x => _interpolate(${JSON.stringify(model.graphs[g].points)}, x);`).join('\n')}
                    return ${delay3Input};`
                );

                const delayFn = new Function('state', 'params', 'auxs', 'M', 't', 'dt', 
                    `"use strict"; 
                    ${stockNames.length > 0 ? `var ${stockNames.join(', ')};\n${stockNames.map(s => `${s} = state["${s}"]`).join(';\n')};` : ''}
                    ${paramNames.length > 0 ? `var ${paramNames.join(', ')};\n${paramNames.map(p => `${p} = params["${p}"]`).join(';\n')};` : ''}
                    ${auxNames.length > 0 ? `var ${auxNames.join(', ')};\n${auxNames.map(a => `${a} = auxs["${a}"]`).join(';\n')};` : ''}
                    const Math = M;
                    ${stepFnStr}
                    ${pulseFnStr}
                    ${interpolateFnStr}
                    ${graphNames.map(g => `const ${g} = x => _interpolate(${JSON.stringify(model.graphs[g].points)}, x);`).join('\n')}
                    return ${delay3Time};`
                );

                model.delay3States[eqName].inputFn = inputFn;
                model.delay3States[eqName].delayFn = delayFn;

                // The auxiliary output is just the current state value of the third stage
                fnSourceCode = `return state["${stateName3}"];`;
            } 
            else {
                // Regular equation processing
                // Extract all referenced variables to determine influences
                const tokenizedEq = processedEq.replace(/[+\-*/^%(),.]/g, ' $& ').replace(/\s+/g, ' ').trim();
                const tokens = tokenizedEq.split(' ');
                
                const usesStockVariable = [];
                const usesParamVariable = [];
                const usesAuxVariable = [];
                const usesGraphFunction = [];
                
                for (const token of tokens) {
                    if (stockNames.includes(token)) usesStockVariable.push(token);
                    if (paramNames.includes(token)) usesParamVariable.push(token);
                    if (auxNames.includes(token)) usesAuxVariable.push(token);
                    if (graphNames.includes(token)) usesGraphFunction.push(token);
                }
                
                // Determine polarity of influences
                for (const stockVar of usesStockVariable) {
                    let polarity = null;
                    // Check for manual polarity override
                    if (model.manualPolarity[eqName]?.[stockVar]) {
                        polarity = model.manualPolarity[eqName][stockVar];
                    } else {
                        // TODO: Implement algorithmic polarity detection (omitted for simplicity)
                        polarity = '?'; // Unknown polarity by default
                    }
                    influences[stockVar] = polarity;
                }
                
                for (const paramVar of usesParamVariable) {
                    let polarity = null;
                    // Check for manual polarity override
                    if (model.manualPolarity[eqName]?.[paramVar]) {
                        polarity = model.manualPolarity[eqName][paramVar];
                    } else {
                        // Default param polarity is positive if it's a common pattern
                        polarity = '+';
                    }
                    influences[paramVar] = polarity;
                }
                
                for (const auxVar of usesAuxVariable) {
                    let polarity = null;
                    // Check for manual polarity override
                    if (model.manualPolarity[eqName]?.[auxVar]) {
                        polarity = model.manualPolarity[eqName][auxVar];
                    } else {
                        // Default aux polarity is unknown without analysis
                        polarity = '?';
                    }
                    influences[auxVar] = polarity;
                }
                
                for (const graphFn of usesGraphFunction) {
                    // The variable used in the graph function call is an influence
                    // This is a simplification - would need to actually parse the function call arguments
                    // For now, graph function inputs are not tracked as influences
                }
                
                // Save influences to the model
                model.influences[eqName] = influences;
                
                // Compile a function from the equation
                // Setup safe wrapper for direct variables
                fnSourceCode = `
                ${stockNames.length > 0 ? `var ${stockNames.join(', ')};\n${stockNames.map(s => `${s} = state["${s}"]`).join(';\n')};` : ''}
                ${paramNames.length > 0 ? `var ${paramNames.join(', ')};\n${paramNames.map(p => `${p} = params["${p}"]`).join(';\n')};` : ''}
                ${auxNames.length > 0 ? `var ${auxNames.join(', ')};\n${auxNames.map(a => `${a} = auxs["${a}"]`).join(';\n')};` : ''}
                const Math = M;
                ${stepFnStr}
                ${pulseFnStr}
                ${interpolateFnStr}
                ${graphNames.map(g => `const ${g} = x => _interpolate(${JSON.stringify(model.graphs[g].points)}, x);`).join('\n')}
                return ${processedEq};`;
            }
            
            // Compile the function
            try {
                const fn = new Function('state', 'params', 'auxs', 'M', 't', 'dt', `"use strict"; ${fnSourceCode}`);
                
                // Store the compiled function
                eqObj.fn = fn;
                eqObj.originalEquation = originalEquation; // Save the original for display
            } catch (error) {
                console.error(`Failed to compile ${eqType} '${eqName}': ${error.message}`);
                console.error(`Source code that failed: ${fnSourceCode}`);
                console.error(`Variables: stocks=${stockNames.length}, params=${paramNames.length}, auxs=${auxNames.length}, graphs=${graphNames.length}`);
                model.errors.push(`Failed to compile ${eqType} '${eqName}': ${error.message}`);
            }
        } catch (error) {
            model.errors.push(`Failed to compile ${eqType} '${eqName}': ${error.message}`);
        }
    };
    
    // Process auxiliaries first (they may be used by flows)
    for (const aux in model.auxiliaries) {
        analyzeAndCompileEquation(aux, model.auxiliaries[aux], 'auxiliary');
    }
    // Then process flows
    for (const flow in model.flows) {
        analyzeAndCompileEquation(flow, model.flows[flow], 'flow');
    }

    // Add title to the model if not already set
    if (!model.title) {
        model.title = "Untitled Model";
    }

    return model;
}

// Export functions for use in other modules
export { parseDSL }; 