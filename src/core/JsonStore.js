const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(filePath, initialValue = {}) {
    this.filePath = filePath;
    this.initialValue = initialValue;
    this.operationChain = Promise.resolve();
    this.cacheReady = false;
    this.cacheValue = null;
    this.readCount = 0;
    this.diskReadCount = 0;
    this.writeCount = 0;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  clone(value) {
    return structuredClone(value);
  }

  async readUnsafe({ force = false } = {}) {
    this.readCount += 1;
    if (!force && this.cacheReady) return this.clone(this.cacheValue);
    try {
      this.diskReadCount += 1;
      const content = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
      this.cacheValue = this.clone(parsed);
      this.cacheReady = true;
      return this.clone(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const initial = this.clone(this.initialValue);
      await this.writeUnsafe(initial);
      return this.clone(initial);
    }
  }

  async writeUnsafe(value) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    await fs.promises.writeFile(temporaryPath, payload, 'utf8');
    await fs.promises.rename(temporaryPath, this.filePath);
    this.cacheValue = this.clone(value);
    this.cacheReady = true;
    this.writeCount += 1;
  }

  enqueue(operation) {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  read(options = {}) {
    return this.enqueue(() => this.readUnsafe(options));
  }

  reload() {
    return this.read({ force: true });
  }

  invalidate() {
    this.cacheReady = false;
    this.cacheValue = null;
  }

  write(value) {
    return this.enqueue(async () => {
      await this.writeUnsafe(value);
      return this.clone(value);
    });
  }

  update(mutator) {
    return this.enqueue(async () => {
      const current = await this.readUnsafe();
      const next = await mutator(current);
      const value = next === undefined ? current : next;
      await this.writeUnsafe(value);
      return this.clone(value);
    });
  }

  metrics() {
    return {
      file: path.basename(this.filePath),
      cacheReady: this.cacheReady,
      reads: this.readCount,
      diskReads: this.diskReadCount,
      writes: this.writeCount
    };
  }
}

module.exports = JsonStore;
