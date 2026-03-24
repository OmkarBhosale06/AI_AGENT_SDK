/**
 * @typedef {Object} ToolContext
 * // extend later with userId, traceId, etc.
 */

/**
 * @typedef {Object} ToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {any} parametersJsonSchema
 * @property {(input: any, ctx: ToolContext) => Promise<any>} execute
 */

export {};