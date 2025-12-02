const PlannerOrchestrator = require('../src/core/PlannerOrchestrator');
const LLMProvider = require('../src/core/LLMProvider');
const OpenAIProvider = require('../src/core/providers/llm/OpenAi');
const AnthropicProvider = require('../src/providers/llm/AnthropicProvider');

/**
 * Complete Flow Demonstration:
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
async function main() {
    try {
        console.log('🚀 Initializing PlannerOrchestrator...\n');

        // ============================================
        // STEP 1: Setup Planning LLM (PlannerModel)
        // ============================================
        console.log('📋 Setting up Planning LLM (PlannerModel)...');
        const plannerLLM = new LLMProvider();
        plannerLLM.registerProvider('openai', OpenAIProvider);
        await plannerLLM.initializeProvider('openai', {
            apiKey: process.env.OPENAI_API_KEY,
            model: 'gpt-4' // Use GPT-4 for planning
        });
        console.log('✅ Planning LLM configured: GPT-4\n');

        // ============================================
        // STEP 2: Setup Default Agent LLM
        // ============================================
        console.log('🤖 Setting up default Agent LLM...');
        const defaultAgentLLM = {
            name: 'anthropic',
            config: {
                apiKey: process.env.ANTHROPIC_API_KEY,
                model: 'claude-3-sonnet' // Default for agents
            }
        };
        console.log('✅ Default Agent LLM configured: Claude-3-Sonnet\n');

        // ============================================
        // STEP 3: Create PlannerOrchestrator
        // ============================================
        const plannerOrchestrator = new PlannerOrchestrator({
            plannerLLM: plannerLLM, // Planning LLM
            defaultAgentLLM: defaultAgentLLM // Default Agent LLM
        });

        // Setup event listeners to track flow
        plannerOrchestrator.on('flowStep', (data) => {
            console.log(`\n📍 Flow Step ${data.step}: ${data.description}`);
            if (data.completed) {
                console.log('✅ Step completed');
            }
        });

        plannerOrchestrator.on('planCreated', (plan) => {
            console.log('\n📋 Plan Created by Planning LLM:');
            console.log(`   Goal: ${plan.goal}`);
            console.log(`   Steps: ${plan.steps.length}`);
        });

        plannerOrchestrator.on('stepStarted', ({ step }) => {
            console.log(`\n▶️  Executing Step: ${step.id} - ${step.description}`);
            if (step.agent) {
                console.log(`   Agent: ${step.agent}`);
            }
        });

        plannerOrchestrator.on('stepCompleted', ({ step, result }) => {
            console.log(`✅ Step ${step.id} completed`);
            console.log(`   Output: ${JSON.stringify(result.output).substring(0, 100)}...`);
        });

        // ============================================
        // STEP 4: Register Agents with Different LLMs
        // ============================================
        console.log('🤖 Registering agents with different LLMs...\n');

        // Agent 1: Research Agent (Claude Opus)
        await plannerOrchestrator.registerAgent('research-agent', {
            llm: {
                name: 'anthropic',
                config: {
                    apiKey: process.env.ANTHROPIC_API_KEY,
                    model: 'claude-3-opus' // Different LLM for research
                }
            },
            config: {
                systemPrompt: 'You are a research assistant specialized in finding and analyzing information.',
                name: 'Research Agent',
                description: 'Specialized in research and information gathering'
            }
        });
        console.log('✅ Research Agent registered (Claude-3-Opus)');

        // Agent 2: Writing Agent (GPT-3.5)
        await plannerOrchestrator.registerAgent('writing-agent', {
            llm: {
                name: 'openai',
                config: {
                    apiKey: process.env.OPENAI_API_KEY,
                    model: 'gpt-3.5-turbo' // Different LLM for writing
                }
            },
            config: {
                systemPrompt: 'You are a professional writer who creates clear and engaging content.',
                name: 'Writing Agent',
                description: 'Specialized in content creation and writing'
            }
        });
        console.log('✅ Writing Agent registered (GPT-3.5-Turbo)\n');

        // ============================================
        // STEP 5: Execute User Request (Complete Flow)
        // ============================================
        console.log('🎯 Executing User Request through complete flow...\n');
        console.log('='.repeat(60));
        console.log('USER REQUEST:');
        console.log('Research the latest AI trends and write a comprehensive report');
        console.log('='.repeat(60));
        console.log('\n');

        const userRequest = 'Research the latest AI trends and write a comprehensive report';

        const finalOutput = await plannerOrchestrator.execute(userRequest, {
            constraints: {
                maxSteps: 5,
                timeout: 300000
            },
            planningTemperature: 0.7,
            enableReflection: true
        });

        // ============================================
        // STEP 6: Display Final Output
        // ============================================
        console.log('\n' + '='.repeat(60));
        console.log('FINAL OUTPUT:');
        console.log('='.repeat(60));
        console.log(JSON.stringify(finalOutput, null, 2));
        console.log('='.repeat(60));

        // ============================================
        // Cleanup
        // ============================================
        await plannerOrchestrator.shutdown();
        console.log('\n✅ Execution completed successfully!');

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

main();