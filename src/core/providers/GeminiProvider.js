const BaseLLMProvider = require('./BaseLLMProvider');

/**
 * Gemini LLM provider using Google Generative Language API.
 * Expects:
 *   config.apiKey
 *   config.model (default 'gemini-2.0-flash')
 */
class GeminiProvider extends BaseLLMProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'GeminiProvider';
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    this.model = config.model || 'gemini-2.0-flash';
    this.baseUrl =
      config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async initialize() {
    if (!this.apiKey) {
      throw new Error('GeminiProvider requires config.apiKey or GEMINI_API_KEY');
    }
  }

  extractSystemInstruction(messages = []) {
    const systemMessage = messages.find((m) => m.role === 'system');
    return systemMessage?.content || '';
  }

  mapMessages(messages = []) {
    return messages
      .map((m) => {
        if (m.role === 'system') {
          return null;
        }

        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: m.name || 'tool',
                  response: {
                    name: m.name || 'tool',
                    content: m.content || '',
                  },
                },
              },
            ],
          };
        }

        const role = m.role === 'assistant' ? 'model' : 'user';
        return {
          role,
          parts: [{ text: m.content || '' }],
        };
      })
      .filter(Boolean);
  }

  mapTools(tools = []) {
    if (!tools.length) return undefined;

    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description || '',
          parameters: t.inputSchema || { type: 'OBJECT', properties: {} },
        })),
      },
    ];
  }

  normalizeResponse(data) {
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const textParts = [];
    const toolCalls = [];

    for (const part of parts) {
      if (part.text) {
        textParts.push(part.text);
      }

      if (part.functionCall) {
        toolCalls.push({
          id: `${part.functionCall.name}-${Date.now()}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }

    return {
      content: textParts.join('\n').trim(),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      raw: data,
    };
  }

  async chat(messages, options = {}) {
    const systemInstruction =
      options.systemInstruction || this.extractSystemInstruction(messages);

    const body = {
      contents: this.mapMessages(messages),
      tools: this.mapTools(options.tools),
      generationConfig: {
        temperature: options.temperature ?? 0.2,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Gemini API error (${resp.status}): ${errorText}`);
    }

    const data = await resp.json();
    return this.normalizeResponse(data);
  }

  async *streamChat() {
    throw new Error('streamChat() not implemented for GeminiProvider yet');
  }

  async embed() {
    throw new Error('embed() not implemented for GeminiProvider yet');
  }
}

module.exports = GeminiProvider;
