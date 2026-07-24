const defaults = {
  markdown: "# Topluyo Komut Paneli\nİstediğin işlemi aşağıdan seçebilirsin.",
  accent: "#7c5cff",
  theme: "dark",
  tree: { type: "box", ui: "flex-y", gap: 0.5, children: [
    { type: "bumote", name: "action_id", value: "yardim", text: "✨ Yardım" },
    { type: "bumote", name: "action_id", value: "ayarlar", text: "⚙️ Ayarlar" },
  ] },
};
function helpCenterPreset() {
  const card = (icon, text, description, value) => ({ type:"_card", ui:"flex-x", icon, text, description, value, _width:32, _height:164, _radius:10, _padding:0, children:[] });
  const quick = (icon, text, value) => ({ type:"_quick", icon, text, value, _height:62, children:[] });
  return {
    type:"box", ui:"flex-y", gap:0.7, children:[
      { type:"_heading", text:"ToplyBot Yardım Merkezi", description:"SEÇENEK 1 — SADE ANA PANEL", _height:76 },
      { type:"_status", text:"Bot Durumu: Çevrimiçi", description:"Tüm özelliklere hızlıca ulaşmak için aşağıdaki kategorilerden birini seç.", _height:44 },
      { type:"flex-x", ui:"flex-x", gap:0.7, children:[
        { type:"flex-y", ui:"flex-y", gap:0.7, _width:75, children:[
          { type:"_search", icon:"⌕", placeholder:"Ne yapmak istiyorsun?", _height:58 },
          { type:"flex-x", ui:"flex-x", gap:0.6, children:[
            card("⌂","Genel & İstatistik","Bilgi, kimlik, arama ve sunucu istatistikleri.","section:general"),
            card("◇","Moderasyon & Güvenlik","Uyarı, timeout, filtre, spam ve denetim.","section:moderation"),
            card("👋","Üye & Karşılama","Karşılama, kayıt ve üye işlemleri.","section:community"),
            card("♟","Roller & Destek","Rol panelleri, self rol ve ticket sistemi.","section:community"),
            card("★","Seviye & Rozet","XP, rank, liderlik, rol ve rozet ödülleri.","section:progression"),
            card("⚡","Otomasyon & Sosyal","Zamanlayıcı, özel komut, yayın ve bildirimler.","section:automation")
          ]}
        ]},
        { type:"flex-y", ui:"flex-y", gap:0.6, _width:25, _padding:12, _radius:12, children:[
          { type:"_heading", text:"Hızlı İşlemler", description:"⚡", _height:48 },
          quick("⚙","Sistem Yönetimi","section:management"),
          quick("🎯","Anket & Çekiliş","section:extras"),
          quick("☷","Bot Ayarları","settings:home")
        ]}
      ]},
      { type:"flex-x", ui:"flex-x", gap:0.6, children:[
        { type:"_nav", icon:"⌂", text:"Ana Sayfa", value:"home", _width:33, _height:54, children:[] },
        { type:"_nav", icon:"←", text:"Geri", value:"back", _width:33, _height:54, children:[] },
        { type:"_nav", icon:"×", text:"Kapat", value:"close", _width:33, _height:54, children:[] }
      ]}
    ]
  };
}

function populateCommandExamples(tree) {
  const command = (text, description, usage, value) => ({
    type:"_command", icon:"!", text, description, placeholder:usage, value,
    _width:32, _height:136
  });
  const catalogs = {
    "section:general": [
      command("!ping","Bot bağlantısını ve cevap süresini kontrol eder.","!ping","run:ping"),
      command("!kimlik","Kullanıcı, kanal, grup ve yetki kimliğini gösterir.","!kimlik","run:kimlik"),
      command("!sunucu","Aktif grubun temel bilgilerini getirir.","!sunucu","run:sunucu"),
      command("!sunucuistatistik","Grup istatistiklerini gösterir.","!sunucuistatistik","run:sunucuistatistik")
    ],
    "section:moderation": [
      command("!uyar","Bir üyeye kalıcı uyarı verir.","!uyar <kullanıcıId> <sebep>","command:uyar"),
      command("!timeout","Üyeye süreli timeout uygular.","!timeout <kullanıcıId> <süre|0> [sebep]","command:timeout"),
      command("!temizle","Kanaldaki son mesajları siler.","!temizle <1-100> [kullanıcıId]","command:temizle"),
      command("!otomod","Otomatik moderasyonu yapılandırır.","!otomod <durum|aç|kapat>","command:otomod")
    ],
    "section:community": [
      command("!welcome","Karşılama sistemini yönetir.","!welcome <durum|aç|kapat>","command:welcome"),
      command("!kayıt","Üyeyi kaydeder ve rollerini verir.","!kayıt <kullanıcıId> <isim> [yaş]","command:kayıt"),
      command("!rolpanel","Etkileşimli rol paneli oluşturur.","!rolpanel oluştur <başlık> | <rolId,rolId>","command:rolpanel"),
      command("!ticket","Ticket açar, kapatır ve yönetir.","!ticket <aç konu|kapat id|liste|bilgi id>","command:ticket")
    ],
    "section:progression": [
      command("!rank","Seviye, XP ve rozetleri gösterir.","!rank [kullanıcıId]","command:rank"),
      command("!leveltop","XP liderlik tablosunu gösterir.","!leveltop [adet]","command:leveltop"),
      command("!seviyeayar","Seviye sistemini açar veya kapatır.","!seviyeayar <aç|kapat>","command:seviyeayar"),
      command("!xpver","Kullanıcıya XP ekler.","!xpver <kullanıcıId> <miktar>","command:xpver")
    ],
    "section:automation": [
      command("!zamanlayıcı","Planlı mesajları yönetir.","!zamanlayıcı <sonra|tekrar|günlük|liste|sil>","command:zamanlayıcı"),
      command("!komutoluştur","Yeni özel komut oluşturur.","!komutoluştur <ad> <tür> <içerik>","command:komutoluştur"),
      command("!yayın","Canlı yayın duyurularını yönetir.","!yayın <liste|ekle|ayarla|kontrol|test|sil>","command:yayın"),
      command("!sosyal","Sosyal medya bildirimlerini yönetir.","!sosyal <liste|ekle|sil|kontrol>","command:sosyal")
    ],
    "section:management": [
      command("!ayarlar","Sunucuya özel bot ayarlarını özetler.","!ayarlar","run:ayarlar"),
      command("!sistemkontrol","Sistem sağlığını denetler.","!sistemkontrol [detay]","command:sistemkontrol"),
      command("!yedek","Bot verilerini yedekler ve geri yükler.","!yedek <oluştur|liste|bilgi|geri>","command:yedek")
    ],
    "section:extras": [
      command("!anket","Süreli çok seçenekli anket oluşturur.","!anket oluştur <süre|0> <soru> | seçenek","command:anket"),
      command("!oy","Bir ankette oy verir.","!oy <anketId> <seçenekNo>","command:oy"),
      command("!çekiliş","Çekiliş oluşturur veya yönetir.","!çekiliş <oluştur|durum|bitir|yeniden>","command:çekiliş")
    ],
    "settings:home": [
      command("!kanalayarla","Özellik kanallarını ayarlar.","!kanalayarla <tür> <#kanal|kanalId|kapat>","command:kanalayarla"),
      command("!prefixbilgi","Aktif komut prefixini gösterir.","!prefixbilgi","run:prefixbilgi")
    ]
  };
  const visit = (node) => {
    if (catalogs[node.value]) node.children = clone(catalogs[node.value]);
    (node.children || []).forEach(visit);
  };
  visit(tree);
  return tree;
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const storageKey = "topluyo-jtml-studio-v2";
let state = load();
let selectedPath = null;
let focusPath = [];
let dragData = null;
let timer;
let toastTimer;
const numericProperties = new Set(["gap", "_width", "_height", "_radius", "_padding"]);

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function exportTree(value) {
  if (Array.isArray(value)) return value.map(exportTree);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith("_")).map(([key, item]) => [key, exportTree(item)]));
}
function load() {
  try { return { ...clone(defaults), ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; }
  catch { return clone(defaults); }
}
function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  $("#saveState").textContent = "Yerel olarak kaydedildi";
}
function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" })[c]);
}
function renderMarkdown(v) {
  return esc(v).replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>")
    .split(/\n{2,}/).map(b => b.startsWith("<h") ? b : `<p>${b.replace(/\n/g,"<br>")}</p>`).join("");
}
function pathKey(path) { return path.join("."); }
function parsePath(value) { return value === "" ? [] : value.split(".").map(Number); }
function nodeAt(path) {
  let node = state.tree;
  for (const index of path) node = node.children[index];
  return node;
}
function parentAt(path) {
  if (!path.length) return null;
  return { node: nodeAt(path.slice(0, -1)), index: path.at(-1) };
}
function isContainer(node) { return node && (["bumote", "_card", "_quick", "_nav"].includes(node.type) || ["box", "flex-x", "flex-y"].includes(node.type)); }
function label(node) {
  if (node.type === "bumote") return "Buton";
  if (node.type === "input") return "Metin alanı";
  if (node.type === "_heading") return "Başlık";
  if (node.type === "_status") return "Durum satırı";
  if (node.type === "_search") return "Arama";
  if (node.type === "_card") return "Menü kartı";
  if (node.type === "_command") return "Komut kartı";
  if (node.type === "_quick") return "Hızlı işlem";
  if (node.type === "_nav") return "Alt menü";
  return node.ui === "flex-x" || node.type === "flex-x" ? "Yatay grup" : "Dikey grup";
}
function makeNode(kind) {
  const id = Date.now().toString(36).slice(-5);
  if (kind === "heading") return { type:"_heading", text:"ToplyBot Yardım Merkezi", description:"SEÇENEK 1 — SADE ANA PANEL", _height:72 };
  if (kind === "status") return { type:"_status", text:"Bot Durumu: Çevrimiçi", description:"Tüm özelliklere hızlıca ulaşmak için bir kategori seç.", _height:40 };
  if (kind === "search") return { type:"_search", icon:"⌕", placeholder:"Ne yapmak istiyorsun?", _height:56 };
  if (kind === "card") return { type:"_card", icon:"⚙", text:"Sunucu Ayarları", description:"Sunucunuza özel ayarları yönetin.", value:`kart-${id}`, _width:32, _height:150, _radius:10, _padding:12, children:[] };
  if (kind === "command") return { type:"_command", icon:"!", text:"!komut", description:"Komut açıklaması.", placeholder:"!komut <parametre>", value:`command-${id}`, _width:32, _height:132 };
  if (kind === "quick") return { type:"_quick", icon:"⚡", text:"Hızlı İşlem", value:`hizli-${id}`, _height:58, children:[] };
  if (kind === "nav") return { type:"_nav", icon:"⌂", text:"Ana Sayfa", value:`nav-${id}`, _width:32, _height:50, children:[] };
  if (kind === "button") return { type:"bumote", name:"action_id", value:`islem-${id}`, text:"Yeni Buton" };
  if (kind === "input") return { type:"input", ui:"space", name:`alan_${id}`, placeholder:"Bir değer yazın..." };
  if (kind === "row") return { type:"flex-x", ui:"flex-x", gap:0.5, children:[] };
  return { type:"flex-y", ui:"flex-y", gap:0.5, children:[] };
}
function nodeHtml(node, path) {
  const key = pathKey(path);
  const selected = key === pathKey(selectedPath || [-1]) ? " selected" : "";
  const containerClass = isContainer(node) ? " container-item" : "";
  const width = Math.max(25, Math.min(100, Number(node._width) || 100));
  const height = Math.max(32, Math.min(240, Number(node._height) || 40));
  const radius = Math.max(0, Math.min(30, Number(node._radius) || 9));
  const padding = Math.max(0, Math.min(32, Number(node._padding) || 0));
  const sizeStyle = `style="width:${width}%;min-height:${height}px;border-radius:${radius}px;padding:${padding}px"`;
  let body;
  if (node.type === "bumote") {
    const count = node.children?.length || 0;
    body = `<button class="ui-button" type="button">${esc(node.text || "Buton")}${count ? `<small>↳ ${count} alt öğe</small>` : ""}</button>`;
  }
  else if (node.type === "input") body = `<div class="ui-input">${esc(node.placeholder || "Metin gir...")}</div>`;
  else if (node.type === "_heading") body = `<div class="designer-heading"><small>${esc(node.description || "")}</small><strong>${esc(node.text || "Başlık")}</strong></div>`;
  else if (node.type === "_status") body = `<div class="designer-status"><span class="designer-icon">🤖</span><i></i><b>${esc(node.text || "")}</b><span>|</span><span>${esc(node.description || "")}</span></div>`;
  else if (node.type === "_search") body = `<div class="designer-search"><span>${esc(node.icon || "⌕")}</span>${esc(node.placeholder || "Ara...")}</div>`;
  else if (node.type === "_card") body = `<div class="designer-card"><div class="designer-card-head"><span class="designer-icon">${esc(node.icon || "⚙")}</span><div><b>${esc(node.text || "Kart")}</b><small>${esc(node.description || "")}</small></div></div><div class="card-action">Git</div></div>`;
  else if (node.type === "_command") body = `<div class="designer-command"><div class="designer-command-head"><span>${esc(node.icon || "⌘")}</span><strong>${esc(node.text || "!komut")}</strong></div><p>${esc(node.description || "")}</p><code>Kullanım: ${esc(node.placeholder || node.text || "")}</code><div class="designer-command-actions"><span>${/[<]/.test(node.placeholder || "") ? "Parametre Gir →" : "Aç →"}</span></div></div>`;
  else if (node.type === "_quick") body = `<div class="designer-quick"><span class="designer-icon">${esc(node.icon || "⚡")}</span><b>${esc(node.text || "Hızlı işlem")}</b><em>›</em></div>`;
  else if (node.type === "_nav") body = `<div class="designer-nav"><span>${esc(node.icon || "⌂")}</span>${esc(node.text || "Menü")}</div>`;
  else {
    const children = node.children || [];
    const direction = node.ui === "flex-x" || node.type === "flex-x" ? "row" : "column";
    body = `<div class="drop-container ${direction}" data-container="${key}">${children.length ? children.map((n,i) => nodeHtml(n,[...path,i])).join("") : '<div class="drop-placeholder">Bileşeni buraya bırak</div>'}</div>`;
  }
  return `<div class="canvas-item${selected}${containerClass}" ${sizeStyle} draggable="true" data-path="${key}"><span class="item-tag">${label(node)}</span>${body}</div>`;
}
function renderCanvas() {
  $("#markdownPreview").innerHTML = renderMarkdown(state.markdown);
  $("#canvas").innerHTML = (state.tree.children || []).map((n,i) => nodeHtml(n,[i])).join("") || '<div class="drop-placeholder">Soldan bir bileşen sürükleyip buraya bırak</div>';
  bindCanvas();
}
function renderFocusedCanvas() {
  $("#markdownPreview").innerHTML = renderMarkdown(state.markdown);
  const focused = focusPath.length ? nodeAt(focusPath) : state.tree;
  const children = focused.children || [];
  $("#canvas").dataset.container = pathKey(focusPath);
  $("#canvas").classList.toggle(
    "focus-row",
    focused.ui === "flex-x" || focused.type === "flex-x" ||
    ["_card", "_quick", "_nav"].includes(focused.type)
  );
  $("#canvas").innerHTML = children.map((node, index) => nodeHtml(node, [...focusPath, index])).join("") ||
    '<div class="drop-placeholder">Bileşeni bu grubun içine bırak</div>';
  const crumbs = [{ path:[], text:"Ana tuval" }];
  focusPath.forEach((_, index) => {
    const path = focusPath.slice(0, index + 1);
    crumbs.push({ path, text:label(nodeAt(path)) });
  });
  $("#breadcrumbs").innerHTML = crumbs.map((crumb, index) =>
    `${index ? "<i>›</i>" : ""}<button type="button" data-focus="${pathKey(crumb.path)}">${esc(crumb.text)}</button>`
  ).join("");
  $$("#breadcrumbs [data-focus]").forEach(button => button.addEventListener("click", () => {
    focusPath = parsePath(button.dataset.focus);
    selectedPath = focusPath.length ? [...focusPath] : null;
    renderAll();
  }));
  bindCanvas();
}
function renderAll() {
  document.documentElement.style.setProperty("--accent", state.accent);
  $("#markdownInput").value = state.markdown;
  $("#accentInput").value = state.accent;
  $$(".theme-choice").forEach(b => b.classList.toggle("active", b.dataset.theme === state.theme));
  $("#previewDevice").style.filter = state.theme === "light" ? "invert(.88) hue-rotate(180deg)" : "";
  renderFocusedCanvas();
  $("#codeInput").value = `~${JSON.stringify(exportTree(state.tree), null, 2)}`;
  setValid(true);
  updateInspector();
  save();
}
function bindCanvas() {
  $$(".canvas-item").forEach(el => {
    el.addEventListener("click", e => { e.stopPropagation(); selectedPath = parsePath(el.dataset.path); renderAll(); });
    el.addEventListener("dblclick", e => {
      e.preventDefault();
      e.stopPropagation();
      const path = parsePath(el.dataset.path);
      if (!isContainer(nodeAt(path))) return;
      focusPath = path;
      selectedPath = null;
      renderAll();
      showToast(`${label(nodeAt(path))} içine girdin`);
    });
    el.addEventListener("dragstart", e => {
      e.stopPropagation();
      dragData = { source:"canvas", path:parsePath(el.dataset.path) };
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", el.dataset.path);
    });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); clearDropStyles(); });
  });
  $$("[data-container]").forEach(bindDropContainer);
}
function bindDropContainer(container) {
  container.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); container.classList.add("drag-over"); e.dataTransfer.dropEffect = dragData?.source === "canvas" ? "move" : "copy"; });
  container.addEventListener("dragleave", e => { if (!container.contains(e.relatedTarget)) container.classList.remove("drag-over"); });
  container.addEventListener("drop", e => {
    e.preventDefault(); e.stopPropagation();
    const targetPath = parsePath(container.dataset.container);
    dropInto(targetPath);
  });
}
function dropInto(containerPath) {
  const target = containerPath.length ? nodeAt(containerPath) : state.tree;
  if (!isContainer(target)) return;
  if (dragData?.source === "palette") {
    target.children ||= [];
    target.children.push(makeNode(dragData.kind));
    selectedPath = [...containerPath, target.children.length - 1];
  } else if (dragData?.source === "canvas") {
    const sourcePath = dragData.path;
    if (pathKey(containerPath).startsWith(`${pathKey(sourcePath)}.`) || pathKey(containerPath) === pathKey(sourcePath)) {
      showToast("Bir grup kendi içine taşınamaz"); return;
    }
    const moving = clone(nodeAt(sourcePath));
    const old = parentAt(sourcePath);
    old.node.children.splice(old.index, 1);
    let adjusted = [...containerPath];
    if (sourcePath.length === containerPath.length && pathKey(sourcePath.slice(0,-1)) === pathKey(containerPath.slice(0,-1)) && sourcePath.at(-1) < containerPath.at(-1)) adjusted[adjusted.length - 1]--;
    const destination = adjusted.length ? nodeAt(adjusted) : state.tree;
    destination.children ||= [];
    destination.children.push(moving);
    selectedPath = [...adjusted, destination.children.length - 1];
  }
  dragData = null;
  renderAll();
  showToast("Bileşen yerleştirildi");
}
function clearDropStyles() { $$(".drag-over").forEach(el => el.classList.remove("drag-over")); }
function updateInspector() {
  const has = selectedPath && selectedPath.length && (() => { try { return !!nodeAt(selectedPath); } catch { return false; } })();
  $("#emptyInspector").hidden = !!has;
  $("#inspector").hidden = !has;
  if (!has) return;
  const node = nodeAt(selectedPath);
  const kind = node.type === "bumote" ? "button" : node.type === "input" ? "input" : node.type.startsWith("_") ? "designer" : "container";
  $("#selectedType").textContent = label(node);
  $("#selectedIcon").textContent = kind === "button" ? "▣" : kind === "input" ? "⌨" : "⇅";
  $("#selectedPath").textContent = `Katman ${selectedPath.map(i => i + 1).join(" › ")}`;
  $$(".text-property").forEach(el => el.hidden = ["input", "_search"].includes(node.type));
  $$(".icon-property").forEach(el => el.hidden = !node.type.startsWith("_") || ["_heading", "_status"].includes(node.type));
  $$(".description-property").forEach(el => el.hidden = !["_heading", "_status", "_card"].includes(node.type));
  $$(".input-property").forEach(el => el.hidden = !["input", "_search", "_command"].includes(node.type));
  $$(".name-property").forEach(el => el.hidden = !["button","input"].includes(kind));
  $$(".value-property").forEach(el => el.hidden = !["button","designer"].includes(kind) || ["_heading","_status","_search"].includes(node.type));
  $$(".layout-property, .gap-property").forEach(el => el.hidden = kind !== "container");
  for (const field of $("#inspector").elements) if (field.name) field.value = node[field.name] ?? (field.name === "gap" ? 0.5 : "");
  $("#gapOutput").value = `${node.gap ?? 0.5}`;
  $("#widthOutput").value = `${node._width ?? 100}`;
  $("#heightOutput").value = `${node._height ?? 40}`;
  $("#radiusOutput").value = `${node._radius ?? 9}`;
  $("#paddingOutput").value = `${node._padding ?? 0}`;
  $("#enterButton").hidden = !isContainer(node);
}
function mutateSelected(callback) {
  if (!selectedPath) return;
  callback(nodeAt(selectedPath));
  renderAll();
}
function moveSelected(delta) {
  const parent = parentAt(selectedPath || []);
  if (!parent) return;
  const next = parent.index + delta;
  if (next < 0 || next >= parent.node.children.length) return;
  [parent.node.children[parent.index], parent.node.children[next]] = [parent.node.children[next], parent.node.children[parent.index]];
  selectedPath[selectedPath.length - 1] = next;
  renderAll();
}
function setValid(valid, message="") {
  $(".code-status").classList.toggle("invalid", !valid);
  $("#validationText").textContent = valid ? "Geçerli JTML" : "JTML hatası";
  $("#errorMessage").hidden = valid; $("#errorMessage").textContent = message;
}
function parseCode() {
  try {
    const raw = $("#codeInput").value.trim();
    const parsed = JSON.parse(raw.startsWith("~") ? raw.slice(1) : raw);
    if (!parsed.type) throw new Error('"type" alanı zorunludur.');
    state.tree = parsed; selectedPath = null; focusPath = []; setValid(true); renderFocusedCanvas(); updateInspector(); save();
  } catch (e) { setValid(false, e.message); }
}
function showToast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
}

$$(".component").forEach(el => {
  el.addEventListener("click", () => { dragData = { source:"palette", kind:el.dataset.kind }; dropInto(focusPath); });
  el.addEventListener("dragstart", e => { dragData = { source:"palette", kind:el.dataset.kind }; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", el.dataset.kind); });
  el.addEventListener("dragend", () => { el.classList.remove("dragging"); clearDropStyles(); });
});
$("#canvas").addEventListener("click", e => { if (e.target === $("#canvas")) { selectedPath = null; renderAll(); } });
$("#inspector").addEventListener("input", e => {
  if (!e.target.name) return;
  const node = nodeAt(selectedPath);
  if (numericProperties.has(e.target.name)) {
    const numericValue = Number(e.target.value);
    if (!Number.isFinite(numericValue)) return;
    node[e.target.name] = numericValue;
    $$(`#inspector [name="${e.target.name}"]`).forEach(field => {
      if (field !== e.target) field.value = `${numericValue}`;
    });
  } else {
    node[e.target.name] = e.target.value;
  }
  renderFocusedCanvas();
  $("#codeInput").value = `~${JSON.stringify(exportTree(state.tree), null, 2)}`;
  save();
});
$("#inspector").addEventListener("change", e => {
  if (!numericProperties.has(e.target.name)) return;
  const node = nodeAt(selectedPath);
  const fallback = Number(node[e.target.name] ?? (e.target.name === "gap" ? 0.5 : 0));
  const minimum = Number(e.target.min);
  const maximum = Number(e.target.max);
  let value = Number(e.target.value);
  if (!Number.isFinite(value)) value = fallback;
  if (Number.isFinite(minimum)) value = Math.max(minimum, value);
  if (Number.isFinite(maximum)) value = Math.min(maximum, value);
  node[e.target.name] = value;
  $$(`#inspector [name="${e.target.name}"]`).forEach(field => { field.value = `${value}`; });
  renderFocusedCanvas();
  $("#codeInput").value = `~${JSON.stringify(exportTree(state.tree), null, 2)}`;
  save();
});
$("#enterButton").addEventListener("click", () => {
  if (!selectedPath || !isContainer(nodeAt(selectedPath))) return;
  const node = nodeAt(selectedPath);
  node.children ||= [];
  focusPath = [...selectedPath];
  selectedPath = null;
  renderAll();
  showToast(`${label(node)} alt içeriği açıldı`);
});
$("#moveUpButton").addEventListener("click", () => moveSelected(-1));
$("#moveDownButton").addEventListener("click", () => moveSelected(1));
$("#duplicateButton").addEventListener("click", () => {
  const parent = parentAt(selectedPath || []); if (!parent) return;
  parent.node.children.splice(parent.index + 1, 0, clone(nodeAt(selectedPath)));
  selectedPath[selectedPath.length - 1]++; renderAll(); showToast("Bileşen çoğaltıldı");
});
$("#deleteButton").addEventListener("click", () => {
  const parent = parentAt(selectedPath || []); if (!parent) return;
  const deletedPath = pathKey(selectedPath);
  parent.node.children.splice(parent.index, 1);
  if (pathKey(focusPath).startsWith(deletedPath)) focusPath = [];
  selectedPath = null; renderAll(); showToast("Bileşen silindi");
});
$$("[data-tab]").forEach(button => button.addEventListener("click", () => {
  $$("[data-tab]").forEach(b => b.classList.toggle("active", b === button));
  $("#propertiesTab").hidden = button.dataset.tab !== "properties";
  $("#codeTab").hidden = button.dataset.tab !== "code";
}));
$("#markdownInput").addEventListener("input", e => { state.markdown = e.target.value; renderAll(); });
$("#accentInput").addEventListener("input", e => { state.accent = e.target.value; renderAll(); });
$$("[data-theme]").forEach(b => b.addEventListener("click", () => { state.theme = b.dataset.theme; renderAll(); }));
$$("[data-width]").forEach(b => b.addEventListener("click", () => {
  $$("[data-width]").forEach(x => x.classList.toggle("active", x === b));
  $("#previewDevice").classList.toggle("mobile", b.dataset.width === "mobile");
}));
$("#codeInput").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(parseCode, 250); });
$("#copyButton").addEventListener("click", async () => { await navigator.clipboard.writeText(`${state.markdown}\n\n${$("#codeInput").value}`); showToast("Markdown + JTML kopyalandı"); });
$("#downloadButton").addEventListener("click", () => {
  const blob = new Blob([`${state.markdown}\n\n${$("#codeInput").value}\n`], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "topluyo-arayuz.jtml"; a.click(); URL.revokeObjectURL(a.href); showToast("JTML indirildi");
});
$("#resetButton").addEventListener("click", () => {
  if (!confirm("Tasarım başlangıç haline döndürülsün mü?")) return;
  state = clone(defaults); selectedPath = null; focusPath = []; renderAll(); showToast("Tasarım sıfırlandı");
});
$("#presetButton").addEventListener("click", () => {
  if (!confirm("Mevcut tasarım Yardım Merkezi şablonuyla değiştirilsin mi?")) return;
  state.markdown = "";
  state.accent = "#7c5cff";
  state.theme = "dark";
  state.tree = populateCommandExamples(helpCenterPreset());
  selectedPath = null;
  focusPath = [];
  renderAll();
  showToast("Yardım Merkezi şablonu yüklendi");
});

renderAll();
