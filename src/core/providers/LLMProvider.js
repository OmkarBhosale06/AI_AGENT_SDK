const BaseLLMProvider = require('./BaseLLMProvider');

/**
 * Dynamic LLM Provider Manager
 * Allows registration and switching between different LLM providers
 */
class LLMProvider {
    constructor() {
        this.providers = new Map();
        this.currentProvider = null;
    }

    /**
     * Register a new LLM provider
     * @param {string} name - Provider name
     * @param {BaseLLMProvider} providerClass - Provider class
     */
    registerProvider(name, providerClass) {
        if (!(providerClass.prototype instanceof BaseLLMProvider)) {
            throw new Error('Provider must extend BaseLLMProvider');
        }
        this.providers.set(name, providerClass);
    }

    /**
     * Initialize a provider with configuration
     * @param {string} providerName - Name of the provider
     * @param {Object} config - Configuration object
     * @returns {Promise<BaseLLMProvider>} Initialized provider instance
     */
    async initializeProvider(providerName, config = {}) {
        const ProviderClass = this.providers.get(providerName);
        if (!ProviderClass) {
            throw new Error(`Provider ${providerName} not registered`);
        }

        const provider = new ProviderClass(config);
        await provider.initialize();
        this.currentProvider = provider;
        return provider;
    }

    /**
     * Set the current active provider
     * @param {BaseLLMProvider} provider - Provider instance
     */
    setProvider(provider) {
        this.currentProvider = provider;
    }

    /**
     * Get current provider
     * @returns {BaseLLMProvider|null}
     */
    getProvider() {
        return this.currentProvider;
    }

    /**
     * Chat with current provider
     * @param {Array} messages - Array of message objects
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Response from LLM
     */
    async chat(messages, options = {}) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.chat(messages, options);
    }

    /**
     * Stream chat with current provider
     * @param {Array} messages - Array of message objects
     * @param {Object} options - Additional options
     * @returns {AsyncGenerator} Stream of responses
     */
    async *streamChat(messages, options = {}) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        yield* await this.currentProvider.streamChat(messages, options);
    }

    /**
     * Get embeddings from current provider
     * @param {string|Array<string>} text - Text to embed
     * @returns {Promise<Array>} Embedding vectors
     */
    async embed(text) {
        if (!this.currentProvider) {
            throw new Error('No provider initialized');
        }
        return await this.currentProvider.embed(text);
    }

    /**
     * List all registered providers
     * @returns {Array<string>} Array of provider names
     */
    listProviders() {
        return Array.from(this.providers.keys());
    }
}

module.exports = LLMProvider;