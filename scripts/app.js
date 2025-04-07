/**
 * Main Application Module for System Dynamics Tool v1.2
 * Integrates all modules and manages UI interactions
 */

import { parseDSL } from './parser.js';
import { generateMermaidSyntax, renderMermaid } from './visualization.js';
import { runSimulationv1_2, prepareVariations, runVariations } from './simulation.js';
import { plotResults, plotABResults, plotSweepResults } from './plotting.js';
import { 
    analyzeSimulationResults, 
    displayInterpretation,
    findFeedbackLoops, 
    explainLoop
} from './analysis.js';
import {
    displayMessage,
    debounce,
    switchTab,
    updateUrl,
    loadFromUrl,
    copyToClipboard
} from './utils.js';
import {
    generateReport,
    generatePDF,
    saveHTML
} from './reporting.js';
import { config } from './config.js';

// --- Global Variables & Constants ---
const DEBOUNCE_DELAY = 500;
let currentChart = null;
let currentMermaidSyntax = '';
let lastValidModel = null;
let lastResults = null;
let lastAnalysis = null;
let lastLoops = null;
let lastSuccessfulModel = null;
let debounceTimer = null;
let urlUpdateTimer = null;
let lastABResults = null;
let editor = null; // CodeMirror editor instance
let dslVersion = 'v1.2'; // Default to new version
let lastChartImages = null; 
const scenarioSelector = document.getElementById('scenarioSelector'); // Added for scenarios

// Define CodeMirror mode for DSL syntax highlighting
function defineDslMode() {
    // Define a simple mode for our DSL
    CodeMirror.defineSimpleMode("dsl", {
        // Start state
        start: [
            // Comments
            {regex: /#.*/, token: "comment"},
            
            // Specific Keywords First with UNIQUE tokens!
            {regex: /(?:plot|StartTime|EndTime|TimeStep)\b/, token: "keyword-plot"}, // Unique token for Purple
            {regex: /(?:sweep|scenario|abtest)\b/, token: "keyword-sweep"}, // Unique token for Orange
            {regex: /(?:limit)\b/, token: "keyword-limit"}, // Unique token for Limit Blue
            
            // Default Keywords (standard token)
            {regex: /(?:title|stock|flow|calc|constant|param|map|group|module)\b/, token: "keyword"}, // Default Blue
            
            // Other tokens
            {regex: /(?:-->|-\+>)/, token: "polarity"},
            {regex: /\d+(?:\.\d+)?/, token: "number"},
            {regex: /[+\-*\/=<>&|^%]+/, token: "operator"},
            {regex: /[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/, token: "module-reference"},
            {regex: /(?:smooth|delay3|step|pulse|time|map|max|min)\b(?=\s*\()/, token: "function"}, 
            {regex: /[A-Za-z_][A-Za-z0-9_]*/, token: "variable"},
            {regex: /"(?:[^\\]|\\.)*?(?:"|$)/, token: "string"},
            {regex: /'(?:[^\\]|\\.)*?(?:'|$)/, token: "string"},
            {regex: /[\(\)]/, token: "bracket"},
            {regex: /[\{\}]/, token: "bracket"},
            {regex: /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/, token: "map-point"},
        ],
        meta: {
            dontIndentStates: ["comment"],
            lineComment: "#"
        }
    });
}

// --- DOM Element References ---
const simulateBtn = document.getElementById('simulateBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const reportBtn = document.getElementById('reportBtn');
const docsBtn = document.getElementById('docsBtn');
const actionsDropdownBtn = document.getElementById('actionsDropdownBtn');
const actionsDropdown = document.getElementById('actionsDropdown');
const mermaidDiagramContainer = document.getElementById('mermaidDiagram');
const messageArea = document.getElementById('messageArea');
const resultsChartContainer = document.getElementById('resultsChartContainer');
const resultsChart = document.getElementById('resultsChart');
const resultsChartCtx = resultsChart.getContext('2d');
const chartPlaceholder = document.getElementById('chartPlaceholder');
const statusIndicator = document.getElementById('statusIndicator');
const tabButtons = document.querySelectorAll('.tab-button');
const tabPanels = document.querySelectorAll('.tab-panel');
const modelTabBtn = document.getElementById('modelTabBtn');
const modelTabPanel = document.getElementById('modelTabPanel');
const simTabBtn = document.getElementById('simTabBtn');
const simTabPanel = document.getElementById('simulationTabPanel');
const interpTabBtn = document.getElementById('interpTabBtn');
const interpTabPanel = document.getElementById('interpretationTabPanel');
const interpretationContent = document.getElementById('interpretationContent');
const dslVersionSelector = document.getElementById('dslVersionSelector');

// Report modal elements
const reportModal = document.getElementById('reportModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const generatePdfBtn = document.getElementById('generatePdfBtn');
const includeModelSummary = document.getElementById('includeModelSummary');
const includeSimSummary = document.getElementById('includeSimSummary');
const includeLoops = document.getElementById('includeLoops');
const includeDsl = document.getElementById('includeDsl');
const generateHtmlBtn = document.getElementById('generateHtmlBtn');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // For debugging purposes, log mermaid version
    console.log("Mermaid version: ", mermaid.version ? mermaid.version : "Not available");
    
    // Check if mermaid is ready
    checkMermaidStatus();
    
    // Initial UI setup
    simTabBtn.disabled = true;
    interpTabBtn.disabled = true;
    
    // Define and setup CodeMirror for DSL editing
    defineDslMode();
    setupEditor();
    
    // Set up DSL version selector
    setupDSLVersionSelector();
    
    // Load model from URL hash if present
    loadModelFromUrl();
    
    // Set up other event listeners
    addEventListeners();
    
    // Force an initial visualization with a small delay to ensure DOM is ready
    setTimeout(() => {
        updateVisualization();
    }, 100);
});

/**
 * Sets up the DSL version selector
 */
function setupDSLVersionSelector() {
    if (dslVersionSelector) {
        dslVersionSelector.addEventListener('change', (e) => {
            dslVersion = e.target.value;
            updateVisualization();
        });
    }
}

/**
 * Check if Mermaid is properly initialized
 */
function checkMermaidStatus() {
    try {
        if (!mermaid) {
            console.error("Mermaid library not found");
            displayMessage("Error: Mermaid library not loaded properly", "error", messageArea);
            return false;
        }
        return true;
    } catch (error) {
        console.error("Error checking Mermaid status:", error);
        displayMessage("Error accessing diagram library: " + error.message, "error", messageArea);
        return false;
    }
}

/**
 * Load model from URL if present
 */
function loadModelFromUrl() {
    const urlModel = loadFromUrl();
    if (urlModel && editor) {
        editor.setValue(urlModel);
        updateVisualization();
    }
}

/**
 * Set up all event listeners
 */
function addEventListeners() {
    // Button click handlers
    simulateBtn.addEventListener('click', handleSimulateClick);
    copyLinkBtn.addEventListener('click', handleCopyLink);
    reportBtn.addEventListener('click', showReportModal);
    docsBtn.addEventListener('click', openDocumentation);
    actionsDropdownBtn.addEventListener('click', toggleActionsDropdown);
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-container')) {
            actionsDropdown.classList.remove('active');
        }
    });
    
    // Report modal handlers
    closeModalBtn.addEventListener('click', hideReportModal);
    generatePdfBtn.addEventListener('click', handleGeneratePdf);
    generateHtmlBtn.addEventListener('click', handleGenerateHtml);
    
    // Tab navigation
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.hasAttribute('disabled')) return;
            
            const tabId = btn.dataset.tab;
            switchTabUI(tabId);
        });
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === reportModal) {
            hideReportModal();
        }
    });
}

/**
 * Updates the visualization based on DSL input
 */
function updateVisualization() {
    if (!editor) return;
    
    // Clear messages related to previous parsing/rendering
    const isVizMessage = messageArea.querySelector('.error-message, .info-message');
    if (isVizMessage && (isVizMessage.textContent.startsWith('DSL') || isVizMessage.textContent.startsWith('Mermaid'))) {
        messageArea.innerHTML = '';
    }

    const dslCode = editor.getValue();
    
    // Parse the model based on DSL version
    let model;
    model = parseDSL(dslCode);

    // Populate scenario selector if scenarios exist
    if (scenarioSelector) { // Check if the element exists first
        // Clear previous options (except the default 'Base Model')
        while (scenarioSelector.options.length > 1) {
            scenarioSelector.remove(1);
        }
        
        if (model.scenarios && Object.keys(model.scenarios).length > 0) {
            console.log("[DEBUG app] Scenarios found, populating selector:", Object.keys(model.scenarios));
            scenarioSelector.disabled = false;
            for (const scenarioName in model.scenarios) {
                const option = document.createElement('option');
                option.value = scenarioName;
                option.textContent = scenarioName;
                scenarioSelector.appendChild(option);
            }
        } else {
            console.log("[DEBUG app] No scenarios found, disabling selector.");
            scenarioSelector.disabled = true;
            scenarioSelector.value = ""; // Reset to Base Model selection
        }
    }

    // Always attempt to generate syntax, even if errors exist
    if (model) { 
        if (model.errors && model.errors.length > 0) {
            // Show parsing errors in the message area
            displayMessage(`DSL Parsing Errors (displaying potentially incomplete model):
- ${model.errors.join('\n- ')}`, 'error', messageArea);
        } else {
             // Clear errors if parsing is now successful
             if(messageArea.querySelector('.error-message')) messageArea.innerHTML = ''; 
        }

        // Store the model regardless of errors
        lastValidModel = model; 

        // Display model title if it exists in the parsed model
        const modelTitleElement = document.getElementById('modelTitle');
        if (modelTitleElement) {
            if (model.title) {
                modelTitleElement.textContent = model.title;
                modelTitleElement.classList.remove('hidden');
            } else {
                // Hide if no title found in this parse
                modelTitleElement.classList.add('hidden');
            }
        }
        
        // Generate syntax - generateMermaidSyntax should handle potential inconsistencies
        currentMermaidSyntax = generateMermaidSyntax(model); 
        
        // Only render if the model tab is active
        if (modelTabPanel.getAttribute('data-active') === 'true') {
            renderMermaid(currentMermaidSyntax, mermaidDiagramContainer);
        }
        
        // Enable sim button only if there are NO errors
        simTabBtn.disabled = model.errors && model.errors.length > 0;
        interpTabBtn.disabled = true; // Always disable interp initially

    } else {
        // Handle case where parser failed catastrophically (returned null/undefined)
        displayMessage('Critical parser failure.', 'error', messageArea);
        currentMermaidSyntax = 'graph TD; Error["Parser failed critically."];';
        if (modelTabPanel.getAttribute('data-active') === 'true') {
             renderMermaid(currentMermaidSyntax, mermaidDiagramContainer);
        }
        simTabBtn.disabled = true;
        interpTabBtn.disabled = true;
    }
    
    // Schedule URL update
    clearTimeout(urlUpdateTimer);
    urlUpdateTimer = setTimeout(handleUrlUpdate, 1500);
}

/**
 * Updates the URL with the current model for sharing
 */
function handleUrlUpdate() {
    const currentCode = editor.getValue().trim();
    if (currentCode.length > 0) {
        updateUrl(currentCode);
    }
}

/**
 * Handles the simulate button click
 */
async function handleSimulateClick() {
    if (!editor) return;

    // 1. Clear Outputs & Update Status
    clearOutputs();
    displayMessage("Parsing model...", "info", messageArea);
    statusIndicator.textContent = "Parsing & Preparing...";
    statusIndicator.className = "status-busy";
    let model, variationsToRun, allSimulationResults, analysisResult;

    try {
        // 1. Get DSL Text
        const dslText = editor.getValue();

        // 2. Parse DSL
        let model = parseDSL(dslText);
        console.log("[DEBUG app] Parsed model object (checking sweeps/scenarios):", {
            sweeps: model?.sweeps,
            scenarios: model?.scenarios
        });
        
        if (!model || model.errors?.length > 0) {
            // Display errors even if we attempt partial rendering
            displayMessage("DSL Parsing Errors (displaying potentially incomplete model):\n" + model.errors.join("\n"), "error", messageArea);
            // If parsing failed critically, stop before simulation
            if (!model) throw new Error("Parsing failed critically.");
            // Don't throw yet if partial model exists, let visualization try
        } else {
             displayMessage("DSL parsed successfully.", "info", messageArea);
             lastSuccessfulModel = model; // Store the last fully successful parse
        }

        // Keep the original parsed model
        const originalModel = model; 

        // 3. Prepare Variations (Combines Scenarios & Sweeps)
        displayMessage("Preparing simulation variations...", "info", messageArea, true);
        const preparationResult = prepareVariations(originalModel, config.MAX_VARIATIONS);
        const variationsToRun = preparationResult.configurations;
        console.log(`[DEBUG app] Prepared ${variationsToRun.length} variations:`, variationsToRun.map(v => v.identifier));

        if (preparationResult.limitReached) {
             displayMessage(`Warning: Maximum variation limit (${config.MAX_VARIATIONS}) reached. Only the first ${variationsToRun.length} variations will be run.`, "warning", messageArea, true);
        }
        if (variationsToRun.length === 0) {
             throw new Error("No simulation variations could be prepared. Check model definition (scenarios/sweeps).");
        }

        // 4. Run Variations (asynchronously)
        displayMessage(`Running ${variationsToRun.length} simulation variations...`, "info", messageArea, true);
        statusIndicator.textContent = "Simulating...";
        
        setTimeout(async () => { 
            let analysisResult = null;
            let allSimulationResults = null;
            try {
                // Pass the ORIGINAL model and the prepared configurations
                allSimulationResults = runVariations(originalModel, variationsToRun);
                lastResults = allSimulationResults; // Store the new structure

                // --- Handle Partial Failures --- 
                const variationIDs = Object.keys(allSimulationResults.variations);
                const failedVariations = variationIDs.filter(id => allSimulationResults.variations[id].error);
                const successfulVariations = variationIDs.filter(id => !allSimulationResults.variations[id].error);
                const successCount = successfulVariations.length;
                const failureCount = failedVariations.length;

                if (successCount === 0) {
                    // If ALL failed, report the first error
                    const firstErrorMsg = failedVariations.length > 0 ? allSimulationResults.variations[failedVariations[0]].message : "Unknown simulation error.";
                    throw new Error(`All ${variationIDs.length} simulation variations failed. First error: ${firstErrorMsg}`);
                }
                
                let simResultMessage = "";
                if (failureCount > 0) {
                     simResultMessage = `Simulations complete. ${successCount} successful, ${failureCount} failed. Analyzing successful runs...`;
                     console.warn(`[WARN app] Failed variations: ${failedVariations.join(', ')}`);
                     // Optionally display which ones failed in the message area?
                     // displayMessage(`Failed variations: ${failedVariations.join(', ')}`, "warning", messageArea, true); // Append warning
                } else {
                     simResultMessage = `Simulations complete (${successCount} variations). Analyzing results...`;
                }

                displayMessage(simResultMessage, "info", messageArea, true);
                statusIndicator.textContent = "Analyzing...";
                statusIndicator.className = "status-busy";

                // 5. Analyze Results (Use the original parsed 'model' for structure info)
                analysisResult = analyzeSimulationResults(allSimulationResults, originalModel); 
                lastAnalysis = analysisResult; 
                lastLoops = findFeedbackLoops(originalModel); 
                console.log(`[DEBUG app] Analysis complete. Found ${lastLoops?.length || 0} loops.`);
                
                // 6. Enable Tabs
                simTabBtn.disabled = false;
                interpTabBtn.disabled = false;
                
                // 7. Plot Results
                displayMessage("Plotting results...", "info", messageArea, true);
                await new Promise(resolve => setTimeout(resolve, 10)); // Allow UI update
                
                const { comparisonChart, detailCharts } = plotResults(allSimulationResults, resultsChartCtx, resultsChartContainer, chartPlaceholder, originalModel);
                lastChartImages = null; // Reset images
                
                // Capture chart images after a short delay to ensure rendering
                // await captureChartImages(comparisonChart, detailCharts);
                
                // 8. Display Interpretation
                displayInterpretation(analysisResult, interpretationContent, lastLoops);
                
                // Ensure the Sim tab is visible after successful run
                switchTabUI('simulation'); 
                statusIndicator.textContent = "Complete";
                displayMessage(`Simulation and analysis complete for ${successCount} variations.`, "success", messageArea, true);

                // 9. Update URL
                // Debounce URL updates to avoid excessive history entries
                handleUrlUpdate(); 

                // ADDED LOG BELOW
                console.log("[DEBUG] Structure of lastAnalysis:", JSON.stringify(lastAnalysis, null, 2));

            } catch (error) { 
                console.error('Error during simulation process:', error);
                displayMessage(`Error: ${error.message}`, "error", messageArea);
                statusIndicator.textContent = "Error";
                interpretationContent.innerHTML = `<p class="text-red-600">An error occurred: ${error.message}</p>`;
                chartPlaceholder.textContent = 'Simulation failed.';
                chartPlaceholder.classList.remove('hidden');
                resultsChart.classList.add('hidden');
                if (window.currentChart) {
                     window.currentChart.destroy();
                     window.currentChart = null;
                }
                lastChartImages = null; // Clear images on error
                lastSuccessfulModel = null; // Clear on any error during the process
            }
        }, 0);

    } catch (error) { 
        console.error('Error during simulation process:', error);
        displayMessage(`Error: ${error.message}`, "error", messageArea);
        statusIndicator.textContent = "Error";
        interpretationContent.innerHTML = `<p class="text-red-600">An error occurred: ${error.message}</p>`;
        chartPlaceholder.textContent = 'Simulation failed.';
        chartPlaceholder.classList.remove('hidden');
        resultsChart.classList.add('hidden');
        if (window.currentChart) {
             window.currentChart.destroy();
             window.currentChart = null;
        }
        lastChartImages = null; // Clear images on error
        lastSuccessfulModel = null; // Clear on any error during the process
    }
}

/**
 * Show the report generation modal
 */
function showReportModal() {
    if (!lastSuccessfulModel) {
        displayMessage("You need to run a simulation before generating a report.", "error", messageArea);
        return;
    }
    
    reportModal.classList.remove('hidden');
}

/**
 * Hide the report generation modal
 */
function hideReportModal() {
    reportModal.classList.add('hidden');
}

/**
 * Handle PDF report generation
 */
async function handleGeneratePdf() {
    // Use lastSuccessfulModel for report generation
    if (!lastSuccessfulModel) { 
        displayMessage("No successfully simulated model available for report generation. Please run simulation again.", "error", messageArea);
        return;
    }
    if (!editor) return;
    
    const options = {
        includeModelSummary: includeModelSummary.checked,
        includeSimSummary: includeSimSummary.checked,
        includeLoops: includeLoops.checked,
        includeCharts: document.getElementById('includeCharts')?.checked ?? false,
        includeDsl: includeDsl.checked
    };
    
    displayMessage("Generating PDF report...", "info", messageArea, 3000);
    try {
        const reportHtml = generateReport(
            lastSuccessfulModel,
            lastResults,
            lastAnalysis,
            lastLoops,
            editor.getValue(),
            options,
            lastChartImages
        );
        generatePDF(reportHtml, `SD_Report_${Date.now()}.pdf`);
        hideReportModal();
        displayMessage("PDF report generated and downloaded.", "info", messageArea);
    } catch (error) {
        console.error("Error generating PDF:", error);
        displayMessage(`Error generating PDF: ${error.message}`, "error", messageArea);
    }
}

/**
 * Handle HTML report generation
 */
function handleGenerateHtml() {
    // Use lastSuccessfulModel for report generation
    if (!lastSuccessfulModel) { 
        displayMessage("No successfully simulated model available for report generation. Please run simulation again.", "error", messageArea);
        return;
    }
     if (!editor) return;
     
    const options = {
        includeModelSummary: includeModelSummary.checked,
        includeSimSummary: includeSimSummary.checked,
        includeLoops: includeLoops.checked,
        includeCharts: document.getElementById('includeCharts')?.checked ?? false,
        includeDsl: includeDsl.checked
    };
    
    displayMessage("Generating HTML report...", "info", messageArea, 3000);
    try {
        const reportHtml = generateReport(
            lastSuccessfulModel,
            lastResults,
            lastAnalysis,
            lastLoops,
            editor.getValue(),
            options,
            lastChartImages
        );
        saveHTML(reportHtml, `SD_Report_${Date.now()}.html`);
        hideReportModal();
        displayMessage("HTML report generated and downloaded.", "info", messageArea);
    } catch (error) {
        console.error("Error generating HTML:", error);
        displayMessage(`Error generating HTML: ${error.message}`, "error", messageArea);
    }
}

/**
 * Clears simulation outputs and resets UI
 */
function clearOutputs() {
    // Clear previous messages
    messageArea.innerHTML = '';
    
    // Clear previous chart
    if (window.currentChart) {
        window.currentChart.destroy();
        window.currentChart = null;
    }
    
    // Clear chart and show loading state
    resultsChartCtx.clearRect(0, 0, resultsChart.width, resultsChart.height);
    chartPlaceholder.textContent = 'Running simulation...';
    chartPlaceholder.classList.remove('hidden');
    resultsChart.classList.add('hidden');
    
    // Reset interpretation panel
    interpretationContent.innerHTML = '<p class="text-gray-500">Running simulation...</p>';
    
    // Update status indicator
    statusIndicator.textContent = 'Simulating...';
    
    // Disable tabs during simulation
    simTabBtn.disabled = true;
    interpTabBtn.disabled = true;
}

/**
 * Handle copy link button click
 */
async function handleCopyLink() {
    if (!editor) return;
    
    updateUrl(editor.getValue());
    const success = await copyToClipboard(window.location.href);
    
    if (success) {
        displayMessage("Link copied to clipboard!", "info", messageArea);
    } else {
        displayMessage("Failed to copy link to clipboard.", "error", messageArea);
    }
}

/**
 * Switch between UI tabs
 * @param {String} tabId - ID of the tab to switch to
 */
function switchTabUI(tabId) {
    switchTab(tabId, tabButtons, tabPanels);
    
    // Special handling for different tabs
    if (tabId === 'model' && currentMermaidSyntax) {
        renderMermaid(currentMermaidSyntax, mermaidDiagramContainer);
    }
}

/**
 * Set up the CodeMirror editor
 */
function setupEditor() {
    const editorContainer = document.getElementById('editor-container');
    if (!editorContainer) return;

    // Default model text showcasing v1.2 features
    const defaultModelText = `
title Simple Population & Resources Model v1.2

# Simple Population & Resources Model v1.2

constant BirthRate = 0.02 # births per person per year
constant DeathRateFactor = 0.001 # Factor for resource-dependent death rate
constant InitialPopulation = 1000 # people
constant InitialResources = 10000 # units
constant ResourceConsumptionRate = 1 # units per person per year

stock Population = InitialPopulation
stock Resources = InitialResources

flow Births:
    Population * BirthRate -+> Population

flow Deaths:
     (Resources > 1e-6 ? Population * DeathRateFactor * Population / Resources : 0) --> Population

flow ResourceDepletion:
    Population * ResourceConsumptionRate --> Resources

limit Resources min=0
limit Population min=0

constant StartTime = 0
constant EndTime = 40
constant TimeStep = 0.5

sweep param BirthRate = [0.02, 0.03]
plot Population
`;

    // Initialize CodeMirror
    editor = CodeMirror(editorContainer, {
        value: defaultModelText, 
        mode: "dsl", // Use our custom DSL mode
        lineNumbers: true,
        lineWrapping: true,
        theme: "default",
        matchBrackets: true,
        autoCloseBrackets: true,
        gutters: ["CodeMirror-lint-markers"],
        lint: true
    });

    // Debounced update visualization
    editor.on("change", debounce(() => {
        updateVisualization();
        // Debounce URL update separately
        clearTimeout(urlUpdateTimer);
        urlUpdateTimer = setTimeout(() => {
            updateUrl(editor.getValue());
        }, 1500); // Longer delay for URL update
    }, DEBOUNCE_DELAY));
}

/**
 * Opens the DSL documentation in a new tab
 */
function openDocumentation() {
    window.open('documentation.html', '_blank');
}

/**
 * Toggle the actions dropdown menu
 */
function toggleActionsDropdown(e) {
    e.stopPropagation();
    actionsDropdown.classList.toggle('active');
} 