/**
 * System Dynamics Tool v1.2
 * Utility functions for testing parameter sweep functionality
 */

import { parseDSLv1_2 } from './parser.js';
import { runParameterSweep } from './simulation.js';
import { plotSweepResults } from './plotting.js';
import { interpretSweepResults, displaySweepInterpretation } from './analysis.js';

/**
 * Validates a model to check if it has sweep parameters
 * @param {Object} model - The parsed model
 * @returns {Object} Validation result with status and message
 */
export function validateSweepModel(model) {
    if (!model) {
        return { valid: false, message: "Model is null or undefined" };
    }
    
    if (!model.sweeps || Object.keys(model.sweeps).length === 0) {
        return { 
            valid: false, 
            message: "No sweep parameters defined in model",
            details: "Add a sweep parameter using the syntax: sweep: ParameterName = [value1, value2, ...]"
        };
    }
    
    // Check if the swept parameter exists in constants
    for (const paramName of Object.keys(model.sweeps)) {
        if (!model.constants || !model.constants.hasOwnProperty(paramName)) {
            return {
                valid: false,
                message: `Sweep parameter '${paramName}' is not defined as a constant`,
                details: `Make sure '${paramName}' is defined as a constant before using it in a sweep`
            };
        }
    }
    
    return { 
        valid: true, 
        message: "Model contains valid sweep parameters",
        details: {
            sweepParams: Object.keys(model.sweeps),
            paramValues: model.sweeps
        }
    };
}

/**
 * Runs diagnostics on a parameter sweep simulation
 * @param {Object} results - The simulation results
 * @returns {Object} Diagnostics information
 */
export function diagnoseSimulationResults(results) {
    if (!results) {
        return {
            success: false,
            message: "Simulation results are null or undefined"
        };
    }
    
    const diagnostics = {
        success: true,
        paramName: results.paramName,
        paramValues: results.paramValues,
        timePoints: {
            count: results.timePoints?.length || 0,
            start: results.timePoints?.[0],
            end: results.timePoints?.[results.timePoints?.length - 1]
        },
        simulations: {
            count: results.simulations?.length || 0
        },
        stocks: [],
        flows: [],
        calculations: []
    };
    
    // Check simulations match parameter values
    if (results.paramValues?.length !== results.simulations?.length) {
        diagnostics.success = false;
        diagnostics.message = `Mismatch between parameter values (${results.paramValues?.length}) and simulations (${results.simulations?.length})`;
        return diagnostics;
    }
    
    // Analyze the first simulation to get variable names
    if (results.simulations && results.simulations.length > 0) {
        const firstSim = results.simulations[0];
        
        // Get stock names
        if (firstSim.stocks) {
            diagnostics.stocks = Object.keys(firstSim.stocks);
        }
        
        // Get flow names
        if (firstSim.flows) {
            diagnostics.flows = Object.keys(firstSim.flows);
        }
        
        // Get calculation names
        if (firstSim.calcs) {
            diagnostics.calculations = Object.keys(firstSim.calcs);
        }
        
        // Check data integrity
        let allTimeSeriesValid = true;
        let detectedIssues = [];
        
        // Check stocks
        for (const stockName of diagnostics.stocks) {
            const timeSeries = firstSim.stocks[stockName];
            if (!timeSeries || timeSeries.length !== results.timePoints.length) {
                allTimeSeriesValid = false;
                detectedIssues.push(`Stock '${stockName}' has invalid time series data (${timeSeries?.length} vs expected ${results.timePoints.length})`);
            }
        }
        
        // Check flows
        for (const flowName of diagnostics.flows) {
            const timeSeries = firstSim.flows[flowName];
            if (!timeSeries || timeSeries.length !== results.timePoints.length) {
                allTimeSeriesValid = false;
                detectedIssues.push(`Flow '${flowName}' has invalid time series data (${timeSeries?.length} vs expected ${results.timePoints.length})`);
            }
        }
        
        // Check calculations
        for (const calcName of diagnostics.calculations) {
            const timeSeries = firstSim.calcs[calcName];
            if (!timeSeries || timeSeries.length !== results.timePoints.length) {
                allTimeSeriesValid = false;
                detectedIssues.push(`Calculation '${calcName}' has invalid time series data (${timeSeries?.length} vs expected ${results.timePoints.length})`);
            }
        }
        
        if (!allTimeSeriesValid) {
            diagnostics.success = false;
            diagnostics.message = "Some time series data is invalid or incomplete";
            diagnostics.issues = detectedIssues;
        }
    }
    
    return diagnostics;
}

/**
 * Performs a full test of the parameter sweep functionality
 * @param {string} dslText - The DSL model text
 * @param {Function} logger - Optional logging function
 * @returns {Object} Test results
 */
export async function testParameterSweep(dslText, logger = console.log) {
    const results = {
        parsing: { success: false },
        validation: { success: false },
        simulation: { success: false },
        plotting: { success: false },
        analysis: { success: false }
    };
    
    try {
        // Step 1: Parse the model
        logger("Parsing DSL...");
        const model = parseDSLv1_2(dslText);
        
        if (model.errors && model.errors.length > 0) {
            results.parsing = {
                success: false,
                errors: model.errors
            };
            return results;
        }
        
        results.parsing = {
            success: true,
            model: {
                timeSettings: model.timeSettings,
                constants: Object.keys(model.constants || {}),
                stocks: Object.keys(model.stocks || {}),
                flows: Object.keys(model.flows || {}),
                calcs: Object.keys(model.calcs || {}),
                sweeps: model.sweeps ? Object.keys(model.sweeps) : []
            }
        };
        
        // Step 2: Validate the model for sweep parameters
        logger("Validating sweep parameters...");
        const validation = validateSweepModel(model);
        results.validation = validation;
        
        if (!validation.valid) {
            return results;
        }
        
        // Step 3: Run parameter sweep simulation
        logger("Running parameter sweep simulation...");
        const simResults = runParameterSweep(model);
        
        if (!simResults) {
            results.simulation = {
                success: false,
                message: "Simulation returned no results"
            };
            return results;
        }
        
        // Diagnose simulation results
        const diagnostics = diagnoseSimulationResults(simResults);
        results.simulation = {
            success: diagnostics.success,
            diagnostics: diagnostics
        };
        
        if (!diagnostics.success) {
            return results;
        }
        
        // Step 4: Test plotting (without actual rendering)
        logger("Testing plotting functionality...");
        try {
            // We don't actually render here, just check if the function works
            const dummyCanvas = { getContext: () => ({ canvas: {} }) };
            const chartConfig = plotSweepResults(simResults, dummyCanvas);
            
            results.plotting = {
                success: true,
                details: "Plotting function executed without errors"
            };
        } catch (plotError) {
            results.plotting = {
                success: false,
                error: plotError.message
            };
            return results;
        }
        
        // Step 5: Test analysis
        logger("Testing analysis functionality...");
        try {
            const interpretation = interpretSweepResults(simResults);
            
            results.analysis = {
                success: true,
                hasInterpretation: !!interpretation,
                insights: interpretation?.insights?.length || 0,
                comparisons: interpretation?.comparisons?.length || 0
            };
            
            // Create a dummy element to test display function
            const dummyElement = { innerHTML: "" };
            displaySweepInterpretation(simResults, interpretation, dummyElement);
            
            // If we got here, everything worked
            results.overall = {
                success: true,
                message: "Parameter sweep functionality working correctly"
            };
            
        } catch (analysisError) {
            results.analysis = {
                success: false,
                error: analysisError.message
            };
        }
        
    } catch (error) {
        results.overall = {
            success: false,
            error: error.message
        };
    }
    
    return results;
}

/**
 * Gets detailed information about available modules and functions
 * @returns {Object} Module information
 */
export function getModuleInfo() {
    return {
        parser: {
            available: typeof parseDSLv1_2 !== 'undefined',
            functions: ['parseDSLv1_2']
        },
        simulation: {
            available: typeof runParameterSweep !== 'undefined',
            functions: ['runParameterSweep']
        },
        plotting: {
            available: typeof plotSweepResults !== 'undefined',
            functions: ['plotSweepResults']
        },
        analysis: {
            available: typeof interpretSweepResults !== 'undefined' && 
                      typeof displaySweepInterpretation !== 'undefined',
            functions: ['interpretSweepResults', 'displaySweepInterpretation']
        }
    };
} 