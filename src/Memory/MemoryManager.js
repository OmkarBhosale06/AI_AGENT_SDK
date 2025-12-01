const ShortTermMemory = require('./ShortTerm');

class MemoryManager {
    constructor(memorytype) {
        this.memory = memorytype;
    }

    async initializeMemory() {
        switch (this.memorytype.toLowerCase()) {
            case 'short-term-memory':
                this.memory = new ShortTermMemory();
                break;
            default:
                //Keeping the default as short-term-memory
                this.memory = new ShortTermMemory();
                break;
        }
    }
}