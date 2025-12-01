const BaseDatabaseProvider = require('./providers/database/BaseDatabaseProvider');

/**
 * Dynamic Database Provider Manager
 * Allows registration and switching between different database providers
 */
class Database {
    constructor() {
        this.providers = new Map();
        this.currentProvider = null;
    }

    /**
     * Register a new database provider
     * @param {string} name - Provider name
     * @param {BaseDatabaseProvider} providerClass - Provider class
     */
    registerProvider(name, providerClass) {
        if (!(providerClass.prototype instanceof BaseDatabaseProvider)) {
            throw new Error('Provider must extend BaseDatabaseProvider');
        }
        this.providers.set(name, providerClass);
    }

    /**
     * Initialize a provider with configuration
     * @param {string} providerName - Name of the provider
     * @param {Object} config - Configuration object
     * @returns {Promise<BaseDatabaseProvider>} Initialized provider instance
     */
    async initializeProvider(providerName, config = {}) {
        const ProviderClass = this.providers.get(providerName);
        if (!ProviderClass) {
            throw new Error(`Provider ${providerName} not registered`);
        }

        const provider = new ProviderClass(config);
        await provider.connect();
        this.currentProvider = provider;
        return provider;
    }

    /**
     * Set the current active provider
     * @param {BaseDatabaseProvider} provider - Provider instance
     */
    setProvider(provider) {
        this.currentProvider = provider;
    }

    /**
     * Get current provider
     * @returns {BaseDatabaseProvider|null}
     */
    getProvider() {
        return this.currentProvider;
    }

    /**
     * Execute a query
     * @param {string} query - Query string
     * @param {Array} params - Query parameters
     * @returns {Promise<Object>} Query result
     */
    async query(query, params = []) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.query(query, params);
    }

    /**
     * Insert data into collection/table
     * @param {string} collection - Collection/table name
     * @param {Object|Array} data - Data to insert
     * @returns {Promise<Object>} Insert result
     */
    async insert(collection, data) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.insert(collection, data);
    }

    /**
     * Find documents/records
     * @param {string} collection - Collection/table name
     * @param {Object} filter - Filter criteria
     * @returns {Promise<Array>} Found records
     */
    async find(collection, filter = {}) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.find(collection, filter);
    }

    /**
     * Update documents/records
     * @param {string} collection - Collection/table name
     * @param {Object} filter - Filter criteria
     * @param {Object} data - Update data
     * @returns {Promise<Object>} Update result
     */
    async update(collection, filter, data) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.update(collection, filter, data);
    }

    /**
     * Delete documents/records
     * @param {string} collection - Collection/table name
     * @param {Object} filter - Filter criteria
     * @returns {Promise<Object>} Delete result
     */
    async delete(collection, filter) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.delete(collection, filter);
    }

    /**
     * Disconnect from database
     * @returns {Promise<void>}
     */
    async disconnect() {
        if (this.currentProvider) {
            await this.currentProvider.disconnect();
            this.currentProvider = null;
        }
    }

    /**
     * List all registered providers
     * @returns {Array<string>} Array of provider names
     */
    listProviders() {
        return Array.from(this.providers.keys());
    }
}

module.exports = Database;