const { EventEmitter } = require('events');

/**
 * Model Context Protocol (MCP) Server
 * Implements MCP protocol for agent communication
 */
class MCPServer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            port: config.port || 3000,
            host: config.host || 'localhost',
            ...config
        };
        this.tools = new Map();
        this.resources = new Map();
        this.prompts = new Map();
        this.server = null;
    }

    /**
     * Register a tool that can be called by agents
     * @param {string} name - Tool name
     * @param {Object} toolDef - Tool definition
     * @param {Function} handler - Tool handler function
     */
    registerTool(name, toolDef, handler) {
        if (typeof handler !== 'function') {
            throw new Error('Handler must be a function');
        }

        this.tools.set(name, {
            name,
            description: toolDef.description || '',
            inputSchema: toolDef.inputSchema || {},
            handler
        });

        this.emit('toolRegistered', name);
    }

    /**
     * Register a resource
     * @param {string} uri - Resource URI
     * @param {Object} resourceDef - Resource definition
     * @param {Function} handler - Resource handler function
     */
    registerResource(uri, resourceDef, handler) {
        this.resources.set(uri, {
            uri,
            name: resourceDef.name || uri,
            description: resourceDef.description || '',
            mimeType: resourceDef.mimeType || 'text/plain',
            handler
        });

        this.emit('resourceRegistered', uri);
    }

    /**
     * Register a prompt template
     * @param {string} name - Prompt name
     * @param {Object} promptDef - Prompt definition
     */
    registerPrompt(name, promptDef) {
        this.prompts.set(name, {
            name,
            description: promptDef.description || '',
            arguments: promptDef.arguments || [],
            template: promptDef.template || ''
        });

        this.emit('promptRegistered', name);
    }

    /**
     * Get tool by name
     * @param {string} name - Tool name
     * @returns {Object|null} Tool definition
     */
    getTool(name) {
        return this.tools.get(name) || null;
    }

    /**
     * Get resource by URI
     * @param {string} uri - Resource URI
     * @returns {Object|null} Resource definition
     */
    getResource(uri) {
        return this.resources.get(uri) || null;
    }

    /**
     * Get prompt by name
     * @param {string} name - Prompt name
     * @returns {Object|null} Prompt definition
     */
    getPrompt(name) {
        return this.prompts.get(name) || null;
    }

    /**
     * List all registered tools
     * @returns {Array<Object>} Array of tool definitions
     */
    listTools() {
        return Array.from(this.tools.values());
    }

    /**
     * List all registered resources
     * @returns {Array<Object>} Array of resource definitions
     */
    listResources() {
        return Array.from(this.resources.values());
    }

    /**
     * List all registered prompts
     * @returns {Array<Object>} Array of prompt definitions
     */
    listPrompts() {
        return Array.from(this.prompts.values());
    }

    /**
     * Call a tool
     * @param {string} name - Tool name
     * @param {Object} args - Tool arguments
     * @returns {Promise<Object>} Tool result
     */
    async callTool(name, args = {}) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Tool ${name} not found`);
        }

        try {
            this.emit('toolCalled', { name, args });
            const result = await tool.handler(args);
            this.emit('toolCompleted', { name, args, result });
            return result;
        } catch (error) {
            this.emit('toolError', { name, args, error });
            throw error;
        }
    }

    /**
     * Get resource content
     * @param {string} uri - Resource URI
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Resource content
     */
    async fettchResource(uri, options = {}) {
        const resource = this.resources.get(uri);
        if (!resource) {
            throw new Error(`Resource ${uri} not found`);
        }

        try {
            this.emit('resourceRequested', { uri, options });
            const content = await resource.handler(uri, options);
            this.emit('resourceRetrieved', { uri, content });
            return content;
        } catch (error) {
            this.emit('resourceError', { uri, error });
            throw error;
        }
    }

    /**
     * Render a prompt template
     * @param {string} name - Prompt name
     * @param {Object} variables - Template variables
     * @returns {string} Rendered prompt
     */
    renderPrompt(name, variables = {}) {
        const prompt = this.prompts.get(name);
        if (!prompt) {
            throw new Error(`Prompt ${name} not found`);
        }

        let rendered = prompt.template;
        for (const [key, value] of Object.entries(variables)) {
            rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        return rendered;
    }

    /**
     * Start the MCP server
     * @returns {Promise<void>}
     */
    async start() {
        return new Promise((resolve) => {
            this.emit('serverStarting');
            // In a real implementation, you would set up HTTP/WebSocket server here
            // This is a simplified version
            this.server = {
                running: true,
                port: this.config.port,
                host: this.config.host
            };
            this.emit('serverStarted', this.config);
            resolve();
        });
    }

    /**
     * Stop the MCP server
     * @returns {Promise<void>}
     */
    async stop() {
        return new Promise((resolve) => {
            this.emit('serverStopping');
            if (this.server) {
                this.server.running = false;
                this.server = null;
            }
            this.emit('serverStopped');
            resolve();
        });
    }

    /**
     * Get server status
     * @returns {Object} Server status
     */
    getStatus() {
        return {
            running: this.server?.running || false,
            tools: this.tools.size,
            resources: this.resources.size,
            prompts: this.prompts.size,
            config: this.config
        };
    }

    
}

module.exports = MCPServer;