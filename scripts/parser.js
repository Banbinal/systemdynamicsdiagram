/**
 * Main parser module (v1.3+)
 * Orchestrates the parsing process by calling tokenizer, token parser, validator, and compiler.
 */

import { tokenizeDSL } from './tokenizer.js';
import { parseDSLTokens } from './tokenParser.js';
import { validateModel } from './validator.js';
import { compileExpressions } from './compiler.js';
// import { parseDSL as parseDSLegacy } from './legacyParser.js'; // Keep legacy for now if needed

/**
 * Parses the DSL text using the modularized parser components.
 * @param {string} dslText - The DSL text to parse.
 * @returns {object} The parsed model object, including errors and warnings.
 */
export function parseDSL(dslText) {
    console.log("[DEBUG v1.3] Starting modular parsing...");
    
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
        influences: {}, // Changed from array to object for target->source mapping
        timeConfig: { startTime: 0, endTime: 10, timeStep: 0.25 },
        errors: [],
        warnings: [],
        plotTargets: [],
        limits: {},
        title: null,
        builtInFunctions: { 
            // Add standard math functions and simulation-specific ones here
            // Example: min, max, abs, sqrt, sin, cos, tan, exp, log, log10, 
            //          step, pulse, smooth, delay3 etc. will be handled by compiler/simulation
            //          but basic Math functions should be available for initial evaluation
        },
    };

    // Add standard Math functions to builtInFunctions context
    for (const funcName of Object.getOwnPropertyNames(Math)) {
        if (typeof Math[funcName] === 'function') {
            model.builtInFunctions[funcName] = Math[funcName];
        }
    }

    // If empty input, return empty model
    if (!dslText || dslText.trim() === '') {
        model.errors.push("Empty model text");
        console.error("[DEBUG v1.3] Empty model text provided");
        return model;
    }

    try {
        // 1. Tokenize
        console.log("[DEBUG v1.3] Step 1: Tokenizing...");
        const tokenizerResult = tokenizeDSL(dslText);
        if (tokenizerResult.errors.length > 0) {
            model.errors.push(...tokenizerResult.errors);
            console.error("[DEBUG v1.3] Tokenizer errors:", tokenizerResult.errors);
            return model; // Stop if tokenization fails critically
        }
        const tokens = tokenizerResult.tokens;
        console.log(`[DEBUG v1.3] Tokenization complete: ${tokens.length} tokens`);

        // 2. Parse Tokens into Model Structure
        console.log("[DEBUG v1.3] Step 2: Parsing tokens...");
        const tokenParserResult = parseDSLTokens(tokens, model);
        // parseDSLTokens modifies the model directly and pushes errors/warnings
        console.log("[DEBUG v1.3] Token parsing complete.");
        if (model.errors.length > 0) {
            // Optionally return early if fundamental structure errors occur
            // console.warn("[DEBUG v1.3] Errors found during token parsing, validation/compilation might be incomplete.");
        }
        
        // 3. Validate Model Structure and Semantics
        console.log("[DEBUG v1.3] Step 3: Validating model...");
        validateModel(model); // validateModel modifies the model directly (adds errors/warnings)
        console.log(`[DEBUG v1.3] Validation complete. Total errors: ${model.errors.length}`);
        
        // 4. Compile Expressions (if no fatal errors so far)
        if (model.errors.length === 0) { // Or based on a severity check
            console.log("[DEBUG v1.3] Step 4: Compiling expressions...");
            compileExpressions(model); // compileExpressions modifies the model (adds compiled functions, influences, errors)
             console.log(`[DEBUG v1.3] Compilation complete. Total errors: ${model.errors.length}`);
        } else {
            console.warn("[DEBUG v1.3] Skipping compilation due to previous errors.");
        }

    } catch (error) {
        model.errors.push(`Unexpected parser error: ${error.message}`);
        console.error("[DEBUG v1.3] UNEXPECTED Exception during parsing:", error);
        console.error("[DEBUG v1.3] Stack trace:", error.stack);
    }

    console.log("[DEBUG v1.3] Modular parsing finished.");
    return model;
}

// Optional: Keep the old entry point if needed during transition
// export { parseDSLegacy as parseDSL_legacy };
// ... existing code ...
// --- Ensure all old code below this line is removed by replacing it --- 