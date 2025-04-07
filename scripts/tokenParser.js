/**
 * Token Parser for DSL v1.3+
 * Converts a stream of tokens into the basic model structure.
 */

// Note: This function is extracted directly from the legacy parser.
// It modifies the model object directly.
// Consider returning updates instead or using a class structure later.

/**
 * Helper function to get the fully qualified name within a namespace.
 * @param {string} name - The simple name.
 * @param {string} currentNamespace - The current namespace (e.g., "ModuleA.SubModuleB").
 * @returns {string} The fully qualified name.
 */
function getQualifiedName(name, currentNamespace) {
    return currentNamespace ? `${currentNamespace}.${name}` : name;
}

/**
 * Parse the token stream into a model structure
 * @param {Array} tokens - The tokens to parse
 * @param {Object} model - The model to populate (will be modified directly)
 * @param {Array} parentScope - Parent scope stack for nested structures (internal use)
 * @param {string} currentNamespace - Current namespace for modules (internal use)
 * @returns {Object} Result object, currently includes `consumed` for block parsing.
 */
export function parseDSLTokens(tokens, model, parentScope = [], currentNamespace = '') {
    let i = 0;
    const tokenCount = tokens.length;
    let currentFlowName = null; // Track the flow being defined
    let currentMapName = null; // Track the map being defined
    let currentScenarioName = null; // Track the scenario being defined
    // let currentBlock = null; // Track current group/module block - Handled by recursion now
    
    console.log("[DEBUG tokenParser] Starting token parsing v1.3 with", tokenCount, "tokens. Namespace:", currentNamespace || '(root)');
    
    // Ensure necessary model structures exist (might be redundant if main parser initializes)
    // if (!model.timeConfig) model.timeConfig = { startTime: 0, endTime: 10, timeStep: 0.25 };
    if (!model.constants) model.constants = {};
    if (!model.stocks) model.stocks = {};
    if (!model.flows) model.flows = {};
    if (!model.calcs) model.calcs = {};
    if (!model.maps) model.maps = {};
    if (!model.scenarios) model.scenarios = {}; // Scenarios remain global
    if (!model.sweeps) model.sweeps = {}; // Sweeps remain global
    if (!model.plotTargets) model.plotTargets = [];
    if (!model.limits) model.limits = {};
    if (!model.errors) model.errors = []; // Ensure errors array exists
    if (!model.warnings) model.warnings = []; // Ensure warnings array exists

    while (i < tokenCount) {
        const token = tokens[i];
        console.log(`[DEBUG tokenParser] Processing token #${i}/${tokenCount-1}: ${token.type}${token.name ? ' ' + token.name : ''}${token.line ? ' at line ' + token.line : ''} in NS '${currentNamespace}'`);
        
        switch (token.type) {
            case 'TITLE':
                if (currentNamespace === '') { // Title only allowed at root level
                    model.title = token.text;
                    console.log(`[DEBUG tokenParser] Set model title: ${model.title}`);
                } else {
                     model.warnings.push(`Line ${token.line}: Title directive ignored inside module '${currentNamespace}'.`);
                }
                i++;
                break;
                
            case 'TIME_CONFIG':
                 if (currentNamespace === '') { // Time config only at root level
                    if (!model.timeConfig) { // Use existing object or create if needed
                        model.timeConfig = {};
                    }
                    const settingKey = token.name.toLowerCase(); // e.g., 'starttime'
                    const settingValue = token.value;
                    // Map common names to the internal structure
                    if (settingKey === 'starttime') {
                        model.timeConfig.startTime = settingValue;
                    } else if (settingKey === 'endtime') {
                        model.timeConfig.endTime = settingValue;
                    } else if (settingKey === 'timestep') {
                        model.timeConfig.timeStep = settingValue;
                    }
                    console.log(`[DEBUG tokenParser] Set time config ${settingKey} to ${settingValue}`);
                } else {
                    model.warnings.push(`Line ${token.line}: Time config '${token.name}' ignored inside module '${currentNamespace}'.`);
                }
                i++;
                break;
                
            case 'CONSTANT':
                {
                    const constantFullName = getQualifiedName(token.name, currentNamespace);
                    if (model.constants[constantFullName] || model.stocks[constantFullName] || model.flows[constantFullName] || model.calcs[constantFullName] || model.maps[constantFullName]) {
                        model.errors.push(`Line ${token.line}: Duplicate definition for '${constantFullName}'.`);
                    } else {
                        model.constants[constantFullName] = {
                            expression: token.expression,
                            originalName: token.name,
                            namespace: currentNamespace,
                            line: token.line
                        };
                        console.log(`[DEBUG tokenParser] Added constant: ${constantFullName} = ${token.expression}`);
                    }
                }
                i++;
                break;
                
            case 'STOCK':
                {
                    const stockFullName = getQualifiedName(token.name, currentNamespace);
                     if (model.constants[stockFullName] || model.stocks[stockFullName] || model.flows[stockFullName] || model.calcs[stockFullName] || model.maps[stockFullName]) {
                         model.errors.push(`Line ${token.line}: Duplicate definition for '${stockFullName}'.`);
                     } else {
                        model.stocks[stockFullName] = {
                            expression: token.expression, // This is the initial value expression
                            originalName: token.name,
                            namespace: currentNamespace,
                            line: token.line
                        };
                        console.log(`[DEBUG tokenParser] Added stock: ${stockFullName} = ${token.expression}`);
                    }
                }
                i++;
                break;
                
            case 'FLOW_START':
                 {
                    currentFlowName = getQualifiedName(token.name, currentNamespace);
                    if (model.constants[currentFlowName] || model.stocks[currentFlowName] || model.flows[currentFlowName] || model.calcs[currentFlowName] || model.maps[currentFlowName]) {
                         model.errors.push(`Line ${token.line}: Duplicate definition for flow '${currentFlowName}'.`);
                         // Set to null so subsequent effects don't get added to a potentially wrong flow
                         currentFlowName = null; 
                    } else {
                         model.flows[currentFlowName] = {
                             effects: [],
                             originalName: token.name,
                             namespace: currentNamespace,
                             line: token.line
                         };
                        console.log(`[DEBUG tokenParser] Started flow definition: ${currentFlowName}`);
                    }
                }
                i++;
                break;

            case 'FLOW_EFFECT':
                if (currentFlowName && model.flows[currentFlowName]) {
                    // Target needs resolving relative to the *current* namespace context
                    // This assumes targets can be global or within the same/parent module,
                    // which needs careful validation later.
                    const effect = {
                        expression: token.expression,
                        polarity: token.polarity, // Store '-->' or '-+>'
                        target: getQualifiedName(token.target, currentNamespace), // Resolve target in current context
                        targetOriginal: token.target, // Keep original for potential later resolution if needed
                        line: token.line
                    };
                    model.flows[currentFlowName].effects.push(effect);
                    console.log(`[DEBUG tokenParser] Added effect to flow ${currentFlowName}: ${effect.expression} ${effect.polarity} ${effect.target} (orig: ${effect.targetOriginal})`);
                } else {
                    model.errors.push(`Line ${token.line}: Flow effect found outside of a valid flow definition.`);
                }
                i++;
                break;
                
            case 'MAP_START':
                 {
                    currentMapName = getQualifiedName(token.name, currentNamespace);
                     if (model.constants[currentMapName] || model.stocks[currentMapName] || model.flows[currentMapName] || model.calcs[currentMapName] || model.maps[currentMapName]) {
                         model.errors.push(`Line ${token.line}: Duplicate definition for map '${currentMapName}'.`);
                         currentMapName = null; // Prevent adding points to wrong map
                     } else {
                        model.maps[currentMapName] = { 
                            points: [], 
                            interpolation: token.interpolation,
                            originalName: token.name, 
                            namespace: currentNamespace,
                            line: token.line 
                        };
                        console.log(`[DEBUG tokenParser] Started map definition: ${currentMapName} (Interpolation: ${token.interpolation})`);
                    }
                }
                i++;
                break;
                
            case 'MAP_POINT':
                if (currentMapName && model.maps[currentMapName]) {
                    model.maps[currentMapName].points.push([token.x, token.y]);
                    console.log(`[DEBUG tokenParser] Added point (${token.x}, ${token.y}) to map ${currentMapName}`);
                } else {
                    model.errors.push(`Line ${token.line}: Map point found outside of a valid map definition.`);
                }
                i++;
                break;
                
            case 'SCENARIO_START':
                 if (currentNamespace === '') { // Scenarios only at root level
                    currentScenarioName = token.name; // Scenarios are global, not namespaced
                    if (!model.scenarios[currentScenarioName]) {
                        model.scenarios[currentScenarioName] = { overrides: {}, line: token.line };
                        console.log(`[DEBUG tokenParser] Started scenario definition: ${currentScenarioName}`);
                    } else {
                        model.warnings.push(`Line ${token.line}: Duplicate scenario definition ignored: ${currentScenarioName}`);
                        currentScenarioName = null; // Prevent adding overrides to wrong scenario
                    }
                } else {
                     model.warnings.push(`Line ${token.line}: Scenario definition ignored inside module '${currentNamespace}'.`);
                     currentScenarioName = null; // Ensure overrides aren't added
                }
                i++;
                break;
                
            case 'OVERRIDE':
                if (currentScenarioName && model.scenarios[currentScenarioName]) {
                    // Override targets can be namespaced, they need full qualification
                    const overrideTargetName = getQualifiedName(token.targetName, currentNamespace);
                    model.scenarios[currentScenarioName].overrides[overrideTargetName] = {
                        type: token.targetType, // 'stock' or 'constant'
                        expression: token.expression,
                        targetOriginal: token.targetName,
                        line: token.line
                    };
                    console.log(`[DEBUG tokenParser] Added override to scenario ${currentScenarioName}: ${token.targetType} ${overrideTargetName} = ${token.expression}`);
                } else {
                    model.errors.push(`Line ${token.line}: Override found outside of a valid scenario definition.`);
                }
                i++;
                break;
                
            // MODULE_START (GROUP_START is deprecated/ignored or treated as module)
            case 'GROUP_START': 
                 model.warnings.push(`Line ${token.line}: 'group' keyword is deprecated, treating as 'module'.`);
                 // Fall through to MODULE_START
            case 'MODULE_START':
                 {
                    // Handle nested blocks by recursively calling parseDSLTokens
                    const blockType = 'module'; 
                    const blockName = token.name;
                    const newNamespace = getQualifiedName(blockName, currentNamespace);
                    console.log(`[DEBUG tokenParser] Entering ${blockType} block: ${blockName} (Namespace: ${newNamespace})`);
                    
                    // Check for duplicate module name (optional, could allow merging)
                    // if (model.modules[newNamespace]) { ... }
                    
                    // Add module info to model (maybe just for structure, actual content is namespaced)
                    if (!model.modules) model.modules = {};
                    model.modules[newNamespace] = { originalName: blockName, parentNamespace: currentNamespace, line: token.line };

                    // Push block info onto parent scope for tracking hierarchy
                    parentScope.push({ type: blockType, name: blockName });
                    
                    // Advance past the START token
                    i++;
                    
                    // Consume tokens within the block recursively
                    const blockResult = parseDSLTokens(tokens.slice(i), model, parentScope, newNamespace);
                    i += blockResult.consumed; // Advance main loop counter by tokens consumed in recursion
                    
                    // Pop block info from scope after processing
                    parentScope.pop();
                    console.log(`[DEBUG tokenParser] Exiting ${blockType} block: ${blockName}`);
                    // We expect a DEDENT token next, which will be handled by the DEDENT case
                }
                break;
                
            case 'INDENT':
                // Handled implicitly by block structures or ignored if not expected
                console.log("[DEBUG tokenParser] INDENT encountered");
                i++;
                break;
                
            case 'DEDENT':
                // Signifies the end of an indented block (flow, map, scenario, module)
                console.log("[DEBUG tokenParser] DEDENT encountered");
                
                // Reset contexts that are tied strictly to indentation within the *current* level
                // Note: Module end is handled by the return from recursion
                if (currentFlowName) {
                    console.log(`[DEBUG tokenParser] Finished flow definition (dedent): ${currentFlowName}`);
                    currentFlowName = null;
                }
                if (currentMapName) {
                    console.log(`[DEBUG tokenParser] Finished map definition (dedent): ${currentMapName}`);
                    currentMapName = null;
                }
                 if (currentScenarioName && currentNamespace === '') { // Only reset if dedent is at root level for scenario
                     console.log(`[DEBUG tokenParser] Finished scenario definition (dedent): ${currentScenarioName}`);
                     currentScenarioName = null;
                 }

                // If this DEDENT corresponds to the end of the current recursive call (module end)
                // the calling function needs this token to know the block ended.
                if (parentScope.length > 0) {
                    console.log(`[DEBUG tokenParser] DEDENT signals end of block initiated by ${parentScope[parentScope.length-1].type} '${parentScope[parentScope.length-1].name}'`);
                    // Don't consume the DEDENT here, return control. The `consumed` count will include up to *before* this DEDENT.
                    return { consumed: i }; 
                }
                
                // Consume the DEDENT token only if it doesn't belong to ending a recursive block
                i++; 
                break;

            case 'CALC':
                 {
                    const calcFullName = getQualifiedName(token.name, currentNamespace);
                    if (model.constants[calcFullName] || model.stocks[calcFullName] || model.flows[calcFullName] || model.calcs[calcFullName] || model.maps[calcFullName]) {
                         model.errors.push(`Line ${token.line}: Duplicate definition for calc '${calcFullName}'.`);
                    } else {
                        model.calcs[calcFullName] = {
                            expression: token.expression,
                            originalName: token.name,
                            namespace: currentNamespace,
                            line: token.line
                        };
                        console.log(`[DEBUG tokenParser] Added calc: ${calcFullName} = ${token.expression}`);
                    }
                 }
                i++;
                break;
                
            case 'SWEEP':
                if (currentNamespace === '') { // Sweeps only allowed at root level
                    // Add support for parameter sweeps
                    console.log(`[DEBUG tokenParser] Processing sweep token: ${token.paramName} with values [${token.values}]`);
                    if (!model.sweeps) {
                        model.sweeps = {};
                    }
                    // Check for duplicate sweep definition for the same parameter
                    if (model.sweeps[token.paramName]) {
                        model.warnings.push(`Line ${token.line}: Duplicate sweep definition for '${token.paramName}'. Overwriting previous definition.`);
                    }
                    model.sweeps[token.paramName] = token.values;
                    console.log(`[DEBUG tokenParser] Added sweep to model: ${token.paramName} -> [${model.sweeps[token.paramName].join(', ')}]`);
                } else {
                     model.warnings.push(`Line ${token.line}: Sweep definition ignored inside module '${currentNamespace}'.`);
                }
                i++;
                break;
                
            case 'PLOT_TARGET':
                 if (currentNamespace === '') { // Plot targets only at root level for now
                    if (!model.plotTargets) {
                        model.plotTargets = [];
                    }
                    // Plot targets can refer to namespaced variables
                    const plotTargetName = getQualifiedName(token.name, currentNamespace); // Resolve in current context, though likely meant globally
                     // We store the potentially namespaced name. Validation will check if it exists.
                    if (!model.plotTargets.includes(plotTargetName)) {
                         model.plotTargets.push(plotTargetName); // Store the resolved name
                         console.log(`[DEBUG tokenParser] Added plot target: ${plotTargetName} (Original: ${token.name})`);
                    }
                 } else {
                      model.warnings.push(`Line ${token.line}: Plot directive ignored inside module '${currentNamespace}'.`);
                 }
                i++;
                break;
                
            case 'LIMIT':
                 {
                     // Limits can apply to namespaced variables
                     const limitTargetName = getQualifiedName(token.name, currentNamespace); 
                    
                    // Initialize limits for this target if not already present
                    if (!model.limits[limitTargetName]) {
                        model.limits[limitTargetName] = {};
                    }
                    
                    // Add provided limits (min/max), potentially overwriting if specified multiple times
                    if (token.min !== undefined && !isNaN(token.min)) {
                        model.limits[limitTargetName].min = token.min;
                        console.log(`[DEBUG tokenParser] Set limit min for ${limitTargetName}: ${token.min}`);
                    }
                    if (token.max !== undefined && !isNaN(token.max)) {
                        model.limits[limitTargetName].max = token.max;
                         console.log(`[DEBUG tokenParser] Set limit max for ${limitTargetName}: ${token.max}`);
                    }
                    // Store the line number for potential error reporting later
                    model.limits[limitTargetName].line = token.line;
                 }
                i++;
                break;
                
            default:
                console.warn(`[DEBUG tokenParser] Unknown or unhandled token type in this context: ${token.type}`);
                i++;
                break;
        }
    }
    
    // If the loop finishes without returning (i.e., not ending a recursive block),
    // it means all tokens at the current level were processed.
    console.log(`[DEBUG tokenParser] Finished processing ${i} tokens at namespace '${currentNamespace || '(root)'}'`);
    return { consumed: i }; // Return the total count consumed at this level
}
