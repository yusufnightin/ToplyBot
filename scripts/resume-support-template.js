const confirmation = process.argv.slice(2).join(' ').trim();

if (confirmation !== 'KURULUMU TAMAMLA') {
  console.error('Bu işlem için komutun sonuna KURULUMU TAMAMLA yazılmalıdır.');
  process.exit(1);
}

process.env.TOPLYBOT_SUPPORT_REBUILD = confirmation;
require('../src/index');
