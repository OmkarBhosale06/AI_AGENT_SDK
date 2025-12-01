const PlanningLayer = require('./PlanningLayer');
const Agent = require('./Agent');
const LLMProvider = require('./LLMProvider');
const { EventEmitter } = require('events');

/**
 * Orchestrator
 * Manages multiple agents with different LLMs and executes plans
 * This is the core execution engine that coordinates agents
 */
class Orchestrator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            plannerLLM: config.plannerLLM || null, // LLM for planning
            defaultAgentLLM: config.defaultAgentLLM || null, // Default LLM for agents
            enableReflection: config.enableReflection !== false,
            maxRetries: config.maxRetries || 3,
            ...config
        };

        this.planningLayer = new PlanningLayer({
            plannerLLM: this.config.plannerLLM,
            ...config.planning
        });

        this.agents = new Map(); // agentId -> Agent instance
        this.agentConfigs = new Map(); // agentId -> { llm, config }
        this.executionQueue = [];
        this.activeExecutions = new Map();
    }

    /**
     * Register an agent with optional custom LLM
     * @param {string} agentId - Unique agent identifier
     * @param {Object} agentConfig - Agent configuration
     * @param {Object} agentConfig.llm - LLM config for this agent { name, config }
     * @param {Object} agentConfig.config - Agent config (systemPrompt, etc.)
     * @returns {Promise<Agent>} Created agent instance
     */
    async registerAgent(agentId, agentConfig = {}) {
        try {
            // Create agent with its own LLM
            const agent = new Agent(agentConfig.config || {});

            // Initialize agent's LLM (can be different from planner)
            if (agentConfig.llm) {
                await agent.llm.initializeProvider(agentConfig.llm.name, agentConfig.llm.config);
            } else if (this.config.defaultAgentLLM) {
                // Use default agent LLM if no specific LLM provided
                await agent.llm.initializeProvider(
                    this.config.defaultAgentLLM.name,
                    this.config.defaultAgentLLM.config
                );
            }

            // Initialize other providers if provided
            if (agentConfig.database) {
                await agent.database.initializeProvider(
                    agentConfig.database.name,
                    agentConfig.database.config
                );
            }

            if (agentConfig.mcp) {
                await agent.mcpServer.start();
            }

            this.agents.set(agentId, agent);
            this.agentConfigs.set(agentId, agentConfig);

            this.emit('agentRegistered', { agentId, agent });
            return agent;
        } catch (error) {
            this.emit('agentRegistrationError', { agentId, error });
            throw error;
        }
    }

    /**
     * Unregister an agent
     * @param {string} agentId - Agent identifier
     * @returns {Promise<void>}
     */
    async unregisterAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (agent) {
            await agent.shutdown();
            this.agents.delete(agentId);
            this.agentConfigs.delete(agentId);
            this.emit('agentUnregistered', { agentId });
        }
    }

    /**
     * Get agent by ID
     * @param {string} agentId - Agent identifier
     * @returns {Agent|null}
     */
    getAgent(agentId) {
        return this.agents.get(agentId) || null;
    }

    /**
     * List all registered agents
     * @returns {Array<Object>} Agent information
     */
    listAgents() {
        return Array.from(this.agents.entries()).map(([id, agent]) => ({
            id,
            name: agent.config.name || id,
            description: agent.config.description || '',
            llmProvider: agent.llm.getProvider()?.getName(),
            state: agent.getState()
        }));
    }

    /**
     * Set planner LLM
     * @param {LLMProvider} llmProvider - LLM provider for planning
     */
    setPlannerLLM(llmProvider) {
        this.config.plannerLLM = llmProvider;
        this.planningLayer.setPlannerLLM(llmProvider);
    }

    /**
     * Execute a task using planning and orchestration
     * @param {string} task - Task description
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Execution result
     */
    async executeTask(task, options = {}) {
        try {
            this.emit('taskStarted', { task, options });

            // Step 1: Create plan
            const context = {
                availableAgents: this.listAgents(),
                availableTools: this.getAllAvailableTools(),
                constraints: options.constraints || {},
                previousResults: options.previousResults || {}
            };

            const plan = await this.planningLayer.createPlan(task, context, options.planning || {});

            this.emit('planCreated', plan);

            // Step 2: Execute plan
            const executionResult = await this.executePlan(plan, options);

            this.emit('taskCompleted', { task, plan, result: executionResult });
            return {
                task,
                plan,
                result: executionResult,
                success: executionResult.success,
                completedAt: new Date()
            };
        } catch (error) {
            this.emit('taskError', { task, error });
            throw error;
        }
    }

    /**
     * Execute a plan step by step
     * @param {Object} plan - Execution plan
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Execution results
     */
    async executePlan(plan, options = {}) {
        const results = {};
        const stepResults = [];

        try {
            // Sort steps by dependencies
            const sortedSteps = this.sortStepsByDependencies(plan.steps);

            for (const step of sortedSteps) {
                try {
                    this.emit('stepStarted', { step, plan });

                    // Check dependencies
                    const dependenciesMet = this.checkDependencies(step, results);
                    if (!dependenciesMet) {
                        throw new Error(`Dependencies not met for step ${step.id}`);
                    }

                    // Execute step with retry logic
                    let stepResult;
                    let attempts = 0;
                    const maxAttempts = options.maxRetries || this.config.maxRetries || 3;

                    while (attempts < maxAttempts) {
                        try {
                            stepResult = await this.executeStep(step, results, options);
                            break; // Success, exit retry loop
                        } catch (error) {
                            attempts++;
                            if (attempts >= maxAttempts) {
                                throw error; // Re-throw if max retries reached
                            }
                            this.emit('stepRetry', { step, attempt: attempts, error });
                            // Wait before retry (exponential backoff)
                            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempts) * 1000));
                        }
                    }

                    step.result = stepResult;
                    step.status = 'completed';
                    step.completedAt = new Date();

                    results[step.id] = stepResult;
                    stepResults.push(step);

                    this.emit('stepCompleted', { step, result: stepResult });

                    // Check if we need to refine plan
                    if (this.config.enableReflection && stepResult.needsRefinement) {
                        plan = await this.planningLayer.refinePlan(plan, results);
                        this.emit('planRefined', plan);
                    }
                } catch (error) {
                    step.status = 'failed';
                    step.error = error.message;
                    step.completedAt = new Date();

                    this.emit('stepFailed', { step, error });

                    if (options.stopOnError !== false) {
                        throw error;
                    }
                }
            }

            return {
                success: true,
                steps: stepResults,
                finalResult: this.aggregateResults(stepResults),
                plan
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                steps: stepResults,
                plan
            };
        }
    }

    /**
     * Execute a single step
     * @param {Object} step - Step definition
     * @param {Object} previousResults - Results from previous steps
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Step result
     */
    async executeStep(step, previousResults = {}, options = {}) {
        try {
            // If step has an assigned agent, use it
            if (step.agent) {
                const agent = this.getAgent(step.agent);
                if (!agent) {
                    throw new Error(`Agent ${step.agent} not found`);
                }

                // Build context from previous results
                const context = this.buildStepContext(step, previousResults);

                // Build message with context
                let message = step.description;
                if (Object.keys(context.previousResults).length > 0) {
                    message += `\n\nContext from previous steps:\n${JSON.stringify(context.previousResults, null, 2)}`;
                }

                // Execute with agent
                const response = await agent.process(message, {
                    context,
                    tools: step.tools,
                    ...options
                });

                // Validate step result
                const validated = this.validateStep(step, response);

                return {
                    agent: step.agent,
                    output: response,
                    validated,
                    needsRefinement: !validated && this.config.enableReflection
                };
            } else {
                // Execute step without specific agent (direct execution)
                // This could be for tool-only steps or system operations
                return {
                    output: {
                        message: `Step ${step.id} executed`,
                        description: step.description
                    },
                    validated: true,
                    needsRefinement: false
                };
            }
        } catch (error) {
            throw error;
        }
    }

    /**
     * Build context for step execution
     * @param {Object} step - Step definition
     * @param {Object} previousResults - Previous step results
     * @returns {Object} Context object
     */
    buildStepContext(step, previousResults) {
        const context = {
            step: {
                id: step.id,
                description: step.description,
                expectedOutput: step.expectedOutput
            },
            previousResults: {}
        };

        // Include results from dependent steps
        if (step.dependencies && step.dependencies.length > 0) {
            step.dependencies.forEach(depId => {
                if (previousResults[depId]) {
                    context.previousResults[depId] = previousResults[depId];
                }
            });
        }

        return context;
    }

    /**
     * Validate step execution
     * @param {Object} step - Step definition
     * @param {Object} result - Step result
     * @returns {boolean}
     */
    validateStep(step, result) {
        if (!step.validation) {
            return true; // No validation criteria
        }

        // Simple validation - can be enhanced
        try {
            // Check if expected output matches
            if (step.expectedOutput) {
                const outputStr = JSON.stringify(result).toLowerCase();
                const expectedStr = step.expectedOutput.toLowerCase();
                return outputStr.includes(expectedStr) ||
                    result.content?.toLowerCase().includes(expectedStr) ||
                    result.text?.toLowerCase().includes(expectedStr);
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Sort steps by dependencies
     * @param {Array<Object>} steps - Steps array
     * @returns {Array<Object>} Sorted steps
     */
    sortStepsByDependencies(steps) {
        const sorted = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (step) => {
            if (visiting.has(step.id)) {
                throw new Error(`Circular dependency detected involving step ${step.id}`);
            }
            if (visited.has(step.id)) {
                return;
            }

            visiting.add(step.id);

            // Visit dependencies first
            if (step.dependencies && step.dependencies.length > 0) {
                step.dependencies.forEach(depId => {
                    const depStep = steps.find(s => s.id === depId);
                    if (depStep) {
                        visit(depStep);
                    }
                });
            }

            visiting.delete(step.id);
            visited.add(step.id);
            sorted.push(step);
        };

        steps.forEach(visit);
        return sorted;
    }

    /**
     * Check if step dependencies are met
     * @param {Object} step - Step definition
     * @param {Object} results - Previous results
     * @returns {boolean}
     */
    checkDependencies(step, results) {
        if (!step.dependencies || step.dependencies.length === 0) {
            return true;
        }

        return step.dependencies.every(depId => {
            return results[depId] && results[depId].validated !== false;
        });
    }

    /**
     * Get all available tools from all agents
     * @returns {Array<Object>}
     */
    getAllAvailableTools() {
        const tools = [];
        this.agents.forEach((agent, agentId) => {
            const agentTools = agent.mcpServer.listTools();
            agentTools.forEach(tool => {
                tools.push({
                    ...tool,
                    agent: agentId
                });
            });
        });
        return tools;
    }

    /**
     * Execute steps in parallel (if no dependencies)
     * @param {Array<Object>} steps - Steps to execute in parallel
     * @param {Object} previousResults - Previous results
     * @param {Object} options - Execution options
     * @returns {Promise<Array>} Step results
     */
    async executeStepsParallel(steps, previousResults = {}, options = {}) {
        const promises = steps.map(step =>
            this.executeStep(step, previousResults, options)
                .then(result => ({ step, result, status: 'completed' }))
                .catch(error => ({ step, error: error.message, status: 'failed' }))
        );

        return await Promise.all(promises);
    }

    /**
     * Aggregate results from all steps
     * @param {Array<Object>} stepResults - Step results
     * @returns {Object} Aggregated result
     */
    aggregateResults(stepResults) {
        const completed = stepResults.filter(s => s.status === 'completed');
        const failed = stepResults.filter(s => s.status === 'failed');

        return {
            totalSteps: stepResults.length,
            completedSteps: completed.length,
            failedSteps: failed.length,
            successRate: stepResults.length > 0 ? (completed.length / stepResults.length) * 100 : 0,
            outputs: completed.map(s => ({
                stepId: s.id,
                agent: s.agent,
                output: s.result?.output || null,
                validated: s.result?.validated || false
            })),
            errors: failed.map(s => ({
                stepId: s.id,
                error: s.error
            }))
        };
    }

    /**
     * Get orchestrator status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            agents: this.agents.size,
            activeExecutions: this.activeExecutions.size,
            queueLength: this.executionQueue.length,
            agents: this.listAgents()
        };
    }

    /**
     * Shutdown orchestrator and all agents
     * @returns {Promise<void>}
     */
    async shutdown() {
        const shutdownPromises = Array.from(this.agents.values()).map(agent => agent.shutdown());
        await Promise.all(shutdownPromises);
        this.agents.clear();
        this.agentConfigs.clear();
        this.executionQueue = [];
        this.activeExecutions.clear();
        this.emit('shutdown');
    }
}

module.exports = Orchestrator;