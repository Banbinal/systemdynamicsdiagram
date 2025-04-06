/**
 * Simulation Module for System Dynamics Tool
 * Implements RK4 integration for system dynamics models
 */

/**
 * Runs the simulation using RK4 method
 * @param {Object} model - The parsed model
 * @param {Object} overrideParams - Optional parameters to override original values (for A/B testing)
 * @returns {Object|null} - Simulation results or null if simulation fails
 */
function runSimulation(model, overrideParams = null) {
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

export { runSimulation }; 