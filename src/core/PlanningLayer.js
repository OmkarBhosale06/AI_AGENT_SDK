const LLMProvider = require('./LLMProvider');
const { EventEmitter } = require('events');

/**
 * Planning Layer
 * Uses a separate LLM for planning, task decomposition, and orchestration
 */
class PlanningLayer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            plannerLLM: config.plannerLLM || null, // LLMProvider instance for planning
            systemPrompt: config.systemPrompt || this.getDefaultSystemPrompt(),
            maxIterations: config.maxIterations || 10,
            enableReflection: config.enableReflection !== false,
            ...config
        };

        this.plannerLLM = this.config.plannerLLM;
        this.planHistory = [];
        this.currentPlan = null;
    }

    /**
     * Get default system prompt for planner
     * @returns {string}
     */
    getDefaultSystemPrompt() {
        return `You are an advanced AI planning and orchestration system. Your role is to:
1. Analyze complex tasks and break them down into smaller, actionable steps
2. Determine which agents or tools are needed for each step
3. Create execution plans with dependencies
4. Monitor and adjust plans based on results
5. Coordinate multiple agents to work together efficiently

Always provide plans in a structured JSON format with clear steps, dependencies, and agent assignments.`;
    }

    /**
     * Set the planner LLM
     * @param {LLMProvider} llmProvider - LLM provider instance
     */
    setPlannerLLM(llmProvider) {
        this.plannerLLM = llmProvider;
    }

    /**
     * Get planner LLM
     * @returns {LLMProvider|null}
     */
    getPlannerLLM() {
        return this.plannerLLM;
    }

    /**
     * Create a plan for a given task
     * @param {string} task - Task description
     * @param {Object} context - Additional context (available agents, tools, etc.)
     * @param {Object} options - Planning options
     * @returns {Promise<Object>} Execution plan
     */
    async createPlan(task, context = {}, options = {}) {
        try {
            if (!this.plannerLLM) {
                throw new Error('Planner LLM not configured');
            }

            this.emit('planningStarted', { task, context });

            const planningPrompt = this.buildPlanningPrompt(task, context, options);

            const messages = [
                {
                    role: 'system',
                    content: this.config.systemPrompt
                },
                {
                    role: 'user',
                    content: planningPrompt
                }
            ];

            const response = await this.plannerLLM.chat(messages, {
                temperature: options.temperature || 0.7,
                maxTokens: options.maxTokens || 2000
            });

            const plan = this.parsePlanResponse(response, task);
            plan.id = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            plan.createdAt = new Date();
            plan.status = 'created';

            this.currentPlan = plan;
            this.planHistory.push(plan);

            this.emit('planCreated', plan);
            return plan;
        } catch (error) {
            this.emit('planningError', { task, error });
            throw error;
        }
    }

    /**
     * Build planning prompt
     * @param {string} task - Task description
     * @param {Object} context - Context information
     * @param {Object} options - Options
     * @returns {string}
     */
    buildPlanningPrompt(task, context, options) {
        let prompt = `Task: ${task}\n\n`;

        if (context.availableAgents && context.availableAgents.length > 0) {
            prompt += `Available Agents:\n`;
            context.availableAgents.forEach((agent, idx) => {
                prompt += `${idx + 1}. ${agent.name || agent.id} - ${agent.description || 'No description'}\n`;
                if (agent.capabilities) {
                    prompt += `   Capabilities: ${agent.capabilities.join(', ')}\n`;
                }
            });
            prompt += '\n';
        }

        if (context.availableTools && context.availableTools.length > 0) {
            prompt += `Available Tools:\n`;
            context.availableTools.forEach((tool, idx) => {
                prompt += `${idx + 1}. ${tool.name} - ${tool.description || ''}\n`;
            });
            prompt += '\n';
        }

        if (context.constraints) {
            prompt += `Constraints: ${JSON.stringify(context.constraints, null, 2)}\n\n`;
        }

        if (context.previousResults) {
            prompt += `Previous Results:\n${JSON.stringify(context.previousResults, null, 2)}\n\n`;
        }

        prompt += `Please create a detailed execution plan with the following structure:
{
  "goal": "Clear description of the overall goal",
  "steps": [
    {
      "id": "step_1",
      "description": "What needs to be done",
      "agent": "agent_name or null if no specific agent",
      "tools": ["tool1", "tool2"],
      "dependencies": [],
      "expectedOutput": "What this step should produce",
      "validation": "How to validate this step succeeded"
    }
  ],
  "estimatedDuration": "estimated time",
  "riskFactors": ["risk1", "risk2"],
  "contingencyPlans": ["plan1", "plan2"]
}

Provide only valid JSON.`;

        return prompt;
    }

    /**
     * Parse plan from LLM response
     * @param {Object} response - LLM response
     * @param {string} task - Original task
     * @returns {Object} Parsed plan
     */
    parsePlanResponse(response, task) {
        try {
            const content = response.content || response.text || JSON.stringify(response);

            // Try to extract JSON from response
            let jsonStr = content;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonStr = jsonMatch[0];
            }

            const plan = JSON.parse(jsonStr);

            // Validate and normalize plan structure
            if (!plan.steps || !Array.isArray(plan.steps)) {
                plan.steps = [];
            }

            // Ensure all steps have required fields
            plan.steps = plan.steps.map((step, idx) => ({
                id: step.id || `step_${idx + 1}`,
                description: step.description || '',
                agent: step.agent || null,
                tools: step.tools || [],
                dependencies: step.dependencies || [],
                expectedOutput: step.expectedOutput || '',
                validation: step.validation || '',
                status: 'pending',
                result: null,
                error: null,
                ...step
            }));

            return {
                goal: plan.goal || task,
                steps: plan.steps,
                estimatedDuration: plan.estimatedDuration || 'unknown',
                riskFactors: plan.riskFactors || [],
                contingencyPlans: plan.contingencyPlans || [],
                metadata: plan.metadata || {}
            };
        } catch (error) {
            // Fallback plan if parsing fails
            return {
                goal: task,
                steps: [
                    {
                        id: 'step_1',
                        description: task,
                        agent: null,
                        tools: [],
                        dependencies: [],
                        expectedOutput: 'Task completion',
                        validation: 'Check if task is complete',
                        status: 'pending'
                    }
                ],
                estimatedDuration: 'unknown',
                riskFactors: ['Failed to parse plan from LLM'],
                contingencyPlans: [],
                metadata: { parseError: error.message }
            };
        }
    }

    /**
     * Refine or adjust a plan based on results
     * @param {Object} plan - Current plan
     * @param {Object} results - Execution results so far
     * @param {Object} context - Updated context
     * @returns {Promise<Object>} Refined plan
     */
    async refinePlan(plan, results = {}, context = {}) {
        try {
            if (!this.config.enableReflection) {
                return plan;
            }

            this.emit('planRefinementStarted', { plan, results });

            const refinementPrompt = `Current Plan:
${JSON.stringify(plan, null, 2)}

Execution Results So Far:
${JSON.stringify(results, null, 2)}

Updated Context:
${JSON.stringify(context, null, 2)}

Please refine the plan based on the results. Adjust steps, dependencies, or agent assignments as needed. Provide the updated plan in the same JSON format.`;

            const messages = [
                {
                    role: 'system',
                    content: this.config.systemPrompt
                },
                {
                    role: 'user',
                    content: refinementPrompt
                }
            ];

            const response = await this.plannerLLM.chat(messages);
            const refinedPlan = this.parsePlanResponse(response, plan.goal);
            refinedPlan.id = plan.id;
            refinedPlan.refinedAt = new Date();
            refinedPlan.originalPlan = plan;

            this.currentPlan = refinedPlan;
            this.planHistory.push(refinedPlan);

            this.emit('planRefined', refinedPlan);
            return refinedPlan;
        } catch (error) {
            this.emit('refinementError', { plan, error });
            return plan; // Return original plan on error
        }
    }

    /**
     * Get current plan
     * @returns {Object|null}
     */
    getCurrentPlan() {
        return this.currentPlan;
    }

    /**
     * Get plan history
     * @returns {Array<Object>}
     */
    getPlanHistory() {
        return this.planHistory;
    }

    /**
     * Clear plan history
     */
    clearPlanHistory() {
        this.planHistory = [];
        this.currentPlan = null;
    }
}

module.exports = PlanningLayer;