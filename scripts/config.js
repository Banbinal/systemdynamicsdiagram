export const config = {
    // Maximum number of simulation variations (sweeps * scenarios) to run
    // Prevents browser freeze with too many variations.
    MAX_VARIATIONS: 100,

    // Default simulation time parameters (if not specified in DSL)
    DEFAULT_START_TIME: 0,
    DEFAULT_END_TIME: 10,
    DEFAULT_TIME_STEP: 0.25,

    // Add other configuration constants here as needed
    // e.g., UI settings, backend endpoints (if any), etc.
}; 