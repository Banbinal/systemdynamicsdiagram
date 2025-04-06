/**
 * Main Application Module for System Dynamics Tool
 * Integrates all modules and manages UI interactions
 */

import { parseDSL } from './parser.js';
import { generateMermaidSyntax, renderMermaid } from './visualization.js';
import { runSimulation } from './simulation.js';
import { plotResults, plotABResults } from './plotting.js';
import { 
    interpretSimulationResults, 
    findFeedbackLoops, 
    displayInterpretation,
    displayABInterpretation
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

// --- Global Variables & Constants ---
const DEBOUNCE_DELAY = 500;
let currentChart = null;
let currentMermaidSyntax = '';
let lastValidModel = null;
let lastResults = null;
let lastAnalysis = null;
let lastLoops = null;
let debounceTimer = null;
let urlUpdateTimer = null;
let lastABResults = null;
let editor = null; // CodeMirror editor instance

// Define CodeMirror mode for DSL syntax highlighting
function defineDslMode() {
    // Define a simple mode for our DSL
    CodeMirror.defineSimpleMode("dsl", {
        // Start state
        start: [
            // Comments
            {regex: /#.*/, token: "comment"},
            
            // Keywords
            {regex: /(?:stock|flow|aux|param|graph|title|time|dt|timestep|runs|to|from|connect|sim)\b/, 
             token: "keyword"},
            
            // AB Test
            {regex: /abtest\b/, token: "abtest"},
            
            // Numbers
            {regex: /\d+(?:\.\d+)?/, token: "number"},
            
            // Operators
            {regex: /[+\-*\/=<>!&|^%]+/, token: "operator"},
            
            // Variable names
            {regex: /[A-Za-z_][A-Za-z0-9_]*/, token: "variable"},
            
            // Strings
            {regex: /"(?:[^\\]|\\.)*?(?:"|$)/, token: "string"},
            {regex: /'(?:[^\\]|\\.)*?(?:'|$)/, token: "string"},
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
    const model = parseDSL(dslCode);
    
    if (model && model.errors.length === 0) {
        lastValidModel = model; // Store valid model
        
        // Display model title if available
        const modelTitleElement = document.getElementById('modelTitle');
        if (modelTitleElement) {
            if (model.title) {
                modelTitleElement.textContent = model.title;
                modelTitleElement.classList.remove('hidden');
            } else {
                modelTitleElement.classList.add('hidden');
            }
        }
        
        currentMermaidSyntax = generateMermaidSyntax(model);
        // Only render if the model tab is active
        if (modelTabPanel.getAttribute('data-active') === 'true') {
            renderMermaid(currentMermaidSyntax, mermaidDiagramContainer);
        }
    } else if (model && model.errors.length > 0) {
        // Show parsing errors
        displayMessage(`DSL Parsing Errors:\n- ${model.errors.join('\n- ')}`, 'error', messageArea);
        currentMermaidSyntax = 'graph TD; Error["Parsing failed or model invalid."];';
        
        // Hide model title if model is invalid
        const modelTitleElement = document.getElementById('modelTitle');
        if (modelTitleElement) {
            modelTitleElement.classList.add('hidden');
        }
        
        if (modelTabPanel.getAttribute('data-active') === 'true') {
            renderMermaid(currentMermaidSyntax, mermaidDiagramContainer);
        }
    } else {
        // Parsing failed entirely
        currentMermaidSyntax = 'graph TD; Error["Parsing failed or model invalid."];';
        
        // Hide model title if model is invalid
        const modelTitleElement = document.getElementById('modelTitle');
        if (modelTitleElement) {
            modelTitleElement.classList.add('hidden');
        }
        
        if (modelTabPanel.getAttribute('data-active') === 'true') {
            renderMermaid(currentMermaidSyntax, mermaidDiagramContainer);
        }
    }
}

/**
 * Handles periodic URL updates for sharing
 */
function handleUrlUpdate() {
    if (!editor) return;
    
    clearTimeout(urlUpdateTimer);
    urlUpdateTimer = setTimeout(() => {
        updateUrl(editor.getValue());
    }, 2000);
}

/**
 * Handles the simulation button click
 */
function handleSimulateClick() {
    if (!editor) return;
    
    messageArea.innerHTML = ''; // Clear previous messages
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
    
    // Clear chart and show loading state
    resultsChartCtx.clearRect(0, 0, resultsChart.width, resultsChart.height);
    chartPlaceholder.style.display = 'flex';
    chartPlaceholder.textContent = 'Running simulation...';
    interpretationContent.innerHTML = '<p class="text-gray-500">Running simulation...</p>';
    statusIndicator.textContent = 'Simulating...';
    simTabBtn.disabled = true;
    interpTabBtn.disabled = true; // Disable tabs during run

    // Parse the model *before* the timeout to catch immediate errors
    const dslCode = editor.getValue();
    const model = parseDSL(dslCode);

    if (model && model.errors.length === 0) {
        lastValidModel = model; // Store the valid model

        // Use setTimeout to allow the UI to update before potentially long simulation
        setTimeout(() => {
            try {
                // --- A/B Test Logic ---
                if (model.abTest) {
                    console.log("Running A/B Test for:", model.abTest.paramName);
                    // Create parameter overrides
                    const paramsA = { ...model.params, [model.abTest.paramName]: model.abTest.values[0] };
                    const paramsB = { ...model.params, [model.abTest.paramName]: model.abTest.values[1] };

                    // Run simulations using the original model but with overridden parameters
                    const resultsA = runSimulation(model, paramsA);
                    const resultsB = runSimulation(model, paramsB);

                    statusIndicator.textContent = ''; // Clear status after sim

                    if (resultsA && resultsB) {
                        lastABResults = {
                            paramName: model.abTest.paramName,
                            values: model.abTest.values,
                            A: resultsA,
                            B: resultsB
                        };
                        lastResults = null; // Clear standard results
                        
                        // Generate analysis for both scenarios
                        const analysisA = interpretSimulationResults(resultsA, model);
                        const analysisB = interpretSimulationResults(resultsB, model);
                        lastAnalysis = { A: analysisA, B: analysisB };
                        
                        // Feedback loops (same for both scenarios)
                        lastLoops = findFeedbackLoops(model);

                        const chartConfig = plotABResults(lastABResults, model);
                        if (chartConfig) {
                            chartPlaceholder.style.display = 'none';
                            currentChart = new Chart(resultsChartCtx, chartConfig);
                            
                            // Generate and display AB interpretation
                            displayABInterpretation(lastABResults, model);
                            
                            // Enable navigation and switch to results view
                            displayMessage(`A/B Simulation for ${model.abTest.paramName} completed.`, "info", messageArea);
                            simTabBtn.disabled = false;
                            interpTabBtn.disabled = false;
                            switchTabUI('simulation');
                        } else {
                            displayMessage("A/B Simulation completed, but no plot generated.", "info", messageArea);
                            chartPlaceholder.textContent = 'A/B Simulation completed, no plot data.';
                            chartPlaceholder.style.display = 'flex';
                            interpTabBtn.disabled = false; // Interpretation might still be valid
                            switchTabUI('interpretation');
                        }
                    } else {
                        // One or both A/B simulations failed
                        throw new Error("One or both A/B simulations failed.");
                    }

                // --- Standard Simulation Logic ---
                } else {
                    console.log("Running Standard Simulation");
                    // Run simulation without parameter overrides
                    const results = runSimulation(model); // Pass null or no second arg
                    statusIndicator.textContent = ''; // Clear status after sim
                    
                    if (results) {
                        lastResults = results;
                        lastABResults = null; // Clear A/B results
                        
                        // Generate analysis and find feedback loops
                        lastAnalysis = interpretSimulationResults(results, model);
                        lastLoops = findFeedbackLoops(model);
                        
                        const chartConfig = plotResults(results, model);
                        if (chartConfig) {
                            chartPlaceholder.style.display = 'none';
                            currentChart = new Chart(resultsChartCtx, chartConfig);
                            
                            // Update interpretation panel
                            displayInterpretation(model, lastAnalysis, lastLoops);
                            
                            // Enable navigation and show success message
                            displayMessage("Simulation completed.", "info", messageArea);
                            simTabBtn.disabled = false;
                            interpTabBtn.disabled = false;
                            switchTabUI('simulation');
                        } else {
                            displayMessage("Simulation completed, but no plot generated.", "info", messageArea);
                            chartPlaceholder.textContent = 'Simulation completed, no plot data.';
                            chartPlaceholder.style.display = 'flex';
                            interpTabBtn.disabled = false;
                            switchTabUI('interpretation');
                        }
                    } else {
                        // Simulation function returned null (likely an error during sim)
                        throw new Error("Simulation failed to produce results.");
                    }
                }
            } catch (e) {
                // Catch errors during simulation or post-simulation analysis
                statusIndicator.textContent = '';
                displayMessage(`Error during simulation/analysis: ${e.message}`, 'error', messageArea);
                console.error("Simulation/Analysis error:", e);
                chartPlaceholder.textContent = 'Analysis failed.';
                chartPlaceholder.style.display = 'flex';
                interpretationContent.innerHTML = `<p class="text-red-600">Analysis failed: ${e.message}</p>`;
                interpTabBtn.disabled = true;
                switchTabUI('model');
            }
        }, 50); // Short delay for UI update
    } else {
        // Parsing failed before simulation attempt
        chartPlaceholder.textContent = 'Cannot simulate: parsing errors.';
        interpretationContent.innerHTML = '<p class="text-red-600">Cannot simulate due to parsing errors.</p>';
        statusIndicator.textContent = '';
        simTabBtn.disabled = true;
        interpTabBtn.disabled = true;
        
        if (model && model.errors.length > 0) {
            displayMessage(`Cannot simulate due to parsing errors:\n- ${model.errors.join('\n- ')}`, "error", messageArea);
        } else {
            displayMessage("Cannot simulate: Invalid or missing model.", "error", messageArea);
        }
    }
}

/**
 * Show the report generation modal
 */
function showReportModal() {
    if (!lastValidModel) {
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
    if (!lastValidModel || !editor) {
        displayMessage("No valid model available for report generation.", "error", messageArea);
        return;
    }
    
    // Collect report options
    const options = {
        includeModelSummary: includeModelSummary.checked,
        includeSimSummary: includeSimSummary.checked,
        includeLoops: includeLoops.checked,
        includeDsl: includeDsl.checked
    };
    
    try {
        // Select the appropriate results based on whether we have A/B test or standard results
        const results = lastABResults || lastResults;
        const analysis = lastAnalysis;
        
        // Generate the report HTML
        const reportHtml = generateReport(
            lastValidModel,
            results,
            analysis,
            lastLoops,
            editor.getValue(),
            options
        );
        
        // Generate PDF from the HTML
        await generatePDF(reportHtml);
        
        hideReportModal();
        displayMessage("PDF report generated and downloaded.", "info", messageArea);
    } catch (error) {
        console.error("Error generating PDF:", error);
        displayMessage("Error generating PDF report: " + error.message, "error", messageArea);
    }
}

/**
 * Handle HTML report generation
 */
function handleGenerateHtml() {
    if (!lastValidModel || !editor) {
        displayMessage("No valid model available for report generation.", "error", messageArea);
        return;
    }
    
    // Collect report options
    const options = {
        includeModelSummary: includeModelSummary.checked,
        includeSimSummary: includeSimSummary.checked,
        includeLoops: includeLoops.checked,
        includeDsl: includeDsl.checked
    };
    
    try {
        // Select the appropriate results based on whether we have A/B test or standard results
        const results = lastABResults || lastResults;
        const analysis = lastAnalysis;
        
        // Generate the report HTML
        const reportHtml = generateReport(
            lastValidModel,
            results,
            analysis,
            lastLoops,
            editor.getValue(),
            options
        );
        
        // Save the HTML to a file
        saveHTML(reportHtml);
        
        hideReportModal();
        displayMessage("HTML report generated and downloaded.", "info", messageArea);
    } catch (error) {
        console.error("Error generating HTML:", error);
        displayMessage("Error generating HTML report: " + error.message, "error", messageArea);
    }
}

/**
 * Clear all outputs
 */
function clearOutputs() {
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
    
    // Reset chart area
    resultsChartCtx.clearRect(0, 0, resultsChart.width, resultsChart.height);
    chartPlaceholder.style.display = 'flex';
    chartPlaceholder.textContent = 'Click "Run Simulation" to see results.';
    
    // Reset interpretation panel
    interpretationContent.innerHTML = '<p class="text-gray-500">Run simulation to generate interpretation...</p>';
    
    // Clear references to previous results
    lastResults = null;
    lastABResults = null;
    lastAnalysis = null;
    lastLoops = null;
    
    // Disable result tabs
    simTabBtn.disabled = true;
    interpTabBtn.disabled = true;
    
    // Switch to model tab
    switchTabUI('model');
    
    // Show confirmation message
    displayMessage("Outputs cleared.", "info", messageArea);
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
    
    // Sample DSL content
    const initialContent = `# Minimal Population Model
title Simple Population & Resources Model

# Stocks
stock Population = 1000
stock Resources = 5000

# Parameters
param BirthRate = 0.05
param ResourceConsumptionRate = 1.2

# Flows
flow Births = Population * BirthRate * (Resources / 5000)
flow Deaths = Population * (1 - Resources / 10000)
flow ResourceDepletion = Population * ResourceConsumptionRate

# Connections
connect Births -> Population
connect Deaths <- Population
connect ResourceDepletion <- Resources

# Simulation settings
sim 0 40 0.5

# A/B test different consumption rates
abtest param ResourceConsumptionRate = [1.2, 0.8]`;

    // Create CodeMirror editor
    editor = CodeMirror(editorContainer, {
        value: initialContent,
        mode: "dsl",
        lineNumbers: true,
        lineWrapping: true,
        theme: "default",
        indentWithTabs: false,
        tabSize: 2,
        indentUnit: 2,
        matchBrackets: true,
        autoCloseBrackets: true
    });
    
    // Set up event listener for changes
    editor.on("change", () => {
        debouncedParseAndVisualize();
    });
}

// Debounced parse and visualize function
const debouncedParseAndVisualize = debounce(() => {
    statusIndicator.textContent = 'Updating diagram...';
    updateVisualization();
    // Also trigger URL update (less frequently)
    handleUrlUpdate();
    setTimeout(() => { statusIndicator.textContent = ''; }, 1000);
}, DEBOUNCE_DELAY);

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