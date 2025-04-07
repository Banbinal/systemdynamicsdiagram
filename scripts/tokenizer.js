/**
 * Tokenizer for DSL v1.3+
 * Converts DSL text into a stream of tokens, handling indentation and syntax.
 */

// Note: This function is extracted directly from the legacy parser.
// Consider further refinement or dependency injection later.

/**
 * Tokenize the DSL text into tokens, handling indentation and v1.2 syntax
 * @param {string} dslText - The DSL text to tokenize
 * @returns {Object} Object containing tokens and any errors
 */
export function tokenizeDSL(dslText) {
    console.log("[DEBUG tokenizer] Starting tokenization v1.3 of", dslText.length, "characters");
    
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

        console.log(`[DEBUG tokenizer] Processing line ${currentLineNumber}: '${trimmedLineWithoutComment}' (Original: '${line}')`);

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
                console.log(`[DEBUG tokenizer] INDENT to ${currentIndent}`);
            } else {
                // Decrease or maintain indentation
                while (currentIndent < indentStack[indentStack.length - 1]) {
                    indentStack.pop();
                    tokens.push({ type: 'DEDENT', line: currentLineNumber });
                    console.log(`[DEBUG tokenizer] DEDENT to ${indentStack[indentStack.length - 1]}`);
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

            // --- CHECK FOR INDENTED TOKENS FIRST ---

            // Match scenario override: (constant|stock) Identifier = expression (must be indented)
            if (!matched && indentStack.length > 1) {
                const overrideMatch = lineToParse.match(/^(constant|stock)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)/i);
                if (overrideMatch) {
                     tokens.push({ type: 'OVERRIDE', targetType: overrideMatch[1].toLowerCase(), targetName: overrideMatch[2], expression: overrideMatch[3].trim(), line: currentLineNumber });
                     matched = true;
                     console.log(`[DEBUG tokenizer] Matched OVERRIDE: ${overrideMatch[1]} ${overrideMatch[2]}`);
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
                      console.log(`[DEBUG tokenizer] Matched FLOW_EFFECT: ${flowEffectMatch[1]}`);
                 } 
            }
            
            // Match map point: ( number , number ) (must be indented)
            if (!matched && indentStack.length > 1) {
                 const mapPointMatch = lineToParse.match(/^\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/);
                 if (mapPointMatch) {
                     tokens.push({ type: 'MAP_POINT', x: parseFloat(mapPointMatch[1]), y: parseFloat(mapPointMatch[2]), line: currentLineNumber });
                     matched = true;
                      console.log(`[DEBUG tokenizer] Matched MAP_POINT: (${mapPointMatch[1]}, ${mapPointMatch[2]})`);
                 }
            }
            
            // --- CHECK FOR TOP-LEVEL (NON-INDENTED) KEYWORDS --- 

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
                     console.log(`[DEBUG tokenizer] Matched FLOW_START: ${flowStartMatch[1]}`);
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
                     console.log(`[DEBUG tokenizer] Matched STOCK: ${stockMatch[1]}`);
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
                          console.log(`[DEBUG tokenizer] Matched CONSTANT: ${constMatch[1]}`);
                    } // Time config is handled separately by TIME_CONFIG match
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
                    console.log(`[DEBUG tokenizer] Matched CALC: ${calcMatch[1]}`);
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
                     console.log(`[DEBUG tokenizer] Matched SWEEP: ${paramName}`);
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
                    console.log(`[DEBUG tokenizer] Matched TIME_CONFIG: ${timeMatch[1]}`);
                 }
              }
             
            // Match scenario start: scenario Identifier:
            if (!matched) {
                const scenarioStartMatch = lineToParse.match(/^scenario\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
                if (scenarioStartMatch) {
                    tokens.push({ type: 'SCENARIO_START', name: scenarioStartMatch[1], line: currentLineNumber });
                    matched = true;
                    console.log(`[DEBUG tokenizer] Matched SCENARIO_START: ${scenarioStartMatch[1]}`);
                }
            }

            // Match map start: map Identifier [: type] :
            if (!matched) {
                const mapStartMatch = lineToParse.match(/^map\s+([A-Za-z_][A-Za-z0-9_]*)(?::\s*(linear|step|spline))?\s*:/i);
                if (mapStartMatch) {
                    tokens.push({ type: 'MAP_START', name: mapStartMatch[1], interpolation: mapStartMatch[2] || 'linear', line: currentLineNumber });
                    matched = true;
                    console.log(`[DEBUG tokenizer] Matched MAP_START: ${mapStartMatch[1]}`);
                }
            }

            // Match group/module start: (group|module) Identifier :
            if (!matched) {
                const blockStartMatch = lineToParse.match(/^(group|module)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/i);
                if (blockStartMatch) {
                    tokens.push({ type: blockStartMatch[1].toUpperCase() + '_START', name: blockStartMatch[2], line: currentLineNumber });
                    matched = true;
                    console.log(`[DEBUG tokenizer] Matched MODULE/GROUP_START: ${blockStartMatch[2]}`);
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
                         console.log(`[DEBUG tokenizer] Matched LIMIT: ${name}`);
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
                     console.log(`[DEBUG tokenizer] Matched PLOT_TARGET: ${plotMatch[1]}`);
                }
             }
            // Match title directive: title Anything until end of line
            if (!matched) {
                const titleMatch = lineToParse.match(/^title\s+(.+)/i);
                if (titleMatch) {
                    tokens.push({ type: 'TITLE', text: titleMatch[1].trim(), line: currentLineNumber });
                    matched = true;
                     console.log(`[DEBUG tokenizer] Matched TITLE`);
                }
            }
            // --- End of checks ---
            
            // If no pattern matched
            if (!matched) {
                errors.push(`Line ${currentLineNumber}: Unrecognized syntax: ${lineToParse}`);
            }

        } catch (e) {
            errors.push(`Line ${currentLineNumber}: Error processing line: ${e.message}`);
            console.error(`[ERROR tokenizer] Line ${currentLineNumber}:`, e);
        }
    }
    
    // Add final DEDENTs to close any open blocks
     while (indentStack.length > 1) {
         indentStack.pop();
         tokens.push({ type: 'DEDENT', line: currentLineNumber + 1 });
         console.log(`[DEBUG tokenizer] Final DEDENT to ${indentStack[indentStack.length-1]}`);
     }

    console.log(`[DEBUG tokenizer] Tokenization complete: ${tokens.length} tokens`);
    console.log(`[DEBUG tokenizer] Tokenizer errors: `, errors);
    
    return { tokens, errors };
}
