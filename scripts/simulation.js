/**
 * Simulation Module for System Dynamics Tool v1.2
 * Implements RK4 integration for system dynamics models
 */

import { compileExpressions } from './compiler.js';
import { evaluateExpression } from './parserUtils.js';

/**
 * Runs the simulation using RK4 method
 * @param {Object} model - The parsed model
 * @param {string | null} scenarioName - Optional scenario name to use for simulation
 * @param {Object | null} sweepOverrides - Optional object with { paramName: value } for sweeps
 * @returns {Object|null} - Simulation results or null if simulation fails
 */
function runSimulationv1_2(model, scenarioName = null, sweepOverrides = null) {
    if (!model || model.errors?.length > 0) {
        console.error("[SIM ERROR] Invalid model provided to runSimulationv1_2.");
        return { error: true, results: null, message: "Invalid model provided (parsing errors or null)." }; 
    }

    // Setup simulation parameters and state
    const currentState = {};
    const constants = {};
    const calcs = {};
    
    // Apply constants to simulation
    for (const constantName in model.constants) {
        try {
            const constant = model.constants[constantName];
            constants[constantName] = constant.compiledValue;
            if (constants[constantName] === undefined) {
                console.error(`Constant ${constantName} has no compiled value after compileExpressions.`);
                if (constant.expression) {
                    constants[constantName] = evaluateExpression(constant.expression, {});
                } else {
                    throw new Error(`Constant ${constantName} missing compiled value and expression.`);
                }
            }
        } catch (error) {
            console.error(`Error evaluating constant ${constantName}:`, error);
            return null;
        }
    }
    
    // --- Apply sweep overrides FIRST ---
    if (sweepOverrides) {
        console.log("[DEBUG sim] Applying sweep overrides:", sweepOverrides);
        for (const paramName in sweepOverrides) {
            if (constants.hasOwnProperty(paramName)) {
                constants[paramName] = sweepOverrides[paramName];
                console.log(`[DEBUG sim] Sweep override applied: ${paramName} = ${constants[paramName]}`);
            } else {
                 console.warn(`[WARN sim] Sweep parameter '${paramName}' not found in model constants. Skipping override.`);
                 // Optionally return an error? 
                 // return { error: true, results: null, message: `Sweep parameter '${paramName}' not found.` };
            }
        }
    }
    
    // --- Apply scenario overrides SECOND (can overwrite sweeps) --- 
    if (scenarioName && model.scenarios && model.scenarios[scenarioName]) {
        const overrides = model.scenarios[scenarioName].overrides;
        console.log(`[DEBUG] Applying scenario overrides for: ${scenarioName}`, overrides);
        
        // Apply CONSTANT overrides first, updating the constants context
        for (const varName in overrides) {
            const override = overrides[varName];
            if (override.type === 'constant') {
                try {
                    // Evaluate override expression using the *initial* constants context (before any overrides)
                    // This prevents order dependency if overrides refer to other overridden constants.
                    // We might need a copy of the initial constants if complex dependencies exist.
                    // For simplicity, let's use the current `constants` object, assuming simple overrides.
                    const overrideValue = evaluateExpression(override.expression, constants);
                    if (isNaN(overrideValue)) {
                        throw new Error(`Override expression for constant '${varName}' evaluated to NaN`);
                    }
                    constants[varName] = overrideValue; // Overwrite the constant value
                    console.log(`[DEBUG] Scenario override applied: Constant ${varName} = ${overrideValue}`);
                } catch (error) {
                    console.error(`Error applying scenario override for constant ${varName}:`, error);
                    // Decide how to handle: return error, use default, etc.
                    return { error: true, results: null, message: `Error applying scenario override for constant ${varName}: ${error.message}` };
                }
            }
        }

        // Initialize stocks using base initial values
        for (const stockName in model.stocks) {
             try {
                 const stock = model.stocks[stockName];
                 currentState[stockName] = stock.initialValue;
                 if (isNaN(currentState[stockName])) {
                    throw new Error(`Stock ${stockName} base initialization resulted in NaN`);
                 }
             } catch (error) {
                 console.error(`Error initializing stock ${stockName} before overrides:`, error);
                 return { error: true, results: null, message: `Error initializing stock ${stockName}: ${error.message}` };
             }
        }
        
        // Apply STOCK overrides, using the potentially updated constants context
        for (const varName in overrides) {
            const override = overrides[varName];
            if (override.type === 'stock') {
                try {
                    const overrideValue = evaluateExpression(override.expression, constants); // Use potentially overridden constants
                    if (isNaN(overrideValue)) {
                        throw new Error(`Override expression for stock '${varName}' evaluated to NaN`);
                    }
                    currentState[varName] = overrideValue; // Overwrite the initial stock value
                    console.log(`[DEBUG] Scenario override applied: Stock ${varName} = ${overrideValue}`);
                } catch (error) {
                     console.error(`Error applying scenario override for stock ${varName}:`, error);
                     return { error: true, results: null, message: `Error applying scenario override for stock ${varName}: ${error.message}` };
                }
            }
        }
    } else {
        // No scenario or scenario not found, just initialize stocks normally
        if (scenarioName) {
             console.warn(`[SIM WARN] Scenario '${scenarioName}' requested but not found or model.scenarios missing.`);
             // Consider if this should be an error: 
             // return { error: true, results: null, message: `Scenario '${scenarioName}' not found.` };
        }
        // Initialize stocks using base initial values if no scenario applies
        for (const stockName in model.stocks) {
            try {
                const stock = model.stocks[stockName];
                currentState[stockName] = stock.initialValue;
                 if (isNaN(currentState[stockName])) {
                     throw new Error(`Stock ${stockName} base initialization resulted in NaN`);
                 }
            } catch (error) {
                 console.error(`Error initializing stock ${stockName}:`, error);
                 return { error: true, results: null, message: `Error initializing stock ${stockName}: ${error.message}` };
            }
        }
    }
    // --- End scenario override application ---
    
    // Initialize smooth states
    for (const smoothName in model.smoothStates) {
        const smooth = model.smoothStates[smoothName];
        try {
            // Initialize the smooth state with the input value
            const inputValue = smooth.inputFn(currentState, constants, calcs, 0, 0);
            currentState[smooth.stateName] = inputValue;
        } catch (error) {
            console.error(`Error initializing smooth state for ${smoothName}:`, error);
            return null;
        }
    }
    
    // Initialize delay3 states
    for (const delayName in model.delay3States) {
        const delay = model.delay3States[delayName];
        try {
            // Initialize all three delay stages with the input value
            const inputValue = delay.inputFn(currentState, constants, calcs, 0, 0);
            currentState[delay.stateName1] = inputValue;
            currentState[delay.stateName2] = inputValue;
            currentState[delay.stateName3] = inputValue;
        } catch (error) {
            console.error(`Error initializing delay3 states for ${delayName}:`, error);
            return null;
        }
    }
    
    // Set up time parameters
    const startTime = model.timeConfig?.startTime ?? config.DEFAULT_START_TIME;
    const endTime = model.timeConfig?.endTime ?? config.DEFAULT_END_TIME;
    const dt = model.timeConfig?.timeStep ?? config.DEFAULT_TIME_STEP;

    // Validate time config
    if (isNaN(endTime) || isNaN(startTime) || isNaN(dt) || dt <= 0) {
        console.error(`[SIM ERROR] Invalid time configuration: Start=${startTime}, End=${endTime}, Step=${dt}`);
        return { error: true, results: null, message: "Invalid time configuration (NaN or non-positive dt)." };
    }
    
    // Set up results structure
    const results = { 
        time: [], 
        stocks: {}, 
        calcs: {} 
    };
    
    // Initialize results arrays for stocks
    for (const stockName in model.stocks) {
        // Skip internal states for smooth/delay3
        if (!stockName.startsWith('_smooth_') && !stockName.startsWith('_delay3_')) {
            results.stocks[stockName] = [];
        }
    }
    
    // Initialize results arrays for calcs
    for (const calcName in model.calcs) {
        results.calcs[calcName] = [];
    }
    
    // RK4 helper functions
    const scaleObject = (obj, factor) => { 
        const res = {}; 
        for (const k in obj) res[k] = obj[k] * factor; 
        return res; 
    };
    
    const addObject = (obj1, obj2) => { 
        const res = {}; 
        for (const k in obj1) res[k] = obj1[k] + (obj2[k] || 0); 
        return res; 
    };
    
    const combineRK4 = (k1, k2, k3, k4) => { 
        const res = {}; 
        for (const k in k1) res[k] = (k1[k] + 2*k2[k] + 2*k3[k] + k4[k]) / 6; 
        return res; 
    };
    
    /**
     * Calculate derivatives for all stocks based on the current state
     * @param {number} time - Current simulation time
     * @param {Object} state - Current state values
     * @param {number} dtVal - Time step
     * @returns {Object} - Derivatives for all state variables
     */
    const calculateDerivatives = (time, state, dtVal) => {
        const derivatives = {};
        const currentCalcs = {};
        
        // Initialize all derivatives to zero
        for (const stockName in model.stocks) {
            derivatives[stockName] = 0;
        }
        
        // Calculate aux values first (calc in v1.2) - they might depend on each other
        // so we need to iterate until they stabilize
        let calcChanged = true;
        let calcIterations = 0;
        const maxCalcIterations = Object.keys(model.calcs).length * 2 + 5; // Limit iterations
        
        // Initialize calc values based on smooth and delay3 outputs
        for (const calcName in model.calcs) {
            if (model.smoothStates[calcName]) {
                currentCalcs[calcName] = state[model.smoothStates[calcName].stateName];
            } else if (model.delay3States[calcName]) {
                currentCalcs[calcName] = state[model.delay3States[calcName].stateName3];
            } else {
                currentCalcs[calcName] = NaN; // Initialize others as NaN
            }
        }
        
        // Iterate until calc values stabilize
        while (calcChanged && calcIterations < maxCalcIterations) {
            calcChanged = false;
            calcIterations++;
            
            for (const calcName in model.calcs) {
                // Skip calcs that are smooth or delay3 outputs
                if (model.smoothStates[calcName] || model.delay3States[calcName]) {
                    continue;
                }
                
                try {
                    const calc = model.calcs[calcName];
                    const oldValue = currentCalcs[calcName];
                    // Pass Math, builtIns, and mapFns
                    const newValue = calc.valueFn(state, constants, currentCalcs, time, dtVal, Math, model.builtInFunctions || {}, model.mapFunctions || {});
                    
                    if (isNaN(newValue)) {
                        throw new Error(`Calc '${calcName}' evaluated to NaN`);
                    }
                    
                    if (isNaN(oldValue) || Math.abs(newValue - oldValue) > 1e-10) {
                        currentCalcs[calcName] = newValue;
                        calcChanged = true;
                    }
                } catch (error) {
                    console.error(`Error evaluating calc ${calcName}:`, error);
                    throw error;
                }
            }
        }
        
        if (calcIterations >= maxCalcIterations) {
            console.warn(`Calc values might not have stabilized at t=${time.toFixed(2)}`);
        }
        
        // Process flows to calculate stock derivatives
        for (const flowName in model.flows) {
            const flow = model.flows[flowName];
            
            // Evaluate each flow effect
            flow.effects.forEach(effect => {
                try {
                    // Calculate the flow effect value
                    // Pass Math, builtIns, and mapFns
                    const effectValue = effect.fn(state, constants, currentCalcs, time, dtVal, Math, model.builtInFunctions || {}, model.mapFunctions || {});
                    
                    if (isNaN(effectValue)) {
                        throw new Error(`Flow effect evaluated to NaN`);
                    }
                    
                    // Apply the effect to the target stock's derivative based on polarity
                    if (effect.polarity === '-+>') { 
                        derivatives[effect.target] += effectValue;
                    } else if (effect.polarity === '-->') { 
                        derivatives[effect.target] -= effectValue;
                    } else {
                        // Should not happen with v1.2 parser, but good to handle
                        console.warn(`[WARN] Unknown polarity '${effect.polarity}' for flow effect in ${flowName}`);
                    }
                } catch (error) {
                    console.error(`Error evaluating flow effect in ${flowName}:`, error);
                    throw error;
                }
            });
        }
        
        // Calculate derivatives for smooth states
        for (const smoothName in model.smoothStates) {
            const smooth = model.smoothStates[smoothName];
            try {
                const inputValue = smooth.inputFn(state, constants, currentCalcs, time, dtVal);
                const delayTime = smooth.delayFn(state, constants, currentCalcs, time, dtVal);
                const currentValue = state[smooth.stateName];
                
                if (isNaN(inputValue) || isNaN(delayTime)) {
                    throw new Error(`Smooth parameters evaluated to NaN`);
                }
                
                // Avoid division by zero
                if (delayTime <= 1e-9) {
                    derivatives[smooth.stateName] = 0;
                } else {
                    derivatives[smooth.stateName] = (inputValue - currentValue) / delayTime;
                }
            } catch (error) {
                console.error(`Error calculating derivative for smooth ${smoothName}:`, error);
                throw error;
            }
        }
        
        // Calculate derivatives for delay3 states
        for (const delayName in model.delay3States) {
            const delay = model.delay3States[delayName];
            try {
                const inputValue = delay.inputFn(state, constants, currentCalcs, time, dtVal);
                const delayTime = delay.delayFn(state, constants, currentCalcs, time, dtVal);
                
                // Each stage has transit time = total delay / 3
                const transitTime = delayTime > 1e-9 ? delayTime / 3.0 : 1e-9;
                
                if (isNaN(inputValue) || isNaN(delayTime)) {
                    throw new Error(`Delay3 parameters evaluated to NaN`);
                }
                
                // Material flows from input to stage 1, from stage 1 to 2, from stage 2 to 3
                const s1 = state[delay.stateName1];
                const s2 = state[delay.stateName2];
                const s3 = state[delay.stateName3];
                
                derivatives[delay.stateName1] = (inputValue - s1) / transitTime;
                derivatives[delay.stateName2] = (s1 - s2) / transitTime;
                derivatives[delay.stateName3] = (s2 - s3) / transitTime;
            } catch (error) {
                console.error(`Error calculating derivatives for delay3 ${delayName}:`, error);
                throw error;
            }
        }
        
        return derivatives;
    };
    
    // Run the simulation
    try {
        const numSteps = Math.ceil((endTime - startTime) / dt);
        let currentTime = startTime;
        
        // Main simulation loop
        for (let step = 0; step <= numSteps; step++) {
            // Record current state
            results.time.push(currentTime);
            
            for (const stockName in model.stocks) {
                if (!stockName.startsWith('_smooth_') && !stockName.startsWith('_delay3_')) {
                    results.stocks[stockName].push(currentState[stockName]);
                }
            }
            
            // Calculate and record calc values for the current time step
            const currentCalcValues = {};
            
            // Initialize with smooth and delay3 outputs
            for (const calcName in model.calcs) {
                if (model.smoothStates[calcName]) {
                    currentCalcValues[calcName] = currentState[model.smoothStates[calcName].stateName];
                } else if (model.delay3States[calcName]) {
                    currentCalcValues[calcName] = currentState[model.delay3States[calcName].stateName3];
                } else {
                    currentCalcValues[calcName] = NaN;
                }
            }
            
            // Calculate regular calcs
            let calcChanged = true;
            let calcIterations = 0;
            const maxCalcIterations = Object.keys(model.calcs).length * 2 + 5;
            
            while (calcChanged && calcIterations < maxCalcIterations) {
                calcChanged = false;
                calcIterations++;
                
                for (const calcName in model.calcs) {
                    if (model.smoothStates[calcName] || model.delay3States[calcName]) continue;
                    
                    try {
                        const calc = model.calcs[calcName];
                        const oldValue = currentCalcValues[calcName];
                        // Pass Math, builtIns, and mapFns
                        const newValue = calc.valueFn(currentState, constants, currentCalcValues, currentTime, dt, Math, model.builtInFunctions || {}, model.mapFunctions || {});
                        
                        if (isNaN(oldValue) || Math.abs(newValue - oldValue) > 1e-10) {
                            currentCalcValues[calcName] = newValue;
                            calcChanged = true;
                        }
                    } catch (error) {
                        console.error(`Error calculating calc ${calcName} at t=${currentTime}:`, error);
                        currentCalcValues[calcName] = NaN;
                        // Maybe add an error/warning to results?
                        // results.errors.push(`Calc error for ${calcName} at t=${currentTime}: ${error.message}`);
                    }
                }
            }
            
            // Record calc values
            for (const calcName in model.calcs) {
                results.calcs[calcName].push(currentCalcValues[calcName]);
            }
            
            // Stop if we reached the end time
            if (step === numSteps) break;
            
            // RK4 Integration step - Wrap in try/catch specific to integration
            try {
                const k1_derivs = calculateDerivatives(currentTime, currentState, dt);
                const k1 = scaleObject(k1_derivs, dt);
                const state_k2 = addObject(currentState, scaleObject(k1, 0.5));
                
                const k2_derivs = calculateDerivatives(currentTime + dt / 2, state_k2, dt);
                const k2 = scaleObject(k2_derivs, dt);
                const state_k3 = addObject(currentState, scaleObject(k2, 0.5));
                
                const k3_derivs = calculateDerivatives(currentTime + dt / 2, state_k3, dt);
                const k3 = scaleObject(k3_derivs, dt);
                const state_k4 = addObject(currentState, k3);
                
                const k4_derivs = calculateDerivatives(currentTime + dt, state_k4, dt);
                const k4 = scaleObject(k4_derivs, dt);
                
                const delta_state = combineRK4(k1, k2, k3, k4);
                
                // Update state with calculated changes
                for (const stateName in currentState) {
                    if (isNaN(delta_state[stateName])) {
                        throw new Error(`NaN detected in state change for '${stateName}'`);
                    }
                    currentState[stateName] += delta_state[stateName];

                    // Apply limits if defined for this state variable
                    if (model.limits && model.limits[stateName]) {
                        const limits = model.limits[stateName];
                        const currentValue = currentState[stateName];
                        let clampedValue = currentValue;

                        if (limits.min !== undefined && !isNaN(limits.min) && clampedValue < limits.min) {
                            clampedValue = limits.min;
                        }
                        if (limits.max !== undefined && !isNaN(limits.max) && clampedValue > limits.max) {
                            clampedValue = limits.max;
                        }
                        currentState[stateName] = clampedValue;
                    }
                }
                
                // Advance time
                currentTime += dt;
            } catch (integrationError) {
                console.error(`Error during RK4 integration at t=${currentTime}:`, integrationError);
                // Add error message to results structure?
                // results.errors = results.errors || [];
                // results.errors.push(`RK4 failed at t=${currentTime}: ${integrationError.message}`);
                // Return error structure instead of null
                return { error: true, results: null, message: `Error during RK4 integration at t=${currentTime}: ${integrationError.message}` };
            }
        }
        
        console.log(`Simulation completed successfully. Time points: ${results.time.length}`);
        // Return success structure
        return { error: false, results: results };
    } catch (error) {
        console.error("Simulation failed:", error);
        // Return error structure
        return { error: true, results: null, message: `Simulation failed: ${error.message}` };
    }
}

/**
 * Find the fully qualified name of a variable given its simple name
 * @param {Object} collection - Collection of model elements (stocks, constants, calcs)
 * @param {string} simpleName - The simple name to look for
 * @returns {string|null} - The fully qualified name if found, or null
 */
function findFullyQualifiedName(collection, simpleName) {
    for (const fullName in collection) {
        if (collection[fullName].originalName === simpleName) {
            return fullName;
        }
    }
    return null;
}

/**
 * Original simulation function (v0.9.2) for backward compatibility
 */
export function runSimulation(model, overrideParams = null) {
    if (!model || model.errors?.length > 0) {
        return null; 
    }
    
    // Use overrideParams if provided, otherwise use the model's default params
    const simParams = overrideParams || model.params;
    
    const currentState = {};
    for (const stateName in model.stocks) {
        currentState[stateName] = model.stocks[stateName]?.initialValue ?? NaN;
        if (isNaN(currentState[stateName])) {
            return null;
        }
    }
    
    const { startTime, endTime, dt } = model.simSettings;
    const results = { time: [], stocks: {}, auxiliaries: {} };
    for (const sn in model.stocks) {
        if (!sn.startsWith('_smooth_') && !sn.startsWith('_delay3_')) results.stocks[sn] = [];
    }
    for (const an in model.auxiliaries) results.auxiliaries[an] = [];
    
    const numSteps = Math.max(0, Math.ceil((endTime - startTime) / dt));
    const maxIterations = numSteps + 10;
    let iterations = 0;
    let currentTime = startTime;
    
    const scaleObject = (obj, factor) => { const res={}; for(const k in obj)res[k]=obj[k]*factor; return res; };
    const addObject = (obj1, obj2) => { const res={}; for(const k in obj1)res[k]=obj1[k]+(obj2[k]||0); return res; };
    const combineRK4 = (k1, k2, k3, k4) => { const res={}; for(const k in k1)res[k]=(k1[k]+2*k2[k]+2*k3[k]+k4[k])/6; return res; };
    
    /** Calculates all derivatives for a given state and time */
    const calculateAllDerivatives = (time, state, dtVal) => {
        const derivatives = {};
        const auxValues = {};
        let changed = true;
        let iter = 0;
        const maxIter = Object.keys(model.auxiliaries).length + 5;
        
        // Initialize aux values based on state (for SMOOTH/DELAY3 outputs)
        for (const auxName in model.auxiliaries) {
            if (model.smoothStates[auxName]) {
                auxValues[auxName] = state[model.smoothStates[auxName].stateName];
            } else if (model.delay3States[auxName]) {
                auxValues[auxName] = state[model.delay3States[auxName].stateName3];
            } else {
                auxValues[auxName] = NaN; // Initialize others as NaN
            }
        }
        
        // Iteratively calculate auxiliaries until they stabilize
        while(changed && iter < maxIter) {
            changed = false;
            iter++;
            for (const auxName in model.auxiliaries) {
                if (model.smoothStates[auxName] || model.delay3States[auxName]) continue; // Skip SMOOTH/DELAY3 outputs
                try {
                    const oldVal = auxValues[auxName];
                    // Use model functions but currentSimParams
                    const newVal = model.auxiliaries[auxName].fn(state, simParams, auxValues, Math, time, dtVal);
                    if (isNaN(newVal)) throw new Error(`Aux '${auxName}' calculated as NaN in deriv calc at t=${time.toFixed(2)}.`);
                    if (newVal !== oldVal || auxValues[auxName] === undefined || isNaN(auxValues[auxName])) {
                        auxValues[auxName] = newVal;
                        changed = true;
                    }
                } catch (e) {
                    throw new Error(`Error calc aux '${auxName}' for derivative at t=${time.toFixed(2)}: ${e.message}`);
                }
            }
        }
        if (iter >= maxIter) console.warn("Aux values might not have stabilized during derivative calculation.");
        
        // Calculate flow values using stabilized auxiliaries
        const flowValues = {};
        for (const fn in model.flows) {
            try {
                // Use model functions but currentSimParams
                flowValues[fn] = model.flows[fn].fn(state, simParams, auxValues, Math, time, dtVal);
                if (isNaN(flowValues[fn])) throw new Error(`Flow '${fn}' calculated as NaN in derivative calc at t=${time.toFixed(2)}.`);
            } catch (e) {
                throw new Error(`Error calc flow '${fn}' for derivative at t=${time.toFixed(2)}: ${e.message}`);
            }
        }
        
        // Calculate stock derivatives from flows
        for (const stockName in model.stocks) {
            if (!stockName.startsWith('_smooth_') && !stockName.startsWith('_delay3_')) derivatives[stockName] = 0;
        }
        model.connections.forEach(c => {
            if (flowValues.hasOwnProperty(c.flow) && derivatives.hasOwnProperty(c.stock)) {
                const mult = c.direction === 'in' ? 1 : -1;
                derivatives[c.stock] += mult * flowValues[c.flow];
            }
        });
        
        // Calculate derivatives for SMOOTH states
        for (const auxName in model.smoothStates) {
            const si = model.smoothStates[auxName];
            const sn = si.stateName;
            try {
                const inputVal = si.inputFn(state, simParams, auxValues, Math, time, dtVal);
                const delayTime = si.delayFn(state, simParams, auxValues, Math, time, dtVal);
                const currentVal = state[sn];
                if (isNaN(inputVal) || isNaN(delayTime)) throw new Error(`SMOOTH NaN input/delay for '${auxName}'.`);
                if (delayTime <= 1e-9) {
                    derivatives[sn] = 0;
                } else {
                    derivatives[sn] = (inputVal - currentVal) / delayTime;
                }
            } catch (e) {
                throw new Error(`Error calc deriv SMOOTH '${auxName}': ${e.message}`);
            }
        }
        
        // Calculate derivatives for DELAY3 states
        for (const auxName in model.delay3States) {
            const di = model.delay3States[auxName];
            try {
                const inputVal = di.inputFn(state, simParams, auxValues, Math, time, dtVal);
                const delayTime = di.delayFn(state, simParams, auxValues, Math, time, dtVal);
                const transitTime = (delayTime > 1e-9) ? delayTime / 3.0 : 1e-9;
                const s1 = state[di.stateName1];
                const s2 = state[di.stateName2];
                const s3 = state[di.stateName3];
                if (isNaN(inputVal) || isNaN(delayTime)) throw new Error(`DELAY3 NaN input/delay for '${auxName}'.`);
                derivatives[di.stateName1] = (inputVal - s1) / transitTime;
                derivatives[di.stateName2] = (s1 - s2) / transitTime;
                derivatives[di.stateName3] = (s2 - s3) / transitTime;
            } catch (e) {
                throw new Error(`Error calc deriv DELAY3 '${auxName}': ${e.message}`);
            }
        }
        
        return derivatives;
    };
    
    // --- Main Simulation Loop ---
    try {
        for (let step = 0; step <= numSteps && iterations < maxIterations; step++) {
            // --- Record current state ---
            results.time.push(currentTime);
            for (const sn in model.stocks) {
                if (!sn.startsWith('_smooth_') && !sn.startsWith('_delay3_')) results.stocks[sn].push(currentState[sn]);
            }
            
            // Calculate and record auxiliaries for the *current* time step
            const currentAuxValues = {};
            let auxCalcError = false;
            let auxChanged = true;
            let auxIter = 0;
            const auxMaxIter = Object.keys(model.auxiliaries).length + 5;
            
            // Initialize aux values based on state (for SMOOTH/DELAY3 outputs)
            for (const auxName in model.auxiliaries) {
                if (model.smoothStates[auxName]) {
                    currentAuxValues[auxName] = currentState[model.smoothStates[auxName].stateName];
                } else if (model.delay3States[auxName]) {
                    currentAuxValues[auxName] = currentState[model.delay3States[auxName].stateName3];
                } else {
                    currentAuxValues[auxName] = NaN;
                }
            }
            
            // Iteratively calculate auxiliaries
            while(auxChanged && auxIter < auxMaxIter) {
                auxChanged = false;
                auxIter++;
                for (const auxName in model.auxiliaries) {
                    if (model.smoothStates[auxName] || model.delay3States[auxName]) continue;
                    try {
                        const oldVal = currentAuxValues[auxName];
                        // Use model functions but current simParams
                        const newVal = model.auxiliaries[auxName].fn(currentState, simParams, currentAuxValues, Math, currentTime, dt);
                        if (isNaN(newVal)) {
                            console.error(`Aux '${auxName}' calculated as NaN at t=${currentTime.toFixed(2)} for recording.`);
                            // Decide how to handle NaN - throw error or record NaN? Recording NaN for now.
                            currentAuxValues[auxName] = NaN;
                        }
                        if (newVal !== oldVal || isNaN(currentAuxValues[auxName])) {
                            currentAuxValues[auxName] = newVal;
                            auxChanged = true;
                        }
                    } catch (e) {
                        console.error(`Error calc aux '${auxName}' for recording at t=${currentTime.toFixed(2)}: ${e.message}`);
                        currentAuxValues[auxName] = NaN; // Record NaN on error
                        auxCalcError = true; // Flag error
                    }
                }
            }
            if (auxIter >= auxMaxIter) console.warn(`Aux values might not have stabilized during recording at t=${currentTime.toFixed(2)}.`);
            
            // Record the calculated aux values
            for (const auxName in model.auxiliaries) {
                results.auxiliaries[auxName].push(currentAuxValues[auxName]);
            }
            
            // If a critical error occurred calculating auxiliaries, stop the simulation
            if (auxCalcError) throw new Error("Error calculating auxiliary values during recording.");
            
            // --- Stop if last step ---
            if (step === numSteps) break;
            
            // --- RK4 Integration Step ---
            const k1_derivs = calculateAllDerivatives(currentTime, currentState, dt);
            const k1 = scaleObject(k1_derivs, dt);
            const state_k2 = addObject(currentState, scaleObject(k1, 0.5));
            
            const k2_derivs = calculateAllDerivatives(currentTime + dt / 2, state_k2, dt);
            const k2 = scaleObject(k2_derivs, dt);
            const state_k3 = addObject(currentState, scaleObject(k2, 0.5));
            
            const k3_derivs = calculateAllDerivatives(currentTime + dt / 2, state_k3, dt);
            const k3 = scaleObject(k3_derivs, dt);
            const state_k4 = addObject(currentState, k3);
            
            const k4_derivs = calculateAllDerivatives(currentTime + dt, state_k4, dt);
            const k4 = scaleObject(k4_derivs, dt);
            
            const delta_state = combineRK4(k1, k2, k3, k4);
            
            // --- Update state ---
            for (const stateName in currentState) {
                currentState[stateName] += delta_state[stateName];

                // Apply limits if defined for this state variable
                if (model.limits && model.limits[stateName]) {
                    const limits = model.limits[stateName];
                    const currentValue = currentState[stateName];
                    let clampedValue = currentValue;

                    if (limits.min !== undefined && !isNaN(limits.min) && clampedValue < limits.min) {
                        clampedValue = limits.min;
                    }
                    if (limits.max !== undefined && !isNaN(limits.max) && clampedValue > limits.max) {
                        clampedValue = limits.max;
                    }
                    currentState[stateName] = clampedValue;
                }
            }
            currentTime += dt;
            iterations++;
        } // End simulation loop
        
        if (iterations > numSteps + 1) {
            console.warn(`Simulation exceeded expected steps (${numSteps}) by ${iterations - numSteps -1}. Check for instability or very small dt.`);
        }
        
    } catch (error) {
        console.error("Sim failed:", error);
        return null; // Return null on simulation error
    }
    
    console.log(`Sim finished using RK4. Steps: ${iterations}, Time points: ${results.time.length}`);
    return results;
}

/**
 * Runs a parameter sweep simulation based on v1.2 model definition.
 * @param {Object} model - The parsed model object (v1.2).
 * @param {string|null} [scenarioName=null] - The name of the scenario to apply (if any).
 * @returns {Object|null} - An object containing sweep results { paramName, runs: [{paramValue, simulationOutput}, ...] } or null on failure.
 */
export function runParameterSweep(model, scenarioName = null) {
    console.log("[DEBUG] runParameterSweep invoked");

    if (!model || !model.sweeps || Object.keys(model.sweeps).length === 0) {
        console.warn("[WARN] No sweep parameters found in the model.");
        // Return structure for a single run if no sweep defined?
        // For now, let's return null as it's specifically sweep function
        return null; 
    }

    // Currently support only one sweep parameter
    const sweeps = model.sweeps;
    if (Object.keys(sweeps).length > 1) {
        console.warn("[WARN] Multiple sweep parameters defined, only the first one will be used:", Object.keys(sweeps)[0]);
    }

    // Get the sweep parameter and values
    const paramName = Object.keys(sweeps)[0]; // Get the name of the first (and only supported) sweep parameter
    const paramValues = sweeps[paramName]; // Get the array of values for this parameter
    
    console.log("[DEBUG] Sweep details:", { paramName, paramValues });
    
    // Validate paramValues is an array
    if (!Array.isArray(paramValues)) {
        console.error(`[ERROR] Sweep parameter '${paramName}' values are not an array:`, paramValues);
        return null; // Or handle error appropriately
    }
    
    // Prepare the results object
    const sweepOutput = {
        paramName: paramName,
        runs: [] // Changed from 'simulations' to 'runs'
    };
    
    // Run a simulation for each parameter value
    for (const paramValue of paramValues) {
        console.log(`[DEBUG] Running sweep with ${paramName} = ${paramValue}`);
        
        // Create a deep clone of the model for this run
        // NOTE: JSON stringify/parse is a simple way to deep clone, but it can lose functions or non-JSON types.
        // Ensure your model structure is JSON-serializable if using this method.
        let modelClone;
        try {
            // Create a clean clone FROM THE ORIGINAL model each time
            modelClone = JSON.parse(JSON.stringify(model));
        } catch (e) {
            console.error("[ERROR] Failed to deep clone model for sweep run:", e);
            // Optionally add failed run info to sweepOutput
            sweepOutput.runs.push({ paramValue: paramValue, simulationOutput: { error: true, results: { errors: [`Model cloning failed: ${e.message}`] } } });
            continue; // Skip this value
        }
        
        // Remove sweep definition from the clone to avoid infinite loops if runSimulation calls sweep
        delete modelClone.sweeps; 

        // Apply the parameter value for this run
        // Find the constant and modify its expression for re-compilation
        if (modelClone.constants && modelClone.constants[paramName]) {
            console.log(`[DEBUG] Setting constant ${paramName} to ${paramValue}`);
            // Modify the expression property, which compileExpressions uses.
            modelClone.constants[paramName].expression = paramValue.toString(); 
        } else {
            console.error(`[ERROR] Sweep parameter '${paramName}' not found in model constants:`, Object.keys(modelClone.constants || {}));
            // Optionally add failed run info
             sweepOutput.runs.push({ paramValue: paramValue, simulationOutput: { error: true, results: { errors: [`Sweep parameter '${paramName}' not found in constants.`] } } });
            continue; // Skip this value
        }
        
        // IMPORTANT: Re-compile expressions for the cloned model with the new constant value!
        // This is necessary for the change to take effect in calculations and initial values.
        compileExpressions(modelClone);
        
        // Run the simulation with this parameter value
        console.log(`[DEBUG] Starting simulation for ${paramName}=${paramValue}`);
        // Pass the modified clone to the simulation function
        const simResult = runSimulationv1_2(modelClone, scenarioName);
        
        // Check if the simulation itself returned an error object
        if (!simResult || simResult.error) {
            const errorMsg = simResult?.results?.errors?.join('; ') || `Simulation failed internally for ${paramName}=${paramValue}`;
            console.error(`[DEBUG] ${errorMsg}`);
            sweepOutput.runs.push({ 
                paramValue: paramValue, 
                simulationOutput: simResult || { error: true, results: { errors: [`Simulation function returned null for ${paramName}=${paramValue}`] } } 
            });
            continue; // Continue to the next sweep value even if one fails
        }
        
        console.log(`[DEBUG] Simulation successful for ${paramName}=${paramValue}`);
        
        // Push the structured result
        sweepOutput.runs.push({
            paramValue: paramValue,
            simulationOutput: simResult // Changed from 'results' to 'simulationOutput'
        });
    }
    
    // Check if *any* simulations were added (even failures might be useful)
    if (sweepOutput.runs.length === 0) {
        console.error("[DEBUG] No sweep simulations were run (possibly due to cloning or parameter errors).");
        // Return null if absolutely nothing could be run
        return null; 
    }
    
    console.log(`[DEBUG] Sweep complete: ${sweepOutput.runs.length} runs processed.`);
    
    // Return the object with the 'runs' array
    return sweepOutput;
}

const MAX_VARIATIONS = 8; // Define the maximum number of variations to run

/**
 * Helper function to compute the Cartesian product of multiple arrays.
 * Example: cartesian([1, 2], ['A', 'B']) -> [[1, 'A'], [1, 'B'], [2, 'A'], [2, 'B']]
 * @param {...Array<any>} arrays - Arrays to combine.
 * @returns {Array<Array<any>>} - The Cartesian product.
 */
function cartesian(...arrays) {
    if (!arrays || arrays.length === 0) {
        return [[]]; // Return array with one empty combination if no arrays
    }
    return arrays.reduce((acc, curr) => 
        acc.flatMap(c => curr.map(n => [].concat(c, n))),
        [[]] // Initial value for reduce
    );
}

/**
 * Prepares configurations for all simulation variations based on sweeps and scenarios.
 * @param {Object} model - The fully parsed and compiled model.
 * @param {number} maxVariations - Maximum number of variations to prepare.
 * @returns {Object} { configurations: Array, limitReached: boolean }
 */
function prepareVariations(model, maxVariations = 50) {
    console.log("[DEBUG sim] Preparing variations...");
    const configurations = [];
    let limitReached = false;

    // 1. Identify Scenarios (include Base Model)
    const scenarioNames = [null, ...(model.scenarios ? Object.keys(model.scenarios) : [])];
    console.log("[DEBUG sim] Scenarios to consider:", scenarioNames.map(s => s === null ? 'Base Model' : s));

    // 2. Identify and Combine Sweeps
    const sweeps = model.sweeps || {};
    const sweepParams = Object.keys(sweeps);
    let sweepCombinations = [{}]; // Start with one empty combination (for base run or scenario-only runs)

    if (sweepParams.length > 0) {
        console.log("[DEBUG sim] Sweep parameters found:", sweepParams);
        sweepCombinations = []; // Reset if sweeps exist
        const paramValues = sweepParams.map(param => sweeps[param]);
        
        // Generate Cartesian product of sweep values
        const generateCombinations = (index, currentCombination) => {
            if (index === sweepParams.length) {
                sweepCombinations.push({ ...currentCombination });
                return;
            }
            const paramName = sweepParams[index];
            const values = paramValues[index];
            for (const value of values) {
                currentCombination[paramName] = value;
                generateCombinations(index + 1, currentCombination);
            }
        };
        generateCombinations(0, {});
    } 
    console.log(`[DEBUG sim] Generated ${sweepCombinations.length} sweep combinations.`);
    
    // 3. Combine Scenarios and Sweeps
    for (const scenarioName of scenarioNames) {
        const scenarioLabel = scenarioName === null ? "Base" : scenarioName;
        
        for (const sweepOverrideSet of sweepCombinations) {
            if (configurations.length >= maxVariations) {
                limitReached = true;
                console.warn(`[WARN sim] Max variations limit (${maxVariations}) reached during preparation.`);
                break; // Stop adding sweep combinations for this scenario
            }

            // Create identifier
            let identifier = scenarioLabel;
            const sweepParts = Object.entries(sweepOverrideSet).map(([param, value]) => `${param}=${value}`);
            if (sweepParts.length > 0) {
                identifier += ` (${sweepParts.join(', ')})`;
            }
            
            configurations.push({
                identifier: identifier,
                scenarioName: scenarioName, 
                sweepOverrides: { ...sweepOverrideSet } // Pass a copy
            });
        }
        if (limitReached) {
            break; // Stop adding scenarios
        }
    }

    console.log(`[DEBUG sim] Prepared ${configurations.length} total variations.`);
    return { configurations, limitReached };
}

/**
 * Runs multiple simulation variations.
 * @param {Object} originalModel - The original, unmodified parsed and compiled model.
 * @param {Array<Object>} configurations - Array of variation configurations from prepareVariations.
 * @returns {Object} - An object containing results for all variations, keyed by identifier.
 */
function runVariations(originalModel, configurations) {
    console.log(`[DEBUG sim] Running ${configurations.length} variations...`);
    const allResults = {
        variations: {},
        // We might want to store common info like time axis once
        // time: null // Example
    };

    if (!configurations || configurations.length === 0) {
        console.warn("[WARN sim] No variations provided to runVariations.");
        return allResults;
    }

    configurations.forEach(config => {
        console.log(`[DEBUG sim] Running variation: ${config.identifier}`);
        try {
            // Run simulation with the original model + scenario + sweep overrides
            const result = runSimulationv1_2(originalModel, config.scenarioName, config.sweepOverrides);
            
            if (result && !result.error) {
                allResults.variations[config.identifier] = { 
                    results: result.results, // <-- Extract the inner results object
                    scenario: config.scenarioName, 
                    sweeps: config.sweepOverrides,
                    error: false
                };
                // Example: Store time axis once if consistent
                // if (allResults.time === null && result.time) allResults.time = result.time;
            } else {
                console.warn(`[WARN sim] Variation '${config.identifier}' failed: ${result?.message || 'Unknown simulation error'}`);
                allResults.variations[config.identifier] = {
                    results: null,
                    scenario: config.scenarioName,
                    sweeps: config.sweepOverrides,
                    error: true,
                    message: result?.message || 'Simulation failed internally.'
                };
            }
        } catch (e) {
            console.error(`[ERROR sim] Uncaught exception during variation '${config.identifier}':`, e);
            allResults.variations[config.identifier] = {
                results: null,
                scenario: config.scenarioName,
                sweeps: config.sweepOverrides,
                error: true,
                message: `Simulation crashed: ${e.message}`
            };
        }
    });

    console.log(`[DEBUG sim] Finished running variations. Success/Total: ${Object.values(allResults.variations).filter(v => !v.error).length}/${configurations.length}`);
    return allResults;
}

// Export the functions needed by app.js and potentially other modules
export { 
    runSimulationv1_2, 
    prepareVariations,
    runVariations,
    // runParameterSweep
}; 