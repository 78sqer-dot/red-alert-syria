// Map module — MapLibre GL with OpenFreeMap vector tiles, Esri imagery and AWS terrain.
import { ALERT_TYPES, ZONE_KM, assassinationWeaponGlyph, typeOf, FLIGHT_DIRECTIONS } from '/shared/types.js?v=18';
import { SVG } from './marker-svgs.js?v=18';
import { EXTRA_SVG } from './target-svgs.js?v=2';
import { icon } from './icons.js';
import { groupAlerts, nextAlertId } from './marker-layout.js';
import { squadLayout } from './aircraft-layout.js';
import { flightPath, flightPosition } from '/shared/flight-path.js?v=1';
import { markerTapMatchesMapClick } from './map-click-guard.js?v=1';
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
const ZONE_COLOR = { uav: '#ef233c', uav_strike: '#ff6b7a', breaking: '#ef233c' };
const TYPE_ICON = { breaking: 'bolt', uav: 'drone', uav_strike: 'drone', warplane: 'plane', air_movement: 'route', border: 'mapPin', missile: 'rocket', attack: 'swords', assassination: 'swords', artillery: 'target', explosion: 'bomb', civil: 'ambulance', accident: 'carCrash', protest: 'speaker', fire: 'flame', civil_plane: 'planeDep', quake: 'quake', weather: 'storm' };
export const typeIcon = (t) => TYPE_ICON[t] || 'alert';
const svgTag = (glyph, size, extra = '') => `<svg viewBox="0 0 512 512" width="${size}" height="${size}" ${extra} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${EXTRA_SVG[glyph] || SVG[glyph] || SVG.other}</svg>`;
// Round coloured disc with the original glyph (used by the map, the legend and toasts).
export function glyphDisc(type, size = 34, iconSize = 18, cls = 'sai', glyphOverride = null) {
  const t = typeOf(type);
  const bg = t.disc || '#000000';
  const fg = bg === '#000000' ? t.color : '#ffffff';
  return `<span class="${cls}" style="width:${size}px;height:${size}px;background:${bg};border-color:${t.color};color:${fg}">${svgTag(glyphOverride || t.glyph, iconSize, `fill="${fg}"`)}</span>`;
}

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
    dataCache = Promise.all(['syria-border', 'syria-governorates'].map((n) => fetch(`/data/${n}.geojson`).then((r) => r.json())));
  }
  const [border, govs] = await dataCache;
  return { border, govs };
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
  // one DEM source for both hillshade and 3D terrain (was two -> every tile downloaded and decoded twice)
  style.sources['ras-dem-hs'] = { type: 'raster-dem', tiles: [DEM], encoding: 'terrarium', tileSize: 256, maxzoom: 11, attribution: 'Terrain: Mapzen / AWS Open Data' };
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

function circlePolygon(lon, lat, km, steps = 96) {
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
    this._lastMarkerTap = null;
    this.onSelect = opts.onSelect || (() => {});
    this.popupHtml = opts.popupHtml || (() => '');
    this.ready = false;
  }

  async init() {
    const M = ml();
    try {
      if (M.getRTLTextPluginStatus && M.getRTLTextPluginStatus() === 'unavailable') M.setRTLTextPlugin('/vendor/mapbox-gl-rtl-text.js', true);
    } catch { /* already set */ }
    // Start with a local style so a slow/broken third-party style endpoint (common in
    // Telegram's in-app Chrome) cannot block the map controls and incident overlays.
    const stylePromise = buildStyle(this.opts);
    this.map = new M.Map({
      // phone "desktop site": the page is zoomed, so render the map canvas at the real screen resolution
      pixelRatio: (this._pr = Math.min(2, (window.devicePixelRatio || 1) * ((window.__uiz || 1) > 1 ? window.__uiz : 1))),
      container: this.el,
      style: fallbackStyle(this.opts.dark ? 'dark' : 'light'),
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
    window.__rasMap = this.map;
    this.map.on('style.load', () => this.addOverlays());
    stylePromise.then((style) => {
      if (this.map) this.map.setStyle(style, { diff: false });
    }).catch((e) => console.warn('[map] basemap style unavailable; continuing with local fallback', e?.message || e));
    let lastOrbitUpdate = 0;
    const zoomTier = (forceOrbit = false) => {
      const z = this.map.getZoom();
      const c = this.map.getContainer();
      c.classList.toggle('zoom-detail', z >= 11);
      c.classList.toggle('zoom-tier-mid', z >= 9 && z < 11);
      c.classList.toggle('zoom-tier-far', z < 9);
      c.classList.toggle('zoom-far', z < 7.5);
      // like the original: below zoom 11 only the glowing circle shows; from 11 up the drone appears
      // and flies along the circle's edge, so its orbit follows the ring while pinching
      const now = performance.now();
      if (forceOrbit || now - lastOrbitUpdate >= 33) {
        lastOrbitUpdate = now;
        this._orbitPx(); // keep flight paths responsive without remeasuring every zoom event
      }
      // small icons at every zoom, getting a little smaller as you zoom in (like the original)
      const mks = Math.max(0.42, Math.min(0.56, 0.56 - (z - 6) * 0.025)).toFixed(2);
      if (mks !== this._mks) { this._mks = mks; c.style.setProperty('--mks', mks); } // restyle markers only when the size step changes
    };
    this.map.on('zoom', () => zoomTier());
    this.map.on('zoomend', () => {
      this.el.classList.remove('is-zooming');
      zoomTier(true);
      this._queueZones();
    });
    // pulse rings are re-sized when the zoom settles; hidden meanwhile so they never look out of scale
    this.map.on('zoomstart', () => this.el.classList.add('is-zooming'));
    // pause the marker animations while a gesture/flight is running so the map itself stays smooth
    this.map.on('movestart', () => this.el.classList.add('is-moving'));
    this.map.on('moveend', () => {
      this.el.classList.remove('is-moving');
      this.refreshMarkerGroups();
    });
    this.map.on('resize', () => this._queueZones());
    zoomTier(true);
    this.map.on('styleimagemissing', (e) => {
      if (!this.map.hasImage(e.id)) this.map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    this.map.on('click', (e) => {
      const markerTap = this._lastMarkerTap;
      this._lastMarkerTap = null; // consume the next map click, whether it is an echo or a separate tap
      if (markerTapMatchesMapClick(markerTap, e.point, performance.now())) return;
      if (e.originalEvent?.target?.closest?.('.mk, .maplibregl-popup')) return;
      if (window.__svcHit && window.__svcHit(e)) return; // a road / service icon (public/js/services.js)
      if (this.newsHidden) return; // services map mode: the news is hidden
      // a tap inside any circle of an alert (main or extra affected area) opens that same alert
      const hit = this.zoneAt(e.lngLat);
      if (hit) { this._popupAt = { id: hit.id, ll: [hit.lon, hit.lat] }; return this.onSelect(hit.id, { fromMap: true, fly: false }); }
      this.onSelect(null, { fromMap: true });
    });
    // Hover hit-testing is useful for desktop cursors, but costs work during touch/pan gestures.
    if (!window.matchMedia?.('(pointer: coarse)').matches) {
      this.map.on('mousemove', (e) => {
        const c = this.map.getCanvas();
        const want = this.zoneAt(e.lngLat) ? 'pointer' : '';
        if (c.style.cursor !== want) c.style.cursor = want;
      });
    }
    // Markers are DOM elements: show them as soon as the style is parsed,
    // without waiting for every basemap tile (or forever, if a tile server is down).
    await new Promise((res) => {
      if (this.map.isStyleLoaded()) return res();
      this.map.once('style.load', res);
      this.map.once('load', res);
      setTimeout(res, 6000);
    });
    this.ready = true;
    if ((window.__viewW ? window.__viewW() : window.innerWidth) < 768) this.el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    this.render();
    if (this._pending) { const [a, o] = this._pending; this._pending = null; this.select(a, o); }
  }

  padding() {
    const mobile = (window.__viewW ? window.__viewW() : window.innerWidth) < 768;
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
    const { border, govs } = await loadData();
    const before = firstSymbolId(map);
    const dark = this.opts.dark || this.opts.layer === 'satellite';
    const font = labelFont(map);
    const add = (layer, beforeId = before) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
    };
    if (!map.getSource('ras-border')) map.addSource('ras-border', { type: 'geojson', data: border });
    if (!map.getSource('ras-mask')) map.addSource('ras-mask', { type: 'geojson', data: maskFeature(border) });
    if (!map.getSource('ras-govs')) map.addSource('ras-govs', { type: 'geojson', data: govs });
    if (!map.getSource('ras-zones')) map.addSource('ras-zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!map.getSource('ras-flight-paths')) map.addSource('ras-flight-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    if (this.opts.layer !== 'satellite' && map.getSource('ras-dem-hs')) {
      add({ id: 'ras-hillshade', type: 'hillshade', source: 'ras-dem-hs', paint: { 'hillshade-exaggeration': dark ? 0.18 : 0.28, 'hillshade-shadow-color': dark ? '#000000' : '#5a5a70', 'hillshade-highlight-color': dark ? '#2a2a35' : '#ffffff', 'hillshade-accent-color': dark ? '#000000' : '#6a6a80' } });
    }
    add({ id: 'ras-mask', type: 'fill', source: 'ras-mask', paint: { 'fill-color': dark ? '#000000' : '#1a1a2e', 'fill-opacity': dark ? 0.42 : 0.14 } });
    add({ id: 'ras-gov-line', type: 'line', source: 'ras-govs', paint: { 'line-color': dark ? 'rgba(240,240,245,0.35)' : 'rgba(26,26,46,0.35)', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.4], 'line-dasharray': [3, 2] } });
    add({ id: 'ras-border-glow', type: 'line', source: 'ras-border', paint: { 'line-color': '#ff3b4e', 'line-opacity': 0.22, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 10], 'line-blur': 3 } });
    add({ id: 'ras-border', type: 'line', source: 'ras-border', paint: { 'line-color': dark ? '#f0f0f5' : '#1a1a2e', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2.4] } });
    // Affected-area circles (same look as the original: fill .14, solid line .7 / dashed for aircraft),
    // softened at close zoom so a 1.5 km circle never floods the screen.
    // Affected-area circles: vivid red-tinted fill + solid edge + soft pulsing glow (like the original),
    // softened slightly at very close zoom so a small circle never floods the screen.
    const A = (on, off) => ['case', ['get', 'active'], on, off];
    add({ id: 'ras-zones-fill', type: 'fill', source: 'ras-zones', filter: ['!', ['get', 'dashed']], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': A(dark ? 0.22 : 0.17, 0.05) } });
    add({ id: 'ras-zones-line', type: 'line', source: 'ras-zones', filter: ['!', ['get', 'dashed']], paint: { 'line-color': ['get', 'color'], 'line-opacity': A(0.8, 0.3), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 11, 1.6] } });
    add({ id: 'ras-zones-dash', type: 'line', source: 'ras-zones', filter: ['get', 'dashed'], paint: { 'line-color': ['get', 'color'], 'line-opacity': A(0.85, 0.3), 'line-width': 1.8, 'line-dasharray': [3, 4] } });
    add({ id: 'ras-flight-path-line', type: 'line', source: 'ras-flight-paths', paint: { 'line-color': '#3b82f6', 'line-opacity': 0.62, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 10, 2.4], 'line-dasharray': [2, 2] } });
    this._startGlow();
    this.applyToggles();
    this.updateZones();
    this.refreshMarkerGroups();
    this.syncMovementTracks();
  }

  /** services map mode (public/js/services.js): hide the news markers and circles until the user goes back */
  setNewsHidden(on) {
    this.newsHidden = !!on;
    this.el.classList.toggle('news-off', this.newsHidden);
    if (on) this.closePopup();
    const map = this.map; if (!map) return;
    for (const id of ['ras-zones-fill', 'ras-zones-line', 'ras-zones-dash', 'ras-flight-path-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
    this.syncMovementTracks();
  }
  applyToggles() {
    const map = this.map;
    if (!map || !map.getLayer('ras-border')) return;
    const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of ['ras-zones-fill', 'ras-zones-line', 'ras-zones-dash', 'ras-flight-path-line']) vis(id, !this.newsHidden);
    vis('ras-gov-line', this.opts.showGov);
    vis('ras-mask', this.opts.focusSyria);
    // 3D kept light so it stays smooth: one shared low-zoom DEM, gentle exaggeration and tilt, and on phones
    // the canvas is drawn at a lower resolution while terrain is on (the 3D pass costs ~2x per frame)
    const phone = this.dockMode();
    if (this.opts.map3d) {
      map.setTerrain({ source: 'ras-dem-hs', exaggeration: phone ? 1.0 : 1.2 });
      if (map.setPixelRatio) map.setPixelRatio(phone ? Math.min(1.25, this._pr || 1) : Math.min(1.5, this._pr || 1));
      map.setMaxPitch(phone ? 50 : 60);
      this.el.classList.add('is-3d');
      if (map.getPitch() < 30) map.easeTo({ pitch: phone ? 40 : 50, duration: 800 });
    } else {
      map.setTerrain(null);
      if (map.setPixelRatio && this._pr && map.getPixelRatio() !== this._pr) map.setPixelRatio(this._pr);
      this.el.classList.remove('is-3d');
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    }
  }

  // ------------------------------------------------------------- markers
  setAlerts(alerts, selectedId) {
    this.alerts = alerts;
    this.selectedId = selectedId;
    this.syncMovementNotice();
    this.syncMovementTracks();
    if (this.ready) this.render();
  }

  // Direction-only reports carry no coordinates by design, so show the movement as a map UI cue, not a pin.
  syncMovementNotice() {
    const movements = this.alerts
      .filter((a) => a.type === 'air_movement' && a.is_active && FLIGHT_DIRECTIONS[a.flight_direction]
        && !Number.isFinite(a.location?.latitude) && !Number.isFinite(a.location?.longitude))
      .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0));
    const alert = movements[0];
    if (!alert) {
      this.movementNotice?.remove();
      this.movementNotice = null;
      return;
    }
    if (!this.movementNotice) {
      const notice = document.createElement('button');
      notice.type = 'button';
      notice.className = 'map-flight-status';
      notice.innerHTML = '<span class="map-flight-main"><span class="map-flight-label"></span><span class="map-flight-flow" dir="ltr"></span></span><small class="map-flight-note"></small>';
      notice.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = notice.dataset.alertId;
        if (id) this.onSelect(id, { fromMap: true, fly: false });
      });
      this.el.append(notice);
      this.movementNotice = notice;
    }
    const lang = this.opts.lang === 'en' ? 'en' : 'ar';
    const direction = FLIGHT_DIRECTIONS[alert.flight_direction][lang];
    const country = lang === 'en' ? 'Syria' : 'سوريا';
    const plane = document.createElement('span');
    plane.className = 'map-flight-plane';
    plane.setAttribute('aria-hidden', 'true');
    const aircraft = alert.aircraft === 'uav' ? 'uav' : 'plane';
    const fill = aircraft === 'uav' ? '#6b7280' : '#2476c9';
    plane.innerHTML = svgTag(aircraft, 22, `fill="${fill}" class="map-flight-svg"`);
    const arrow = document.createElement('span');
    arrow.className = 'map-flight-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    const destination = document.createElement('b');
    destination.className = 'map-flight-destination';
    destination.textContent = country;
    const flow = this.movementNotice.querySelector('.map-flight-flow');
    flow.replaceChildren(...(alert.flight_direction === 'leaving_syria' ? [destination, arrow, plane] : [plane, arrow, destination]));
    const label = movements.length > 1 ? `${direction} (+${movements.length - 1})` : direction;
    this.movementNotice.querySelector('.map-flight-label').textContent = label;
    this.movementNotice.querySelector('.map-flight-note').textContent = lang === 'en' ? 'Schematic route · location unspecified' : 'مسار توضيحي · الموقع غير محدد';
    this.movementNotice.dataset.alertId = alert.id;
    this.movementNotice.classList.toggle('is-leaving', alert.flight_direction === 'leaving_syria');
    this.movementNotice.setAttribute('aria-label', `${direction}: ${country} — ${lang === 'en' ? 'schematic route, not a live track' : 'مسار توضيحي وليس تتبعاً مباشراً'}`);
    this.movementNotice.title = this.movementNotice.getAttribute('aria-label');
  }

  // Direction-only reports deliberately have no location pin; these animated aircraft follow a
  // clearly labelled schematic path so viewers can see entering/approaching/leaving motion.
  syncMovementTracks() {
    const map = this.map;
    const source = map?.getSource('ras-flight-paths');
    if (!map || !source) return;
    const M = ml();
    if (!this.movementTracks) this.movementTracks = new Map();
    const active = this.newsHidden ? [] : this.alerts
      .filter((a) => a.type === 'air_movement' && a.is_active && FLIGHT_DIRECTIONS[a.flight_direction]
        && !Number.isFinite(a.location?.latitude) && !Number.isFinite(a.location?.longitude))
      .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0))
      .slice(0, 3);
    const features = [];
    const keep = new Set();
    const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    active.forEach((alert, index) => {
      const path = flightPath(alert.flight_direction);
      if (path.length < 2) return;
      keep.add(alert.id);
      // Keep the schematic coordinates for aircraft motion, but do not draw a route line.
      const aircraft = alert.aircraft === 'uav' ? 'uav' : 'plane';
      const color = aircraft === 'uav' ? '#ef4444' : '#3b82f6';
      const signature = `${aircraft}|${alert.flight_direction}`;
      let track = this.movementTracks.get(alert.id);
      if (track && track.signature !== signature) {
        cancelAnimationFrame(track.frame);
        track.marker.remove();
        this.movementTracks.delete(alert.id);
        track = null;
      }
      if (!track) {
        const el = document.createElement('div');
        el.className = `map-flight-track-marker ${aircraft === 'uav' ? 'is-uav' : 'is-plane'}`;
        el.setAttribute('aria-hidden', 'true');
        el.title = this.opts.lang === 'en' ? 'Schematic route · not a live track' : 'مسار توضيحي · ليس مساراً حقيقياً';
        const halo = document.createElement('span'); halo.className = 'map-flight-track-halo';
        const squad = document.createElement('span'); squad.className = 'map-flight-track-squad';
        for (const slot of [{ name: 'is-lead', size: 26 }, { name: 'is-left', size: 22 }, { name: 'is-right', size: 22 }]) {
          const airframe = document.createElement('span');
          airframe.className = `map-flight-track-airframe ${slot.name}`;
          airframe.innerHTML = svgTag(aircraft, slot.size, `fill="${color}" class="map-flight-track-svg"`);
          squad.append(airframe);
        }
        el.append(halo, squad);
        const marker = new M.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' }).setLngLat(path[0]).addTo(map);
        track = { marker, element: el, signature, start: performance.now() + index * 2200, frame: 0, last: 0 };
        this.movementTracks.set(alert.id, track);
      }
      const tick = (now) => {
        if (!this.movementTracks?.has(alert.id)) return;
        if (now - track.last >= 1000 / 24 && !this.el.classList.contains('is-moving')) {
          track.last = now;
          const progress = reducedMotion ? 0.72 : ((Math.max(0, now - track.start) % 10_000) / 10_000);
          const pos = flightPosition(path, progress);
          if (pos) {
            track.marker.setLngLat([pos.lon, pos.lat]);
            track.marker.setRotation((pos.bearing || 0) - (aircraft === 'uav' ? 0 : 45));
            track.element.style.opacity = reducedMotion ? '1' : String(Math.max(0.28, Math.min(1, Math.min(progress * 9, (1 - progress) * 7))));
          }
        }
        if (reducedMotion) { track.frame = 0; return; }
        track.frame = requestAnimationFrame(tick);
      };
      if (!track.frame) track.frame = requestAnimationFrame(tick);
    });
    for (const [id, track] of this.movementTracks) {
      if (keep.has(id)) continue;
      cancelAnimationFrame(track.frame);
      track.marker.remove();
      this.movementTracks.delete(id);
    }
    source.setData({ type: 'FeatureCollection', features });
  }

  bindMarkerTap(el, activate) {
    let gesture = null;
    let ignoreTouchClick = false;
    let ignoreTimer = 0;
    const rememberTap = (e) => {
      const r = this.el.getBoundingClientRect();
      this._lastMarkerTap = { x: e.clientX - r.left, y: e.clientY - r.top, at: performance.now() };
    };
    el.addEventListener('pointerdown', (e) => {
      if ((e.pointerType === 'touch' || e.pointerType === 'pen') && e.isPrimary) {
        gesture = { id: e.pointerId, x: e.clientX, y: e.clientY };
        ignoreTouchClick = false;
        clearTimeout(ignoreTimer);
      } else if (e.pointerType === 'mouse') {
        gesture = null;
        ignoreTouchClick = false;
        clearTimeout(ignoreTimer);
      }
    }, { passive: true });
    el.addEventListener('pointerup', (e) => {
      if (!gesture || e.pointerId !== gesture.id) return;
      const start = gesture;
      gesture = null;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) return;
      ignoreTouchClick = true;
      clearTimeout(ignoreTimer);
      ignoreTimer = setTimeout(() => { ignoreTouchClick = false; }, 750);
      rememberTap(e);
      activate();
    }, { passive: true });
    el.addEventListener('pointercancel', () => { gesture = null; }, { passive: true });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ignoreTouchClick && e.detail > 0) {
        ignoreTouchClick = false;
        clearTimeout(ignoreTimer);
        e.preventDefault();
        return;
      }
      if (e.detail > 0) rememberTap(e);
      activate();
    });
  }

  selectMarker(id) {
    const group = groupAlerts(this.alerts, this.selectedId).find((g) => g.alerts.some((a) => a.id === id));
    this.onSelect(group ? nextAlertId(group, this.selectedId) : id, { fromMap: true });
  }

  refreshMarkerGroups() {
    // Never write MapLibre's private _offset field: the library owns its Point.
    // Same-location reports share a visible marker, without inventing positions.
    for (const group of groupAlerts(this.alerts, this.selectedId)) {
      for (const a of group.alerts) {
        const marker = this.markers.get(a.id);
        if (!marker) continue;
        const el = marker.getElement();
        const visible = a.id === group.representative.id;
        el.hidden = !visible;
        el.setAttribute('aria-hidden', String(!visible));
        el.tabIndex = visible ? 0 : -1;
        el.classList.toggle('sel', a.id === this.selectedId);
        el.style.zIndex = a.id === this.selectedId ? 50 : a.is_active ? 10 : 2;
        const count = group.alerts.length;
        const hint = this.opts.lang === 'en' ? `${count} alerts here — click to switch` : `${count} تنبيهات في هذا الموقع — اضغط للتبديل`;
        el.title = count > 1 ? `${a.title} · ${hint}` : a.title;
        el.setAttribute('aria-label', el.title);
        el.dataset.alertId = a.id;
        let badge = el.querySelector('.mk-count');
        if (count > 1 && visible) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'mk-count'; badge.setAttribute('aria-hidden', 'true'); el.append(badge); }
          badge.textContent = String(count);
        } else if (badge) badge.remove();
      }
    }
    if (this.sats) for (const m of this.sats.values()) {
      const parent = this.markers.get(m._alertId);
      if (!parent) continue;
      const el = m.getElement();
      el.hidden = parent.getElement().hidden;
      el.classList.toggle('sel', m._alertId === this.selectedId);
      el.style.zIndex = m._alertId === this.selectedId ? 49 : parent.getElement().style.zIndex;
    }
  }

  render() {
    const M = ml();
    const seen = new Set();
    for (const a of this.alerts) {
      if (!a.location || !Number.isFinite(a.location.latitude) || !Number.isFinite(a.location.longitude)) continue;
      seen.add(a.id);
      let m = this.markers.get(a.id);
      const sig = `${a.type}|${a.is_active}`;
      if (m && m._sig !== sig) {
        m.remove();
        this.markers.delete(a.id);
        m = null;
      }
      if (!m) {
        const el = this.markerEl(a);
        m = new M.Marker({ element: el, anchor: 'center', offset: [0, 0] }).setLngLat([a.location.longitude, a.location.latitude]).addTo(this.map);
        m._sig = sig;
        this.bindMarkerTap(el, () => this.selectMarker(a.id));
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
    }
    this.refreshMarkerGroups();
    // drones: the alert's own marker flies over its main circle; every other circle of the same alert gets
    // its drone too, and an intensive flight (a.drones = 2-3, from the server) puts 2-3 over each circle
    this.sats = this.sats || new Map();
    const satSeen = new Set();
    let satN = 0;
    for (const a of this.alerts) {
      if (typeOf(a.type).marker !== 'orbit' || !a.location || a.scope === 'country') continue;
      const per = Math.max(1, Math.min(3, Number(a.drones) || 1));
      const zs = Array.isArray(a.zones) && a.zones.length ? a.zones : [];
      let mi = -1, bd = Infinity;
      zs.forEach((z, i) => { const d = (z.lat - a.location.latitude) ** 2 + (z.lon - a.location.longitude) ** 2; if (d < bd) { bd = d; mi = i; } });
      zs.forEach((z, i) => {
        for (let j = i === mi ? 1 : 0; j < per; j++) {
          if (satN >= 60) return; // keep phones smooth
          const key = `${a.id}:${i}:${j}`;
          satSeen.add(key); satN++;
          let m = this.sats.get(key);
          const sig = `${a.type}|${a.is_active}|${z.lat.toFixed(4)},${z.lon.toFixed(4)}|${per}`;
          if (m && m._sig !== sig) { m.remove(); this.sats.delete(key); m = null; }
          if (!m) {
            const el = this.markerEl(a);
            el.classList.add('mk-sat');
            el.removeAttribute('tabindex');
            // spread the drones of one circle around it, and offset each circle a little
            el.style.setProperty('--delay', `${(-(9 * j) / per - i * 1.3).toFixed(2)}s`);
            this.bindMarkerTap(el, () => this.onSelect(a.id, { fromMap: true }));
            m = new M.Marker({ element: el, anchor: 'center' }).setLngLat([z.lon, z.lat]).addTo(this.map);
            m._sig = sig;
            this.sats.set(key, m);
          }
          m._zkm = z.km; m._lat = z.lat; m._alertId = a.id;
          const el = m.getElement();
          el.dataset.alertId = a.id;
          el.hidden = !!this.markers.get(a.id)?.getElement().hidden;
          el.classList.toggle('sel', a.id === this.selectedId);
          el.style.zIndex = a.is_active ? 9 : 1;
          el.title = a.title;
        }
      });
    }
    for (const [k, m] of this.sats) if (!satSeen.has(k)) { m.remove(); this.sats.delete(k); }
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
    const glyph = a.marker_glyph === 'weapon' ? 'weapon' : a.type === 'assassination' ? assassinationWeaponGlyph(a) : t.glyph;
    const el = document.createElement('div');
    el.className = `mk t-${a.type}${a.is_active ? '' : ' inactive'} mk-${t.marker}`;
    el.style.setProperty('--c', t.color);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (t.marker === 'orbit') {
      el.innerHTML = `<div class="uav-box"><div class="uav">${svgTag(t.glyph, 20, 'class="uav-svg"')}</div></div>`;
    } else if (t.marker === 'squad') {
      const pl = (sz, x, y, op) => `<div class="sq" style="left:${x}px;top:calc(50% + ${y}px);opacity:${op}">${svgTag(t.glyph, sz, `fill="${t.color}" class="sq-svg"`)}</div>`;
      el.innerHTML = `<div class="squad">${pl(16, 22, -16, 1)}${pl(14, 6, -3, 0.85)}${pl(14, 38, -3, 0.85)}</div>`;
    } else if (t.marker === 'fly') {
      el.innerHTML = `<div class="squad solo"><div class="sq" style="top:50%">${svgTag(t.glyph, 22, `fill="${t.icon || t.color}" class="fly-svg"`)}</div></div>`;
    } else if (t.marker === 'movement') {
      const aircraftGlyph = a.aircraft === 'uav' ? 'uav' : 'plane';
      const arrow = a.flight_direction === 'entering_syria' ? '⇢' : a.flight_direction === 'leaving_syria' ? '⇠' : '➤';
      const movement = a.flight_direction === 'entering_syria' ? 'entering' : a.flight_direction === 'leaving_syria' ? 'leaving' : 'toward';
      const plane = (slot, size) => `<span class="flight-airframe ${slot}">${svgTag(aircraftGlyph, size, `fill="${t.color}" class="flight-svg"`)}</span>`;
      el.innerHTML = `<div class="flight-movement ${movement}"><span class="flight-squad">${plane('is-lead', 23)}${plane('is-left', 18)}${plane('is-right', 18)}</span><span class="flight-arrow" aria-hidden="true">${arrow}</span></div>`;
    } else if (a.type === 'breaking') {
      el.classList.add('mk-breaking-news');
      el.innerHTML = `<span class="news-pulse-ring" aria-hidden="true"></span><span class="news-marker-core">${svgTag(glyph, 24, 'class="news-marker-svg" fill="none"')}</span>`;
    } else if (t.marker === 'icon') {
      const sz = t.size || 30;
      el.innerHTML = `<div class="ic ic-${glyph}" style="--ic:${t.icon || t.color};width:${sz}px;height:${sz}px">${svgTag(glyph, sz, 'class="ic-svg"')}</div>`;
    } else {
      el.innerHTML = glyphDisc(a.type, 34, 18, 'sai', a.marker_glyph);
    }
    el.innerHTML = `<div class="mk-s">${el.innerHTML}</div>`;
    // civil family: pinned to its exact place; a small tidy dot at country view, the icon from zoom 7.5 up
    if (t.group === 'civil') {
      el.classList.add('mk-civ');
      el.insertAdjacentHTML('beforeend', `<span class="civ-dot" style="--ic:${t.icon || t.color}"></span>`);
    }
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.selectMarker(a.id);
      }
    });
    return el;
  }

  _startGlow() {
    // Circle-fill pulse runs on the compositor via .zp-fill; never animate the MapLibre paint layer,
    // because repeated setPaintProperty calls force expensive WebGL map redraws on phones.
  }
  // Keep every affected-area circle in proportion to the screen: it follows its real size on the
  // ground, but never shrinks below a visible dot at country view nor grows past a comfortable share
  // of the screen when zoomed in (laptop, phone and phone "desktop site" alike).
  _screenKm(km, lat) {
    const c = this.map.getContainer();
    const vmin = Math.max(200, Math.min(c.clientWidth, c.clientHeight) || 600);
    const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, this.map.getZoom()));
    const px = Math.min(vmin * 0.18, Math.max(5, (km * 1000) / mpp));
    return (px * mpp) / 1000;
  }
  _queueZones() {
    if (this._zq) return;
    this._zq = requestAnimationFrame(() => { this._zq = 0; this.updateZones(); });
  }
  updateZones() {
    const src = this.map && this.map.getSource('ras-zones');
    if (!src) return;
    const features = [];
    const pulses = [];
    const orb = (this._orb = new Map());
    const hits = (this._hits = []);
    for (const a of this.alerts) {
      const t = ALERT_TYPES[a.type];
      // every alert type gets a glowing circle over each affected area (aircraft keep their dashed blue ring)
      if (!t || t.marker === 'movement' || a.scope === 'country' || !a.location || !Number.isFinite(a.location.latitude)) continue;
      const props = { color: t.zone === 'dashed' ? t.color : ZONE_COLOR[a.type] || '#ef233c', active: !!a.is_active, dashed: t.zone === 'dashed' };
      // one circle per affected locality (server-computed), like the original map
      const zs = Array.isArray(a.zones) && a.zones.length ? a.zones : [{ lat: a.location.latitude, lon: a.location.longitude, km: ZONE_KM[a.scope] || ZONE_KM.place }];
      if (t.marker === 'orbit' || t.marker === 'squad') {
        // the drone circles the ring nearest to its own position (the alert's main place)
        let best = zs[0], bd = Infinity;
        for (const z of zs) { const d = (z.lat - a.location.latitude) ** 2 + (z.lon - a.location.longitude) ** 2; if (d < bd) { bd = d; best = z; } }
        orb.set(a.id, { km: this._screenKm(best.km, best.lat), lat: best.lat, squad: t.marker === 'squad' });
      }
      zs.forEach((z, i) => {
        const km = this._screenKm(z.km, z.lat);
        hits.push({ id: a.id, lon: z.lon, lat: z.lat, km, ts: Date.parse(a.timestamp) || 0, live: !!a.is_active });
        features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [circlePolygon(z.lon, z.lat, km)] } });
        if (a.is_active && pulses.length < 80) pulses.push({ key: `${a.id}:${i}`, lon: z.lon, lat: z.lat, km, color: props.color });
      });
    }
    src.setData({ type: 'FeatureCollection', features });
    this._syncPulses(pulses);
    this._orbitPx();
  }
  // Pulsing glow over every circle of a live alert. Plain DOM rings animated with transform/opacity
  // only (GPU compositor), so the map itself never has to redraw for the animation — phones stay smooth.
  _syncPulses(list) {
    const M = ml();
    if (!this._pulses) this._pulses = new Map();
    const z = this.map.getZoom();
    const keep = new Set();
    for (const p of list) {
      keep.add(p.key);
      const mpp = (40075016.686 * Math.cos((p.lat * Math.PI) / 180)) / (512 * Math.pow(2, z));
      const d = Math.max(16, Math.round((2 * p.km * 1000) / mpp));
      let m = this._pulses.get(p.key);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'zp';
        const fill = document.createElement('span');
        fill.className = 'zp-fill';
        fill.setAttribute('aria-hidden', 'true');
        el.append(fill);
        el.setAttribute('aria-hidden', 'true');
        m = new M.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(this.map);
        el.style.zIndex = '1';
        this._pulses.set(p.key, m);
      }
      const el = m.getElement();
      if (el._d !== d) { el._d = d; el.style.setProperty('--d', d + 'px'); }
      if (el._c !== p.color) { el._c = p.color; el.style.setProperty('--c', p.color); }
    }
    for (const [k, m] of this._pulses) if (!keep.has(k)) { m.remove(); this._pulses.delete(k); }
    if (!this.map.isZooming()) this.el.classList.remove('is-zooming');
  }
  // Scale aircraft markers while keeping supplemental drone copies close to their exact area anchors.
  _orbitPx() {
    if (!this._orb || !this.map) return;
    const z = this.map.getZoom();
    for (const [id, o] of this._orb) {
      const m = this.markers.get(id);
      if (!m) continue;
      const mpp = (40075016.686 * Math.cos((o.lat * Math.PI) / 180)) / (512 * Math.pow(2, z));
      const el = m.getElement();
      if (o.squad) {
        // Keep the full three-plane squad moving at country view too; shrink the planes and formation
        // together as the visible flight ring gets smaller so they remain legible without crowding the map.
        const r = Math.round((o.km * 1000) / mpp);
        const layout = squadLayout(r);
        if (el._fy !== layout.flightRadius) { el._fy = layout.flightRadius; el.style.setProperty('--fy', layout.flightRadius + 'px'); }
        if (el._sqi !== layout.planeScale) { el._sqi = layout.planeScale; el.style.setProperty('--sqi', layout.planeScale.toFixed(2)); }
        if (el._sqf !== layout.formationScale) { el._sqf = layout.formationScale; el.style.setProperty('--sqf', layout.formationScale.toFixed(2)); }
        continue;
      }
      if (z < 11) continue;
      const px = Math.max(8, Math.min(12, Math.round((o.km * 1000) / mpp)));
      if (el._orb !== px) { el._orb = px; el.style.setProperty('--orb', px + 'px'); }
    }
    if (z >= 11 && this.sats) for (const m of this.sats.values()) {
      if (!Number.isFinite(m._zkm)) continue;
      const mpp = (40075016.686 * Math.cos((m._lat * Math.PI) / 180)) / (512 * Math.pow(2, z));
      const px = Math.max(8, Math.min(12, Math.round((this._screenKm(m._zkm, m._lat) * 1000) / mpp)));
      const el = m.getElement();
      if (el._orb !== px) { el._orb = px; el.style.setProperty('--orb', px + 'px'); }
    }
  }

  // ------------------------------------------------------------- selection / camera
  select(alert, { fly = true, popup = true } = {}) {
    this.selectedId = alert ? alert.id : null;
    if (!this.ready) { this._pending = alert ? [alert, { fly, popup }] : null; return; }
    this.refreshMarkerGroups();
    if (!alert) return this.closePopup();
    if (!alert.location || !Number.isFinite(alert.location.latitude)) return this.closePopup();
    const ll = [alert.location.longitude, alert.location.latitude];
    const zs = Array.isArray(alert.zones) ? alert.zones : [];
    if (fly && alert.more && alert.more.length && zs.length > 1) {
      // several areas: frame all of their circles
      let w = 180, e = -180, s = 90, n = -90;
      for (const q of zs) { const dl = q.km / 111, dn = q.km / (111 * Math.cos((q.lat * Math.PI) / 180)); w = Math.min(w, q.lon - dn); e = Math.max(e, q.lon + dn); s = Math.min(s, q.lat - dl); n = Math.max(n, q.lat + dl); }
      this.map.fitBounds([[w, s], [e, n]], { padding: this.padding(), maxZoom: 11, duration: 1100, essential: true });
    } else if (fly) {
      const z = { place: 11, point: 11.5, district: 9.5, governorate: 8 }[alert.scope] || 9;
      this.map.flyTo({ center: ll, zoom: Math.max(this.map.getZoom(), z), padding: this.padding(), speed: 1.4, essential: true });
    }
    if (popup) this.openPopup(alert);
  }

  // the alert circle under a map point: smallest circle first (the most precise area), then live, then newest
  zoneAt(ll) {
    if (!ll || !this._hits || !this._hits.length) return null;
    let best = null;
    const cos = Math.cos((ll.lat * Math.PI) / 180);
    for (const h of this._hits) {
      const dy = (ll.lat - h.lat) * 111.32, dx = (ll.lng - h.lon) * 111.32 * cos;
      if (dx * dx + dy * dy > h.km * h.km) continue;
      if (!best || h.km < best.km - 0.01 || (Math.abs(h.km - best.km) <= 0.01 && (h.live > best.live || (h.live === best.live && h.ts > best.ts)))) best = h;
    }
    return best;
  }
  // Phone detection for mobile map rendering/3D performance; alert popups remain anchored to their map circles.
  dockMode() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    return window.innerWidth < 768 || (coarse && Math.min(screen.width || 9999, screen.height || 9999) < 768);
  }
  // Service cards remain docked on phones; alert-circle popups use MapLibre's point-anchored popup below.
  openDockHtml(html, ll, { id = null, cls = '', onClose = null } = {}) {
    const card = document.createElement('div');
    card.className = 'pp-dock' + (cls ? ' ' + cls : '');
    card.setAttribute('role', 'dialog');
    const x = document.createElement('button'); x.className = 'pp-dock-x'; x.type = 'button'; x.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Close' : 'إغلاق'); x.textContent = '×';
    const body = document.createElement('div'); body.className = 'pp-dock-body maplibregl-popup-content'; body.append(htmlToNode(html));
    card.append(x, body);
    for (const old of this.el.querySelectorAll('.pp-dock')) old.remove();
    this.el.append(card);
    document.body.classList.add('pp-docked');
    let tm = 0;
    const place = () => this.placeDock(card);
    const tick = () => { place(); tm = setTimeout(tick, 300); };
    const pp = {
      _alertId: id, _dock: true,
      getElement: () => card,
      on() { return pp; },
      remove: () => {
        clearTimeout(tm); card.remove();
        if (!this.el.querySelector('.pp-dock')) { document.body.classList.remove('pp-docked'); for (const c of document.querySelectorAll('.map-ctrls')) c.style.transform = ''; }
        if (onClose) onClose();
      },
    };
    x.addEventListener('click', (e) => { e.stopPropagation(); if (id) this.closePopup(); else pp.remove(); });
    requestAnimationFrame(() => { tick(); if (ll) this.showAboveDock(ll, card); });
    return pp;
  }
  // bottom of the dock = top of the list sheet (when it covers the map), the zoom buttons move up above the card
  placeDock(card) {
    if (!card.isConnected) return;
    const mr = this.el.getBoundingClientRect();
    let b = 10;
    for (const sh of document.querySelectorAll('.sidebar')) {
      const r = sh.getBoundingClientRect();
      if (r.height && r.top > mr.top + 120 && r.top < mr.bottom) b = Math.max(b, mr.bottom - r.top + 10);
    }
    card.style.bottom = b + 'px';
    card.style.maxHeight = Math.max(140, mr.height - b - 76) + 'px';
    const cr = card.getBoundingClientRect();
    for (const c of document.querySelectorAll('.map-ctrls')) {
      c.style.transform = '';
      const r = c.getBoundingClientRect();
      if (r.height && r.bottom > cr.top - 8 && r.top < cr.bottom) c.style.transform = `translateY(${-(r.bottom - cr.top + 10)}px)`;
    }
  }
  // after the flight: if the alert's point ends up behind the card, nudge the map so it sits in the free area above
  showAboveDock(ll, card) {
    const go = () => {
      if (!card.isConnected || !this.map) return;
      const pt = this.map.project(ll);
      const mr = this.el.getBoundingClientRect(); const cr = card.getBoundingClientRect();
      const freeTop = 70; const freeBot = cr.top - mr.top - 16;
      if (freeBot - freeTop < 60) return;
      if (pt.y > freeBot || pt.y < freeTop) this.map.panBy([0, pt.y - (freeTop + freeBot) / 2], { duration: 350 });
    };
    if (this.map.isMoving()) this.map.once('moveend', () => setTimeout(go, 30)); else go();
  }
  openPopup(alert) {
    const M = ml();
    this.closePopup();
    const at = this._popupAt && this._popupAt.id === alert.id ? this._popupAt.ll : null;
    this._popupAt = null;
    const m = at ? null : this.markers.get(alert.id);
    const off = m ? m.getOffset() : { x: 0, y: 0 };
    this.popup = new M.Popup({ className: 'pp-alert-popup', closeButton: true, closeOnClick: false, maxWidth: 'min(360px, calc(100vw - 24px))', offset: { bottom: [off.x, off.y - 26], top: [off.x, off.y + 26], left: [off.x + 26, off.y], right: [off.x - 26, off.y] }, focusAfterOpen: false })
      .setLngLat(at || [alert.location.longitude, alert.location.latitude])
      .setDOMContent(htmlToNode(this.popupHtml(alert)))
      .addTo(this.map);
    this.popup._alertId = alert.id;
    this.bindClamp();
    // put the card inside the map's gesture layer (like the markers): pinch / drag that start on the card
    // now zoom and pan the map instead of being swallowed (on phones the card covers the middle of the map)
    const pe = this.popup.getElement();
    if (pe) {
      pe.classList.add('pp-gest');
      const content = pe.querySelector('.maplibregl-popup-content');
      content?.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
      content?.addEventListener('touchstart', (event) => { if (content.scrollHeight > content.clientHeight + 2) event.stopPropagation(); }, { passive: true });
      content?.addEventListener('touchmove', (event) => { if (content.scrollHeight > content.clientHeight + 2) event.stopPropagation(); }, { passive: true });
      this.map.getCanvasContainer().appendChild(pe);
    }
    this.popup.on('close', () => {
      if (this.popup && this.popup._alertId === alert.id) this.popup = null;
    });
    // keep the card fully on screen: after it is laid out, and again whenever the map stops moving
    this._fitLeft = 2; // one fit after layout, one after the opening flight lands
    requestAnimationFrame(() => requestAnimationFrame(() => this.fitPopup()));
    if (!this._fitBound) {
      this._fitBound = true;
      this.map.on('movestart', (e) => { if (e.originalEvent) this._fitLeft = 0; }); // user took over
      this.map.on('moveend', (e) => { if (!e.originalEvent && !this._fitPanning && this._fitLeft > 0) this.fitPopup(); this._fitPanning = false; });
      window.addEventListener('orientationchange', () => { this._fitLeft = 1; setTimeout(() => this.fitPopup(), 400); });
    }
    return this.popup;
  }
  // Pan the map just enough that the open popup lies completely inside the visible part of the map
  // (works with page zoom in phone "desktop site" mode, the top controls and bottom-positioned panels).
  // visible part of the map in client px, excluding the top controls and any bottom-positioned panel
  visBox() {
    const c = this.map.getContainer();
    const cr = c.getBoundingClientRect();
    const scale = c.clientWidth ? cr.width / c.clientWidth : 1; // rect px per map px
    const vv = window.visualViewport;
    const vis = { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom };
    if (vv) {
      const z = (window.__uiz || 1) > 1 ? window.__uiz : 1;
      vis.l = Math.max(vis.l, vv.offsetLeft / z); vis.t = Math.max(vis.t, vv.offsetTop / z);
      vis.r = Math.min(vis.r, (vv.offsetLeft + vv.width) / z); vis.b = Math.min(vis.b, (vv.offsetTop + vv.height) / z);
    }
    // overlays on top of the map: floating buttons (top) and the bottom sheet (bottom)
    let top = vis.t;
    for (const s of document.querySelectorAll('.map-tools, .map-top, .fab-row')) {
      const r = s.getBoundingClientRect();
      if (r.height && r.bottom > top && r.top < vis.t + 140) top = Math.max(top, r.bottom);
    }
    let bottom = vis.b;
    for (const s of document.querySelectorAll('.sidebar')) {
      const r = s.getBoundingClientRect();
      if (r.height && r.top < bottom && r.top > vis.t + 120) bottom = Math.min(bottom, r.top);
    }
    return { vis, top, bottom, scale };
  }
  fitPopup() {
    const p = this.popup;
    const el = p && p.getElement && p.getElement();
    if (!el || !this.map || !(this._fitLeft > 0) || p._dock) return;
    if (this.map.isMoving()) return; // wait for the flight to land (moveend calls us again)
    this._fitLeft = 0; // the map has settled: fit once, then leave the user's camera alone
    this.clampPopups(true);
    const { vis, top, bottom, scale } = this.visBox();
    const m = 10 * scale;
    const r = el.getBoundingClientRect();
    let dx = 0; let dy = 0;
    if (r.width > vis.r - vis.l - 2 * m) dx = r.left + r.width / 2 - (vis.l + vis.r) / 2;
    else if (r.right > vis.r - m) dx = r.right - (vis.r - m);
    else if (r.left < vis.l + m) dx = r.left - (vis.l + m);
    if (r.top < top + m) dy = r.top - (top + m);
    else if (r.bottom > bottom - m) dy = Math.min(r.bottom - (bottom - m), r.top - (top + m));
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { this._fitPanning = true; this._fitLeft = 0; this.map.panBy([dx / scale, dy / scale], { duration: 350 }); }
  }

  // laptop / desktop: while the user zooms or pans, a popup whose point drifts toward (or past) the edge slides
  // back inside the visible map instead of leaving the screen; its tip hides while it is shifted
  clampPopups(reset = false) {
    if (!this.map) return;
    const pops = this.el.querySelectorAll('.maplibregl-popup');
    if (!pops.length) return;
    const { vis, top, bottom, scale } = this.visBox();
    const m = 10 * scale;
    for (const pe of pops) {
      const ct = pe.querySelector('.maplibregl-popup-content');
      if (!ct) continue;
      const sx = reset ? 0 : (+ct.dataset.sx || 0); const sy = reset ? 0 : (+ct.dataset.sy || 0);
      const r = ct.getBoundingClientRect();
      const L = r.left - sx * scale; const R = r.right - sx * scale; const Tp = r.top - sy * scale; const B = r.bottom - sy * scale;
      let dx = 0; let dy = 0;
      if (R - L > vis.r - vis.l - 2 * m) dx = (vis.l + vis.r) / 2 - (L + R) / 2;
      else if (L < vis.l + m) dx = vis.l + m - L;
      else if (R > vis.r - m) dx = vis.r - m - R;
      if (Tp < top + m) dy = top + m - Tp;
      else if (B > bottom - m) dy = Math.max(bottom - m - B, top + m - Tp);
      const nx = Math.round(dx / scale); const ny = Math.round(dy / scale);
      ct.dataset.sx = nx; ct.dataset.sy = ny;
      const moved = Math.abs(nx) > 2 || Math.abs(ny) > 2;
      ct.style.transform = moved ? `translate(${nx}px, ${ny}px)` : '';
      pe.classList.toggle('pp-clamped', moved);
    }
  }
  bindClamp() {
    if (this._clampBound || !this.map) return;
    this._clampBound = true;
    let raf = 0;
    const go = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; this.clampPopups(); }); };
    this.map.on('move', go); this.map.on('resize', go);
    window.addEventListener('resize', go);
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
    this.map.fitBounds(SYRIA_BOUNDS, { padding: this.padding(), duration: 900, pitch: this.opts.map3d ? (this.dockMode() ? 40 : 50) : 0, bearing: 0 });
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
  hideMe() { if (this.me) { this.me.remove(); this.me = null; } }
}
