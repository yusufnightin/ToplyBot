const path = require('node:path');

class PluginManager {
  constructor({ app, pluginDirectory }) {
    this.app = app;
    this.pluginDirectory = pluginDirectory;
    this.loaded = new Map();
  }

  load(pluginNames) {
    for (const pluginName of pluginNames) {
      const pluginPath = path.join(this.pluginDirectory, `${pluginName}.js`);
      const plugin = require(pluginPath);
      if (!plugin || typeof plugin.setup !== 'function') {
        throw new TypeError(`${pluginName} eklentisi setup(app) dışa aktarmalıdır.`);
      }
      if (this.loaded.has(pluginName)) {
        throw new Error(`Eklenti zaten yüklü: ${pluginName}`);
      }
      plugin.setup(this.app);
      this.loaded.set(pluginName, plugin);
      this.app.logger.info(`Eklenti yüklendi: ${plugin.name || pluginName}`);
    }
  }
}

module.exports = PluginManager;
