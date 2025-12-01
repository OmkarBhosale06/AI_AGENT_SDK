/**
 * Base class for LLM providers
 */
class BaseLLMProvider {
    constructor(config = {}) {
        this.config = config;
        this.name = 'BaseLLMProvider';
    }

    async initialize() {
        throw new Error('initialize() must be implemented by subclass');
    }

    async chat(messages, options = {}) {
        throw new Error('chat() must be implemented by subclass');
    }

    async streamChat(messages, options = {}) {
        throw new Error('streamChat() must be implemented by subclass');
    }

    async embed(text) {
        throw new Error('embed() must be implemented by subclass');
    }

    getName() {
        return this.name;
    }

    getConfig() {
        return this.config;
    }
}

module.exports = BaseLLMProvider;