/**
 * Utility functions for the DSL Parser.
 */

/**
 * Evaluates a JavaScript expression string within a given context.
 * Used primarily for evaluating initial values of constants and stocks.
 * IMPORTANT: This uses the Function constructor and should be used carefully.
 * It assumes the expression is safe and originates from trusted DSL input.
 * 
 * @param {string} expression - The expression string to evaluate.
 * @param {Object} context - An object where keys are variable names and values are their values.
 * @returns {any} The result of the expression evaluation, or NaN if evaluation fails.
 */
export function evaluateExpression(expression, context) {
    if (!expression || typeof expression !== 'string') {
        console.warn("[Utils evaluateExpression] Invalid expression provided:", expression);
        return NaN;
    }
    console.log(`[DEBUG Utils] Evaluating initial value expression: ${expression}`);
    
    try {
        // Add Math object to context if not already present
        const evalContext = { Math, ...context }; 
        
        const contextKeys = Object.keys(evalContext);
        const contextValues = contextKeys.map(key => evalContext[key]);
        
        // Create the function body. Ensure it's a return statement.
        // Handle potential empty expressions gracefully.
        const functionBody = `"use strict"; return (${expression.trim() || 'undefined'});`; 
        
        const fn = new Function(...contextKeys, functionBody);
        const result = fn(...contextValues);
        
        console.log(`[DEBUG Utils] Expression result: ${result}`);
        // Check for non-numeric results which are often errors in this context
        if (typeof result === 'number' && !isFinite(result)) {
             console.warn(`[Utils evaluateExpression] Expression '${expression}' resulted in non-finite number: ${result}`);
             return NaN; // Treat Infinity/-Infinity as NaN for initial values
        }
        return result;
    } catch (e) {
        console.error(`[Utils ERROR] Failed to evaluate initial value expression: ${expression}`, e);
        // Add error to model? Or let caller handle it.
        return NaN; // Return NaN on error
    }
}

/**
 * Extracts the simple name from a potentially namespaced name (e.g., "ModuleA.varName" -> "varName").
 * @param {string} fullName - The potentially namespaced name.
 * @returns {string} The simple name (the part after the last dot).
 */
export function getSimpleName(fullName) {
    if (typeof fullName !== 'string') return '';
    const parts = fullName.split('.');
    return parts[parts.length - 1];
}

/**
 * Extracts potential variable names (dependencies) from an expression string.
 * This uses a simple regex approach and might capture keywords or function names 
 * incorrectly in complex cases. It does basic filtering against common JS keywords 
 * and assumes a basic set of built-in functions.
 * A proper Abstract Syntax Tree (AST) parser would be more robust.
 * 
 * @param {string} expressionString - The expression string to analyze.
 * @param {Object} [knownBuiltIns={}] - Optional object mapping known built-in function names to true.
 * @returns {string[]} An array of unique potential identifier dependencies.
 */
export function getDependencies(expressionString, knownBuiltIns = {}) {
    if (!expressionString || typeof expressionString !== 'string') {
        return [];
    }
    
    const identifiers = new Set();
    // Regex: Match words starting with a letter or underscore, followed by word characters.
    // Use word boundaries (\b) to avoid matching parts of other words.
    const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;

    // Combine provided built-ins with a default basic set
    const defaultBuiltIns = { 'smooth': true, 'delay3': true, 'step': true, 'pulse': true, 'map': true, 'min': true, 'max': true, 'abs': true, 'sqrt': true, 'sin': true, 'cos': true, 'tan': true, 'exp': true, 'log': true, 'log10': true, 'pow': true };
    const allBuiltIns = { ...defaultBuiltIns, ...knownBuiltIns }; 

    // Basic JS keywords and literals to exclude
    const keywords = new Set([
        'if', 'then', 'else', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 
        'var', 'let', 'const', 'function', 'return', 'new', 'typeof', 'instanceof', 
        'Math', 'time' // 'time' is treated specially
    ]);

    while ((match = regex.exec(expressionString)) !== null) {
        const potentialVar = match[1];
        
        // Exclude if it's a keyword, a known built-in, or a number
        if (!keywords.has(potentialVar) && !allBuiltIns.hasOwnProperty(potentialVar) && isNaN(potentialVar)) { 
           identifiers.add(potentialVar);
        }
    }
    
    console.log(`[DEBUG Utils getDependencies] Found in '${expressionString}':`, [...identifiers]);
    return [...identifiers]; // Convert Set to Array
} 
