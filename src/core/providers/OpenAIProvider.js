const BaseLLMProvider = require('./BaseLLMProvider');
const OpenAI = require('openai');

/**
 * OpenAI LLM provider implementation.
 * Expects:
 *   config.apiKey
 *   config.model (default 'gpt-4.1')
 */
class OpenAIProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'OpenAIProvider';
    this.client = null;
    this.model = config.model || 'gpt-4.1';
  }

  async initialize() {
    if (!this.config.apiKey) {
      throw new Error('OpenAIProvider requires config.apiKey');
    }
    this.client = new OpenAI({ apiKey: this.config.apiKey });
  }

  /**
   * Normalize our messages -> OpenAI messages
   */
  mapMessages(messages) {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
      name: m.name,
    }));
  }

  /**
   * Normalize MCP tools -> OpenAI tools
   * Each tool from MCPServer is:
   *   { name, description, inputSchema, handler }
   */
  mapTools(tools = []) {
    if (!tools.length) return undefined;
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }));
  }

  /**
   * Normalize OpenAI response -> { content, toolCalls }
   */
  normalizeResponse(choice) {
    const msg = choice.message || {};
    const content = msg.content || '';

    const rawToolCalls = msg.tool_calls || [];
    const toolCalls = rawToolCalls.map(tc => {
      let args = {};
      try {
        args = tc.function && tc.function.arguments
          ? JSON.parse(tc.function.arguments)
          : {};
      } catch {
        args = {};
      }

      return {
        id: tc.id,
        name: tc.function?.name,
        arguments: args,
      };
    });

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  /**
   * Chat with current provider
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<Object>} { content, toolCalls? }
   */
  async chat(messages, options = {}) {
    if (!this.client) {
      throw new Error('OpenAIProvider not initialized');
    }

    const payload = {
      model: this.model,
      temperature: options.temperature ?? 0.2,
      messages: this.mapMessages(messages),
      tools: this.mapTools(options.tools),
      tool_choice: options.tools && options.tools.length ? 'auto' : 'none',
    };

    const resp = await this.client.chat.completions.create(payload);
    const choice = resp.choices[0];

    return this.normalizeResponse(choice);
  }

  /**
   * Simple streaming example (optional)
   */
  async *streamChat(messages, options = {}) {
    if (!this.client) {
      throw new Error('OpenAIProvider not initialized');
    }

    const payload = {
      model: this.model,
      temperature: options.temperature ?? 0.2,
      messages: this.mapMessages(messages),
      tools: this.mapTools(options.tools),
      tool_choice: options.tools && options.tools.length ? 'auto' : 'none',
      stream: true,
    };

    const stream = await this.client.chat.completions.create(payload);
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        yield { contentDelta: delta.content };
      }
    }
  }

  async embed(text) {
    if (!this.client) {
      throw new Error('OpenAIProvider not initialized');
    }
    const input = Array.isArray(text) ? text : [text];
    const resp = await this.client.embeddings.create({
      model: this.config.embeddingModel || 'text-embedding-3-small',
      input,
    });
    return resp.data.map(d => d.embedding);
  }
}

module.exports = OpenAIProvider;