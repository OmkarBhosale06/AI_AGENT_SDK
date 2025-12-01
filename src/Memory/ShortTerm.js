const config = require("/home/Omkar.Bhosale/AI_AGENT_SDK/config.json")
const RedisManager = require("../services/Redis");

class ShortTermMemory {
    constructor() {
        this.memory = new RedisManager(config.redis) || [];
    }

    async InitShortMemory() {
        await this.memory.connect();
    }

    async SMstore(key, value, ttl = config.redis.ttl) {
        await this.memory.storeMemory(key, { messages: value }, ttl);
    }

    async SMget(key) {
        return await this.memory.getMemory(key);
    }

}