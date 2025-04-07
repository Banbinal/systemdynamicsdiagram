/**
 * Model Validator for DSL v1.3+
 * Performs semantic checks on the parsed model structure.
 */

// Note: Functions extracted directly from the legacy parser.
// Consider refinement and potentially more focused validation checks.

/**
 * Extract parameters from a function call expression (e.g., smooth(a, b)) 
 * Handles nested parentheses.
 * @param {string} expr - The expression containing the function call
 * @param {string} funcName - The name of the function (e.g., 'smooth')
 * @returns {Array|null} Array of parameter expressions (as strings) or null if parsing fails
 */
function extractFunctionParams(expr, funcName) {
    try {
        // Match the content inside the parentheses of the function call
        // Regex uses non-capturing group for funcName start, whitespace handling,
        // and captures everything inside the outer parentheses.
        const regex = new RegExp(`(?:^|\s)${funcName}\s*\(([\s\S]*)\)\s*$`);
        const match = expr.match(regex);
        
        if (!match || match.length < 2) {
            console.warn(`[validator] Could not match params for function ${funcName} in expression: ${expr}`);
            return null;
        }
        
        const paramsStr = match[1];
        
        // Handle the case of empty parameters: func()
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
                 if (parenLevel < 0) { // Malformed parentheses
                     console.error(`[validator] Mismatched parentheses in parameter string: ${paramsStr}`);
                     return null; 
                 }
            } else if (char === ',' && parenLevel === 0) {
                // Found a top-level comma, push the parameter
                params.push(paramsStr.substring(paramStart, i).trim());
                paramStart = i + 1; // Start next param after the comma
            }
        }
        
         // Check for unbalanced parentheses at the end
         if (parenLevel !== 0) {
             console.error(`[validator] Unbalanced parentheses in parameter string: ${paramsStr}`);
             return null;
         }

        // Add the last parameter (the part after the last top-level comma)
        params.push(paramsStr.substring(paramStart).trim());
        
        // Filter out any potentially empty strings if the input had trailing commas like func(a,)
        return params.filter(p => p !== '');
    } catch (e) {
        console.error(`[validator ERROR] Failed to extract parameters from function: ${expr}`, e);
        return null;
    }
}

/**
 * Validate the complete model structure and semantics.
 * Detects special functions like smooth and delay3, validates map points, 
 * checks for undefined variables (basic), etc.
 * Modifies the model by adding errors/warnings and potentially state info for special funcs.
 * @param {Object} model - The model to validate (will be modified)
 * @returns {void} Errors are added directly to model.errors
 */
export function validateModel(model) {
    console.log("[DEBUG validator] Starting model validation v1.3");
    
    // Initialize error/warning arrays if not present
    if (!model.errors) model.errors = [];
    if (!model.warnings) model.warnings = [];
    
    // Build a set of all defined names for quick lookup (including namespaces)
    const definedNames = new Set([
        ...Object.keys(model.constants || {}),
        ...Object.keys(model.stocks || {}),
        ...Object.keys(model.flows || {}),
        ...Object.keys(model.calcs || {}),
        ...Object.keys(model.maps || {}),
        ...Object.keys(model.modules || {}),
        'time' // Implicitly available
    ]);

    // --- Validate Special Functions (Smooth, Delay3) in Calcs --- 
    console.log("[DEBUG validator] Checking for special functions (smooth, delay3) in calcs...");
    if (!model.smoothStates) model.smoothStates = {};
    if (!model.delay3States) model.delay3States = {};

    if (model.calcs) {
        for (const calcName in model.calcs) {
            const calc = model.calcs[calcName];
            const expr = calc.expression ? calc.expression.trim() : '';
            const lineNum = calc.line || '?'; // Get line number if available
            
            // Check for SMOOTH
            if (expr.startsWith('smooth(')) {
                console.log(`[DEBUG validator] Found potential smooth function in calc: ${calcName} at line ${lineNum}`);
                const params = extractFunctionParams(expr, 'smooth');
                if (params && params.length >= 2) {
                    const inputExpr = params[0];
                    const delayExpr = params[1];
                    // Initial value is optional, defaults to input expression
                    const initialExpr = params.length > 2 ? params[2] : inputExpr;
                    
                    // Store info needed for simulation state initialization
                    model.smoothStates[calcName] = {
                        inputExpr: inputExpr,
                        delayExpr: delayExpr,
                        initialExpr: initialExpr,
                        calcLine: lineNum // Store originating line
                    };
                    console.log(`[DEBUG validator] Registered smooth state for ${calcName} with input: ${inputExpr}, delay: ${delayExpr}, initial: ${initialExpr}`);
                    
                    // TODO: Add basic validation for input/delay/initial expressions?
                    // e.g., check if they reference undefined variables using getDependencies?

                } else {
                    model.errors.push(`Line ${lineNum}: Invalid smooth parameters in calculation '${calcName}'. Expected smooth(input, delay [, initial]).`);
                    console.error(`[ERROR validator] Invalid smooth parameters in calc: ${calcName} at line ${lineNum}`);
                }
            // Check for DELAY3
            } else if (expr.startsWith('delay3(')) {
                console.log(`[DEBUG validator] Found potential delay3 function in calc: ${calcName} at line ${lineNum}`);
                const params = extractFunctionParams(expr, 'delay3');
                if (params && params.length >= 2) {
                    const inputExpr = params[0];
                    const delayExpr = params[1];
                     // Initial value is optional, defaults to input expression
                    const initialExpr = params.length > 2 ? params[2] : inputExpr;
                    
                    // Generate internal state names (must be unique)
                    const baseStateName = `_delay3_${calcName.replace(/\./g, '_')}`;
                    const stateNames = [
                        `${baseStateName}_1`,
                        `${baseStateName}_2`,
                        `${baseStateName}_3`
                    ];

                     // Ensure generated state names don't clash with user-defined names
                     for (const stateName of stateNames) {
                         if (definedNames.has(stateName)) {
                             model.errors.push(`Line ${lineNum}: Internal state name collision for delay3('${calcName}'). Cannot use internally generated name '${stateName}'. Please rename '${calcName}'.`);
                         }
                     }

                    // Store info needed for simulation state initialization
                    model.delay3States[calcName] = {
                        inputExpr: inputExpr,
                        delayExpr: delayExpr,
                        initialExpr: initialExpr,
                        states: stateNames, // Store the generated internal state names
                        calcLine: lineNum // Store originating line
                    };
                    console.log(`[DEBUG validator] Registered delay3 states for ${calcName} with input: ${inputExpr}, delay: ${delayExpr}, initial: ${initialExpr}`);
                    
                     // TODO: Add basic validation for input/delay/initial expressions?

                } else {
                    model.errors.push(`Line ${lineNum}: Invalid delay3 parameters in calculation '${calcName}'. Expected delay3(input, delay [, initial]).`);
                    console.error(`[ERROR validator] Invalid delay3 parameters in calc: ${calcName} at line ${lineNum}`);
                }
            }
        }
    }
    
    // --- Validate Map Definitions --- 
    console.log("[DEBUG validator] Validating map definitions...");
    if (model.maps) {
        for (const mapName in model.maps) {
            const map = model.maps[mapName];
            const lineNum = map.line || '?';
            
            // Maps must have at least 2 points
            if (!map.points || map.points.length < 2) {
                model.errors.push(`Line ${lineNum}: Map '${mapName}' must have at least 2 points defined.`);
                console.error(`[ERROR validator] Map '${mapName}' at line ${lineNum} has fewer than 2 points`);
                continue; // Skip further checks for this map
            }
            
            // Points must be numbers and in strictly increasing x order
            let lastX = -Infinity; // Initialize lower than any possible first point
            let pointsValid = true;
            for (let i = 0; i < map.points.length; i++) {
                const point = map.points[i];
                // Check point format
                if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number' || isNaN(point[0]) || isNaN(point[1])) {
                    model.errors.push(`Line ${lineNum}: Invalid point format #${i+1} in map '${mapName}'. Expected (number, number). Found: (${point ? point.join(', ') : 'invalid'}).`);
                    console.error(`[ERROR validator] Invalid point format in map '${mapName}' at line ${lineNum}`);
                    pointsValid = false;
                    break; // Stop checking points for this map
                }
                
                const x = point[0];
                // Check increasing X order
                if (x <= lastX) {
                    model.errors.push(`Line ${lineNum}: Points in map '${mapName}' must be in strictly increasing x order. Point #${i+1} (${x}) is not greater than previous (${lastX}).`);
                    console.error(`[ERROR validator] Points in map '${mapName}' at line ${lineNum} are not in increasing x order`);
                    pointsValid = false;
                    break; // Stop checking points for this map
                }
                lastX = x;
            }
            // If points were valid, sort them just in case (although parser should handle it)
            if (pointsValid) {
                map.points.sort((a, b) => a[0] - b[0]);
            }
        }
    }

    // --- Validate Flow Effects Targets --- 
    console.log("[DEBUG validator] Validating flow effect targets...");
    if (model.flows) {
        for (const flowName in model.flows) {
            const flow = model.flows[flowName];
            if (flow.effects) {
                flow.effects.forEach((effect, index) => {
                    const targetName = effect.target; // Target is already qualified by tokenParser
                    const lineNum = effect.line || flow.line || '?';
                    // Check if the target is a defined stock
                    if (!model.stocks || !model.stocks[targetName]) {
                         model.errors.push(`Line ${lineNum}: Target '${effect.targetOriginal}' (resolved as '${targetName}') for flow '${flow.originalName}' is not a defined stock.`);
                    }
                });
            }
        }
    }

    // --- Validate Scenario Overrides --- 
    console.log("[DEBUG validator] Validating scenario overrides...");
    if (model.scenarios) {
        for (const scenarioName in model.scenarios) {
            const scenario = model.scenarios[scenarioName];
            const scenarioLine = scenario.line || '?';
            for (const targetName in scenario.overrides) {
                const override = scenario.overrides[targetName];
                const lineNum = override.line || scenarioLine;
                // Check if the overridden variable (constant or stock) exists
                if (!model.constants[targetName] && !model.stocks[targetName]) {
                    model.errors.push(`Line ${lineNum}: Scenario '${scenarioName}' tries to override undefined variable '${override.targetOriginal}' (resolved as '${targetName}').`);
                }
                // Check if the type matches (e.g., cannot override a stock as a constant)
                if (model.constants[targetName] && override.type !== 'constant') {
                     model.errors.push(`Line ${lineNum}: Scenario '${scenarioName}' tries to override constant '${override.targetOriginal}' as a '${override.type}'.`);
                }
                if (model.stocks[targetName] && override.type !== 'stock') {
                     model.errors.push(`Line ${lineNum}: Scenario '${scenarioName}' tries to override stock '${override.targetOriginal}' as a '${override.type}'.`);
                }
            }
        }
    }
    
    // --- Validate Sweep Parameters --- 
    console.log("[DEBUG validator] Validating sweep parameters...");
    if (model.sweeps) {
        for (const paramName in model.sweeps) {
            // Check if the swept parameter exists as a constant
            if (!model.constants || !model.constants[paramName]) {
                 // Find the line number from the token if possible (requires parser to add it)
                 // This lookup is a bit inefficient; ideally, token parser adds line# to sweep def
                 const sweepLine = '?'; // Placeholder - need line info from parser
                 model.errors.push(`Line ${sweepLine}: Swept parameter '${paramName}' is not defined as a constant.`);
            }
            // Check if values are valid numbers (parser should filter NaNs, but double-check)
            const values = model.sweeps[paramName];
            if (!Array.isArray(values) || values.some(isNaN)) {
                const sweepLine = '?'; // Placeholder
                model.errors.push(`Line ${sweepLine}: Sweep for '${paramName}' contains invalid non-numeric values.`);
            }
        }
    }

    // --- Validate Plot Targets --- 
     console.log("[DEBUG validator] Validating plot targets...");
     if (model.plotTargets) {
         model.plotTargets = model.plotTargets.filter(targetName => {
             // Check if the target exists as a stock, calc, or potentially constant
             if (!model.stocks[targetName] && !model.calcs[targetName] && !model.constants[targetName]) {
                 const plotLine = '?'; // Placeholder - need line info from parser
                 model.warnings.push(`Line ${plotLine}: Plot target '${targetName}' is not a defined stock, calculation, or constant. It will be ignored.`);
                 return false; // Remove invalid target
             }
             return true; // Keep valid target
         });
     }

    // --- Validate Limits --- 
    console.log("[DEBUG validator] Validating limit targets...");
    if (model.limits) {
        for (const targetName in model.limits) {
            const limitInfo = model.limits[targetName];
            const lineNum = limitInfo.line || '?';
            // Check if the target exists (stock or calc typically)
            if (!model.stocks[targetName] && !model.calcs[targetName]) {
                 model.warnings.push(`Line ${lineNum}: Limit directive applied to undefined variable '${targetName}'. Limit will be ignored.`);
                 // Optionally remove the limit: delete model.limits[targetName];
                 continue;
            }
            // Check if min <= max if both are defined
            if (limitInfo.min !== undefined && limitInfo.max !== undefined && limitInfo.min > limitInfo.max) {
                 model.errors.push(`Line ${lineNum}: Invalid limit for '${targetName}'. Min value (${limitInfo.min}) cannot be greater than max value (${limitInfo.max}).`);
            }
        }
    }

    // --- Basic Undefined Variable Check (within expressions) --- 
    // This is complex with namespaces. A full check needs the compiler stage.
    // Simple check: Iterate through expressions and see if identifiers exist *somewhere*
    // console.log("[DEBUG validator] Performing basic check for undefined variables...");
    // Add checks here if desired, using getDependencies and definedNames set.
    // Needs careful handling of namespaces.

    console.log(`[DEBUG validator] Model validation complete. Total errors: ${model.errors.length}, Warnings: ${model.warnings.length}`);
}
