import { evaluateExpression, getDependencies, getSimpleName } from './parserUtils.js';

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
        'builtIns', // Pass the whole builtIns object
        'mapFns'    // Pass the whole mapFns object
    ];

    // Generate mapping code for local variables inside compiled functions
    const stockMappings = stockNames.map(name => `const ${getSimpleName(name)} = state['${name}'];`).join('\n    ');
    const constantMappings = constantNames.map(name => `const ${getSimpleName(name)} = constants['${name}'];`).join('\n    ');
    const calcMappings = calcNames.map(name => `const ${getSimpleName(name)} = calcs['${name}'];`).join('\n    '); 
    // Extract functions from the passed objects
    const builtInMappings = builtInFuncNames.map(name => `const ${name} = builtIns['${name}'];`).join('\n    '); 
    const mapFuncMappings = mapNames.map(name => `const ${getSimpleName(name)} = mapFns['${getSimpleName(name)}'];`).join('\n    ');

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
