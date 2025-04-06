/**
 * Utilities Module for System Dynamics Tool
 * Common utility functions used across the application
 */

/**
 * Displays a message in the specified container
 * @param {String} text - Message text to display
 * @param {String} type - Message type ('error' or 'info')
 * @param {HTMLElement} container - Container element for the message
 */
function displayMessage(text, type = 'info', container) {
    if (!container) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.textContent = text;
    messageDiv.className = type === 'error' ? 'error-message' : 'info-message';
    
    // Clear previous messages before adding a new one
    container.innerHTML = '';
    container.appendChild(messageDiv);
    
    // Auto-clear info messages after a delay
    if (type === 'info') {
        setTimeout(() => {
            if (container.contains(messageDiv)) {
                container.removeChild(messageDiv);
            }
        }, 5000);
    }
}

/**
 * Debounces a function call
 * @param {Function} func - Function to debounce
 * @param {Number} wait - Debounce delay in ms
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    };
}

/**
 * Handles tab switching UI
 * @param {String} tabId - ID of tab to switch to
 * @param {NodeList} tabButtons - Collection of tab buttons
 * @param {NodeList} tabPanels - Collection of tab panels
 */
function switchTab(tabId, tabButtons, tabPanels) {
    if (!tabButtons || !tabPanels) return;
    
    // Deactivate all tabs
    tabButtons.forEach(btn => {
        btn.setAttribute('data-active', 'false');
    });
    
    tabPanels.forEach(panel => {
        panel.setAttribute('data-active', 'false');
    });
    
    // Activate the selected tab
    const selectedBtn = Array.from(tabButtons).find(btn => btn.dataset.tab === tabId);
    const selectedPanel = Array.from(tabPanels).find(panel => panel.dataset.panel === tabId);
    
    if (selectedBtn) selectedBtn.setAttribute('data-active', 'true');
    if (selectedPanel) selectedPanel.setAttribute('data-active', 'true');
}

/**
 * Updates the URL with state parameters for sharing
 * @param {String} dslCode - DSL code to encode in URL
 */
function updateUrl(dslCode) {
    if (!dslCode) return;
    
    try {
        const compressed = LZString.compressToEncodedURIComponent(dslCode);
        const newUrl = `${window.location.pathname}?model=${compressed}`;
        window.history.replaceState({}, document.title, newUrl);
    } catch (e) {
        console.error('Failed to update URL:', e);
    }
}

/**
 * Loads DSL code from URL parameters
 * @returns {String|null} - DSL code from URL or null if not present
 */
function loadFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const compressedModel = params.get('model');
        
        if (compressedModel) {
            return LZString.decompressFromEncodedURIComponent(compressedModel);
        }
    } catch (e) {
        console.error('Failed to load from URL:', e);
    }
    
    return null;
}

/**
 * Helper to copy text to clipboard
 * @param {String} text - Text to copy
 * @returns {Promise<boolean>} - Success status
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        console.error('Failed to copy to clipboard:', e);
        return false;
    }
}

export {
    displayMessage,
    debounce,
    switchTab,
    updateUrl,
    loadFromUrl,
    copyToClipboard
}; 