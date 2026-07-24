const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNativeJtmlMarkup, parseSingleHtmlForm, parseTopluyoFrame } = require('../src/utils/topluyoProtocol');

test('geçerli Bumote form nesnesini değiştirmez', () => {
  const source = JSON.stringify({
    action: 'post/bumote',
    message: { form: { menu_action: 'home' }, submit: 'Ana Menü' },
    post_id: 11,
    user_id: 22
  });
  const parsed = parseTopluyoFrame(Buffer.from(source));
  assert.equal(parsed.value.message.form.menu_action, 'home');
  assert.equal(parsed.format, 'form-object');
  assert.equal(parsed.repaired, false);
});


test('resmî ~{JSON} JTML işaretlemesini ayrıştırır', () => {
  const jtml = '~{"type":"box","ui":"flex-y","children":[{"type":"input","name":"query","placeholder":"Ara"},{"type":"bumote","name":"menu_action","value":"search","text":"Ara"},{"type":"bumote","name":"menu_action","value":"close","text":"Kapat"}]}';
  const parsedMarkup = parseNativeJtmlMarkup(jtml);
  assert.equal(parsedMarkup.blockCount, 1);
  assert.equal(parsedMarkup.bumoteCount, 2);
  assert.equal(parsedMarkup.inputCount, 1);

  const source = `{"action":"post/bumote","message":${jtml},"channel_id":44,"post_id":71,"user_id":25}`;
  const parsed = parseTopluyoFrame(source);
  assert.equal(parsed.repaired, true);
  assert.equal(parsed.format, 'native-jtml-markup');
  assert.equal(parsed.value.protocol.attachmentEcho, true);
  assert.equal(parsed.value.protocol.bumoteCount, 2);
  assert.equal(parsed.value.message.form, null);
});

test('tırnaksız ve çok formlu JTML içeren bozuk Topluyo çerçevesini onarır ve ekleme bildirimi olarak işaretler', () => {
  const html = '<form class="jtml-action"><button type="submit" name="menu_action" value="home">🏠 Ana Menü</button></form>\n'
    + '<form class="jtml-action"><button type="submit" name="menu_action" value="refresh">🔄 Yenile</button></form>';
  const source = `{"action":"post/bumote","message":${html},"channel_id":44366,"group_id":6875,"post_id":711538,"user_id":25469}`;
  const parsed = parseTopluyoFrame(source);
  assert.equal(parsed.repaired, true);
  assert.equal(parsed.value.action, 'post/bumote');
  assert.equal(parsed.value.post_id, 711538);
  assert.equal(parsed.value.message.form, null);
  assert.equal(parsed.value.protocol.attachmentEcho, true);
  assert.equal(parsed.value.protocol.formCount, 2);
});

test('tek HTML formundan tıklanan buton alanını çıkarır', () => {
  const html = '<form class="jtml-search"><input type="text" name="query" value="ban"><button type="submit" name="menu_action" value="search">Ara</button></form>';
  const source = `{"action":"post/bumote","message":${html},"channel_id":44,"group_id":68,"post_id":71,"user_id":25}`;
  const parsed = parseTopluyoFrame(source);
  assert.equal(parsed.value.message.form.query, 'ban');
  assert.equal(parsed.value.message.form.menu_action, 'search');
  assert.equal(parsed.value.message.submit, 'Ara');
  assert.equal(parsed.format, 'single-form-html');
});

test('tırnaksız iç içe form JSON mesajını kurtarır', () => {
  const source = '{"action":"post/bumote","message":{"form":{"menu_action":"section:moderation"},"submit":"Moderasyon"},"channel_id":44,"post_id":71,"user_id":25}';
  const parsed = parseTopluyoFrame(source);
  assert.equal(parsed.repaired, false);
  assert.equal(parsed.value.message.form.menu_action, 'section:moderation');
  assert.equal(parsed.value.message.submit, 'Moderasyon');
});

test('tek form ayrıştırıcısı entity ve input değerlerini çözer', () => {
  const parsed = parseSingleHtmlForm('<form><input name="query" value="rol &amp; yetki"><button name="menu_action" value="search">🔎 Ara</button></form>');
  assert.deepEqual(parsed.form, { query: 'rol & yetki', menu_action: 'search' });
  assert.equal(parsed.submit, '🔎 Ara');
});
