/* CarbuVision — app.js final
   Import automatique avec repli manuel, fusion prévisions + flux officiel,
   stockage IndexedDB (adapté aux gros CSV). */
const FUELS = ['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc'];
const AUTO_SOURCES = [
  { name: 'Prévisions par station', url: 'https://www.data.gouv.fr/api/1/datasets/r/2a2c176e-bf01-42fe-9665-be2ade16cd6c' },
  { name: 'Flux officiel instantané', url: 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/csv?lang=fr&timezone=Europe%2FParis&use_labels=true&delimiter=%3B' }
];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const norm = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const n = v => { const x = Number(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(x) ? x : null; };
const euros = v => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const id8 = v => String(v ?? '').replace(/\.0$/, '').padStart(8, '0');
const DB_NAME = 'carbuvision-final-v1';
const STORE = 'data';
const state = {
  records: [], position: null, map: null, markers: null,
  fuel: '', sort: 'price', filters: { max: '', radius: 30, drop: false },
  favorites: new Set(JSON.parse(localStorage.getItem('cv.favorites') || '[]'))
};

function fuelName(v) {
  const x = norm(v);
  if (x === 'gazole' || x === 'diesel') return 'Gazole';
  if (x === 'sp95') return 'SP95';
  if (x === 'sp98') return 'SP98';
  if (x === 'e10' || x === 'sp95e10') return 'E10';
  if (x === 'e85') return 'E85';
  if (x === 'gplc' || x === 'gpl') return 'GPLc';
  return null;
}
function toast(message) {
  const box = $('#toast'); box.textContent = message; box.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => box.classList.remove('visible'), 3000);
}
function setStatus(message) { $('#loadStatus').textContent = message; }

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbSet(key, value) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
async function dbGet(key) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

function parseCSV(text) {
  const sample = text.slice(0, 5000);
  const separator = (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === separator && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (row.length || field) { row.push(field); rows.push(row); row = []; field = ''; }
    } else field += c;
  }
  if (row.length || field) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map(norm);
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function parseForecast(rows) {
  return rows.map(row => {
    const fuel = fuelName(row.typecarburant || row.carburant);
    const current = n(row.prixactuel);
    if (!fuel || current === null) return null;
    return { id: id8(row.idstation || row.id), fuel, brand: row.marque || '', city: row.ville || '', postal: String(row.codepostal || ''), predictedCurrent: current, j1: n(row.prixpreditj1), j3: n(row.prixpreditj3) };
  }).filter(Boolean);
}
function parseLive(rows) {
  return rows.map(row => {
    const prices = {};
    FUELS.forEach(fuel => { const price = n(row[norm(`Prix ${fuel}`)]); if (price !== null) prices[fuel] = price; });
    const latitude = n(row.latitude), longitude = n(row.longitude);
    return {
      id: id8(row.id), lat: latitude === null ? null : latitude / 100000, lng: longitude === null ? null : longitude / 100000,
      address: row.adresse || '', city: row.ville || '', postal: String(row.codepostal || ''),
      services: row.servicesproposes || row.services || '', hours: row.horairesdetails || row.horaires || '',
      automatic: row.automate2424ouinon || '', unavailable: row.carburantsindisponibles || '', temporary: row.carburantsenrupturetemporaire || '', prices
    };
  }).filter(x => x.id !== '00000000');
}

async function importRows(rows, sourceName) {
  const headers = Object.keys(rows[0] || {});
  if (headers.includes('typecarburant') && headers.includes('prixactuel')) {
    const data = parseForecast(rows); if (!data.length) throw Error('Aucune prévision exploitable.');
    await dbSet('forecast', { data, at: new Date().toISOString(), sourceName });
    return `Prévisions : ${data.length.toLocaleString('fr-FR')} lignes`;
  }
  const isOfficialFuelFeed =   headers.includes('latitude') &&   headers.includes('longitude') &&   (headers.includes('id') || headers.includes('idstation'));  if (isOfficialFuelFeed) {
    const data = parseLive(rows); if (!data.length) throw Error('Aucune station officielle exploitable.');
    await dbSet('live', { data, at: new Date().toISOString(), sourceName });
    return `Flux officiel : ${data.length.toLocaleString('fr-FR')} stations`;
  }
  throw Error('Fichier non reconnu. Choisissez previsions-par-station.csv ou prix-des-carburants-en-france-flux-instantane-v2.csv.');
}
async function importFile(file) {
  setStatus(`Lecture de ${file.name}…`);
  try {
    const result = await importRows(parseCSV(await file.text()), file.name);
    await merge(); setStatus(`${result}. Fusion terminée.`); toast('Import manuel terminé');
  } catch (error) { setStatus(`Échec de l’analyse : ${error.message}`); }
}
async function fetchCSV(source) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(source.url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw Error(`réponse HTTP ${response.status}`);
    return await importRows(parseCSV(await response.text()), source.name);
  } finally { clearTimeout(timer); }
}
async function autoImport() {
  const completed = [], failed = [];
  for (const source of AUTO_SOURCES) {
    try { setStatus(`Téléchargement : ${source.name}…`); completed.push(await fetchCSV(source)); }
    catch (error) { failed.push(`${source.name} (${error.message})`); }
  }
  await merge();
  if (completed.length === 2) { setStatus(`Actualisation automatique réussie. ${completed.join(' · ')}.`); toast('Données actualisées'); }
  else if (completed.length) { setStatus(`Mise à jour partielle : ${completed.join(' · ')}. Import manuel requis : ${failed.join(' · ')}`); toast('Import manuel requis pour une source'); }
  else { setStatus(`Téléchargement automatique indisponible. Importez les deux CSV manuellement. Détail : ${failed.join(' · ')}`); toast('Utilisez l’import manuel'); }
}

async function merge() {
  const forecast = await dbGet('forecast'); const live = await dbGet('live');
  const byId = new Map((live?.data || []).map(station => [station.id, station]));
  state.records = (forecast?.data || []).map(prediction => {
    const station = byId.get(prediction.id); const official = station?.prices[prediction.fuel] ?? null;
    return { ...prediction, current: official ?? prediction.predictedCurrent, official, lat: station?.lat ?? null, lng: station?.lng ?? null, address: station?.address ?? '', services: station?.services ?? '', hours: station?.hours ?? '', automatic: station?.automatic ?? '', unavailable: station?.unavailable ?? '', temporary: station?.temporary ?? '', geo: !!(station && station.lat !== null && station.lng !== null) };
  });
  await dbSet('meta', { count: state.records.length, forecastAt: forecast?.at || null, liveAt: live?.at || null, mergedAt: new Date().toISOString() });
  renderAll();
}
function km(station) {
  if (!state.position || !station.geo) return null;
  const rad = Math.PI / 180, R = 6371;
  const a = Math.sin((station.lat - state.position.lat) * rad / 2) ** 2 + Math.cos(state.position.lat * rad) * Math.cos(station.lat * rad) * Math.sin((station.lng - state.position.lng) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function variation(station) { return station.j3 === null ? null : (station.j3 - station.current) / station.current * 100; }
function results() {
  const search = norm($('#searchInput').value), maximum = n(state.filters.max);
  return state.records.filter(s => {
    const distance = km(s), change = variation(s), text = norm(`${s.brand} ${s.address} ${s.city} ${s.postal} ${s.services}`);
    return (!state.fuel || s.fuel === state.fuel) && (!search || text.includes(search)) && (maximum === null || s.current <= maximum) && (!state.position || distance === null || distance <= state.filters.radius) && (!state.filters.drop || (change !== null && change < 0));
  }).sort((a, b) => {
    if (state.sort === 'distance') return (km(a) ?? Infinity) - (km(b) ?? Infinity);
    if (state.sort === 'forecast') return (a.j3 ?? Infinity) - (b.j3 ?? Infinity);
    if (state.sort === 'variation') return (variation(a) ?? Infinity) - (variation(b) ?? Infinity);
    return a.current - b.current;
  });
}
function stationCard(s) {
  const distance = km(s), change = variation(s), key = `${s.id}-${s.fuel}`, favorite = state.favorites.has(key);
  return `<article class="station-card" tabindex="0" data-station="${encodeURIComponent(`${s.id}|${s.fuel}`)}"><div class="station-head"><div><div class="station-title">${esc(s.brand || 'Station-service')}</div><div class="station-address">${esc([s.address, s.postal, s.city].filter(Boolean).join(', '))}</div></div><button class="fav-button ${favorite ? 'saved' : ''}" data-favorite="${encodeURIComponent(key)}">${favorite ? '♥' : '♡'}</button></div><div class="station-values"><span class="badge">${s.fuel}</span><span class="price">${euros(s.current)} €/L</span>${s.official !== null ? '<span class="badge">officiel</span>' : ''}</div><div class="meta">${distance !== null ? `<span>${distance.toFixed(1)} km</span>` : ''}${s.j1 !== null ? `<span>J+1 : ${euros(s.j1)} €/L</span>` : ''}${s.j3 !== null ? `<span>J+3 : ${euros(s.j3)} €/L</span>` : ''}${change !== null ? `<span class="change ${change < 0 ? 'down' : 'up'}">${change >= 0 ? '+' : ''}${change.toFixed(2)} %</span>` : ''}${s.temporary ? '<span class="badge">rupture signalée</span>' : ''}</div></article>`;
}
function renderExplore() {
  const list = results(); $('#summary').textContent = `${list.length.toLocaleString('fr-FR')} résultat(s)${state.position ? ` · rayon ${state.filters.radius} km` : ''}`;
  $('#stationList').innerHTML = list.length ? list.map(stationCard).join('') : '<div class="panel-card"><strong>Aucun résultat.</strong><p>Importez les deux CSV ou modifiez les filtres.</p></div>';
  const best = list[0], falling = list.filter(s => (variation(s) ?? 0) < -0.5).sort((a, b) => variation(a) - variation(b))[0];
  $('#insights').innerHTML = `${best ? `<div class="insight"><strong>Meilleur prix actuel</strong>${esc(best.brand)} · ${esc(best.city)} — ${euros(best.current)} €/L (${best.fuel})</div>` : ''}${falling ? `<div class="insight warn"><strong>Baisse prévue à J+3</strong>${esc(falling.brand)} : ${Math.abs(variation(falling)).toFixed(2)} % anticipés.</div>` : ''}`;
}
function renderChips() { $('#fuelChips').innerHTML = `<button class="chip ${!state.fuel ? 'active' : ''}" data-fuel="">Tous</button>` + FUELS.map(f => `<button class="chip ${state.fuel === f ? 'active' : ''}" data-fuel="${f}">${f}</button>`).join(''); }
function renderFavorites() { const list = state.records.filter(s => state.favorites.has(`${s.id}-${s.fuel}`)); $('#favoriteList').innerHTML = list.length ? list.map(stationCard).join('') : '<div class="panel-card"><strong>Aucun favori.</strong><p>Utilisez le cœur sur une station pour la conserver.</p></div>'; }
function initMap() { if (!window.L) return; state.map = L.map('map').setView([46.7, 2.5], 5.4); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(state.map); state.markers = L.layerGroup().addTo(state.map); }
function renderMap() {
  if (!state.map) return; state.markers.clearLayers(); const list = results().filter(s => s.geo);
  list.forEach(s => { const change = variation(s); L.circleMarker([s.lat, s.lng], { radius: 7, color: change !== null && change < 0 ? '#087443' : '#1769aa', fillOpacity: .9 }).bindPopup(`<b>${esc(s.brand)}</b><br>${esc(s.city)}<br>${s.fuel} : ${euros(s.current)} €/L<br><button onclick="CarbuVision.open('${encodeURIComponent(`${s.id}|${s.fuel}`)}')">Détails</button>`).addTo(state.markers); });
  $('#mapCount').textContent = `${list.length} station${list.length > 1 ? 's' : ''} cartographiée${list.length > 1 ? 's' : ''}`;
}
async function renderQuality() { const meta = await dbGet('meta'); $('#dataQuality').innerHTML = `<div class="metric"><span>Prix fusionnés</span><strong>${meta?.count || 0}</strong></div><div class="metric"><span>Prévisions</span><strong>${meta?.forecastAt ? new Date(meta.forecastAt).toLocaleString('fr-FR') : 'Non importées'}</strong></div><div class="metric"><span>Flux officiel</span><strong>${meta?.liveAt ? new Date(meta.liveAt).toLocaleString('fr-FR') : 'Non importé'}</strong></div><div class="metric"><span>Stockage</span><strong>IndexedDB</strong></div>`; }
function economics() { const volume = n($('#calcVolume').value) || 0, local = n($('#calcLocalPrice').value) || 0, target = n($('#calcTargetPrice').value) || 0, consumption = n($('#calcConsumption').value) || 0, detour = n($('#calcDetour').value) || 0; const pump = Math.max(0, local - target) * volume, cost = consumption / 100 * detour * local, net = pump - cost, limit = consumption && local ? pump / (consumption / 100 * local) : 0; $('#economics').innerHTML = `<div class="metric"><span>Gain à la pompe</span><strong>${pump.toFixed(2)} €</strong></div><div class="metric"><span>Coût du détour</span><strong>${cost.toFixed(2)} €</strong></div><div class="metric"><span>Bilan net</span><strong class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${net.toFixed(2)} €</strong></div><div class="metric"><span>Détour maximal rentable</span><strong>${limit.toFixed(1)} km</strong></div>`; }
function toggleFavorite(key) { state.favorites.has(key) ? state.favorites.delete(key) : state.favorites.add(key); localStorage.setItem('cv.favorites', JSON.stringify([...state.favorites])); renderAll(); }
function openStation(encoded) {
  const [id, fuel] = decodeURIComponent(encoded).split('|'); const s = state.records.find(x => x.id === id && x.fuel === fuel); if (!s) return;
  const change = variation(s), key = `${s.id}-${s.fuel}`;
  $('#stationTitle').textContent = s.brand;
  $('#stationDetail').innerHTML = `<p class="station-address">${esc([s.address, s.postal, s.city].filter(Boolean).join(', '))}</p><div class="detail-grid"><div><span>Prix actuel</span><strong>${euros(s.current)} €/L</strong></div><div><span>Source prix</span><strong>${s.official !== null ? 'Flux officiel' : 'Prévision'}</strong></div><div><span>Prévision J+1</span><strong>${s.j1 === null ? '—' : euros(s.j1) + ' €/L'}</strong></div><div><span>Prévision J+3</span><strong>${s.j3 === null ? '—' : euros(s.j3) + ' €/L'}</strong></div>${change === null ? '' : `<div><span>Variation J+3</span><strong class="${change < 0 ? 'positive' : 'negative'}">${change >= 0 ? '+' : ''}${change.toFixed(2)} %</strong></div>`}${s.automatic ? `<div><span>Automate 24/24</span><strong>${esc(s.automatic)}</strong></div>` : ''}</div>${s.services ? `<p><strong>Services :</strong> ${esc(s.services)}</p>` : ''}${s.temporary || s.unavailable ? `<p><strong>Disponibilité :</strong> ${esc(s.temporary || s.unavailable)}</p>` : ''}<div class="detail-actions"><a class="route" href="https://maps.apple.com/?daddr=${s.lat},${s.lng}&dirflg=d" target="_blank" rel="noopener">Itinéraire Apple Plans</a><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Itinéraire Google Maps</a><button id="detailFavorite">${state.favorites.has(key) ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button></div>`;
  $('#stationDialog').showModal(); $('#detailFavorite').onclick = () => { toggleFavorite(key); openStation(encoded); };
}
function renderAll() { renderChips(); renderExplore(); renderFavorites(); renderMap(); renderQuality(); economics(); }
function fitMap() { const list = results().filter(s => s.geo); if (!list.length) return toast('Aucune station à afficher.'); state.map.fitBounds(L.latLngBounds(list.map(s => [s.lat, s.lng])), { padding: [25, 25], maxZoom: 13 }); }

async function start() {
  $('#filterFuel').innerHTML = '<option value="">Tous les carburants</option>' + FUELS.map(f => `<option>${f}</option>`).join('');
  $('#calcFuel').innerHTML = FUELS.map(f => `<option>${f}</option>`).join(''); $('#vehicleFuel').innerHTML = FUELS.map(f => `<option>${f}</option>`).join('');
  initMap(); await merge();
  $$('.bottom-nav button').forEach(button => button.onclick = () => { const tab = button.dataset.tab; $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${tab}`)); $$('.bottom-nav button').forEach(item => item.classList.toggle('active', item === button)); if (tab === 'map') setTimeout(() => state.map?.invalidateSize(), 100); });
  $('#fileInput').onchange = event => { [...event.target.files].forEach(importFile); event.target.value = ''; };
  $('#loadUrlButton').onclick = autoImport; $('#refreshButton').onclick = autoImport;
  $('#searchInput').oninput = renderAll; $('#sortSelect').onchange = event => { state.sort = event.target.value; renderAll(); };
  $('#fuelChips').onclick = event => { const button = event.target.closest('[data-fuel]'); if (button) { state.fuel = button.dataset.fuel; renderAll(); } };
  $('#filterButton').onclick = () => $('#filterDialog').showModal(); $('#filterRadius').oninput = event => $('#radiusOutput').textContent = event.target.value;
  $('#filterDialog').addEventListener('close', () => { state.fuel = $('#filterFuel').value; state.filters = { max: $('#filterMaxPrice').value, radius: Number($('#filterRadius').value), drop: $('#filterDrop').checked }; renderAll(); });
  $('#resetFiltersButton').onclick = () => { state.fuel = ''; state.filters = { max: '', radius: 30, drop: false }; $('#filterFuel').value = ''; $('#filterMaxPrice').value = ''; $('#filterDrop').checked = false; };
  const stationClick = event => { const favorite = event.target.closest('[data-favorite]'); if (favorite) return toggleFavorite(decodeURIComponent(favorite.dataset.favorite)); const station = event.target.closest('[data-station]'); if (station) openStation(station.dataset.station); };
  $('#stationList').onclick = stationClick; $('#favoriteList').onclick = stationClick; $('#closeStationButton').onclick = () => $('#stationDialog').close(); $('#fitMapButton').onclick = fitMap;
  $('#locationButton').onclick = () => navigator.geolocation.getCurrentPosition(position => { state.position = { lat: position.coords.latitude, lng: position.coords.longitude }; state.map?.setView([state.position.lat, state.position.lng], 12); renderAll(); toast('Position mise à jour'); }, () => toast('Localisation refusée ou indisponible'), { enableHighAccuracy: false, timeout: 10000 });
  ['calcVolume', 'calcLocalPrice', 'calcTargetPrice', 'calcConsumption', 'calcDetour'].forEach(id => $('#'+id).oninput = economics);
  $('#useCheapestButton').onclick = () => { const best = state.records.filter(s => s.fuel === $('#calcFuel').value).sort((a,b) => a.current - b.current)[0]; if (!best) return toast('Aucun prix pour ce carburant.'); $('#calcTargetPrice').value = best.current; economics(); toast(`Prix de ${best.brand} appliqué.`); };
  $('#saveVehicleButton').onclick = () => { localStorage.setItem('cv.vehicle', JSON.stringify({ name: $('#vehicleName').value, fuel: $('#vehicleFuel').value, tank: $('#tankCapacity').value })); toast('Profil enregistré'); };
  $('#clearDataButton').onclick = () => { if (confirm('Effacer les deux sources, le cache et les favoris ?')) { indexedDB.deleteDatabase(DB_NAME); localStorage.clear(); location.reload(); } };
  $('#themeButton').onclick = () => document.body.classList.toggle('dark'); window.CarbuVision = { open: openStation }; renderAll();
}
document.addEventListener('DOMContentLoaded', start);
