const LLMProvider = require('./providers/LLMProvider');
const Database = require('./Database');
const MCPServer = require('./MCPServer');
const MiddlewareManager = require('./Middleware');

/**
 * Main Agent class that orchestrates LLM, Database, and MCP Server
 */
class Agent {
    constructor(config = {}) {
        this.config = config;
        this.llm = new LLMProvider();
        this.database = new Database();
        this.mcpServer = config.mcpServer || new MCPServer(config.mcp || {});
        this.memoryType = config.memoryType || 'short-term-memory';
        this.middleware = config.middleware instanceof MiddlewareManager
            ? config.middleware
            : null;

        // core runtime state
        this.memory = [];      // conversation history
        this.state = {};       // arbitrary agent state
    }

    /**
     * Initialize the agent with LLM and Database providers
     * @param {Object} providers
     * @param {{ name: string, config?: Object }} [providers.llm]
     * @param {{ name: string, config?: Object }} [providers.database]
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

        this.applyMemoryPolicy();
    }

    /**
     * Apply memory policy depending on memoryType.
     */
    applyMemoryPolicy() {
        if (!this.memory) this.memory = [];

        if (this.memoryType === 'short-term-memory') {
            const maxMessages = this.config.maxMemoryMessages || 30;
            if (this.memory.length > maxMessages) {
                this.memory = this.memory.slice(-maxMessages);
            }
        }
        // future: 'long-term', 'episodic', DB-backed memory, etc.
    }

    /**
     * Process a message/query from the user with multi-step tool use.
     * @param {string} message
     * @param {{ maxSteps?: number }} [options]
     * @returns {Promise<Object>} Final LLM response
     */
    async process(message, options = {}) {
        const maxSteps = options.maxSteps || 4;

        if (this.middleware) {
            await this.middleware.execute('beforeProcess', {
                message,
                options,
                agent: this,
            });
        }

        // 1) Add user message to memory (+ optional DB)
        const userEvent = {
            role: 'user',
            content: message,
            timestamp: new Date(),
        };
        this.memory.push(userEvent);
        await this.persistMemoryEvent(userEvent);

        // 2) Build initial context and tools
        let messages = this.buildContext();
        const tools = this.mcpServer ? this.mcpServer.listTools() : [];

        let lastResponse = null;

        for (let step = 0; step < maxSteps; step++) {
            try {
                // 3) Call LLM with current messages and tools
                if (this.middleware) {
                    await this.middleware.execute('beforeLLMCall', {
                        messages,
                        tools,
                        options,
                    });
                }

                const response = await this.llm.chat(messages, {
                    ...options,
                    tools,
                });

                if (this.middleware) {
                    await this.middleware.execute('afterLLMCall', {
                        messages,
                        tools,
                        options,
                        response,
                    });
                }
                lastResponse = response;

                const content =
                    response.content || response.text || JSON.stringify(response);

                // Save assistant turn
                const assistantEvent = {
                    role: 'assistant',
                    content,
                    timestamp: new Date(),
                };
                this.memory.push(assistantEvent);
                await this.persistMemoryEvent(assistantEvent);
                messages.push({ role: 'assistant', content });

                // 4) If there are no tool calls, we’re done
                const toolCalls = response.toolCalls || [];
                if (!toolCalls.length) {
                    break;
                }

                // 5) Execute each tool in parallel and push results as messages
                const toolResults = await Promise.all(
                    toolCalls.map(async (call) => {
                        const { name, arguments: args } = call;

                        if (this.middleware) {
                            await this.middleware.execute('beforeToolCall', {
                                name,
                                args,
                                agent: this,
                            });
                        }

                        const result = await this.mcpServer.callTool(name, args || {});

                        if (this.middleware) {
                            await this.middleware.execute('afterToolCall', {
                                name,
                                args,
                                result,
                                agent: this,
                            });
                        }

                        const content =
                            typeof result === 'string' ? result : JSON.stringify(result);

                        const event = {
                            role: 'tool',
                            name,
                            content,
                            timestamp: new Date(),
                        };

                        // side effects here; return event so we can also push to messages
                        this.memory.push(event);
                        await this.persistMemoryEvent(event);

                        return event;
                    })
                );

                // Keep message order aligned with toolCalls order
                for (const event of toolResults) {
                    messages.push({
                        role: 'tool',
                        name: event.name,
                        content: event.content,
                    });
                }
                // 6) Loop again so LLM can see tool results
            } catch (err) {
                const errorMessage = `LLM or tool error: ${err.message || String(err)}`;
                const errorEvent = {
                    role: 'assistant',
                    content: errorMessage,
                    timestamp: new Date(),
                };
                this.memory.push(errorEvent);
                await this.persistMemoryEvent(errorEvent);

                if (this.middleware) {
                    await this.middleware.execute('onError', {
                        error: err,
                        message,
                        options,
                        agent: this,
                    });
                    await this.middleware.execute('afterProcess', {
                        message,
                        options,
                        agent: this,
                        error: err,
                        response: null,
                    });
                }

                this.applyMemoryPolicy();
                return { error: true, message: errorMessage };
            }
        }

        this.applyMemoryPolicy();

        if (this.middleware) {
            await this.middleware.execute('afterProcess', {
                message,
                options,
                agent: this,
                error: null,
                response: lastResponse,
            });
        }

        return lastResponse;
    }

    /**
     * Build context from memory and config.
     * @returns {Array} Context messages
     */
    buildContext() {
        const context = [...this.memory];

        if (this.config.systemPrompt) {
            context.unshift({
                role: 'system',
                content: this.config.systemPrompt,
            });
        }

        return context;
    }

    /**
     * Get agent state snapshot
     */
    getState() {
        return {
            ...this.state,
            memoryLength: this.memory.length,
            llmProvider: this.llm.getProvider()?.getName(),
            databaseProvider: this.database.getProvider()?.getName(),
            mcpStatus: this.mcpServer.getStatus(),
        };
    }

    clearMemory() {
        this.memory = [];
    }

    setState(state) {
        this.state = { ...this.state, ...state };
    }

    /**
     * Shutdown the agent and its dependencies
     */
    async shutdown() {
        await this.database.disconnect();
        await this.mcpServer.stop();
    }

    /**
     * Persist a memory event if database + config say so.
     */
    async persistMemoryEvent(event) {
        if (!this.config.persistMemory) return;
        if (!this.database.getProvider()) return;

        const conversationId = this.config.conversationId || 'default';

        try {
            await this.database.insert('agent_memory', {
                conversationId,
                role: event.role,
                content: event.content,
                timestamp: event.timestamp || new Date(),
                meta: event.meta || {},
            });
        } catch (err) {
            if (this.config.logErrors) {
                console.error('Failed to persist memory event', err);
            }
        }
    }
}

module.exports = Agent;