const Agent = require('./src/core/Agent');
const GeminiProvider = require('./src/core/providers/GeminiProvider');
const BaseDatabaseProvider = require('./src/core/database/BaseDatabaseProvider');
const { config } = require('node:process');
require('dotenv').config();
// const config = require('./config.json')
class MockDatabaseProvider extends BaseDatabaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'MockDB';
  }

  async connect() {}
  async disconnect() {}
  async query() {
    return { rows: [] };
  }
  async insert() {
    return { inserted: true };
  }
  async find() {
    return [];
  }
  async update() {
    return { updated: true };
  }
  async delete() {
    return { deleted: true };
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Set GEMINI_API_KEY before running gemini-test.js');
  }

  const agent = new Agent({
    systemPrompt: 'You are a concise assistant.',
    persistMemory: false,
  });

  agent.llm.registerProvider('gemini', GeminiProvider);
  agent.database.registerProvider('mock', MockDatabaseProvider);

  await agent.initialize({
    llm: {
      name: 'gemini',
      config: {
        apiKey,
        model: 'gemini-2.0-flash',
      },
    },
    database: {
      name: 'mock',
      config: {},
    },
  });

  const response = await agent.process('Explain how AI works in a few words.');
  console.log('Gemini response:', response);

  await agent.shutdown();
}

main().catch((error) => {
  console.error('Gemini test failed:', error.message);
  process.exit(1);
});
