const Redis = require('ioredis');
const { EventEmitter } = require('events');

/**
 * Redis Manager Class
 * Handles Redis connection, caching, pub/sub, and memory operations
 */
class RedisManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            host: config.host || 'localhost',
            port: config.port || 6379,
            password: config.password || null,
            db: config.db || 0,
            keyPrefix: config.keyPrefix || 'ai_agent:',
            retryStrategy: config.retryStrategy || this.defaultRetryStrategy,
            maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
            enableReadyCheck: config.enableReadyCheck !== false,
            lazyConnect: config.lazyConnect || false,
            ...config
        };

        this.client = null;
        this.subscriber = null;
        this.publisher = null;
        this.connected = false;
        this.reconnectAttempts = 0;
    }

    /**
     * Default retry strategy for reconnection
     * @param {number} times - Number of retry attempts
     * @returns {number|Error} Delay in ms or Error to stop retrying
     */
    defaultRetryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }

    /**
     * Initialize Redis connection
     * @returns {Promise<void>}
     */
    async connect() {
        try {
            if (this.client && this.connected) {
                return;
            }

            // Create main client
            this.client = new Redis(this.config);

            // Setup event listeners
            this.setupEventListeners(this.client);

            // Connect if not lazy
            if (!this.config.lazyConnect) {
                await this.client.connect();
            }
            this.connected = true;
            this.emit('connected');
            return this.client;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Setup event listeners for Redis client
     * @param {Redis} client - Redis client instance
     */
    setupEventListeners(client) {
        client.on('connect', () => {
            this.connected = true;
            this.reconnectAttempts = 0;
            this.emit('connect');
        });

        client.on('ready', () => {
            this.emit('ready');
        });

        client.on('error', (error) => {
            this.emit('error', error);
        });

        client.on('close', () => {
            this.connected = false;
            this.emit('close');
        });

        client.on('reconnecting', (delay) => {
            this.reconnectAttempts++;
            this.emit('reconnecting', delay);
        });

        client.on('end', () => {
            this.connected = false;
            this.emit('end');
        });
    }

    /**
     * Disconnect from Redis
     * @returns {Promise<void>}
     */
    async disconnect() {
        try {
            if (this.client) {
                await this.client.quit();
                this.client = null;
            }
            if (this.subscriber) {
                await this.subscriber.quit();
                this.subscriber = null;
            }
            if (this.publisher) {
                await this.publisher.quit();
                this.publisher = null;
            }
            this.connected = false;
            this.emit('disconnected');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Check if connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connected && this.client && this.client.status === 'ready';
    }

    /**
     * Get Redis client instance
     * @returns {Redis|null}
     */
    getClient() {
        return this.client;
    }

    // ==================== Basic Key-Value Operations ====================

    /**
     * Set a key-value pair
     * @param {string} key - Key name
     * @param {string|Object} value - Value to store
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<string>} 'OK' on success
     */
    async set(key, value, ttl = null) {
        try {
            const fullKey = this.getFullKey(key);
            const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;

            if (ttl) {
                return await this.client.setex(fullKey, ttl, serializedValue);
            } else {
                return await this.client.set(fullKey, serializedValue);
            }
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get value by key
     * @param {string} key - Key name
     * @param {boolean} parseJson - Whether to parse JSON (default: true)
     * @returns {Promise<string|Object|null>} Value or null if not found
     */
    async get(key, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const value = await this.client.get(fullKey);

            if (value === null) {
                return null;
            }

            if (parseJson) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Delete a key
     * @param {string|Array<string>} keys - Key(s) to delete
     * @returns {Promise<number>} Number of keys deleted
     */
    async delete(keys) {
        try {
            const keyArray = Array.isArray(keys) ? keys : [keys];
            const fullKeys = keyArray.map(k => this.getFullKey(k));
            return await this.client.del(...fullKeys);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Check if key exists
     * @param {string} key - Key name
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        try {
            const fullKey = this.getFullKey(key);
            const result = await this.client.exists(fullKey);
            return result === 1;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Set expiration on a key
     * @param {string} key - Key name
     * @param {number} seconds - Time to live in seconds
     * @returns {Promise<boolean>}
     */
    async expire(key, seconds) {
        try {
            const fullKey = this.getFullKey(key);
            const result = await this.client.expire(fullKey, seconds);
            return result === 1;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get time to live for a key
     * @param {string} key - Key name
     * @returns {Promise<number>} TTL in seconds, -1 if no expiration, -2 if key doesn't exist
     */
    async ttl(key) {
        try {
            const fullKey = this.getFullKey(key);
            return await this.client.ttl(fullKey);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    // ==================== Hash Operations ====================

    /**
     * Set hash field
     * @param {string} key - Hash key
     * @param {string} field - Field name
     * @param {string|Object} value - Field value
     * @returns {Promise<number>}
     */
    async hset(key, field, value) {
        try {
            const fullKey = this.getFullKey(key);
            const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
            return await this.client.hset(fullKey, field, serializedValue);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get hash field
     * @param {string} key - Hash key
     * @param {string} field - Field name
     * @param {boolean} parseJson - Whether to parse JSON
     * @returns {Promise<string|Object|null>}
     */
    async hget(key, field, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const value = await this.client.hget(fullKey, field);

            if (value === null) {
                return null;
            }

            if (parseJson) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get all hash fields and values
     * @param {string} key - Hash key
     * @param {boolean} parseJson - Whether to parse JSON values
     * @returns {Promise<Object>}
     */
    async hgetall(key, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const data = await this.client.hgetall(fullKey);

            if (!data || Object.keys(data).length === 0) {
                return {};
            }

            if (parseJson) {
                const parsed = {};
                for (const [field, value] of Object.entries(data)) {
                    try {
                        parsed[field] = JSON.parse(value);
                    } catch {
                        parsed[field] = value;
                    }
                }
                return parsed;
            }
            return data;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Delete hash field(s)
     * @param {string} key - Hash key
     * @param {string|Array<string>} fields - Field(s) to delete
     * @returns {Promise<number>}
     */
    async hdel(key, fields) {
        try {
            const fullKey = this.getFullKey(key);
            const fieldArray = Array.isArray(fields) ? fields : [fields];
            return await this.client.hdel(fullKey, ...fieldArray);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    // ==================== List Operations ====================

    /**
     * Push to list (left)
     * @param {string} key - List key
     * @param {string|Object} value - Value to push
     * @returns {Promise<number>} New list length
     */
    async lpush(key, value) {
        try {
            const fullKey = this.getFullKey(key);
            const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
            return await this.client.lpush(fullKey, serializedValue);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Push to list (right)
     * @param {string} key - List key
     * @param {string|Object} value - Value to push
     * @returns {Promise<number>} New list length
     */
    async rpush(key, value) {
        try {
            const fullKey = this.getFullKey(key);
            const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
            return await this.client.rpush(fullKey, serializedValue);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Pop from list (left)
     * @param {string} key - List key
     * @param {boolean} parseJson - Whether to parse JSON
     * @returns {Promise<string|Object|null>}
     */
    async lpop(key, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const value = await this.client.lpop(fullKey);

            if (value === null) {
                return null;
            }

            if (parseJson) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Pop from list (right)
     * @param {string} key - List key
     * @param {boolean} parseJson - Whether to parse JSON
     * @returns {Promise<string|Object|null>}
     */
    async rpop(key, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const value = await this.client.rpop(fullKey);

            if (value === null) {
                return null;
            }

            if (parseJson) {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get list range
     * @param {string} key - List key
     * @param {number} start - Start index
     * @param {number} stop - Stop index
     * @param {boolean} parseJson - Whether to parse JSON
     * @returns {Promise<Array>}
     */
    async lrange(key, start, stop, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const values = await this.client.lrange(fullKey, start, stop);

            if (parseJson) {
                return values.map(v => {
                    try {
                        return JSON.parse(v);
                    } catch {
                        return v;
                    }
                });
            }
            return values;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get list length
     * @param {string} key - List key
     * @returns {Promise<number>}
     */
    async llen(key) {
        try {
            const fullKey = this.getFullKey(key);
            return await this.client.llen(fullKey);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    // ==================== Set Operations ====================

    /**
     * Add member to set
     * @param {string} key - Set key
     * @param {string|Object} member - Member to add
     * @returns {Promise<number>}
     */
    async sadd(key, member) {
        try {
            const fullKey = this.getFullKey(key);
            const serializedValue = typeof member === 'object' ? JSON.stringify(member) : member;
            return await this.client.sadd(fullKey, serializedValue);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Remove member from set
     * @param {string} key - Set key
     * @param {string|Object} member - Member to remove
     * @returns {Promise<number>}
     */
    async srem(key, member) {
        try {
            const fullKey = this.getFullKey(key);
            const serializedValue = typeof member === 'object' ? JSON.stringify(member) : member;
            return await this.client.srem(fullKey, serializedValue);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get all set members
     * @param {string} key - Set key
     * @param {boolean} parseJson - Whether to parse JSON
     * @returns {Promise<Array>}
     */
    async smembers(key, parseJson = true) {
        try {
            const fullKey = this.getFullKey(key);
            const members = await this.client.smembers(fullKey);

            if (parseJson) {
                return members.map(m => {
                    try {
                        return JSON.parse(m);
                    } catch {
                        return m;
                    }
                });
            }
            return members;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    // ==================== Memory Operations (for Agent SDK) ====================

    /**
     * Store agent memory
     * @param {string} agentId - Agent identifier
     * @param {Object} memory - Memory object
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<string>}
     */
    async storeMemory(agentId, memory, ttl = null) {
        const key = `memory:${agentId}`;
        return await this.set(key, memory, ttl);
    }

    /**
     * Get agent memory
     * @param {string} agentId - Agent identifier
     * @returns {Promise<Object|null>}
     */
    async getMemory(agentId) {
        const key = `memory:${agentId}`;
        return await this.get(key);
    }

    /**
     * Append to conversation history
     * @param {string} agentId - Agent identifier
     * @param {Object} message - Message object
     * @returns {Promise<number>}
     */
    async appendConversation(agentId, message) {
        const key = `conversation:${agentId}`;
        return await this.rpush(key, message);
    }

    /**
     * Get conversation history
     * @param {string} agentId - Agent identifier
     * @param {number} limit - Number of messages to retrieve (default: all)
     * @returns {Promise<Array>}
     */
    async getConversation(agentId, limit = null) {
        const key = `conversation:${agentId}`;
        if (limit) {
            const length = await this.llen(key);
            const start = Math.max(0, length - limit);
            return await this.lrange(key, start, -1);
        }
        return await this.lrange(key, 0, -1);
    }

    /**
     * Clear conversation history
     * @param {string} agentId - Agent identifier
     * @returns {Promise<number>}
     */
    async clearConversation(agentId) {
        const key = `conversation:${agentId}`;
        return await this.delete(key);
    }

    // ==================== Cache Operations ====================

    /**
     * Cache with automatic expiration
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<string>}
     */
    async cache(key, value, ttl) {
        return await this.set(`cache:${key}`, value, ttl);
    }

    /**
     * Get from cache
     * @param {string} key - Cache key
     * @returns {Promise<any|null>}
     */
    async getCache(key) {
        return await this.get(`cache:${key}`);
    }

    /**
     * Invalidate cache
     * @param {string} key - Cache key
     * @returns {Promise<number>}
     */
    async invalidateCache(key) {
        return await this.delete(`cache:${key}`);
    }

    // ==================== Pub/Sub Operations ====================

    /**
     * Initialize pub/sub clients
     * @returns {Promise<void>}
     */
    async initPubSub() {
        if (!this.subscriber) {
            this.subscriber = new Redis(this.config);
            this.setupEventListeners(this.subscriber);
        }
        if (!this.publisher) {
            this.publisher = new Redis(this.config);
            this.setupEventListeners(this.publisher);
        }
    }

    /**
     * Publish message to channel
     * @param {string} channel - Channel name
     * @param {string|Object} message - Message to publish
     * @returns {Promise<number>} Number of subscribers that received the message
     */
    async publish(channel, message) {
        try {
            if (!this.publisher) {
                await this.initPubSub();
            }
            const serializedMessage = typeof message === 'object' ? JSON.stringify(message) : message;
            return await this.publisher.publish(channel, serializedMessage);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Subscribe to channel
     * @param {string|Array<string>} channels - Channel(s) to subscribe to
     * @param {Function} callback - Callback function(message, channel)
     * @returns {Promise<void>}
     */
    async subscribe(channels, callback) {
        try {
            if (!this.subscriber) {
                await this.initPubSub();
            }
            const channelArray = Array.isArray(channels) ? channels : [channels];
            await this.subscriber.subscribe(...channelArray);

            this.subscriber.on('message', (channel, message) => {
                try {
                    const parsed = JSON.parse(message);
                    callback(parsed, channel);
                } catch {
                    callback(message, channel);
                }
            });
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Unsubscribe from channel(s)
     * @param {string|Array<string>} channels - Channel(s) to unsubscribe from
     * @returns {Promise<void>}
     */
    async unsubscribe(channels) {
        try {
            if (this.subscriber) {
                const channelArray = Array.isArray(channels) ? channels : [channels];
                await this.subscriber.unsubscribe(...channelArray);
            }
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    // ==================== Utility Methods ====================

    /**
     * Get full key with prefix
     * @param {string} key - Key name
     * @returns {string} Full key with prefix
     */
    getFullKey(key) {
        return `${this.config.keyPrefix}${key}`;
    }

    /**
     * Get all keys matching pattern
     * @param {string} pattern - Key pattern (e.g., 'memory:*')
     * @returns {Promise<Array<string>>}
     */
    async keys(pattern) {
        try {
            const fullPattern = this.getFullKey(pattern);
            return await this.client.keys(fullPattern);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Delete all keys matching pattern
     * @param {string} pattern - Key pattern
     * @returns {Promise<number>} Number of keys deleted
     */
    async deletePattern(pattern) {
        try {
            const keys = await this.keys(pattern);
            if (keys.length === 0) {
                return 0;
            }
            return await this.client.del(...keys);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Get Redis info
     * @returns {Promise<Object>}
     */
    async info(section = null) {
        try {
            const info = await this.client.info(section);
            return info;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Ping Redis server
     * @returns {Promise<string>} 'PONG' on success
     */
    async ping() {
        try {
            return await this.client.ping();
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Flush all data (use with caution!)
     * @param {boolean} async - Whether to flush asynchronously
     * @returns {Promise<string>}
     */
    async flushall(async = false) {
        try {
            if (async) {
                return await this.client.flushall('ASYNC');
            }
            return await this.client.flushall();
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
}

module.exports = RedisManager;