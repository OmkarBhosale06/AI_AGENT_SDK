/**
 * Base class for Database providers
 */
class BaseDatabaseProvider {
    constructor(config = {}) {
        this.config = config;
        this.name = 'BaseDatabaseProvider';
        this.connected = false;
    }

    async connect() {
        throw new Error('connect() must be implemented by subclass');
    }

    async disconnect() {
        throw new Error('disconnect() must be implemented by subclass');
    }

    async query(query, params = []) {
        throw new Error('query() must be implemented by subclass');
    }

    async insert(collection, data) {
        throw new Error('insert() must be implemented by subclass');
    }

    async find(collection, filter = {}) {
        throw new Error('find() must be implemented by subclass');
    }

    async update(collection, filter, data) {
        throw new Error('update() must be implemented by subclass');
    }

    async delete(collection, filter) {
        throw new Error('delete() must be implemented by subclass');
    }

    isConnected() {
        return this.connected;
    }

    getName() {
        return this.name;
    }
}

module.exports = BaseDatabaseProvider;