const PlanningLayer = require('./PlanningLayer');
const Orchestrator = require('./Orchestrator');
const LLMProvider = require('./LLMProvider');
const { EventEmitter } = require('events');

/**
 * PlannerOrchestrator - Main entry point that implements the complete flow:
 * 
 * User Request
 *      ↓
 * Planning LLM (PlannerModel) - produces structured plan
 *      ↓
 * Orchestrator - executes plan
 *      ↓
 * Agent LLM(s) - execute tasks
 *      ↓
 * Final Output
 */
class PlannerOrchestrator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            plannerLLM: config.plannerLLM || null, // Planning LLM (e.g., GPT-4)
            defaultAgentLLM: config.defaultAgentLLM || null, // Default LLM for agents
            ...config
        };

        // Step 1: Initialize Planning Layer with Planning LLM
        this.planningLayer = new PlanningLayer({
            plannerLLM: this.config.plannerLLM,
            ...config.planning
        });

        // Step 2: Initialize Orchestrator
        this.orchestrator = new Orchestrator({
            plannerLLM: this.config.plannerLLM, // Pass planner LLM to orchestrator
            defaultAgentLLM: this.config.defaultAgentLLM,
            ...config.orchestration
        });

        // Setup event forwarding
        this.setupEventForwarding();
    }

    /**
     * Setup event forwarding from components
     */
    setupEventForwarding() {
        // Forward planning events
        this.planningLayer.on('planningStarted', (data) => {
            this.emit('planningStarted', data);
        });
        this.planningLayer.on('planCreated', (plan) => {
            this.emit('planCreated', plan);
        });

        // Forward orchestration events
        this.orchestrator.on('taskStarted', (data) => {
            this.emit('taskStarted', data);
        });
        this.orchestrator.on('stepStarted', (data) => {
            this.emit('stepStarted', data);
        });
        this.orchestrator.on('stepCompleted', (data) => {
            this.emit('stepCompleted', data);
        });
        this.orchestrator.on('taskCompleted', (data) => {
            this.emit('taskCompleted', data);
        });
    }

    /**
     * Set Planning LLM (PlannerModel)
     * @param {LLMProvider} llmProvider - LLM provider for planning
     */
    setPlannerLLM(llmProvider) {
        this.config.plannerLLM = llmProvider;
        this.planningLayer.setPlannerLLM(llmProvider);
        this.orchestrator.setPlannerLLM(llmProvider);
    }

    /**
     * Register an agent with its own LLM
     * @param {string} agentId - Agent identifier
     * @param {Object} agentConfig - Agent configuration
     * @returns {Promise<Agent>}
     */
    async registerAgent(agentId, agentConfig) {
        return await this.orchestrator.registerAgent(agentId, agentConfig);
    }

    /**
     * Main entry point - Execute user request through complete flow
     * 
     * Flow:
     * 1. User Request → Planning LLM → Structured Plan
     * 2. Orchestrator → Executes Plan
     * 3. Agent LLMs → Execute Tasks
     * 4. Final Output
     * 
     * @param {string} userRequest - User's request/task
     * @param {Object} options - Execution options
     * @returns {Promise<Object>} Final output with complete execution details
     */
    async execute(userRequest, options = {}) {
        try {
            this.emit('executionStarted', { userRequest, options });

            // ============================================
            // STEP 1: User Request → Planning LLM
            // ============================================
            console.log('📋 Step 1: Planning LLM creating structured plan...');
            this.emit('flowStep', { step: 1, description: 'Planning LLM creating plan' });

            const context = {
                availableAgents: this.orchestrator.listAgents(),
                availableTools: this.orchestrator.getAllAvailableTools(),
                constraints: options.constraints || {},
                previousResults: options.previousResults || {}
            };

            // Planning LLM produces structured plan
            const plan = await this.planningLayer.createPlan(userRequest, context, {
                temperature: options.planningTemperature || 0.7,
                maxTokens: options.planningMaxTokens || 2000
            });

            console.log('✅ Plan created:', JSON.stringify(plan, null, 2));
            this.emit('flowStep', {
                step: 1,
                completed: true,
                result: plan
            });

            // ============================================
            // STEP 2: Orchestrator executes plan
            // ============================================
            console.log('🎯 Step 2: Orchestrator executing plan...');
            this.emit('flowStep', { step: 2, description: 'Orchestrator executing plan' });

            // Orchestrator manages plan execution
            const executionResult = await this.orchestrator.executePlan(plan, {
                stopOnError: options.stopOnError !== false,
                enableReflection: options.enableReflection !== false,
                ...options.execution
            });

            console.log('✅ Execution completed:', JSON.stringify(executionResult, null, 2));
            this.emit('flowStep', {
                step: 2,
                completed: true,
                result: executionResult
            });

            // ============================================
            // STEP 3: Agent LLMs executed tasks (handled by orchestrator)
            // ============================================
            // This step is implicit in step 2, but we can extract agent results
            const agentResults = this.extractAgentResults(executionResult);

            // ============================================
            // STEP 4: Final Output
            // ============================================
            console.log('📤 Step 4: Generating final output...');
            this.emit('flowStep', { step: 4, description: 'Generating final output' });

            const finalOutput = {
                userRequest,
                plan: {
                    id: plan.id,
                    goal: plan.goal,
                    steps: plan.steps.map(s => ({
                        id: s.id,
                        description: s.description,
                        agent: s.agent,
                        status: s.status
                    }))
                },
                execution: {
                    success: executionResult.success,
                    totalSteps: executionResult.steps?.length || 0,
                    completedSteps: executionResult.steps?.filter(s => s.status === 'completed').length || 0,
                    failedSteps: executionResult.steps?.filter(s => s.status === 'failed').length || 0
                },
                agentResults,
                finalResult: executionResult.finalResult,
                completedAt: new Date()
            };

            console.log('✅ Final Output:', JSON.stringify(finalOutput, null, 2));
            this.emit('executionCompleted', finalOutput);

            return finalOutput;
        } catch (error) {
            this.emit('executionError', { userRequest, error });
            throw error;
        }
    }

    /**
     * Extract agent results from execution
     * @param {Object} executionResult - Execution result
     * @returns {Object} Agent results
     */
    extractAgentResults(executionResult) {
        const agentResults = {};

        if (executionResult.steps) {
            executionResult.steps.forEach(step => {
                if (step.agent && step.result) {
                    if (!agentResults[step.agent]) {
                        agentResults[step.agent] = [];
                    }
                    agentResults[step.agent].push({
                        stepId: step.id,
                        description: step.description,
                        output: step.result.output,
                        validated: step.result.validated
                    });
                }
            });
        }

        return agentResults;
    }

    /**
     * Get orchestrator instance
     * @returns {Orchestrator}
     */
    getOrchestrator() {
        return this.orchestrator;
    }

    /**
     * Get planning layer instance
     * @returns {PlanningLayer}
     */
    getPlanningLayer() {
        return this.planningLayer;
    }

    /**
     * Shutdown all components
     * @returns {Promise<void>}
     */
    async shutdown() {
        await this.orchestrator.shutdown();
    }
}

module.exports = PlannerOrchestrator;