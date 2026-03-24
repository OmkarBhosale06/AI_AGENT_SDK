// Core LLM types as JS docs

/**
 * @typedef {Object} LLMMessage
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string} content
 * @property {string} [name]
 */

/**
 * @typedef {Object} LLMToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {any} parametersJsonSchema
 */

/**
 * @typedef {Object} LLMToolCall
 * @property {string} id
 * @property {string} name
 * @property {Object.<string, any>} arguments
 */

/**
 * @typedef {Object} LLMResponse
 * @property {LLMMessage[]} messages
 * @property {LLMToolCall[]} [toolCalls]
 */

export class LLMClient {
    constructor(model) {
      this.model = model;
    }
  
    /**
     * @param {LLMMessage[]} _messages
     * @param {LLMToolDefinition[]} [_tools]
     * @param {{ temperature?: number }} [_options]
     * @returns {Promise<LLMResponse>}
     */
    // Implement in subclasses
    async generate(_messages, _tools, _options) {
      throw new Error('Not implemented');
    }
  }