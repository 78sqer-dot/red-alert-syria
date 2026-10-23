// Map module — MapLibre GL with OpenFreeMap vector tiles, Esri imagery and AWS terrain.
import { ALERT_TYPES, typeOf } from '/shared/types.js';
import { icon } from './icons.js';

const ml = () => window.maplibregl;
// Build popup DOM ourselves (content is already escaped) instead of Popup.setHTML,
// so MapLibre's DOM.sanitize path (GHSA-jrc7-96c5-q579) is never used for alert content.
function htmlToNode(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const wrap = document.createElement('div');
  wrap.append(tpl.content);
  return wrap;
}
const SYRIA_BOUNDS = [[35.45, 32.25], [42.5, 37.4]];
const STYLE_URL = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DEM = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
const TYPE_ICON = { breaking: 'bolt', uav: 'drone', warplane: 'plane', missile: 'rocket', attack: 'flame', artillery: 'target', civil: 'ambulance' };
export const typeIcon = (t) => TYPE_ICON[t] || 'alert';

const styleCache = {};
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
function fallbackStyle(kind) {
  // Minimal offline-safe style: used when the basemap server is slow or unreachable,
  // so the Syria overlays and alert markers always render.
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': kind === 'dark' ? '#14161b' : '#eceef1' } }],
  };
}
function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
}
async function fetchStyle(kind) {
  if (!styleCache[kind]) {
    styleCache[kind] = (async () => {
      for (let i = 0; i < 2; i++) {
        try {
          const r = await fetchWithTimeout(STYLE_URL[kind], 7000);
          if (r.ok) return await r.json();
        } catch { /* retry */ }
      }
      throw new Error('style unavailable');
    })().catch((e) => { delete styleCache[kind]; throw e; });
  }
  try {
    return JSON.parse(JSON.stringify(await styleCache[kind]));
  } catch {
    return fallbackStyle(kind);
  }
}

let dataCache = null;
async function loadData() {
  if (!dataCache) {
    dataCache = Promise.all(['syria-border', 'syria-governorates', 'syria-peaks'].map((n) => fetch(`/data/${n}.geojson`).then((r) => r.json())));
  }
  const [border, govs, peaks] = await dataCache;
  return { border, govs, peaks };
}

function labelExpr(lang) {
  return lang === 'ar'
    ? ['coalesce', ['get', 'name:ar'], ['get', 'name'], ['get', 'name:latin']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
}
function localize(style, lang) {
  for (const l of style.layers) {
    if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
    const s = JSON.stringify(l.layout['text-field']);
    if (!s.includes('name') || s.includes('ref') || s.includes('housenumber')) continue;
    l.layout['text-field'] = labelExpr(lang);
  }
  return style;
}

async function buildStyle({ dark, layer, lang }) {
  const base = await fetchStyle(dark && layer !== 'satellite' ? 'dark' : 'light');
  let style = base;
  if (layer === 'satellite') {
    const keepSrc = ['place', 'water_name', 'boundary', 'transportation_name'];
    const labels = base.layers
      .filter((l) => keepSrc.includes(l['source-layer']) && (l.type === 'symbol' || (l.type === 'line' && l['source-layer'] === 'boundary')))
      .map((l) => {
        const c = JSON.parse(JSON.stringify(l));
        if (c.type === 'symbol') {
          c.paint = { ...(c.paint || {}), 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4 };
        } else {
          c.paint = { ...(c.paint || {}), 'line-color': 'rgba(255,255,255,0.55)' };
        }
        return c;
      });
    style = {
      version: 8,
      glyphs: base.glyphs || GLYPHS,
      ...(base.sprite ? { sprite: base.sprite } : {}),
      sources: {
        ...(base.sources.openmaptiles ? { openmaptiles: base.sources.openmaptiles } : {}),
        esri: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      },
      layers: [{ id: 'esri', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.1, 'raster-contrast': 0.05 } }, ...labels],
    };
  }
  style.sources['ras-dem'] = { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen / AWS Open Data' };
  style.sources['ras-dem-hs'] = { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 12 };
  return localize(style, lang);
}

function firstSymbolId(map) {
  for (const l of map.getStyle().layers) if (l.type === 'symbol') return l.id;
  return undefined;
}
function labelFont(map) {
  for (const l of map.getStyle().layers) if (l.type === 'symbol' && l['source-layer'] === 'place' && l.layout?.['text-font']) return l.layout['text-font'];
  return ['Noto Sans Regular'];
}

function circlePolygon(lon, lat, km, steps = 64) {
  const coords = [];
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return coords;
}

function maskFeature(border) {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes = [];
  for (const f of border.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') holes.push(g.coordinates[0]);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => holes.push(p[0]));
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...holes] } };
}

export class AlertMap {
  constructor(el, opts) {
    this.el = el;
    this.opts = { ...opts };
    this.markers = new Map();
    this.alerts = [];
    this.selectedId = null;
    this.popup = null;
    this.onSelect = opts.onSelect || (() => {});
    this.popupHtml = opts.popupHtml || (() => '');
    this.ready = false;
  }

  async init() {
    const M = ml();
    try {
      if (M.getRTLTextPluginStatus && M.getRTLTextPluginStatus() === 'unavailable') M.setRTLTextPlugin('/vendor/mapbox-gl-rtl-text.js', true);
    } catch { /* already set */ }
    const style = await buildStyle(this.opts);
    this.map = new M.Map({
      container: this.el,
      style,
      bounds: SYRIA_BOUNDS,
      fitBoundsOptions: { padding: this.padding() },
      maxBounds: [[25, 25], [52, 45]],
      minZoom: 4,
      maxZoom: 17,
      attributionControl: false,
      dragRotate: true,
      pitchWithRotate: true,
      cooperativeGestures: false,
      locale: this.opts.lang === 'ar' ? { 'NavigationControl.ZoomIn': 'تكبير', 'NavigationControl.ZoomOut': 'تصغير' } : undefined,
    });
    this.map.addControl(new M.AttributionControl({ compact: true, customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · GeoNames · geoBoundaries' }), this.opts.lang === 'ar' ? 'bottom-left' : 'bottom-right');
    this.map.addControl(new M.ScaleControl({ maxWidth: 110, unit: 'metric' }), this.opts.lang === 'ar' ? 'bottom-right' : 'bottom-left');
    this.map.on('style.load', () => this.addOverlays());
    this.map.on('styleimagemissing', (e) => {
      if (!this.map.hasImage(e.id)) this.map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    this.map.on('click', (e) => {
      if (!e.originalEvent.target.closest('.mk')) this.onSelect(null, { fromMap: true });
    });
    // Markers are DOM elements: show them as soon as the style is parsed,
    // without waiting for every basemap tile (or forever, if a tile server is down).
    await new Promise((res) => {
      if (this.map.isStyleLoaded()) return res();
      this.map.once('style.load', res);
      this.map.once('load', res);
      setTimeout(res, 6000);
    });
    this.ready = true;
    if (window.innerWidth < 768) this.el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    this.render();
    if (this._pending) { const [a, o] = this._pending; this._pending = null; this.select(a, o); }
  }

  padding() {
    const mobile = window.innerWidth < 768;
    return mobile ? { top: 70, bottom: 120, left: 30, right: 30 } : { top: 70, bottom: 70, left: 60, right: 60 };
  }

  async setOptions(patch) {
    const prev = this.opts;
    this.opts = { ...this.opts, ...patch };
    if (!this.map) return;
    const styleChanged = ['dark', 'layer', 'lang'].some((k) => k in patch && patch[k] !== prev[k]);
    if (styleChanged) {
      const style = await buildStyle(this.opts);
      this.map.setStyle(style, { diff: false });
    } else {
      this.applyToggles();
    }
  }

  async addOverlays() {
    const map = this.map;
    const { border, govs, peaks } = await loadData();
    const before = firstSymbolId(map);
    const dark = this.opts.dark || this.opts.layer === 'satellite';
    const font = labelFont(map);
    const add = (layer, beforeId = before) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
    };
    if (!map.getSource('ras-border')) map.addSource('ras-border', { type: 'geojson', data: border });
    if (!map.getSource('ras-mask')) map.addSource('ras-mask', { type: 'geojson', data: maskFeature(border) });
    if (!map.getSource('ras-govs')) map.addSource('ras-govs', { type: 'geojson', data: govs });
    if (!map.getSource('ras-peaks')) map.addSource('ras-peaks', { type: 'geojson', data: peaks });
    if (!map.getSource('ras-zones')) map.addSource('ras-zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    if (this.opts.layer !== 'satellite') {
      add({ id: 'ras-hillshade', type: 'hillshade', source: 'ras-dem-hs', paint: { 'hillshade-exaggeration': dark ? 0.18 : 0.28, 'hillshade-shadow-color': dark ? '#000000' : '#5a5a70', 'hillshade-highlight-color': dark ? '#2a2a35' : '#ffffff', 'hillshade-accent-color': dark ? '#000000' : '#6a6a80' } });
    }
    add({ id: 'ras-mask', type: 'fill', source: 'ras-mask', paint: { 'fill-color': dark ? '#000000' : '#1a1a2e', 'fill-opacity': dark ? 0.42 : 0.14 } });
    add({ id: 'ras-gov-line', type: 'line', source: 'ras-govs', paint: { 'line-color': dark ? 'rgba(240,240,245,0.35)' : 'rgba(26,26,46,0.35)', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.4], 'line-dasharray': [3, 2] } });
    add({ id: 'ras-border-glow', type: 'line', source: 'ras-border', paint: { 'line-color': '#ff3b4e', 'line-opacity': 0.22, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 10], 'line-blur': 3 } });
    add({ id: 'ras-border', type: 'line', source: 'ras-border', paint: { 'line-color': dark ? '#f0f0f5' : '#1a1a2e', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2.4] } });
    add({ id: 'ras-zones-fill', type: 'fill', source: 'ras-zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'active'], 0.12, 0.05] } });
    add({ id: 'ras-zones-line', type: 'line', source: 'ras-zones', paint: { 'line-color': ['get', 'color'], 'line-opacity': ['case', ['get', 'active'], 0.6, 0.25], 'line-width': 1.5, 'line-dasharray': [2, 1.5] } });
    add({ id: 'ras-peaks-dot', type: 'circle', source: 'ras-peaks', minzoom: 6, paint: { 'circle-radius': 3.2, 'circle-color': '#8b5e34', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } }, undefined);
    add({
      id: 'ras-peaks-label', type: 'symbol', source: 'ras-peaks', minzoom: 6.5,
      layout: { 'text-field': ['concat', ['get', this.opts.lang === 'ar' ? 'ar' : 'en'], '\n', ['to-string', ['get', 'ele']], this.opts.lang === 'ar' ? ' م' : ' m'], 'text-font': font, 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 8 },
      paint: { 'text-color': dark ? '#f1d9c0' : '#6b4423', 'text-halo-color': dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)', 'text-halo-width': 1.3 },
    }, undefined);
    this.applyToggles();
    this.updateZones();
  }

  applyToggles() {
    const map = this.map;
    if (!map || !map.getLayer('ras-border')) return;
    const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('ras-peaks-dot', this.opts.showPeaks);
    vis('ras-peaks-label', this.opts.showPeaks);
    vis('ras-gov-line', this.opts.showGov);
    vis('ras-mask', this.opts.focusSyria);
    if (this.opts.map3d) {
      map.setTerrain({ source: 'ras-dem', exaggeration: 1.4 });
      if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 900 });
    } else {
      map.setTerrain(null);
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
  }

  // ------------------------------------------------------------- markers
  setAlerts(alerts, selectedId) {
    this.alerts = alerts;
    this.selectedId = selectedId;
    if (this.ready) this.render();
  }

  render() {
    const M = ml();
    const seen = new Set();
    const groups = new Map();
    for (const a of this.alerts) {
      if (!a.location || !Number.isFinite(a.location.latitude) || !Number.isFinite(a.location.longitude)) continue;
      const key = `${a.location.latitude.toFixed(3)},${a.location.longitude.toFixed(3)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    for (const list of groups.values()) {
      list.forEach((a, i) => {
        seen.add(a.id);
        const n = list.length;
        const offset = n > 1 ? [Math.round(Math.cos((i / n) * Math.PI * 2 - Math.PI / 2) * 26), Math.round(Math.sin((i / n) * Math.PI * 2 - Math.PI / 2) * 26)] : [0, 0];
        let m = this.markers.get(a.id);
        const sig = `${a.type}|${a.is_active}|${offset.join(',')}`;
        if (m && m._sig !== sig) {
          m.remove();
          this.markers.delete(a.id);
          m = null;
        }
        if (!m) {
          const el = this.markerEl(a);
          m = new M.Marker({ element: el, anchor: 'center', offset }).setLngLat([a.location.longitude, a.location.latitude]).addTo(this.map);
          m._sig = sig;
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onSelect(a.id, { fromMap: true });
          });
          this.markers.set(a.id, m);
        } else {
          m.setLngLat([a.location.longitude, a.location.latitude]);
        }
        const el = m.getElement();
        const fresh = a.is_active && Date.now() - Date.parse(a.timestamp) < 20 * 60_000;
        el.classList.toggle('fresh', fresh);
        el.classList.toggle('sel', a.id === this.selectedId);
        el.style.zIndex = a.id === this.selectedId ? 50 : a.is_active ? 10 : 1;
        el.title = a.title;
      });
    }
    for (const [id, m] of this.markers) {
      if (!seen.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }
    this.updateZones();
    if (this.popup && this.popup._alertId && !seen.has(this.popup._alertId)) this.closePopup();
  }

  markerEl(a) {
    const t = typeOf(a.type);
    const el = document.createElement('div');
    el.className = `mk t-${a.type}${a.is_active ? '' : ' inactive'}${t.marker === 'orbit' ? ' mk-orbit' : ' mk-static'}`;
    el.style.setProperty('--c', t.color);
    el.style.setProperty('--r', t.ring);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (t.marker === 'orbit') {
      el.innerHTML = `<span class="zone"></span><span class="pulse"></span><span class="ring"></span><span class="core"></span><div class="orbit"><span class="craft">${icon(a.type === 'warplane' ? 'plane' : 'drone', 26)}</span></div>`;
    } else {
      el.innerHTML = `<span class="pulse"></span><span class="ring"></span><span class="disc">${icon(typeIcon(a.type), 18)}</span>`;
    }
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onSelect(a.id, { fromMap: true });
      }
    });
    return el;
  }

  updateZones() {
    const src = this.map && this.map.getSource('ras-zones');
    if (!src) return;
    const features = [];
    for (const a of this.alerts) {
      const t = ALERT_TYPES[a.type];
      if (!t || !t.radiusKm || !a.location || !Number.isFinite(a.location.latitude)) continue;
      features.push({ type: 'Feature', properties: { color: t.color, active: !!a.is_active }, geometry: { type: 'Polygon', coordinates: [circlePolygon(a.location.longitude, a.location.latitude, t.radiusKm)] } });
    }
    src.setData({ type: 'FeatureCollection', features });
  }

  // ------------------------------------------------------------- selection / camera
  select(alert, { fly = true, popup = true } = {}) {
    this.selectedId = alert ? alert.id : null;
    if (!this.ready) { this._pending = alert ? [alert, { fly, popup }] : null; return; }
    for (const [id, m] of this.markers) {
      m.getElement().classList.toggle('sel', id === this.selectedId);
      m.getElement().style.zIndex = id === this.selectedId ? 50 : 10;
    }
    if (!alert) return this.closePopup();
    if (!alert.location || !Number.isFinite(alert.location.latitude)) return this.closePopup();
    const ll = [alert.location.longitude, alert.location.latitude];
    if (fly) {
      const z = { place: 11, point: 11.5, district: 9.5, governorate: 8 }[alert.scope] || 9;
      this.map.flyTo({ center: ll, zoom: Math.max(this.map.getZoom(), z), padding: this.padding(), speed: 1.4, essential: true });
    }
    if (popup) this.openPopup(alert);
  }

  openPopup(alert) {
    const M = ml();
    this.closePopup();
    const m = this.markers.get(alert.id);
    const off = m ? m.getOffset() : { x: 0, y: 0 };
    this.popup = new M.Popup({ closeButton: true, closeOnClick: false, maxWidth: '290px', offset: { bottom: [off.x, off.y - 26], top: [off.x, off.y + 26], left: [off.x + 26, off.y], right: [off.x - 26, off.y] }, focusAfterOpen: false })
      .setLngLat([alert.location.longitude, alert.location.latitude])
      .setDOMContent(htmlToNode(this.popupHtml(alert)))
      .addTo(this.map);
    this.popup._alertId = alert.id;
    this.popup.on('close', () => {
      if (this.popup && this.popup._alertId === alert.id) this.popup = null;
    });
    return this.popup;
  }

  closePopup() {
    if (this.popup) {
      const p = this.popup;
      this.popup = null;
      p.remove();
    }
  }

  fitSyria() {
    if (!this.map) return;
    this.map.fitBounds(SYRIA_BOUNDS, { padding: this.padding(), duration: 900, pitch: this.opts.map3d ? 50 : 0, bearing: 0 });
  }
  zoomIn() { this.map && this.map.zoomIn(); }
  zoomOut() { this.map && this.map.zoomOut(); }
  resize() { this.map && this.map.resize(); }

  showMe(lon, lat) {
    if (!this.map) return;
    const M = ml();
    if (!this.me) {
      const el = document.createElement('div');
      el.className = 'me-dot';
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#3b8eff;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,142,255,.25),0 2px 6px rgba(0,0,0,.4)';
      this.me = new M.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map);
    } else this.me.setLngLat([lon, lat]);
    this.map.flyTo({ center: [lon, lat], zoom: 11, essential: true });
  }
}
