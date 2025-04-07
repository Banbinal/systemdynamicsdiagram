/**
 * DSL Parser for System Dynamics Tool v1.2
 * Handles parsing of system dynamics models in the DSL format
 */

/**
 * Parses a DSL model in v1.2 format
 * @param {string} dslText - The DSL text to parse
 * @return {Object} - The parsed model
 */
export function parseDSLv1_2(dslText) {
    console.log("[DEBUG] Parsing DSL v1.2 text:", dslText.length, "characters");
    
    // Initialize model structure
    const model = {
        constants: {},
        stocks: {},
        flows: {},
        calcs: {},
        maps: {},
        modules: {},
        scenarios: {},
        sweeps: {},
        smoothStates: {},
        delay3States: {},
        nodeInfo: {},
        influences: [],
        timeConfig: { startTime: 0, endTime: 10, timeStep: 0.25 },
        errors: [],
        warnings: [],
        connections: [], // Added to store connections between flows and stocks
        plotTargets: [],
        limits: {}
    };
    
    // If empty input, return empty model
    if (!dslText || dslText.trim() === '') {
        model.errors.push("Empty model text");
        console.error("[DEBUG] Empty model text provided");
        return model;
    }
    
    try {
        // Tokenize the DSL text
        console.log("[DEBUG] Starting tokenization");
        const tokenizerResult = tokenizeDSL(dslText);
        const tokens = tokenizerResult.tokens;
        console.log("[DEBUG] Tokenization complete:", tokens.length, "tokens");
        
        // Add tokenizer errors if any
        if (tokenizerResult.errors && tokenizerResult.errors.length > 0) {
            model.errors.push(...tokenizerResult.errors);
            console.error("[DEBUG] Tokenizer errors:", tokenizerResult.errors);
            return model; // Return early if there are tokenization errors
        }
        
        // Process tokens to build model structure
        parseDSLTokens(tokens, model);
        console.log("[DEBUG] Token processing complete");
        
        // If no errors, handle special function implementations and compile expressions
        if (model.errors.length === 0) {
            validateModel(model);
            compileExpressions(model);
            
            console.log("[DEBUG] Model successfully parsed");
            console.log("[DEBUG] Model contents:", {
                constants: Object.keys(model.constants),
                stocks: Object.keys(model.stocks),
                flows: Object.keys(model.flows),
                calcs: Object.keys(model.calcs),
                maps: Object.keys(model.maps),
                scenarios: Object.keys(model.scenarios),
                sweeps: Object.keys(model.sweeps)
            });
            
            if (Object.keys(model.sweeps).length > 0) {
                console.log("[DEBUG] Sweeps found:", model.sweeps);
            }
        } else {
            console.error("[DEBUG] Errors during parsing:", model.errors);
        }
    } catch (error) {
        model.errors.push(`Parser error: ${error.message}`);
        console.error("[DEBUG] Exception during parsing:", error);
        console.error("[DEBUG] Stack trace:", error.stack);
    }
    
    return model;
}

/**
 * Tokenize the DSL text into tokens, handling indentation and v1.2 syntax
 * @param {string} dslText - The DSL text to tokenize
 * @returns {Object} Object containing tokens and any errors
 */
function tokenizeDSL(dslText) {
    console.log("[DEBUG] Starting tokenization v1.2 of", dslText.length, "characters");
    
    const tokens = [];
    const errors = [];
    const lines = dslText.split('\n');
    let indentStack = [0]; // Stack to track indentation levels
    let currentLineNumber = 0;

    for (let i = 0; i < lines.length; i++) {
        currentLineNumber = i + 1;
        const line = lines[i];
        const lineWithoutComment = line.split('#')[0]; // Process the line part before any comment
        const trimmedLineWithoutComment = lineWithoutComment.trim();

        // Skip empty lines and comments
        if (trimmedLineWithoutComment === '') {
            continue;
        }

        console.log(`[DEBUG] Processing line ${currentLineNumber}: '${trimmedLineWithoutComment}' (Original: '${line}')`);

        try {
            // Determine the indentation level (based on original line)
            const indentMatch = lineWithoutComment.match(/^(\s*)/);
            const currentIndent = indentMatch ? indentMatch[1].length : 0;
            const lastIndent = indentStack[indentStack.length - 1];

            // --- Handle Indentation Changes --- 
            if (currentIndent > lastIndent) {
                // Increase indentation
                indentStack.push(currentIndent);
                tokens.push({ type: 'INDENT', line: currentLineNumber });
                console.log(`[DEBUG] INDENT to ${currentIndent}`);
            } else {
                // Decrease or maintain indentation
                while (currentIndent < indentStack[indentStack.length - 1]) {
                    indentStack.pop();
                    tokens.push({ type: 'DEDENT', line: currentLineNumber });
                    console.log(`[DEBUG] DEDENT to ${indentStack[indentStack.length - 1]}`);
                }
                // Check for inconsistent indentation
                if (currentIndent !== indentStack[indentStack.length - 1]) {
                     errors.push(`Line ${currentLineNumber}: Inconsistent indentation.`);
                     continue; // Skip processing this line
                }
            }
            
            // --- Handle Line Content (using trimmed line without comment) --- 
            let matched = false;
            const lineToParse = trimmedLineWithoutComment; // Use the cleaned line for matching

            // Match flow start: flow Identifier:
            if (!matched) {
                const flowStartMatch = lineToParse.match(/^flow\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
                if (flowStartMatch) {
                    tokens.push({
                        type: 'FLOW_START',
                        name: flowStartMatch[1],
                        line: currentLineNumber
                    });
                    matched = true;
                } 
            } 
            // Match flow effect: expression polarity identifier (must be indented)
            if (!matched && indentStack.length > 1) { 
                 const flowEffectMatch = lineToParse.match(/^(.*?)\s*(-->|-\+>)\s*([A-Za-z_][A-Za-z0-9_]*)$/);
                 if (flowEffectMatch) {
                     tokens.push({
                         type: 'FLOW_EFFECT',
                         expression: flowEffectMatch[1].trim(),
                         polarity: flowEffectMatch[2],
                         target: flowEffectMatch[3],
                         line: currentLineNumber
                     });
                     matched = true;
                 } 
            }

            // Match stock: stock Identifier = expression
             if (!matched) {
                const stockMatch = lineToParse.match(/^stock\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)/i);
                if (stockMatch) {
                    tokens.push({
                        type: 'STOCK',
                        name: stockMatch[1],
                        expression: stockMatch[2].trim(),
                        line: currentLineNumber
                    });
                    matched = true;
                }
            }

            // Match constant: constant Identifier = expression (or param alias)
             if (!matched) {
                const constMatch = lineToParse.match(/^(?:constant|param)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)/i);
                if (constMatch) {
                    // Check if it's a Time Config constant first
                    if (!['StartTime', 'EndTime', 'TimeStep'].includes(constMatch[1])) {
                         tokens.push({
                             type: 'CONSTANT',
                             name: constMatch[1],
                             expression: constMatch[2].trim(),
                             line: currentLineNumber
                         });
                         matched = true;
                    } // Time config is handled separately
                }
            }
            
            // Match calc: calc Identifier = expression
             if (!matched) {
                const calcMatch = lineToParse.match(/^calc\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)/i);
                if (calcMatch) {
                    tokens.push({
                        type: 'CALC',
                        name: calcMatch[1],
                        expression: calcMatch[2].trim(),
                        line: currentLineNumber
                    });
                    matched = true;
                }
            }

             // Match sweep: sweep Identifier = [values] (or abtest alias)
              if (!matched) {
                 const sweepMatch = lineToParse.match(/^(?:sweep|abtest)\s+(?:param\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[(.*)\]/i);
                 if (sweepMatch) {
                     const paramName = sweepMatch[1];
                     const valuesList = sweepMatch[2].split(',').map(v => parseFloat(v.trim()));
                     tokens.push({
                         type: 'SWEEP',
                         paramName: paramName,
                         values: valuesList.filter(v => !isNaN(v)),
                         line: currentLineNumber
                     });
                     matched = true;
                 }
             }
             
             // Match Time Config: constant TimeKeyword = value
              if (!matched) {
                 const timeMatch = lineToParse.match(/^constant\s+(StartTime|EndTime|TimeStep)\s*=\s*([\d.]+)/i);
                 if (timeMatch) {
                    tokens.push({
                        type: 'TIME_CONFIG',
                        name: timeMatch[1], // StartTime, EndTime, or TimeStep
                        value: parseFloat(timeMatch[2]),
                        line: currentLineNumber
                    });
                    matched = true;
                 }
              }
             
            // Match scenario start: scenario Identifier:
            if (!matched) {
                const scenarioStartMatch = lineToParse.match(/^scenario\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
                if (scenarioStartMatch) {
                    tokens.push({ type: 'SCENARIO_START', name: scenarioStartMatch[1], line: currentLineNumber });
                    matched = true;
                }
            }
            // Match scenario override: (constant|stock) Identifier = expression (must be indented)
            if (!matched && indentStack.length > 1) {
                const overrideMatch = lineToParse.match(/^(constant|stock)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)/i);
                if (overrideMatch) {
                     tokens.push({ type: 'OVERRIDE', targetType: overrideMatch[1].toLowerCase(), targetName: overrideMatch[2], expression: overrideMatch[3].trim(), line: currentLineNumber });
                     matched = true;
                }
            }
            // Match map start: map Identifier [: type] :
            if (!matched) {
                const mapStartMatch = lineToParse.match(/^map\s+([A-Za-z_][A-Za-z0-9_]*)(?::\s*(linear|step|spline))?\s*:/i);
                if (mapStartMatch) {
                    tokens.push({ type: 'MAP_START', name: mapStartMatch[1], interpolation: mapStartMatch[2] || 'linear', line: currentLineNumber });
                    matched = true;
                }
            }
            // Match map point: ( number , number ) (must be indented)
            if (!matched && indentStack.length > 1) {
                 const mapPointMatch = lineToParse.match(/^\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
                 if (mapPointMatch) {
                     tokens.push({ type: 'MAP_POINT', x: parseFloat(mapPointMatch[1]), y: parseFloat(mapPointMatch[2]), line: currentLineNumber });
                     matched = true;
                 }
            }
            // Match group/module start: (group|module) Identifier :
            if (!matched) {
                const blockStartMatch = lineToParse.match(/^(group|module)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
                if (blockStartMatch) {
                    tokens.push({ type: blockStartMatch[1].toUpperCase() + '_START', name: blockStartMatch[2], line: currentLineNumber });
                    matched = true;
                }
            }
            // Match limit directive: limit Identifier [min=Number] [max=Number]
            if (!matched) {
                const limitMatch = lineToParse.match(/^limit\s+([A-Za-z_][A-Za-z0-9_\.]*)\s*(?:min\s*=\s*(-?\d+(?:\.\d+)?))?\s*(?:max\s*=\s*(-?\d+(?:\.\d+)?))?/i);
                if (limitMatch) {
                    const [, name, minValStr, maxValStr] = limitMatch;
                    if (minValStr !== undefined || maxValStr !== undefined) {
                        tokens.push({
                            type: 'LIMIT',
                            name: name,
                            min: minValStr !== undefined ? parseFloat(minValStr) : undefined,
                            max: maxValStr !== undefined ? parseFloat(maxValStr) : undefined,
                            line: currentLineNumber
                        });
                        matched = true;
                    } else {
                         errors.push(`Line ${currentLineNumber}: Limit directive for '${name}' must specify at least min or max.`);
                    }
                }
            }
            // Match plot directive: plot [stock|calc] Identifier
             if (!matched) {
                const plotMatch = lineToParse.match(/^plot\s+(?:(?:stock|calc)\s+)?([A-Za-z_][A-Za-z0-9_\.]*)/i); // Allow dot for module.var
                if (plotMatch) {
                    tokens.push({
                        type: 'PLOT_TARGET',
                        name: plotMatch[1],
                        line: currentLineNumber
                    });
                    matched = true;
                }
             }
            // Match title directive: title Anything until end of line
            if (!matched) {
                const titleMatch = lineToParse.match(/^title\s+(.+)/i);
                if (titleMatch) {
                    tokens.push({ type: 'TITLE', text: titleMatch[1].trim(), line: currentLineNumber });
                    matched = true;
                }
            }
            // ------------------------------------------------------
            
            // If no pattern matched
            if (!matched) {
                errors.push(`Line ${currentLineNumber}: Unrecognized syntax: ${lineToParse}`);
            }

        } catch (e) {
            errors.push(`Line ${currentLineNumber}: Error processing line: ${e.message}`);
            console.error(`[ERROR] Line ${currentLineNumber}:`, e);
        }
    }
    
    // Add final DEDENTs to close any open blocks
     while (indentStack.length > 1) {
         indentStack.pop();
         tokens.push({ type: 'DEDENT', line: currentLineNumber + 1 });
         console.log(`[DEBUG] Final DEDENT to ${indentStack[indentStack.length-1]}`);
     }

    console.log(`[DEBUG] Tokenization complete: ${tokens.length} tokens`);
    console.log(`[DEBUG] Tokenizer errors: `, errors);
    
    return { tokens, errors };
}

/**
 * Parse the token stream into a model structure
 * @param {Array} tokens - The tokens to parse
 * @param {Object} model - The model to populate
 * @param {Array} parentScope - Parent scope stack for nested structures
 * @param {string} currentNamespace - Current namespace for modules
 */
function parseDSLTokens(tokens, model, parentScope = [], currentNamespace = '') {
    let i = 0;
    const tokenCount = tokens.length;
    let currentFlowName = null; // Track the flow being defined
    let currentMapName = null; // Track the map being defined
    let currentScenarioName = null; // Track the scenario being defined
    let currentBlock = null; // Track current group/module block
    
    console.log("[DEBUG] parseDSLTokens v1.2 starting with", tokenCount, "tokens");
    
    // Initialize model structure
    if (!model.timeConfig) model.timeConfig = { start: 0, end: 10, step: 0.25, unit: "time" };
    if (!model.groups) model.groups = {};
    if (!model.modules) model.modules = {};
    if (!model.constants) model.constants = {};
    if (!model.stocks) model.stocks = {};
    if (!model.flows) model.flows = {};
    if (!model.calcs) model.calcs = {};
    if (!model.maps) model.maps = {};
    if (!model.scenarios) model.scenarios = {};
    if (!model.sweeps) model.sweeps = {};
    if (!model.connections) model.connections = []; // Keep for influences, but don't populate from 'connect'

    function getQualifiedName(name) {
        return currentNamespace ? `${currentNamespace}.${name}` : name;
    }
    
    while (i < tokenCount) {
        const token = tokens[i];
        console.log(`[DEBUG] Processing token #${i}/${tokenCount-1}: ${token.type}${token.name ? ' ' + token.name : ''}${token.line ? ' at line ' + token.line : ''}`);
        
        switch (token.type) {
            case 'TITLE':
                model.title = token.text;
                console.log(`[DEBUG] Set model title: ${model.title}`);
                i++;
                break;
                
            case 'TIME_CONFIG':
                if (!model.simSettings) {
                    // Initialize with defaults if it doesn't exist
                    model.simSettings = { startTime: 0, endTime: 100, dt: 1 };
                }
                const settingKey = token.name.toLowerCase(); // e.g., 'starttime'
                const settingValue = token.value;
                // Map common names to the internal structure
                if (settingKey === 'starttime') {
                    model.simSettings.startTime = settingValue;
                } else if (settingKey === 'endtime') {
                    model.simSettings.endTime = settingValue;
                } else if (settingKey === 'timestep' || settingKey === 'dt') {
                    model.simSettings.dt = settingValue;
                }
                console.log(`[DEBUG] Set time config ${settingKey} to ${settingValue}`);
                i++;
                break;
                
            case 'CONSTANT':
                const constantFullName = getQualifiedName(token.name);
                model.constants[constantFullName] = {
                    expression: token.expression,
                    originalName: token.name,
                    namespace: currentNamespace
                };
                console.log(`[DEBUG] Added constant: ${constantFullName} = ${token.expression}`);
                i++;
                break;
                
            case 'STOCK':
                const stockFullName = getQualifiedName(token.name);
                model.stocks[stockFullName] = {
                    expression: token.expression,
                    originalName: token.name,
                    namespace: currentNamespace
                };
                console.log(`[DEBUG] Added stock: ${stockFullName} = ${token.expression}`);
                i++;
                break;
                
            case 'FLOW_START':
                currentFlowName = getQualifiedName(token.name);
                if (!model.flows[currentFlowName]) {
                     model.flows[currentFlowName] = {
                         effects: [],
                         originalName: token.name,
                         namespace: currentNamespace
                     };
                    console.log(`[DEBUG] Started flow definition: ${currentFlowName}`);
                } else {
                     console.warn(`[WARN] Duplicate flow definition ignored: ${currentFlowName}`);
                }
                i++;
                break;

            case 'FLOW_EFFECT':
                if (currentFlowName && model.flows[currentFlowName]) {
                    const effect = {
                        expression: token.expression,
                        polarity: token.polarity, // Store '-->' or '-+>'
                        target: getQualifiedName(token.target)
                    };
                    model.flows[currentFlowName].effects.push(effect);
                    console.log(`[DEBUG] Added effect to flow ${currentFlowName}: ${effect.expression} ${effect.polarity} ${effect.target}`);
                } else {
                    console.error(`[ERROR] Line ${token.line}: Flow effect found outside of a flow definition.`);
                    model.errors.push(`Line ${token.line}: Flow effect outside of flow definition`);
                }
                i++;
                break;
                
            case 'MAP_START':
                currentMapName = getQualifiedName(token.name);
                if (!model.maps[currentMapName]) {
                    model.maps[currentMapName] = { points: [], interpolation: token.interpolation, originalName: token.name, namespace: currentNamespace };
                    console.log(`[DEBUG] Started map definition: ${currentMapName} (Interpolation: ${token.interpolation})`);
                } else {
                    console.warn(`[WARN] Duplicate map definition ignored: ${currentMapName}`);
                }
                i++;
                break;
                
            case 'MAP_POINT':
                if (currentMapName && model.maps[currentMapName]) {
                    model.maps[currentMapName].points.push([token.x, token.y]);
                    console.log(`[DEBUG] Added point (${token.x}, ${token.y}) to map ${currentMapName}`);
                } else {
                    model.errors.push(`Line ${token.line}: Map point found outside of a map definition.`);
                }
                i++;
                break;
                
            case 'SCENARIO_START':
                currentScenarioName = token.name; // Scenarios are global, not namespaced
                if (!model.scenarios[currentScenarioName]) {
                    model.scenarios[currentScenarioName] = { overrides: {} };
                    console.log(`[DEBUG] Started scenario definition: ${currentScenarioName}`);
                } else {
                    console.warn(`[WARN] Duplicate scenario definition ignored: ${currentScenarioName}`);
                }
                i++;
                break;
                
            case 'OVERRIDE':
                if (currentScenarioName && model.scenarios[currentScenarioName]) {
                    const overrideTargetName = getQualifiedName(token.targetName); // Apply namespace to target
                    model.scenarios[currentScenarioName].overrides[overrideTargetName] = {
                        type: token.targetType, // 'stock' or 'constant'
                        expression: token.expression
                    };
                    console.log(`[DEBUG] Added override to scenario ${currentScenarioName}: ${token.targetType} ${overrideTargetName} = ${token.expression}`);
                } else {
                    model.errors.push(`Line ${token.line}: Override found outside of a scenario definition.`);
                }
                i++;
                break;
                
            case 'GROUP_START':
            case 'MODULE_START':
                // Handle nested blocks by recursively calling parseDSLTokens
                const blockType = token.type.split('_')[0].toLowerCase(); // 'group' or 'module'
                const blockName = token.name;
                const newNamespace = blockType === 'module' ? (currentNamespace ? `${currentNamespace}.${blockName}` : blockName) : currentNamespace;
                console.log(`[DEBUG] Entering ${blockType} block: ${blockName} (Namespace: ${newNamespace})`);
                
                // Push block info onto parent scope
                parentScope.push({ type: blockType, name: blockName });
                
                // Advance past the START token
                i++;
                
                // Consume tokens within the block
                const blockResult = parseDSLTokens(tokens.slice(i), model, parentScope, newNamespace);
                i += blockResult.consumed;
                
                // Pop block info from scope after processing
                parentScope.pop();
                console.log(`[DEBUG] Exiting ${blockType} block: ${blockName}`);
                // We expect a DEDENT token next, which will be handled below
                break;
                
            case 'INDENT':
                // Often handled implicitly by block structures, but we need to consume it
                console.log("[DEBUG] INDENT encountered");
                i++;
                break;
                
            case 'DEDENT':
                // Signifies the end of an indented block
                console.log("[DEBUG] DEDENT encountered");
                // Reset contexts that are tied to indentation
                if (currentFlowName) {
                    console.log(`[DEBUG] Finished flow definition: ${currentFlowName}`);
                    currentFlowName = null;
                }
                if (currentMapName) {
                    console.log(`[DEBUG] Finished map definition: ${currentMapName}`);
                    currentMapName = null;
                }
                if (currentScenarioName) {
                    console.log(`[DEBUG] Finished scenario definition: ${currentScenarioName}`);
                    currentScenarioName = null;
                }
                
                // If this DEDENT corresponds to the end of a GROUP or MODULE, return control
                if (parentScope.length > 0 && tokens[i-1].type !== 'INDENT') { // Basic check if DEDENT belongs to a block
                    console.log(`[DEBUG] DEDENT signals end of ${parentScope[parentScope.length-1].type} block`);
                    // Don't consume the DEDENT here; let the caller handle it or the main loop end
                    return { consumed: i }; // Return number of tokens consumed within the block
                }
                
                i++; // Consume the DEDENT token if not ending a recursive block call
                break;

            case 'CALC':
                const calcFullName = getQualifiedName(token.name);
                model.calcs[calcFullName] = {
                    expression: token.expression,
                    originalName: token.name,
                    namespace: currentNamespace
                };
                console.log(`[DEBUG] Added calc: ${calcFullName} = ${token.expression}`);
                i++;
                break;
                
            case 'SWEEP':
                {
                    // Add support for parameter sweeps
                    console.log(`[DEBUG] Processing sweep token: ${token.paramName} with values [${token.values}]`);
                    if (!model.sweeps) {
                        model.sweeps = {};
                        console.log("[DEBUG] Initialized sweeps object in model");
                    }
                    
                    // The token already contains the values, not an object
                    model.sweeps[token.paramName] = token.values;
                    console.log(`[DEBUG] Added sweep to model: ${token.paramName} -> [${model.sweeps[token.paramName].join(', ')}]`);
                    i++; // Important: Increment the counter
                    console.log(`[DEBUG] Advanced token counter to ${i}`);
                }
                break;
                
            case 'PLOT_TARGET':
                if (!model.plotTargets) {
                    model.plotTargets = [];
                }
                const plotTargetName = getQualifiedName(token.name); // Apply namespace
                if (!model.plotTargets.includes(plotTargetName)) {
                     model.plotTargets.push(plotTargetName);
                     console.log(`[DEBUG] Added plot target: ${plotTargetName}`);
                }
                i++;
                break;
                
            case 'LIMIT':
                if (!model.limits) {
                    model.limits = {};
                }
                const limitTargetName = getQualifiedName(token.name); // Apply namespace
                
                // Initialize limits for this target if not already present
                if (!model.limits[limitTargetName]) {
                    model.limits[limitTargetName] = {};
                }
                
                // Add provided limits (min/max), potentially overwriting if specified multiple times
                if (token.min !== undefined && !isNaN(token.min)) {
                    model.limits[limitTargetName].min = token.min;
                    console.log(`[DEBUG] Set limit min for ${limitTargetName}: ${token.min}`);
                }
                if (token.max !== undefined && !isNaN(token.max)) {
                    model.limits[limitTargetName].max = token.max;
                     console.log(`[DEBUG] Set limit max for ${limitTargetName}: ${token.max}`);
                }
                i++;
                break;
                
            default:
                console.log(`[DEBUG] Unknown or unhandled token type: ${token.type}`);
                i++;
                break;
        }
    }
    
    console.log(`[DEBUG] parseDSLTokens v1.2 finished processing ${i} tokens of ${tokenCount}`);
    return { consumed: i };
}

/**
 * Validate the complete model and detect special functions like smooth and delay3
 * @param {Object} model - The model to validate
 * @returns {Array} Array of validation errors
 */
function validateModel(model) {
    console.log("[DEBUG] Starting model validation");
    
    // Initialize storage for special functions if not already present
    if (!model.smoothStates) model.smoothStates = {};
    if (!model.delay3States) model.delay3States = {};
    if (!model.errors) model.errors = [];
    
    // Check for special functions (smooth and delay3) in calculation expressions
    console.log("[DEBUG] Checking for special functions (smooth, delay3) in calculation expressions");
    
    if (model.calcs) {
        for (const calcName in model.calcs) {
            const calc = model.calcs[calcName];
            const expr = calc.expression ? calc.expression.trim() : '';
            
            if (expr.startsWith('smooth(')) {
                console.log(`[DEBUG] Found smooth function in calculation: ${calcName}`);
                // Parse the smooth function parameters
                const params = extractFunctionParams(expr, 'smooth');
                if (params && params.length >= 2) {
                    const inputExpr = params[0];
                    const delayExpr = params[1];
                    const initialExpr = params.length > 2 ? params[2] : inputExpr;
                    
                    // Register the internal state for the smooth function
                    model.smoothStates[calcName] = {
                        inputExpr: inputExpr,
                        delayExpr: delayExpr,
                        initialExpr: initialExpr
                    };
                    
                    console.log(`[DEBUG] Registered smooth state for ${calcName} with input: ${inputExpr}, delay: ${delayExpr}, initial: ${initialExpr}`);
                } else {
                    model.errors.push(`Invalid smooth parameters in calculation '${calcName}'`);
                    console.error(`[ERROR] Invalid smooth parameters in calculation: ${calcName}`);
                }
            } else if (expr.startsWith('delay3(')) {
                console.log(`[DEBUG] Found delay3 function in calculation: ${calcName}`);
                // Parse the delay3 function parameters
                const params = extractFunctionParams(expr, 'delay3');
                if (params && params.length >= 2) {
                    const inputExpr = params[0];
                    const delayExpr = params[1];
                    const initialExpr = params.length > 2 ? params[2] : inputExpr;
                    
                    // Register the internal states for the delay3 function
                    model.delay3States[calcName] = {
                        inputExpr: inputExpr,
                        delayExpr: delayExpr,
                        initialExpr: initialExpr,
                        states: ['_delay3_' + calcName + '_1', '_delay3_' + calcName + '_2', '_delay3_' + calcName + '_3']
                    };
                    
                    console.log(`[DEBUG] Registered delay3 states for ${calcName} with input: ${inputExpr}, delay: ${delayExpr}, initial: ${initialExpr}`);
                } else {
                    model.errors.push(`Invalid delay3 parameters in calculation '${calcName}'`);
                    console.error(`[ERROR] Invalid delay3 parameters in calculation: ${calcName}`);
                }
            }
        }
    }
    
    // Validate map definitions
    if (model.maps) {
        for (const mapName in model.maps) {
            const map = model.maps[mapName];
            
            // Maps must have at least 2 points
            if (!map.points || map.points.length < 2) {
                model.errors.push(`Map '${mapName}' must have at least 2 points`);
                console.error(`[ERROR] Map '${mapName}' has fewer than 2 points`);
                continue;
            }
            
            // Points must be in strictly increasing x order
            let lastX = null;
            for (let i = 0; i < map.points.length; i++) {
                const point = map.points[i];
                if (point.length !== 2) {
                    model.errors.push(`Point #${i+1} in map '${mapName}' must have exactly 2 values`);
                    console.error(`[ERROR] Invalid point format in map '${mapName}'`);
                    continue;
                }
                
                const x = point[0];
                if (lastX !== null && x <= lastX) {
                    model.errors.push(`Points in map '${mapName}' must be in strictly increasing x order`);
                    console.error(`[ERROR] Points in map '${mapName}' are not in increasing x order`);
                    break;
                }
                lastX = x;
            }
        }
    }
    
    console.log(`[DEBUG] Model validation complete with ${model.errors.length} errors`);
    return model.errors;
}

/**
 * Extract parameters from a function call expression
 * @param {string} expr - The expression containing the function call
 * @param {string} funcName - The name of the function
 * @returns {Array} Array of parameter expressions or null if parsing fails
 */
function extractFunctionParams(expr, funcName) {
    try {
        // Match the content inside the parentheses of the function call
        const regex = new RegExp(`${funcName}\s*\(([\s\S]*)\)\s*$`);
        const match = expr.match(regex);
        
        if (!match || match.length < 2) return null;
        
        const paramsStr = match[1];
        
        // Handle the case of empty parameters
        if (!paramsStr.trim()) return [];
        
        // Split by commas, but respect nested parentheses
        const params = [];
        let paramStart = 0;
        let parenLevel = 0;
        
        for (let i = 0; i < paramsStr.length; i++) {
            const char = paramsStr[i];
            
            if (char === '(') {
                parenLevel++;
            } else if (char === ')') {
                parenLevel--;
            } else if (char === ',' && parenLevel === 0) {
                params.push(paramsStr.substring(paramStart, i).trim());
                paramStart = i + 1;
            }
        }
        
        // Add the last parameter
        params.push(paramsStr.substring(paramStart).trim());
        
        return params;
    } catch (e) {
        console.error(`[ERROR] Failed to extract parameters from function: ${expr}`, e);
        return null;
    }
}

/**
 * Compiles the expressions within the model object, evaluating constants,
 * preparing functions for calculations and flows, and calculating influences.
 * @param {Object} model - The model object populated by the parser.
 * @returns {Object} - An object containing any errors encountered.
 */
export function compileExpressions(model) {
    console.log("[DEBUG] Starting expression compilation v1.3 (preparing functions)...");
    let errors = [];
    const initialContext = { 
        ...model.builtInFunctions, 
        time: model.timeConfig?.start ?? 0, // Use initial time for constant/stock eval
        Math // Ensure Math is available
    }; 

    if (!model.influences) model.influences = {};

    // Helper to add influence
    const addInfluence = (target, source, polarity) => {
        if (!model.influences[target]) model.influences[target] = {};
        // Only add if source and target are different
        if (target !== source) {
            model.influences[target][source] = polarity;
            console.log(`[DEBUG] Influence: ${source} --(${polarity})--> ${target}`);
        }
    };
    
    // Helper to estimate polarity (simple numerical differentiation)
    const estimatePolarity = (expressionString, targetVar, sourceVar, currentContext) => {
        if (!expressionString || targetVar === sourceVar) return '?';

        // Check if all dependencies of the expression are available in the current context
        const dependencies = getDependencies(expressionString);
        for (const dep of dependencies) {
            if (!currentContext.hasOwnProperty(dep)) {
                console.warn(`[WARN] Polarity estimation skipped for ${sourceVar} -> ${targetVar}: Dependency '${dep}' not in current context.`);
                return '?'; // Cannot reliably estimate polarity if dependencies are missing
            }
        }

        // Proceed with estimation only if all dependencies are present
        try {
            const baseValue = evaluateExpression(expressionString, currentContext);
            // If base value itself fails (e.g., division by zero with initial values), return '?';
            if (isNaN(baseValue)) {
                 console.warn(`[WARN] Polarity estimation failed for ${sourceVar} -> ${targetVar}: Base evaluation resulted in NaN.`);
                 return '?';
            }

            // Create context with a slightly perturbed source value
            const perturbedContext = { ...currentContext };
            const originalSourceValue = perturbedContext[sourceVar] ?? 0; 
            const delta = Math.abs(originalSourceValue * 0.01) + 0.001; 
            perturbedContext[sourceVar] = originalSourceValue + delta;
            
            const perturbedValue = evaluateExpression(expressionString, perturbedContext);
             // If perturbed evaluation fails, return '?';
             if (isNaN(perturbedValue)) {
                  console.warn(`[WARN] Polarity estimation failed for ${sourceVar} -> ${targetVar}: Perturbed evaluation resulted in NaN.`);
                  return '?';
             }

            const difference = perturbedValue - baseValue;

            if (Math.abs(difference) < 1e-9) return '?'; 
            return difference > 0 ? '+' : '-';
            
        } catch (e) {
            console.warn(`[WARN] Polarity estimation failed for ${sourceVar} -> ${targetVar} due to evaluation error: ${e.message}`);
            return '?';
        }
    };


    // --- Process Constants --- 
    console.log("[DEBUG] Processing constants...");
    if (model.constants) {
        Object.entries(model.constants).forEach(([name, constant]) => {
            try {
                constant.compiledValue = evaluateExpression(constant.expression, initialContext);
                if (isNaN(constant.compiledValue)) throw new Error('Evaluation resulted in NaN');
                initialContext[name] = constant.compiledValue; // Add evaluated constant to context
                console.log(`[DEBUG] Constant ${name} = ${constant.compiledValue}`);
                const deps = getDependencies(constant.expression);
                deps.forEach(dep => {
                     if (initialContext.hasOwnProperty(dep)) { 
                          const polarity = estimatePolarity(constant.expression, name, dep, initialContext);
                          addInfluence(name, dep, polarity);
                     }
                });
            } catch (e) { errors.push(`Constant ${name}: ${e.message}`); constant.compiledValue = NaN; initialContext[name]=NaN; }
        });
    }

    // --- Process Stocks (Initial Values) --- 
    console.log("[DEBUG] Processing stock initial values...");
    if (model.stocks) {
        Object.entries(model.stocks).forEach(([name, stock]) => {
            try {
                stock.initialValue = evaluateExpression(stock.expression, initialContext);
                if (isNaN(stock.initialValue)) throw new Error('Evaluation resulted in NaN');
                initialContext[name] = stock.initialValue; // Add initial stock value to context
                console.log(`[DEBUG] Stock ${name} initial = ${stock.initialValue}`);
                 const deps = getDependencies(stock.expression);
                 deps.forEach(dep => {
                     if (initialContext.hasOwnProperty(dep)) {
                         const polarity = estimatePolarity(stock.expression, name, dep, initialContext);
                         addInfluence(name, dep, polarity);
                     }
                 });
            } catch (e) { errors.push(`Stock ${name} initial value: ${e.message}`); stock.initialValue = NaN; initialContext[name]=NaN; }
        });
    }

    // --- Prepare Context for Simulation Function Compilation --- 
    const stockNames = Object.keys(model.stocks || {});
    const constantNames = Object.keys(model.constants || {});
    const calcNames = Object.keys(model.calcs || {});
    const mapNames = Object.keys(model.maps || {});
    const builtInFuncNames = Object.keys(model.builtInFunctions || {});

    // Function parameters expected by compiled functions
    const contextKeysForSim = [
        'state', 
        'constants', 
        'calcs', 
        't', 
        'dtVal', 
        'Math', 
        ...builtInFuncNames, 
        ...mapNames // Map functions will be added to context
    ];

    // Generate mapping code for local variables inside compiled functions
    const stockMappings = stockNames.map(name => `const ${getSimpleName(name)} = state['${name}'];`).join('\n    ');
    const constantMappings = constantNames.map(name => `const ${getSimpleName(name)} = constants['${name}'];`).join('\n    ');
    // Calcs are accessed iteratively, directly from the 'calcs' object parameter
    const calcMappings = calcNames.map(name => `const ${getSimpleName(name)} = calcs['${name}'];`).join('\n    '); 
    const builtInMappings = builtInFuncNames.map(name => `const ${name} = ${name};`).join('\n    '); // Already parameters
    const mapFuncMappings = mapNames.map(name => `const ${getSimpleName(name)} = ${getSimpleName(name)};`).join('\n    '); // Map functions are parameters

    const variableMappingCode = `
    // Map context parameters to local variables
    const time = t; // Map 't' to 'time'
    ${stockMappings}
    ${constantMappings}
    ${calcMappings}
    ${builtInMappings}
    ${mapFuncMappings}
    `;

    // --- Compile Calculation Functions --- 
    console.log("[DEBUG] Compiling calculation functions (calcs)...");
    if (model.calcs) {
        Object.entries(model.calcs).forEach(([name, calc]) => {
            try {
                const functionBody = `"use strict";
                ${variableMappingCode}
                try { return (${calc.expression}); } catch(e) { console.error('Error in calc ${name}:', e); return NaN; }`;
                calc.valueFn = new Function(...contextKeysForSim, functionBody);
                console.log(`[DEBUG] Compiled calc function for: ${name}`);
                // Estimate influences using initial context
                const deps = getDependencies(calc.expression);
                deps.forEach(dep => {
                    if (initialContext.hasOwnProperty(dep)) {
                         const polarity = estimatePolarity(calc.expression, name, dep, initialContext);
                         addInfluence(name, dep, polarity);
                    }
                });
            } catch (e) { 
                errors.push(`Calculation ${name}: Failed to compile - ${e.message}`); 
                calc.valueFn = () => NaN; // Provide dummy function
            } 
        });
    }

    // --- Compile Flow Effect Functions --- 
    console.log("[DEBUG] Compiling flow effect functions...");
    if (model.flows) {
        Object.entries(model.flows).forEach(([name, flow]) => {
            if (flow.effects) {
                flow.effects.forEach((effect, index) => {
                    try {
                        const functionBody = `"use strict";
                        ${variableMappingCode}
                        try { return (${effect.expression}); } catch(e) { console.error('Error in flow ${name} effect ${index}:', e); return NaN; }`;
                        effect.fn = new Function(...contextKeysForSim, functionBody);
                        console.log(`[DEBUG] Compiled flow effect function for: ${name} #${index}`);
                        // Estimate influences using initial context
                        const deps = getDependencies(effect.expression);
                        deps.forEach(dep => {
                            if (initialContext.hasOwnProperty(dep)) {
                                const polarity = estimatePolarity(effect.expression, name, dep, initialContext);
                                addInfluence(name, dep, polarity);
                            }
                        });
                    } catch (e) { 
                        errors.push(`Flow ${name} effect #${index}: Failed to compile - ${e.message}`); 
                        effect.fn = () => NaN; 
                    }
                });
            }
        });
    }

    // --- Compile Map Functions (if not already done) --- 
    // Ensure map functions are prepared for the simulation context
    if (model.maps) {
        Object.values(model.maps).forEach(mapData => {
            // The actual map function generation might need to be adjusted 
            // depending on how simulation.js expects to call them.
            // Assuming simulation.js adds them to the context correctly.
            // No compilation needed here if simulation context handles it.
        });
    }

    console.log("[DEBUG] Expression compilation finished. Total errors: " + errors.length);
    if (errors.length > 0) {
        console.error("[ERROR] Errors during compilation:", errors);
    }
    model.errors = (model.errors || []).concat(errors);

    return { errors };
}

/**
 * Evaluates a JavaScript expression with the given context (for initial values only)
 * @param {string} expression - The expression to evaluate
 * @param {Object} context - The context object containing variables and functions
 * @returns {any} The evaluated result
 */
function evaluateExpression(expression, context) {
    if (!expression || typeof expression !== 'string') return NaN;
    console.log(`[DEBUG] Evaluating initial value expression: ${expression}`);
    try {
        const contextKeys = Object.keys(context);
        const contextValues = contextKeys.map(key => context[key]);
        const fn = new Function(...contextKeys, `return (${expression});`); // Wrap expression
        const result = fn(...contextValues);
        console.log(`[DEBUG] Expression result: ${result}`);
        return result;
    } catch (e) {
        console.error(`[ERROR] Failed to evaluate initial value expression: ${expression}`, e);
        // Don't throw here, let compileExpressions handle reporting
        return NaN; 
    }
}

// Helper function (ensure this exists or add it)
function getSimpleName(fullName) {
    const parts = fullName.split('.');
    return parts[parts.length - 1];
}

/**
 * Original parser function (v0.9.2) for backward compatibility
 */
export function parseDSL(dslText) {
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

// Helper function to extract potential variable names (dependencies) from an expression string
// Note: This is a simple regex approach and might capture keywords or function names.
// A proper AST parser would be more robust.
function getDependencies(expressionString) {
    if (!expressionString || typeof expressionString !== 'string') {
        return [];
    }
    // Match sequences that start with a letter or underscore, followed by letters, numbers, or underscores
    // Avoid matching numbers directly or parts of numbers (like things after a decimal)
    // Use a Set to automatically handle duplicates
    const identifiers = new Set();
    const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;

    // Temporary context to check against built-ins (assuming model.builtInFunctions exists where compileExpressions is called)
    // This is a simplification; ideally, context should be passed or accessible
    const tempBuiltIns = { 'smooth': true, 'delay3': true, 'step': true, 'pulse': true, 'map': true, 'min': true, 'max': true }; 

    while ((match = regex.exec(expressionString)) !== null) {
        const potentialVar = match[1];
        // Basic check to exclude common keywords or built-ins
        if (potentialVar !== 'time' && !tempBuiltIns.hasOwnProperty(potentialVar) && !['if', 'then', 'else', 'true', 'false'].includes(potentialVar) && isNaN(potentialVar)) { 
           identifiers.add(potentialVar);
        }
    }
    return [...identifiers];
} 
