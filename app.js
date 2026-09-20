/* CarbuVision — app.js compatible avec previsions-par-station.csv
   La source ne contient pas de latitude/longitude : liste, recherche, tri et
   prévisions fonctionnent ; la carte exacte exige une seconde source géolocalisée. */
const FUELS = ['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc'];
const DEFAULT_SOURCE_URL = 'https://www.data.gouv.fr/api/1/datasets/r/2a2c176e-bf01-42fe-9665-be2ade16cd6c';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = {
  stations: [], selectedFuel: '', sort: 'price',
  favorites: new Set(JSON.parse(localStorage.getItem('cv.favorites') || '[]')),
  filters: { maxPrice: '', drop: false, confidence: '', service: '', radius: 30 }
};
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const money = value => Number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(window.cvToast); window.cvToast = setTimeout(() => el.classList.remove('visible'), 2600); }
function fuelName(value) { const v = normalize(value); if (v === 'gazole' || v === 'diesel') return 'Gazole'; if (v === 'sp95') return 'SP95'; if (v === 'sp98') return 'SP98'; if (v === 'e10' || v === 'sp95e10') return 'E10'; if (v === 'e85') return 'E85'; if (v === 'gplc' || v === 'gpl') return 'GPLc'; return null; }
function number(value) { const result = Number(String(value ?? '').trim().replace(',', '.')); return Number.isFinite(result) ? result : null; }
function forecastChange(station) { return station.forecast === null ? null : (station.forecast - station.current) / station.current * 100; }
function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i++; if (row.length || cell) { row.push(cell); rows.push(row); row = []; cell = ''; } }
    else cell += char;
  }
  if (row.length || cell) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() || []).map(normalize);
  return rows.filter(r => r.length >= 7).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}
function rowsFromJSON(object) { const rows = Array.isArray(object) ? object : (object.data || object.records || object.results); if (!Array.isArray(rows)) throw new Error('Format JSON non reconnu.'); return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [normalize(k), v]))); }
function makeStations(rows) {
  const output = rows.map((row, index) => {
    const fuel = fuelName(row.typecarburant || row.carburant || row.fuel);
    const current = number(row.prixactuel ?? row.prix ?? row.currentprice);
    const j1 = number(row.prixpreditj1 ?? row.prixprevisionj1 ?? row.forecastj1);
    const j3 = number(row.prixpreditj3 ?? row.prixprevisionj3 ?? row.forecastj3);
    if (!fuel || current === null) return null;
    const id = String(row.idstation || row.id || index);
    return {
      id: `${id}-${fuel}`, stationId: id, fuel, current,
      forecast: j3 ?? j1, forecastJ1: j1, forecastJ3: j3,
      brand: String(row.marque || row.enseigne || row.brand || 'Station-service'),
      city: String(row.ville || row.commune || row.city || ''),
      postal: String(row.codepostal || row.code_postal || row.cp || ''),
      sourceRow: index + 2
    };
  }).filter(Boolean);
  return [...new Map(output.map(s => [s.id, s])).values()];
}
function setData(rows, label) {
  const stations = makeStations(rows);
  if (!stations.length) throw new Error('Aucune ligne reconnue. Le fichier attendu doit contenir id_station, marque, ville, code_postal, type_carburant et prix_actuel.');
  state.stations = stations;
  localStorage.setItem('cv.cache', JSON.stringify(stations)); localStorage.setItem('cv.cachedAt', new Date().toISOString());
  $('#dataNotice').innerHTML = `<strong>${stations.length.toLocaleString('fr-FR')} prix importés.</strong> ${escapeHTML(label)} · Cette source ne contient pas les coordonnées GPS exactes des stations.`;
  $('#loadStatus').textContent = `Import réussi : ${stations.length.toLocaleString('fr-FR')} prix station/carburant reconnus.`;
  renderAll(); toast('Prévisions importées');
}
function loadText(text, label) { const content = text.trim(); const rows = content.startsWith('{') || content.startsWith('[') ? rowsFromJSON(JSON.parse(content)) : parseCSV(text); setData(rows, label); }
async function loadURL() {
  const url = $('#sourceUrl').value.trim() || DEFAULT_SOURCE_URL;
  $('#loadStatus').textContent = 'Téléchargement en cours…';
  try { const response = await fetch(url); if (!response.ok) throw new Error(`réponse HTTP ${response.status}`); loadText(await response.text(), url); localStorage.setItem('cv.sourceUrl', url); }
  catch (error) { $('#loadStatus').textContent = `L’URL n’est pas accessible depuis le navigateur (${error.message}). Téléchargez le CSV et importez-le avec le bouton ci-dessous.`; }
}
function activeResults() {
  const query = normalize($('#searchInput').value); const max = number(state.filters.maxPrice);
  return state.stations.filter(s => {
    const delta = forecastChange(s); const haystack = normalize(`${s.brand} ${s.city} ${s.postal} ${s.fuel}`);
    return (!state.selectedFuel || s.fuel === state.selectedFuel) && (!query || haystack.includes(query)) &&
      (max === null || s.current <= max) && (!state.filters.drop || (delta !== null && delta < 0));
  }).sort((a, b) => state.sort === 'forecast' ? (a.forecast ?? Infinity) - (b.forecast ?? Infinity) : state.sort === 'variation' ? (forecastChange(a) ?? Infinity) - (forecastChange(b) ?? Infinity) : a.current - b.current);
}
function card(s) {
  const delta = forecastChange(s), fav = state.favorites.has(s.id);
  return `<article class="station-card" tabindex="0" data-station="${encodeURIComponent(s.id)}"><div class="station-head"><div><div class="station-title">${escapeHTML(s.brand)}</div><div class="station-address">${escapeHTML([s.postal, s.city].filter(Boolean).join(' '))}</div></div><button class="fav-button ${fav ? 'saved' : ''}" data-favorite="${encodeURIComponent(s.id)}">${fav ? '♥' : '♡'}</button></div><div class="station-values"><span class="badge">${s.fuel}</span><span class="price">${money(s.current)} €/L</span></div><div class="meta">${s.forecastJ1 !== null ? `<span>J+1 : ${money(s.forecastJ1)} €/L</span>` : ''}${s.forecastJ3 !== null ? `<span>J+3 : ${money(s.forecastJ3)} €/L</span>` : ''}${delta !== null ? `<span class="change ${delta < 0 ? 'down' : 'up'}">${delta >= 0 ? '+' : ''}${delta.toFixed(2)} % à J+3</span>` : ''}</div></article>`;
}
function renderExplore() {
  const list = activeResults(); $('#summary').textContent = `${list.length.toLocaleString('fr-FR')} résultat(s) · prix et prévisions par station`;
  $('#stationList').innerHTML = list.length ? list.map(card).join('') : '<div class="panel-card"><strong>Aucun résultat.</strong><p>Modifiez la recherche ou les filtres.</p></div>';
  const cheapest = list[0], falling = list.filter(s => (forecastChange(s) ?? 0) < -0.5).sort((a, b) => forecastChange(a) - forecastChange(b))[0];
  $('#insights').innerHTML = `${cheapest ? `<div class="insight"><strong>Meilleur prix affiché</strong>${escapeHTML(cheapest.brand)} · ${escapeHTML(cheapest.city)} — ${money(cheapest.current)} €/L (${cheapest.fuel})</div>` : ''}${falling ? `<div class="insight warn"><strong>Baisse prévue à J+3</strong>${escapeHTML(falling.brand)} · ${escapeHTML(falling.city)} : ${Math.abs(forecastChange(falling)).toFixed(2)} %.</div>` : ''}`;
}
function renderFavorites() { const list = state.stations.filter(s => state.favorites.has(s.id)); $('#favoriteList').innerHTML = list.length ? list.map(card).join('') : '<div class="panel-card"><strong>Aucun favori.</strong><p>Utilisez le cœur sur une station pour la conserver ici.</p></div>'; }
function renderChips() { $('#fuelChips').innerHTML = `<button class="chip ${!state.selectedFuel ? 'active' : ''}" data-fuel="">Tous</button>` + FUELS.map(f => `<button class="chip ${state.selectedFuel === f ? 'active' : ''}" data-fuel="${f}">${f}</button>`).join(''); }
function renderMap() { $('#mapCount').textContent = 'Coordonnées GPS absentes'; $('#map').innerHTML = '<div class="panel-card" style="margin:16px"><strong>Carte indisponible avec cette source seule.</strong><p>Le fichier <code>previsions-par-station.csv</code> contient l’identifiant station, la marque, la ville, le code postal, le carburant et les prévisions, mais pas les latitude/longitude. La liste, la recherche et les prévisions restent disponibles. Une carte exacte nécessite de fusionner le flux officiel géolocalisé sur <code>id_station</code>.</p></div>'; }
function renderQuality() { const updated = localStorage.getItem('cv.cachedAt'); const withJ3 = state.stations.filter(s => s.forecastJ3 !== null).length; $('#dataQuality').innerHTML = `<div class="metric"><span>Prix importés</span><strong>${state.stations.length}</strong></div><div class="metric"><span>Prévision J+3</span><strong>${withJ3}</strong></div><div class="metric"><span>Coordonnées GPS</span><strong>Non fournies</strong></div><div class="metric"><span>Dernier import</span><strong>${updated ? new Date(updated).toLocaleString('fr-FR') : '—'}</strong></div>`; }
function renderEconomics() { const volume = number($('#calcVolume').value) || 0, local = number($('#calcLocalPrice').value) || 0, target = number($('#calcTargetPrice').value) || 0, consumption = number($('#calcConsumption').value) || 0, detour = number($('#calcDetour').value) || 0; const pump = Math.max(0, local - target) * volume, cost = consumption / 100 * detour * local, net = pump - cost, limit = consumption && local ? pump / (consumption / 100 * local) : 0; $('#economics').innerHTML = `<div class="metric"><span>Gain à la pompe</span><strong>${pump.toFixed(2)} €</strong></div><div class="metric"><span>Coût du détour</span><strong>${cost.toFixed(2)} €</strong></div><div class="metric"><span>Bilan net</span><strong class="${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${net.toFixed(2)} €</strong></div><div class="metric"><span>Détour maximal rentable</span><strong>${limit.toFixed(1)} km</strong></div>`; }
function renderAll() { renderChips(); renderExplore(); renderFavorites(); renderMap(); renderQuality(); renderEconomics(); }
function toggleFavorite(id) { state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); localStorage.setItem('cv.favorites', JSON.stringify([...state.favorites])); renderAll(); }
function openStation(encoded) { const s = state.stations.find(x => x.id === decodeURIComponent(encoded)); if (!s) return; $('#stationTitle').textContent = s.brand; const delta = forecastChange(s), query = encodeURIComponent(`${s.brand} ${s.postal} ${s.city}`); $('#stationDetail').innerHTML = `<p class="station-address">${escapeHTML([s.postal, s.city].filter(Boolean).join(' '))}</p><div class="detail-grid"><div><span>Carburant</span><strong>${s.fuel}</strong></div><div><span>Prix actuel</span><strong>${money(s.current)} €/L</strong></div><div><span>Prévision J+1</span><strong>${s.forecastJ1 === null ? '—' : money(s.forecastJ1) + ' €/L'}</strong></div><div><span>Prévision J+3</span><strong>${s.forecastJ3 === null ? '—' : money(s.forecastJ3) + ' €/L'}</strong></div>${delta === null ? '' : `<div><span>Variation J+3</span><strong class="${delta < 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : ''}${delta.toFixed(2)} %</strong></div>`}</div><div class="detail-actions"><a class="route" href="https://maps.apple.com/?q=${query}" target="_blank" rel="noopener">Rechercher dans Apple Plans</a><a href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" rel="noopener">Rechercher dans Google Maps</a><button id="detailFavorite">${state.favorites.has(s.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}</button></div>`; $('#stationDialog').showModal(); $('#detailFavorite').onclick = () => { toggleFavorite(s.id); openStation(encoded); }; }
function switchTab(tab) { $$('.tab-panel').forEach(el => el.classList.toggle('active', el.id === `tab-${tab}`)); $$('.bottom-nav button').forEach(el => el.classList.toggle('active', el.dataset.tab === tab)); }
function bind() {
  const options = '<option value="">Tous les carburants</option>' + FUELS.map(f => `<option>${f}</option>`).join(''); $('#filterFuel').innerHTML = options; $('#calcFuel').innerHTML = FUELS.map(f => `<option>${f}</option>`).join(''); $('#vehicleFuel').innerHTML = FUELS.map(f => `<option>${f}</option>`).join('');
  $('#sourceUrl').value = localStorage.getItem('cv.sourceUrl') || DEFAULT_SOURCE_URL; const cache = JSON.parse(localStorage.getItem('cv.cache') || '[]'); if (cache.length) { state.stations = cache; renderAll(); }
  $$('.bottom-nav button').forEach(button => button.onclick = () => switchTab(button.dataset.tab)); $$('[data-open-tab]').forEach(button => button.onclick = () => switchTab(button.dataset.openTab));
  $('#locationButton').onclick = () => toast('Cette source ne fournit pas les coordonnées GPS : recherchez une ville ou fusionnez un flux géolocalisé.'); $('#themeButton').onclick = () => document.body.classList.toggle('dark');
  $('#loadUrlButton').onclick = loadURL; $('#refreshButton').onclick = loadURL; $('#fileInput').onchange = event => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { loadText(reader.result, file.name); } catch (error) { $('#loadStatus').textContent = error.message; } }; reader.readAsText(file); };
  $('#searchInput').oninput = renderAll; $('#sortSelect').onchange = event => { state.sort = event.target.value; renderAll(); }; $('#fuelChips').onclick = event => { const button = event.target.closest('[data-fuel]'); if (button) { state.selectedFuel = button.dataset.fuel; renderAll(); } };
  $('#filterButton').onclick = () => $('#filterDialog').showModal(); $('#filterRadius').oninput = event => $('#radiusOutput').textContent = event.target.value; $('#filterDialog').addEventListener('close', () => { state.selectedFuel = $('#filterFuel').value; state.filters = { maxPrice: $('#filterMaxPrice').value, drop: $('#filterDrop').checked, confidence: '', service: '', radius: Number($('#filterRadius').value) }; renderAll(); }); $('#resetFiltersButton').onclick = () => { $('#filterFuel').value = ''; $('#filterMaxPrice').value = ''; $('#filterDrop').checked = false; state.selectedFuel = ''; state.filters = { maxPrice: '', drop: false, confidence: '', service: '', radius: 30 }; };
  const stationClick = event => { const favorite = event.target.closest('[data-favorite]'); if (favorite) return toggleFavorite(decodeURIComponent(favorite.dataset.favorite)); const station = event.target.closest('[data-station]'); if (station) openStation(station.dataset.station); }; $('#stationList').onclick = stationClick; $('#favoriteList').onclick = stationClick; $('#closeStationButton').onclick = () => $('#stationDialog').close(); $('#fitMapButton').onclick = () => toast('La source ne contient aucune coordonnée à cadrer.');
  ['calcVolume','calcLocalPrice','calcTargetPrice','calcConsumption','calcDetour'].forEach(id => $('#'+id).oninput = renderEconomics); $('#useCheapestButton').onclick = () => { const best = state.stations.filter(s => s.fuel === $('#calcFuel').value).sort((a,b) => a.current-b.current)[0]; if (!best) return toast('Aucun prix pour ce carburant.'); $('#calcTargetPrice').value = best.current; renderEconomics(); toast(`Prix de ${best.brand} appliqué.`); };
  $('#saveVehicleButton').onclick = () => { localStorage.setItem('cv.vehicle', JSON.stringify({ name: $('#vehicleName').value, fuel: $('#vehicleFuel').value, tank: $('#tankCapacity').value })); toast('Profil enregistré'); }; $('#exportButton').onclick = () => { const blob = new Blob([JSON.stringify({ favorites: [...state.favorites], source: $('#sourceUrl').value }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'carbuvision-reglages.json'; link.click(); }; $('#clearDataButton').onclick = () => { if (confirm('Effacer les données, le cache et les favoris ?')) { Object.keys(localStorage).filter(k => k.startsWith('cv.')).forEach(k => localStorage.removeItem(k)); location.reload(); } };
  renderAll();
}
document.addEventListener('DOMContentLoaded', bind);
