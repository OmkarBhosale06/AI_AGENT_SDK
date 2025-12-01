// src/core/Middleware.js
class MiddlewareManager {
    constructor() {
        this.hooks = {
            beforeProcess: [],
            afterProcess: [],
            beforeLLMCall: [],
            afterLLMCall: [],
            beforeToolCall: [],
            afterToolCall: [],
            onError: []
        };
    }

    use(hookName, fn) {
        if (!this.hooks[hookName]) {
            throw new Error(`Unknown hook: ${hookName}`);
        }
        this.hooks[hookName].push(fn);
    }

    async execute(hookName, context) {
        for (const fn of this.hooks[hookName] || []) {
            context = await fn(context) || context;
        }
        return context;
    }
}