const Agent = require('./src/core/Agent.js');
const BaseLLMProvider = require('./src/core/providers/BaseLLMProvider');
const BaseDatabaseProvider = require('./src/core/database/BaseDatabaseProvider');

// Mock LLM Provider for testing
class MockLLMProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'MockLLM';
  }

  async initialize() {
    console.log('Mock LLM Provider initialized');
  }

  async chat(messages, options = {}) {
    const last = messages[messages.length - 1];
    const text = last?.content || '';

    // Simple heuristic: if message mentions "weather", request the get_weather tool
    if (/weather/i.test(text)) {
      return {
        content: '', // defer answer until after tool result
        toolCalls: [
          {
            name: 'get_weather',
            arguments: { location: 'New York' }, // you could parse the city from text
          },
        ],
        model: 'mock-model',
      };
    }

    // Fallback normal response
    return {
      content: `Mock response to: ${text || 'empty'}`,
      model: 'mock-model',
    };
  }

  async *streamChat(messages, options = {}) {
    yield { content: 'Mock stream' };
  }

  async embed(text) {
    return [[0.1, 0.2, 0.3]];
  }
}

// Mock Database Provider for testing
class MockDatabaseProvider extends BaseDatabaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'MockDB';
  }

  async connect() {
    this.connected = true;
    console.log('Mock Database connected');
  }

  async disconnect() {
    this.connected = false;
    console.log('Mock Database disconnected');
  }

  async query(query, params = []) {
    return { rows: [] };
  }

  async insert(collection, data) {
    return { inserted: true, id: 'mock-id' };
  }

  async find(collection, filter = {}) {
    return [];
  }

  async update(collection, filter, data) {
    return { updated: true };
  }

  async delete(collection, filter) {
    return { deleted: true };
  }
}

async function main() {
  try {
    console.log('=== Testing AI Agent SDK (Mock) ===\n');

    // Create agent
    const agent = new Agent({
      systemPrompt: 'You are a helpful assistant.',
      persistMemory: false, // set true once you have a real DB provider
    });

    // Register providers
    agent.llm.registerProvider('mock', MockLLMProvider);
    agent.database.registerProvider('mock', MockDatabaseProvider);

    console.log('Registered providers:');
    console.log('  LLM:', agent.llm.listProviders());
    console.log('  Database:', agent.database.listProviders());
    console.log();

    // Initialize
    await agent.initialize({
      llm: {
        name: 'mock',
        config: {},
      },
      database: {
        name: 'mock',
        config: {},
      },
    });

    // Register MCP tool
    agent.mcpServer.registerTool(
      'get_weather',
      {
        description: 'Get current weather',
        inputSchema: {
          type: 'object',
          properties: {
            location: { type: 'string' },
          },
          required: ['location'],
        },
      },
      async (args) => {
        // mock weather tool
        return {
          temperature: 72,
          condition: 'sunny',
          location: args.location,
        };
      }
    );

    console.log('MCP Server status:', agent.mcpServer.getStatus());
    console.log(
      'Registered tools:',
      agent.mcpServer.listTools().map((t) => t.name)
    );
    console.log();

    // Test agent processing – should trigger toolCalls for "weather"
    console.log('Testing agent.process():');
    const response = await agent.process('What is the weather in New York?');
    console.log('Response:', response);
    console.log();

    // Test MCP tool directly
    console.log('Testing MCP tool:');
    const weather = await agent.mcpServer.callTool('get_weather', {
      location: 'New York',
    });
    console.log('Weather result:', weather);
    console.log();

    // Get agent state
    console.log('Agent state:', agent.getState());
    console.log();

    // Cleanup
    await agent.shutdown();
    console.log('=== Mock test completed successfully ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();