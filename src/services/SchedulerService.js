const { EventEmitter } = require('node:events');

class SchedulerService extends EventEmitter {
  constructor({ logger, intervalMs = 15_000 }) {
    super();
    this.logger = logger;
    this.jobs = new Map();
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  register(name, handler) {
    if (this.jobs.has(name)) throw new Error(`Zamanlayıcı işi zaten kayıtlı: ${name}`);
    this.jobs.set(name, handler);
  }

  async tick() {
    for (const [name, handler] of this.jobs) {
      try {
        await handler(Date.now());
      } catch (error) {
        this.logger?.error(`Zamanlayıcı işi hata verdi: ${name}`, error);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    this.jobs.clear();
  }
}

module.exports = SchedulerService;
