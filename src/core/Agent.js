const LLMProvider = require('./LLMProvider');
const Database = require('./Database');
const MCPServer = require('./MCPServer');

/**
 * Main Agent class that orchestrates LLM, Database, and MCP Server
 */
class Agent {
    constructor(config = {}) {
        this.config = config;
        this.llm = new LLMProvider();
        this.database = new Database();
        this.mcpServer = config.mcpServer || new MCPServer(config.mcp || {});
        this.memorytype = config.memorytype || 'short-term-memory';
        this.state = {};
    }

    /**
     * Initialize the agent with LLM and Database providers
     * @param {Object} providers - Provider configuration
     * @param {Object} providers.llm - LLM provider config { name, config }
     * @param {Object} providers.database - Database provider config { name, config }
     * @returns {Promise<void>}
     */
    async initialize(providers = {}) {
        if (providers.llm) {
            await this.llm.initializeProvider(providers.llm.name, providers.llm.config);
        }

        if (providers.database) {
            await this.database.initializeProvider(providers.database.name, providers.database.config);
        }

        if (this.mcpServer) {
            await this.mcpServer.start();
        }

        if (this.memorytype) {
            //Need to implement the memory type policy.

        }
    }

    /**
     * Process a message/query
     * @param {string} message - User message
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Agent response
     */
    async process(message, options = {}) {
        // Add to memory
        this.memory.push({
            role: 'user',
            content: message,
            timestamp: new Date()
        });

        // Build context from memory
        const context = this.buildContext();

        // Get response from LLM
        const response = await this.llm.chat(context, {
            ...options,
            tools: this.mcpServer.listTools()
        });

        // Add response to memory
        this.memory.push({
            role: 'assistant',
            content: response.content || response.text || JSON.stringify(response),
            timestamp: new Date()
        });

        return response;
    }

    /**
     * Build context from memory and state
     * @returns {Array} Context messages
     */
    buildContext() {
        const context = [...this.memory];

        // Add system context if available
        if (this.config.systemPrompt) {
            context.unshift({
                role: 'system',
                content: this.config.systemPrompt
            });
        }

        return context;
    }

    /**
     * Get agent state
     * @returns {Object} Current state
     */
    getState() {
        return {
            ...this.state,
            memoryLength: this.memory.length,
            llmProvider: this.llm.getProvider()?.getName(),
            databaseProvider: this.database.getProvider()?.getName(),
            mcpStatus: this.mcpServer.getStatus()
        };
    }

    /**
     * Clear agent memory
     */
    clearMemory() {
        this.memory = [];
    }

    /**
     * Set agent state
     * @param {Object} state - State to set
     */
    setState(state) {
        this.state = { ...this.state, ...state };
    }

    /**
     * Shutdown the agent
     * @returns {Promise<void>}
     */
    async shutdown() {
        await this.database.disconnect();
        await this.mcpServer.stop();
    }
}

module.exports = Agent;