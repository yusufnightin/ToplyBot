const { interpolate } = require('../utils/text');

module.exports = {
  name: 'Turbo Transferleri',
  setup(app) {
    app.client.on('action:turbo/transfer', async (event) => {
      try {
        const transfer = {
          transferId: event.transfer_id,
          userId: event.user_id,
          quantity: Number(event.message?.quantity || 0),
          message: String(event.message?.message || ''),
          createdAt: new Date().toISOString()
        };

        await app.stores.transfers.update((transfers) => {
          if (!transfers.some((item) => Number(item.transferId) === Number(transfer.transferId))) {
            transfers.push(transfer);
          }
          return transfers;
        });

        const template = app.config.features.turboThankYou;
        if (template) {
          await app.client.sendDirectMessage(event.user_id, interpolate(template, transfer));
        }
        app.logger.info('Turbo transferi kaydedildi.', transfer);
      } catch (error) {
        app.logger.error('Turbo transferi işlenemedi.', error);
      }
    });
  }
};
