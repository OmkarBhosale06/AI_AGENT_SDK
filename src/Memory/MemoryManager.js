class MemoryManager {
    constructor(memorytype) {
        this.memory = memorytype;
    }

    async initializeMemory() {
        switch (this.memorytype.toLowerCase()) {
            case 'short-term-memory':
                this.memory = new ShortTermMemory();
        }
    }
}