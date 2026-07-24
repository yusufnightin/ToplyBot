const confirmation = process.argv.slice(2).join(' ').trim();

if (confirmation !== 'TAM SIFIRLA') {
  console.error('Bu işlem için komutun sonuna TAM SIFIRLA yazılmalıdır.');
  process.exit(1);
}

process.env.TOPLYBOT_SUPPORT_REBUILD = confirmation;
require('../src/index');
