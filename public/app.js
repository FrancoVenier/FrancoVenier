const BBOX = '-31.55,-64.32,-31.27,-64.03'; // Córdoba Capital
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const LABELS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Muy bueno', 'Excelente'];
const $ = (id) => document.getElementById(id);

const map = L.map('map').setView([-31.4201, -64.1888], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
let layer = L.layerGroup().addTo(map);

let routes = [], summary = {}, current = null, score = 0, photos = [];

const color = (id) => `hsl(${(Number(id) * 137) % 360} 65% 42%)`;
const stars = (avg) => (avg ? `${avg.toFixed(1)} / 6` : 'Sin puntuar');

async function overpass(query) {
  let err;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
      if (r.ok) return (await r.json()).elements;
      err = new Error('HTTP ' + r.status);
    } catch (e) { err = e; }
  }
  throw err;
}

async function loadRoutes() {
  const st = $('status');
  st.textContent = 'Cargando recorridos…';
  try {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem('routes-v1')); } catch {}
    if (cached && Date.now() - cached.t < 7 * 864e5) routes = cached.routes;
    else {
      const els = await overpass(`[out:json][timeout:60];relation["route"="bus"](${BBOX});out tags;`);
      routes = els.map((e) => ({
        id: String(e.id), ref: e.tags.ref || '', name: e.tags.name || '',
        operator: e.tags.operator || e.tags.network || '', from: e.tags.from || '', to: e.tags.to || '',
      })).sort((a, b) => a.ref.localeCompare(b.ref, 'es', { numeric: true }) || a.name.localeCompare(b.name));
      try { localStorage.setItem('routes-v1', JSON.stringify({ t: Date.now(), routes })); } catch {}
    }
    st.textContent = `${routes.length} recorridos`;
  } catch {
    st.innerHTML = 'No se pudieron cargar los recorridos. <button id="retry">Reintentar</button>';
    $('retry').onclick = loadRoutes;
  }
  await loadSummary();
  renderList();
}

async function loadSummary() {
  try {
    const list = await (await fetch('/api/summary')).json();
    summary = Object.fromEntries(list.map((s) => [s.routeId, s]));
  } catch {}
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const ul = $('routes');
  ul.replaceChildren();
  for (const r of routes) {
    if (q && !`${r.ref} ${r.name} ${r.operator}`.toLowerCase().includes(q)) continue;
    const li = document.createElement('li');
    li.className = current?.id === r.id ? 'active' : '';
    const chip = Object.assign(document.createElement('span'), { className: 'chip', textContent: r.ref || '?' });
    chip.style.background = color(r.id);
    const rn = document.createElement('div'); rn.className = 'rn';
    rn.append(r.name || r.ref, Object.assign(document.createElement('small'), { textContent: r.operator }));
    const badge = Object.assign(document.createElement('span'), { className: 'badge', textContent: summary[r.id] ? `★ ${summary[r.id].avg}` : '' });
    li.append(chip, rn, badge);
    li.onclick = () => selectRoute(r);
    ul.append(li);
  }
}

async function selectRoute(r) {
  current = r; renderList();
  $('detail').hidden = false;
  $('d-title').textContent = `${r.ref ? 'Línea ' + r.ref : ''} ${r.name}`.trim();
  $('d-sub').textContent = [r.operator, r.from && r.to ? `${r.from} → ${r.to}` : ''].filter(Boolean).join(' · ');
  setScore(0); photos = []; renderPreviews(); $('form').reset(); $('form-msg').textContent = '';
  loadReviews();
  layer.clearLayers();
  try {
    const els = await overpass(`[out:json][timeout:60];rel(${r.id});out geom;`);
    const members = els[0]?.members || [];
    const c = color(r.id), bounds = [];
    for (const m of members) {
      if (m.type === 'way' && m.geometry && !/^platform/.test(m.role)) {
        const pts = m.geometry.map((p) => [p.lat, p.lon]);
        L.polyline(pts, { color: c, weight: 5, opacity: 0.85 }).addTo(layer);
        bounds.push(...pts);
      } else if (m.type === 'node' && /^stop/.test(m.role) && m.lat != null) {
        L.circleMarker([m.lat, m.lon], { radius: 4, color: c, fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(layer);
      }
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
    else $('d-sub').textContent += ' · (sin trazado en el mapa)';
  } catch { $('d-sub').textContent = 'No se pudo cargar el trazado.'; }
}

async function loadReviews() {
  const id = current.id;
  const box = $('reviews');
  try {
    const d = await (await fetch('/api/ratings?route=' + id)).json();
    if (current.id !== id) return;
    $('d-avg').textContent = d.count ? `★ ${stars(d.avg)} · ${d.count} opinión${d.count > 1 ? 'es' : ''}` : 'Sin puntuaciones todavía';
    box.replaceChildren();
    for (const r of d.ratings) {
      const el = document.createElement('div'); el.className = 'review';
      const head = document.createElement('div');
      head.append(Object.assign(document.createElement('b'), { textContent: r.author }),
        `${r.score}/6 · ${LABELS[r.score]} `,
        Object.assign(document.createElement('span'), { className: 'muted', textContent: new Date(r.createdAt).toLocaleDateString('es-AR') }));
      el.append(head);
      if (r.comment) el.append(Object.assign(document.createElement('p'), { textContent: r.comment }));
      if (r.photos.length) {
        const imgs = document.createElement('div'); imgs.className = 'imgs';
        for (const p of r.photos) {
          const a = Object.assign(document.createElement('a'), { href: '/uploads/' + p, target: '_blank', rel: 'noopener' });
          a.append(Object.assign(document.createElement('img'), { src: '/uploads/' + p, loading: 'lazy', alt: 'Foto del colectivo' }));
          imgs.append(a);
        }
        el.append(imgs);
      }
      box.append(el);
    }
  } catch { box.textContent = 'No se pudieron cargar las opiniones.'; }
}

// --- escala de 6 puntos ---
const scale = $('scale');
for (let i = 1; i <= 6; i++) {
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: i });
  b.setAttribute('role', 'radio'); b.onclick = () => setScore(i);
  scale.append(b);
}
function setScore(n) {
  score = n;
  [...scale.children].forEach((b, i) => { b.classList.toggle('on', i + 1 <= n); b.setAttribute('aria-checked', i + 1 === n); });
  $('scale-label').textContent = n ? `${n}/6 · ${LABELS[n]}` : 'Elegí de 1 (muy malo) a 6 (excelente)';
}

// --- fotos: se reducen en el navegador antes de subir ---
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Imagen inválida'));
    img.src = url;
  });
}
function renderPreviews() {
  const box = $('previews'); box.replaceChildren();
  photos.forEach((p, i) => {
    const im = Object.assign(document.createElement('img'), { src: p, title: 'Clic para quitar' });
    im.onclick = () => { photos.splice(i, 1); renderPreviews(); };
    box.append(im);
  });
}
$('photos').onchange = async (e) => {
  for (const f of e.target.files) {
    if (photos.length >= 3) break;
    try { photos.push(await shrink(f)); } catch { $('form-msg').textContent = 'No se pudo leer una imagen.'; }
  }
  e.target.value = ''; renderPreviews();
};

$('form').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('form-msg');
  if (!score) { msg.textContent = 'Elegí una puntuación de 1 a 6.'; return; }
  $('submit').disabled = true; msg.textContent = 'Enviando…';
  try {
    const f = new FormData(e.target);
    const r = await fetch('/api/ratings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId: current.id, routeName: $('d-title').textContent, score, author: f.get('author'), comment: f.get('comment'), photos }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    msg.textContent = '¡Gracias por tu opinión!';
    setScore(0); photos = []; renderPreviews(); e.target.reset();
    await loadSummary(); renderList(); loadReviews();
  } catch (err) { msg.textContent = 'Error: ' + err.message; }
  $('submit').disabled = false;
};

$('close').onclick = () => { $('detail').hidden = true; current = null; layer.clearLayers(); renderList(); };
$('search').oninput = renderList;
setScore(0);
loadRoutes();
