const fs = require('node:fs');
const path = require('node:path');

class Logger {
  constructor(logDirectory) {
    this.logDirectory = logDirectory;
    fs.mkdirSync(logDirectory, { recursive: true });
  }

  format(level, message, meta) {
    const timestamp = new Date().toISOString();
    const suffix = meta === undefined ? '' : ` ${this.serialize(meta)}`;
    return `[${timestamp}] [${level}] ${message}${suffix}`;
  }

  serialize(value) {
    if (value instanceof Error) {
      return JSON.stringify({ message: value.message, stack: value.stack });
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  write(level, message, meta) {
    const line = this.format(level, message, meta);
    const fileName = `${new Date().toISOString().slice(0, 10)}.log`;
    fs.appendFileSync(path.join(this.logDirectory, fileName), `${line}\n`, 'utf8');

    // Konsolda yalnızca gerçek hataları ve bir kez gösterilen açılış onayını tut.
    // INFO ve WARN kayıtları günlük dosyasına yazılmaya devam eder.
    if (level === 'ERROR') console.error(line);
    else if (level === 'READY') console.log(line);
  }

  info(message, meta) {
    this.write('INFO', message, meta);
  }

  warn(message, meta) {
    this.write('WARN', message, meta);
  }

  ready(message, meta) {
    this.write('READY', message, meta);
  }

  error(message, meta) {
    this.write('ERROR', message, meta);
  }
}

module.exports = Logger;
