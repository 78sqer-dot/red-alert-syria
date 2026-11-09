// Map module — MapLibre GL with OpenFreeMap vector tiles, Esri imagery and AWS terrain.
import { ALERT_TYPES, ZONE_KM, assassinationWeaponGlyph, shootingWeaponGlyph, alertEmoji, alertMarkerKind, typeOf, FLIGHT_DIRECTIONS, eventVisual } from '/shared/types.js?v=41';
import { mapDroneCount } from '/shared/map-drone-visuals.js?v=1';
import { SVG } from './marker-svgs.js?v=19';
import { EXTRA_SVG } from './target-svgs.js?v=19';
import { alertFocusZoom, alertTransitionDuration, distanceKm } from '/shared/map-motion.js?v=1';
import { typeIcon } from './type-icons.js?v=7';
import { clusterAlertsByScreen } from './marker-layout.js?v=3';
import { markerTapMatchesMapClick } from './map-click-guard.js?v=1';
import { zoneVisualKey, pulseVisualKey } from '/shared/zone-visuals.js?v=3';
import { zoneHitAt } from '/shared/zone-hit-test.js?v=1';
import { directFlightPath, directFlightBearing, referenceFlightPath, flightPathBearing, flightPosition, ISRAEL_APPROX_REFERENCE, LEGACY_QUNEITRA_ALERT_ID, isLegacyQuneitraArchiveAlert, legacyQuneitraArchivePath } from '/shared/flight-path.js?v=6';
const ml = () => window.maplibregl;
const aircraftHeading = (alert, bearing) => alert.aircraft === 'uav'
  ? (alert.flight_direction === 'leaving_syria' ? 180 : 0)
  : (Number.isFinite(bearing) ? bearing : alert.flight_direction === 'entering_syria' ? 270 : alert.flight_direction === 'leaving_syria' ? 180 : 0);
// Client-only display override for the known Quneitra report; never changes its saved coordinates or post.
const LEGACY_ISRAEL_REFERENCE_ALERTS = new Set([LEGACY_QUNEITRA_ALERT_ID]);
const hasIsraelReferenceRoute = (alert) => alert?.flight_route_origin === 'israel_approx_reference'
  || LEGACY_ISRAEL_REFERENCE_ALERTS.has(alert?.id);
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
export { typeIcon };
const svgTag = (glyph, size, extra = '') => `<svg viewBox="0 0 512 512" width="${size}" height="${size}" ${extra} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${EXTRA_SVG[glyph] || SVG[glyph] || SVG.other}</svg>`;
// White disc with a professional category-coloured glyph and edge.
export function glyphDisc(type, size = 34, iconSize = 24, cls = 'sai', glyphOverride = null) {
  const t = typeOf(type);
  const visual = eventVisual(type);
  const bg = '#f8fafc';
  const fg = visual.color;
  return `<span class="${cls}" style="width:${size}px;height:${size}px;background:${bg};border-color:${visual.color};color:${fg}">${svgTag(glyphOverride || t.glyph, iconSize, `fill="${fg}"`)}</span>`;
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
    this.selectedAlert = null;
    this.popup = null;
    this._groupPopupNav = null;
    this._replacingPopup = false;
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
    this.map.addControl(new M.AttributionControl({ compact: false, customAttribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · GeoNames · geoBoundaries' }), this.opts.lang === 'ar' ? 'bottom-left' : 'bottom-right');
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
      c.classList.toggle('zoom-detail', z >= 10.5);
      c.classList.toggle('zoom-tier-mid', z >= 9 && z < 10.5);
      c.classList.toggle('zoom-tier-far', z < 9);
      c.classList.toggle('zoom-far', z < 7.5);
      // Keep the drone hidden on the country view, but reveal its orbit at the close-zoom level
      // reached by mobile multi-area alerts (which can settle just under zoom 11).
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
      this.refreshMarkerGroups();
    });
    // pulse rings are re-sized when the zoom settles; hidden meanwhile so they never look out of scale
    this.map.on('zoomstart', () => this.el.classList.add('is-zooming'));
    // pause the marker animations while a gesture/flight is running so the map itself stays smooth
    this.map.on('movestart', () => this.el.classList.add('is-moving'));
    this.map.on('moveend', () => {
      this.el.classList.remove('is-moving');
      this.refreshMarkerGroups();
    });
    this.map.on('resize', () => { this._queueZones(); this.refreshMarkerGroups(); });
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
      const hit = this.zoneAt(e.lngLat, e.point);
      if (hit) { this._popupAt = { id: hit.id, ll: [hit.lon, hit.lat] }; return this.onSelect(hit.id, { fromMap: true, fly: true }); }
      this.onSelect(null, { fromMap: true });
    });
    // Hover hit-testing is useful for desktop cursors, but costs work during touch/pan gestures.
    if (!window.matchMedia?.('(pointer: coarse)').matches) {
      this.map.on('mousemove', (e) => {
        const c = this.map.getCanvas();
        const want = this.zoneAt(e.lngLat, e.point) ? 'pointer' : '';
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
    // Geographic impact circles remain accurate; use restrained fills and outlines to preserve base-map detail.
    const A = (on, off) => ['case', ['get', 'active'], on, off];
    add({ id: 'ras-zones-fill', type: 'fill', source: 'ras-zones', filter: ['!', ['get', 'dashed']], paint: { 'fill-color': ['get', 'color'], 'fill-opacity': A(dark ? 0.11 : 0.08, 0.025) } });
    add({ id: 'ras-zones-line', type: 'line', source: 'ras-zones', filter: ['!', ['get', 'dashed']], paint: { 'line-color': ['get', 'color'], 'line-opacity': A(0.58, 0.22), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 11, 1.3] } });
    add({ id: 'ras-zones-dash', type: 'line', source: 'ras-zones', filter: ['get', 'dashed'], paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'planeArea'], true], 1.5, 1.8], 'line-opacity': ['case', ['==', ['get', 'planeArea'], true], 0.7, A(0.85, 0.3)], 'line-dasharray': [3, 4] } });
    add({ id: 'ras-flight-path-line', type: 'line', source: 'ras-flight-paths', paint: { 'line-color': ['get', 'color'], 'line-opacity': ['case', ['get', 'referenceRoute'], 0.92, ['get', 'planeRoute'], 0.45, 0.9], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'referenceRoute'], 2.4, ['get', 'planeRoute'], 1.5, 1.35], 10, ['case', ['get', 'referenceRoute'], 3.2, ['get', 'planeRoute'], 1.5, 2.1]], 'line-dasharray': ['case', ['get', 'referenceRoute'], ['literal', [4, 2]], ['get', 'planeRoute'], ['literal', [3, 4]], ['literal', [2, 2]]] } });
    add({ id: 'ras-flight-direction-arrow', type: 'symbol', source: 'ras-flight-paths', filter: ['any', ['==', ['get', 'referenceRoute'], true], ['!=', ['get', 'planeRoute'], true]], layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'arrow'], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 12, 10, 16], 'text-rotation-alignment': 'map', 'text-keep-upright': false, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': dark ? '#111827' : '#ffffff', 'text-halo-width': 2, 'text-opacity': 0.92 } });
    add({ id: 'ras-flight-reference-point', type: 'circle', source: 'ras-flight-paths', filter: ['==', ['get', 'referenceOrigin'], true], paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-stroke-color': dark ? '#111827' : '#ffffff', 'circle-stroke-width': 1.6 } });
    add({ id: 'ras-flight-reference-label', type: 'symbol', source: 'ras-flight-paths', filter: ['==', ['get', 'referenceOrigin'], true], layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 12], 'text-anchor': 'left', 'text-offset': [0.8, 0], 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': dark ? '#111827' : '#ffffff', 'text-halo-width': 2, 'text-opacity': 0.96 } });
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
    for (const id of ['ras-zones-fill', 'ras-zones-line', 'ras-zones-dash', 'ras-flight-path-line', 'ras-flight-direction-arrow', 'ras-flight-reference-point', 'ras-flight-reference-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
    this.syncMovementTracks();
  }
  applyToggles() {
    const map = this.map;
    if (!map || !map.getLayer('ras-border')) return;
    const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    for (const id of ['ras-zones-fill', 'ras-zones-line', 'ras-zones-dash', 'ras-flight-path-line', 'ras-flight-direction-arrow', 'ras-flight-reference-point', 'ras-flight-reference-label']) vis(id, !this.newsHidden);
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
    const selected = alerts.find((alert) => alert.id === selectedId);
    if (selected) this.selectedAlert = selected;
    else if (this.selectedAlert?.id !== selectedId) this.selectedAlert = null;
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
    const isReferenceRoute = hasIsraelReferenceRoute(alert);
    const targetName = lang === 'en' ? alert.flight_target?.name_en : alert.flight_target?.name_ar;
    const destinationName = targetName || (lang === 'en' ? 'Syria' : 'سوريا');
    const reportedPlace = lang === 'en'
      ? (alert.place?.name_en || alert.location?.name_en || 'the original report location')
      : (alert.place?.name_ar || alert.location?.name_ar || 'الموقع الأصلي للبلاغ');
    const israelReferenceLabel = lang === 'en' ? 'Israel (approx. reference)' : 'إسرائيل (مرجع تقريبي)';
    const routeNote = isReferenceRoute
      ? (lang === 'en'
        ? `Illustrative line from an approximate reference inside Israel; reported location remains ${reportedPlace}. Not a live track.`
        : `خط توضيحي من مرجع تقريبي داخل إسرائيل؛ موقع البلاغ الأصلي يبقى ${reportedPlace}. ليس تتبعاً مباشراً.`)
      : (lang === 'en' ? 'Schematic route · not a live track' : 'مسار توضيحي · ليس تتبعاً مباشراً');
    const plane = document.createElement('span');
    plane.className = 'map-flight-plane';
    plane.setAttribute('aria-hidden', 'true');
    const aircraft = alert.aircraft === 'uav' ? 'uav' : 'plane';
    const fill = aircraft === 'uav' ? '#6b7280' : '#2476c9';
    plane.innerHTML = svgTag(aircraft, 24, `fill="${fill}" class="map-flight-svg"`);
    const arrow = document.createElement('span');
    arrow.className = 'map-flight-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    const destination = document.createElement('b');
    destination.className = 'map-flight-destination';
    destination.textContent = destinationName;
    const flow = this.movementNotice.querySelector('.map-flight-flow');
    if (isReferenceRoute && alert.flight_direction === 'leaving_syria') {
      const source = document.createElement('b');
      source.textContent = destinationName;
      const arrowToIsrael = document.createElement('span');
      arrowToIsrael.className = 'map-flight-arrow';
      arrowToIsrael.setAttribute('aria-hidden', 'true');
      arrowToIsrael.textContent = '→';
      const israel = document.createElement('b');
      israel.className = 'map-flight-destination';
      israel.textContent = israelReferenceLabel;
      flow.replaceChildren(source, arrow, plane, arrowToIsrael, israel);
    } else {
      flow.replaceChildren(...(alert.flight_direction === 'leaving_syria' ? [destination, arrow, plane] : [plane, arrow, destination]));
    }
    const label = movements.length > 1 ? `${direction} (+${movements.length - 1})` : direction;
    this.movementNotice.querySelector('.map-flight-label').textContent = label;
    this.movementNotice.querySelector('.map-flight-note').textContent = routeNote;
    this.movementNotice.dataset.alertId = alert.id;
    this.movementNotice.classList.toggle('is-leaving', alert.flight_direction === 'leaving_syria');
    this.movementNotice.setAttribute('aria-label', `${direction}: ${destinationName} — ${routeNote}`);
    this.movementNotice.title = this.movementNotice.getAttribute('aria-label');
  }

  movementTrackAlerts() {
    if (this.newsHidden) return [];
    return this.alerts
      .filter((a) => a.type === 'air_movement' && a.is_active && FLIGHT_DIRECTIONS[a.flight_direction]
        && Number.isFinite(a.location?.latitude) && Number.isFinite(a.location?.longitude))
      .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0))
      .slice(0, 3);
  }

  // Warplane icons may travel along the selected illustrative route; this is not live tracking and
  // never changes the saved report location. Reports without coordinates retain the location notice.
  syncMovementTracks() {
    const map = this.map;
    const source = map?.getSource('ras-flight-paths');
    if (!map || !source) return;
    const M = ml();
    if (!this.movementTracks) this.movementTracks = new Map();
    const active = this.movementTrackAlerts();
    const keep = new Set();
    const routeFeatures = [];
    let includesReferenceRoute = false;
    active.forEach((alert) => {
      const position = [alert.location.longitude, alert.location.latitude];
      const isReferenceRoute = hasIsraelReferenceRoute(alert);
      const route = isReferenceRoute
        ? referenceFlightPath(alert.flight_direction, alert.flight_target)
        : directFlightPath(alert.location, alert.flight_target);
      const savedBearing = directFlightBearing(alert.location, alert.flight_target);
      const routeBearing = flightPathBearing(route);
      const heading = isReferenceRoute && Number.isFinite(routeBearing) ? routeBearing : aircraftHeading(alert, savedBearing);
      keep.add(alert.id);
      const aircraft = alert.aircraft === 'uav' ? 'uav' : 'plane';
      const color = eventVisual('air_movement').color;
      const iconColor = aircraft === 'uav' ? color : '#3b8eff';
      const routeColor = aircraft === 'uav' ? '#e5484d' : '#2476c9';
      const lang = this.opts.lang === 'en' ? 'en' : 'ar';
      const direction = FLIGHT_DIRECTIONS[alert.flight_direction][lang];
      const reportedPlace = lang === 'en'
        ? (alert.place?.name_en || alert.location?.name_en || 'the original report location')
        : (alert.place?.name_ar || alert.location?.name_ar || 'الموقع الأصلي للبلاغ');
      const routeNote = isReferenceRoute
        ? (lang === 'en'
          ? `Display-only route from an approximate reference inside Israel; reported location remains ${reportedPlace}. Not a live track.`
          : `مسار عرض توضيحي من مرجع تقريبي داخل إسرائيل؛ موقع البلاغ الأصلي يبقى ${reportedPlace}. ليس تتبعاً مباشراً.`)
        : (lang === 'en' ? 'illustrative direction, not a live track' : 'حركة توضيحية للاتجاه وليست تتبعاً مباشراً');
      if (route.length === 2) {
        if (isReferenceRoute) includesReferenceRoute = true;
        routeFeatures.push({
          type: 'Feature',
          id: alert.id,
          properties: { color: routeColor, arrow: '➤', alertId: alert.id, illustrative: true, planeRoute: aircraft !== 'uav', referenceRoute: isReferenceRoute },
          geometry: { type: 'LineString', coordinates: route },
        });
      }
      const movementTitle = lang === 'en' ? `Open alert: ${alert.title}` : `افتح التنبيه: ${alert.title}`;
      const signature = `${lang}|${aircraft}|${iconColor}|${routeColor}|${alert.flight_direction}|${heading}|${position.join(',')}|${route.join(';')}`;
      let track = this.movementTracks.get(alert.id);
      if (track && track.signature !== signature) {
        if (track.frame) cancelAnimationFrame(track.frame);
        track.marker.remove();
        this.movementTracks.delete(alert.id);
        track = null;
      }
      if (!track) {
        const el = document.createElement('div');
        el.className = `maplibregl-marker map-flight-track-marker ${aircraft === 'uav' ? 'is-uav' : 'is-plane'} is-${alert.flight_direction.replace(/_/g, '-')}`;
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.setAttribute('aria-label', `${movementTitle} · ${direction}`);
        el.title = `${direction} · ${routeNote}`;
        const visual = document.createElement('span'); visual.className = 'map-flight-track-visual';
        const squad = document.createElement('span'); squad.className = 'map-flight-track-squad';
        const formation = document.createElement('span'); formation.className = 'map-flight-track-formation';
        for (const slot of [{ name: 'is-lead', size: 24 }, { name: 'is-left', size: 24 }, { name: 'is-right', size: 24 }]) {
          const airframe = document.createElement('span');
          airframe.className = `map-flight-track-airframe ${slot.name}`;
          airframe.innerHTML = svgTag(aircraft, slot.size, `fill="${iconColor}" class="map-flight-track-svg"`);
          formation.append(airframe);
        }
        squad.append(formation);
        visual.append(squad);
        el.append(visual);
        const marker = new M.Marker({ element: el, anchor: 'center', rotationAlignment: 'map' }).setLngLat(position).addTo(map);
        this.bindMarkerTap(el, () => this.onSelect(alert.id, { fromMap: true, fly: true }));
        track = { marker, element: el, signature, startedAt: performance.now(), frame: null };
        this.movementTracks.set(alert.id, track);
      }
      track.path = route;
      if (aircraft === 'plane' && route.length === 2) {
        if (track.frame == null) {
          const animate = (now) => {
            if (this.movementTracks.get(alert.id) !== track) return;
            if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
              track.marker.setLngLat(position);
              track.marker.setRotation(heading);
              track.frame = null;
              return;
            }
            const progress = ((now - track.startedAt) % 7000) / 7000;
            const point = flightPosition(track.path, progress);
            if (point) {
              track.marker.setLngLat([point.lon, point.lat]);
              track.marker.setRotation(point.bearing);
            }
            track.frame = requestAnimationFrame(animate);
          };
          track.frame = requestAnimationFrame(animate);
        }
      } else {
        track.marker.setLngLat(position);
        track.marker.setRotation(heading);
      }
      track.element.dataset.flightDirection = alert.flight_direction;
    });
    const archivedAlert = !this.newsHidden && this.selectedAlert?.id === this.selectedId
      && isLegacyQuneitraArchiveAlert(this.selectedAlert) ? this.selectedAlert : null;
    const archivedRoute = archivedAlert ? legacyQuneitraArchivePath(archivedAlert) : [];
    if (archivedRoute.length === 2) {
      includesReferenceRoute = true;
      routeFeatures.push({
        type: 'Feature',
        id: `archive-${LEGACY_QUNEITRA_ALERT_ID}`,
        properties: { color: '#2476c9', arrow: '➤', alertId: archivedAlert.id, illustrative: true, planeRoute: true, referenceRoute: true, archived: true },
        geometry: { type: 'LineString', coordinates: archivedRoute },
      });
    }
    for (const [id, track] of this.movementTracks) {
      if (keep.has(id)) continue;
      if (track.frame) cancelAnimationFrame(track.frame);
      track.marker.remove();
      this.movementTracks.delete(id);
    }
    if (includesReferenceRoute) {
      const lang = this.opts.lang === 'en' ? 'en' : 'ar';
      routeFeatures.push({
        type: 'Feature',
        id: 'israel-approx-reference-origin',
        properties: { referenceOrigin: true, illustrative: true, color: '#2563eb', label: lang === 'en' ? 'Approx. reference · Israel' : 'مرجع تقريبي · إسرائيل' },
        geometry: { type: 'Point', coordinates: [...ISRAEL_APPROX_REFERENCE] },
      });
    }
    source.setData({ type: 'FeatureCollection', features: routeFeatures });
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
    el.addEventListener('keydown', (e) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      activate();
    });
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
    const group = clusterAlertsByScreen(this.alerts, this.map, this.selectedId).find((g) => g.alerts.some((a) => a.id === id));
    if (group?.alerts.length > 1) return this.zoomToGroupChooser(group);
    this.onSelect(id, { fromMap: true, fly: true });
  }

  zoomToGroupChooser(group) {
    const located = group.alerts.filter((alert) => Number.isFinite(alert.location?.longitude) && Number.isFinite(alert.location?.latitude));
    if (!located.length) return this.openGroupChooser(group);
    this.closePopup();
    const center = located.reduce((sum, alert) => [sum[0] + alert.location.longitude / located.length, sum[1] + alert.location.latitude / located.length], [0, 0]);
    const currentZoom = this.map.getZoom();
    const zoom = Math.min(17, Math.max(currentZoom + 2, 7.5));
    if (zoom <= currentZoom + 0.01 && distanceKm([this.map.getCenter().lng, this.map.getCenter().lat], center) < 0.01) return this.openGroupChooser(group);
    this.map.once('moveend', () => this.openGroupChooser(group));
    this.map.flyTo({ center, zoom, padding: this.padding(), duration: 800, essential: true });
  }

  openGroupChooser(group) {
    this.closePopup();
    this._groupPopupNav = null;
    const lang = this.opts.lang === 'en' ? 'en' : 'ar';
    const title = document.createElement('h3');
    title.className = 'alert-group-heading';
    title.textContent = lang === 'en' ? `${group.alerts.length} alerts at this location` : `${group.alerts.length} تنبيهات متقاربة على الخريطة`;
    const list = document.createElement('div');
    list.className = 'alert-group-list';
    list.setAttribute('role', 'list');
    for (const alert of group.alerts) {
      const row = document.createElement('div');
      row.setAttribute('role', 'listitem');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'alert-group-item';
      const headline = document.createElement('span');
      headline.className = 'alert-group-title';
      headline.textContent = alert.title || (lang === 'en' ? 'Alert' : 'تنبيه');
      const meta = document.createElement('span');
      meta.className = 'alert-group-meta';
      const type = typeOf(alert.type);
      const label = lang === 'en' ? type.en : type.ar;
      const time = alert.timestamp && Number.isFinite(Date.parse(alert.timestamp))
        ? new Date(alert.timestamp).toLocaleTimeString(lang === 'en' ? 'en-US' : 'ar-SY', { hour: '2-digit', minute: '2-digit' })
        : '';
      meta.textContent = [label, time].filter(Boolean).join(' · ');
      item.append(headline, meta);
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        this.closePopup();
        this._groupPopupNav = { ids: group.alerts.map((item) => String(item.id)), currentId: String(alert.id) };
        this.onSelect(alert.id, { fromMap: true, fly: true });
      });
      row.append(item);
      list.append(row);
    }
    const content = document.createElement('section');
    content.className = 'alert-group-chooser';
    content.dir = lang === 'ar' ? 'rtl' : 'ltr';
    content.setAttribute('aria-label', title.textContent);
    content.append(title, list);
    const { longitude, latitude } = group.representative.location;
    const popup = new (ml().Popup)({ className: 'pp-group-popup', anchor: 'bottom', offset: [0, 0], closeButton: true, closeOnClick: false, maxWidth: 'min(360px, calc(100vw - 28px))', focusAfterOpen: false })
      .setLngLat([longitude, latitude])
      .setDOMContent(content)
      .addTo(this.map);
    this.popup = popup;
    popup._groupKey = group.key;
    popup._groupAlertIds = group.alerts.map((alert) => alert.id);
    const popupElement = popup.getElement();
    popup.on('close', () => { popupElement?._popupConnector?.remove(); if (this.popup === popup) this.popup = null; });
    popupElement?.classList.add('pp-gest');
    const popupContent = popup.getElement()?.querySelector('.maplibregl-popup-content');
    popupContent?.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    popupContent?.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
    popupContent?.addEventListener('touchmove', (event) => event.stopPropagation(), { passive: true });
    this.bindClamp();
    this.schedulePopupFit(1);
  }

  groupPopupNavigation(alertId) {
    const nav = this._groupPopupNav;
    if (!nav) return null;
    const live = new Set(this.alerts.filter((alert) => alert.is_active && Number.isFinite(alert.location?.latitude) && Number.isFinite(alert.location?.longitude)).map((alert) => String(alert.id)));
    nav.ids = nav.ids.filter((id) => live.has(String(id)));
    const index = nav.ids.indexOf(String(alertId));
    if (nav.ids.length < 2 || index < 0) { this._groupPopupNav = null; return null; }
    nav.currentId = String(alertId);
    return { ids: nav.ids, index, total: nav.ids.length };
  }

  groupPopupNavigationNode(nav) {
    const lang = this.opts.lang === 'en' ? 'en' : 'ar';
    const rtl = lang === 'ar';
    const bar = document.createElement('nav');
    bar.className = 'pp-group-nav';
    bar.dir = rtl ? 'rtl' : 'ltr';
    bar.setAttribute('aria-label', rtl ? 'التنقل بين أخبار المجموعة' : 'Navigate alerts in this group');
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'pp-group-prev';
    previous.textContent = rtl ? '→' : '←';
    previous.setAttribute('aria-label', rtl ? 'الخبر السابق' : 'Previous alert');
    previous.title = previous.getAttribute('aria-label');
    previous.disabled = nav.index === 0;
    previous.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); this.moveGroupPopup(-1); });
    const count = document.createElement('span');
    count.className = 'pp-group-nav-count';
    count.setAttribute('aria-live', 'polite');
    count.setAttribute('aria-atomic', 'true');
    count.textContent = rtl ? `${nav.index + 1} من ${nav.total}` : `${nav.index + 1} of ${nav.total}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'pp-group-next';
    next.textContent = rtl ? '←' : '→';
    next.setAttribute('aria-label', rtl ? 'الخبر التالي' : 'Next alert');
    next.title = next.getAttribute('aria-label');
    next.disabled = nav.index === nav.total - 1;
    next.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); this.moveGroupPopup(1); });
    bar.append(previous, count, next);
    return bar;
  }

  moveGroupPopup(delta) {
    const current = this._groupPopupNav?.currentId;
    const nav = this.groupPopupNavigation(current);
    if (!nav) return;
    const id = nav.ids[nav.index + delta];
    if (!id) return;
    this._groupPopupNav.currentId = id;
    this.onSelect(id, { fromMap: true, fly: false });
  }

  refreshMarkerGroups() {
    // Never write MapLibre's private _offset field: the library owns its Point.
    // Same-location reports share a visible marker, without inventing positions.
    const groups = clusterAlertsByScreen(this.alerts, this.map, this.selectedId);
    if (this.popup?._groupKey) {
      const ids = this.popup._groupAlertIds || [];
      const liveIds = new Set(this.alerts.map((alert) => String(alert.id)));
      if (!ids.length || ids.some((id) => !liveIds.has(String(id)))) this.closePopup();
    }
    for (const group of groups) {
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
        const lang = this.opts.lang === 'en' ? 'en' : 'ar';
        const hint = lang === 'en' ? `${count} nearby alerts — click to choose` : `${count} تنبيهات متقاربة — اضغط للاختيار`;
        const hints = count > 1 ? [hint] : [];
        el.title = hints.length ? `${a.title} · ${hints.join(' · ')}` : a.title;
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
    const movementTrackIds = new Set(this.movementTrackAlerts().map((a) => a.id));
    for (const a of this.alerts) {
      if (movementTrackIds.has(a.id) || !a.location || !Number.isFinite(a.location.latitude) || !Number.isFinite(a.location.longitude)) continue;
      seen.add(a.id);
      let m = this.markers.get(a.id);
      const sig = `${a.type}|${a.is_active}|${a.marker_glyph || ''}|${a.meta?.incursionKind || a.incursion_kind || ''}|${a.meta?.vehicleCount || a.vehicle_count || ''}|${a.meta?.patrolForm || ''}`;
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
      const per = mapDroneCount(a);
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
    if (this.popup?._groupKey) {
      const ids = this.popup._groupAlertIds || [];
      const liveIds = new Set(this.alerts.map((alert) => String(alert.id)));
      if (!ids.length || ids.some((id) => !liveIds.has(String(id)))) this.closePopup();
    }
    if (this.popup && this.popup._alertId && !seen.has(this.popup._alertId)) this.closePopup();
  }

  markerEl(a) {
    const t = typeOf(a.type);
    const visual = eventVisual(a.type);
    const incursionKind = a.meta?.incursionKind || a.incursion_kind || (Number.isInteger(a.meta?.vehicleCount) || Number.isInteger(a.vehicle_count) ? 'vehicles' : null);
    const signalDrone = a.type === 'signal_sweep' && (a.signal_platform === 'uav' || a.meta?.signalPlatform === 'uav');
    const marker = alertMarkerKind(a);
    const eventEmoji = ['airstrike', 'artillery', 'explosion', 'detonation', 'weather', 'fire', 'arrest'].includes(a.type)
      ? (a.type === 'weather' ? t.emoji : alertEmoji(a))
      : a.type === 'civil' && alertEmoji(a) === '🚑' ? alertEmoji(a) : null;
    const glyph = signalDrone ? 'signal_sweep_uav'
      : a.type === 'assassination' ? assassinationWeaponGlyph(a)
      : a.type === 'shooting' ? shootingWeaponGlyph(a)
        : a.type === 'military_incursion' ? (incursionKind === 'barrier' ? 'military_barrier' : incursionKind === 'soldiers' ? 'soldiers' : incursionKind === 'vehicles' ? 'military_vehicle' : t.glyph)
        : a.marker_glyph === 'weapon' ? 'weapon' : t.glyph;
    const el = document.createElement('div');
    el.className = `mk t-${a.type}${a.is_active ? '' : ' inactive'} mk-${marker}`;
    el.style.setProperty('--c', visual.color);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (marker === 'orbit') {
      const svgClass = signalDrone ? 'signal-sweep-uav-svg' : 'uav-svg';
      const svg = signalDrone ? svgTag(glyph, 36, `class="${svgClass}"`) : svgTag(glyph, 24, `class="${svgClass}"`);
      el.innerHTML = `<div class="uav-box"><div class="uav">${svg}</div></div>`;
    } else if (marker === 'helicopter') {
      const craft = `<span class="heli-craft">${svgTag(t.glyph, 24, `fill="${visual.color}" class="helicopter-svg"`)}</span>`;
      const second = a.helicopters > 1 ? `<span class="heli-craft heli-craft-second">${svgTag(t.glyph, 24, `fill="${visual.color}" class="helicopter-svg"`)}</span>` : '';
      el.innerHTML = `<div class="heli-orbit${second ? ' heli-intensive' : ''}">${craft}${second}</div>`;
    } else if (marker === 'squad') {
      const pl = (x, y, op) => `<div class="sq" style="left:${x}px;top:calc(50% + ${y}px);opacity:${op}">${svgTag(t.glyph, 24, `fill="${visual.color}" class="sq-svg"`)}</div>`;
      el.innerHTML = `<div class="squad">${pl(36, -12, 1)}${pl(20, 8, 0.85)}${pl(52, 8, 0.85)}</div>`;
    } else if (marker === 'fly') {
      el.innerHTML = `<div class="squad solo"><div class="sq" style="top:50%">${svgTag(t.glyph, 24, `fill="${visual.color}" class="fly-svg"`)}</div></div>`;
    } else if (marker === 'movement') {
      const aircraftGlyph = a.aircraft === 'uav' ? 'uav' : 'plane';
      const arrow = a.flight_direction === 'entering_syria' ? '⇢' : a.flight_direction === 'leaving_syria' ? '⇠' : '➤';
      const movement = a.flight_direction === 'entering_syria' ? 'entering' : a.flight_direction === 'leaving_syria' ? 'leaving' : 'toward';
      const plane = (slot, size) => `<span class="flight-airframe ${slot}">${svgTag(aircraftGlyph, size, `fill="${visual.color}" class="flight-svg"`)}</span>`;
      el.innerHTML = `<div class="flight-movement ${movement}"><span class="flight-squad">${plane('is-lead', 24)}${plane('is-left', 24)}${plane('is-right', 24)}</span><span class="flight-arrow" aria-hidden="true">${arrow}</span></div>`;
    } else if (a.type === 'breaking') {
      el.classList.add('mk-breaking-news');
      const triangle = '<svg class="news-marker-svg" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.3 23.2 21H.8Z" fill="#ef233c"/><path d="m12 6.1-7.2 12.7h14.4Z" fill="#000000"/><path d="M11 9h2v5h-2zm0 6h2v2h-2z" fill="#ef233c"/></svg>';
      el.innerHTML = `<span class="news-marker-core">${triangle}</span>`;
    } else if (eventEmoji) {
      el.innerHTML = `<span class="sai map-event-disc map-event-emoji" style="width:34px;height:34px;border-color:${visual.color};--c:${visual.color}" aria-hidden="true">${eventEmoji}</span>`;
    } else if (marker === 'icon') {
      const iconColor = visual.color;
      const sz = 24;
      if (a.type === 'signal_sweep') {
        el.innerHTML = `<div class="ic ic-${glyph}" style="--ic:${iconColor};width:40px;height:40px">${svgTag(glyph, 34, `class="ic-svg" fill="${iconColor}" color="${iconColor}"`)}</div>`;
      } else {
        el.innerHTML = `<div class="ic ic-${glyph}" style="--ic:${iconColor};width:${sz}px;height:${sz}px">${svgTag(glyph, sz, `class="ic-svg" fill="${iconColor}" color="${iconColor}"`)}</div>`;
      }
    } else {
      el.innerHTML = glyphDisc(a.type, 34, 24, 'sai map-event-disc', a.marker_glyph);
    }
    el.innerHTML = `<div class="mk-s">${el.innerHTML}</div>`;
    if (!['squad', 'movement', 'fly'].includes(marker)) el.insertAdjacentHTML('afterbegin', '<span class="news-pulse-ring" aria-hidden="true"></span>');
    // civil family: pinned to its exact place; a small tidy dot at country view, the icon from zoom 7.5 up
    if (t.group === 'civil') {
      el.classList.add('mk-civ');
      el.insertAdjacentHTML('beforeend', `<span class="civ-dot" style="--ic:${visual.color}"></span>`);
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
  _screenKm(km, lat, maxScreenShare = 0.18) {
    const c = this.map.getContainer();
    const vmin = Math.max(200, Math.min(c.clientWidth, c.clientHeight) || 600);
    const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, this.map.getZoom()));
    const px = Math.min(vmin * maxScreenShare, Math.max(5, (km * 1000) / mpp));
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
    const pulseByKey = new Map();
    const orb = (this._orb = new Map());
    const hits = (this._hits = []);
    const featureKeys = new Set();
    const pulseKeys = new Set();
    for (const a of this.alerts) {
      const t = ALERT_TYPES[a.type];
      // Political reports get a muted editorial ring only around explicitly supplied coordinates.
      const planeArea = a.type === 'warplane' || (a.type === 'air_movement' && a.aircraft !== 'uav');
      if (!t || (t.marker === 'movement' && !(planeArea && a.is_active)) || a.scope === 'country' || !a.location || !Number.isFinite(a.location.latitude) || !Number.isFinite(a.location.longitude)) continue;
      const marker = alertMarkerKind(a);
      const props = planeArea ? { color: '#3b8eff', active: !!a.is_active, dashed: true, planeArea: true } : { color: eventVisual(a.type).color, active: !!a.is_active, dashed: t.zone === 'dashed' };
      // one circle per affected locality (server-computed), like the original map
      const zs = Array.isArray(a.zones) && a.zones.length ? a.zones : [{ lat: a.location.latitude, lon: a.location.longitude, km: ZONE_KM[a.scope] || ZONE_KM.place }];
      if (marker === 'orbit' || marker === 'helicopter') {
        // Orbiting markers follow the ring nearest to their own position (the alert's main place).
        let best = zs[0], bd = Infinity;
        for (const z of zs) { const d = (z.lat - a.location.latitude) ** 2 + (z.lon - a.location.longitude) ** 2; if (d < bd) { bd = d; best = z; } }
        orb.set(a.id, { km: this._screenKm(best.km, best.lat), lat: best.lat, helicopter: marker === 'helicopter' });
      }
      zs.forEach((z) => {
        // Aircraft areas keep the reference's geographic radius at every zoom; this does not
        // change the saved z.km, circle centers or locality count. Other categories retain their cap.
        const km = planeArea ? z.km : this._screenKm(z.km, z.lat, marker === 'squad' ? 0.28 : 0.18);
        const mpp = (40075016.686 * Math.cos((z.lat * Math.PI) / 180)) / (512 * Math.pow(2, this.map.getZoom()));
        const radiusPx = Math.max(5, (km * 1000) / mpp);
        hits.push({ id: a.id, lon: z.lon, lat: z.lat, km, radiusPx, ts: Date.parse(a.timestamp) || 0, live: !!a.is_active });
        const visualZone = { lon: z.lon, lat: z.lat, km };
        const featureKey = zoneVisualKey(visualZone, props) + (planeArea ? '|plane-area' : '');
        if (!featureKeys.has(featureKey)) {
          featureKeys.add(featureKey);
          features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [circlePolygon(z.lon, z.lat, km)] } });
        }
        const classicAircraft = t.marker === 'squad';
        if (a.is_active && !planeArea) {
          const pulseKey = pulseVisualKey(visualZone, props.color, classicAircraft);
          const existingPulse = pulseByKey.get(pulseKey);
          if (existingPulse) {
            existingPulse.alertIds.add(a.id);
            if (a.id === this.selectedId) existingPulse.selected = true;
          } else if (!pulseKeys.has(pulseKey) && pulses.length < 80) {
            pulseKeys.add(pulseKey);
            const pulse = { key: pulseKey, lon: z.lon, lat: z.lat, km, color: props.color, classicAircraft, selected: a.id === this.selectedId, alertIds: new Set([a.id]) };
            pulseByKey.set(pulseKey, pulse);
            pulses.push(pulse);
          }
        }
      });
    }
    src.setData({ type: 'FeatureCollection', features });
    this._lastPulseData = pulses;
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
      el.classList.toggle('zp-aircraft', !!p.classicAircraft);
      el.classList.toggle('zp-selected', !!p.selected);
      el.style.zIndex = p.selected ? '3' : '1';
      if (el._d !== d) { el._d = d; el.style.setProperty('--d', d + 'px'); }
      if (el._c !== p.color) { el._c = p.color; el.style.setProperty('--c', p.color); }
    }
    for (const [k, m] of this._pulses) if (!keep.has(k)) { m.remove(); this._pulses.delete(k); }
    if (!this.map.isZooming()) this.el.classList.remove('is-zooming');
  }
  // Scale drone/helicopter orbit radii while keeping supplemental drone copies near their area anchors.
  _orbitPx() {
    if (!this._orb || !this.map) return;
    const z = this.map.getZoom();
    for (const [id, o] of this._orb) {
      const m = this.markers.get(id);
      if (!m) continue;
      const mpp = (40075016.686 * Math.cos((o.lat * Math.PI) / 180)) / (512 * Math.pow(2, z));
      const el = m.getElement();
      if (o.helicopter) {
        // Keep the single helicopter on the actual visible perimeter of its alert circle.
        const px = Math.max(10, Math.round((o.km * 1000) / mpp));
        if (el._orb !== px) { el._orb = px; el.style.setProperty('--orb', px + 'px'); }
        continue;
      }
      // Keep the orbit legible at country scale while following the real display circle when zoomed in.
      const px = Math.max(5, Math.round((o.km * 1000) / mpp));
      if (el._orb !== px) { el._orb = px; el.style.setProperty('--orb', px + 'px'); }
    }
    if (z >= 10.5 && this.sats) for (const m of this.sats.values()) {
      if (!Number.isFinite(m._zkm)) continue;
      const mpp = (40075016.686 * Math.cos((m._lat * Math.PI) / 180)) / (512 * Math.pow(2, z));
      const circleKm = this._screenKm(m._zkm, m._lat);
      const px = Math.max(5, Math.round((circleKm * 1000) / mpp));
      const el = m.getElement();
      if (el._orb !== px) { el._orb = px; el.style.setProperty('--orb', px + 'px'); }
    }
  }

  // ------------------------------------------------------------- selection / camera
  _playArrival(id) {
    const marker = this.markers.get(id)?.getElement();
    if (!marker || marker.hidden) return;
    clearTimeout(this._arrivalTimer);
    this._arrivalElement?.classList.remove('focus-arrival');
    marker.classList.remove('focus-arrival');
    void marker.offsetWidth;
    marker.classList.add('focus-arrival');
    this._arrivalElement = marker;
    this._arrivalTimer = setTimeout(() => {
      marker.classList.remove('focus-arrival');
      if (this._arrivalElement === marker) this._arrivalElement = null;
      this._arrivalTimer = null;
    }, 2400);
  }
  select(alert, { fly = true, popup = true } = {}) {
    this.selectedId = alert ? alert.id : null;
    this.selectedAlert = alert || null;
    if (!this.ready) { this._pending = alert ? [alert, { fly, popup }] : null; return; }
    this.syncMovementTracks();
    this.refreshMarkerGroups();
    this._syncPulses((this._lastPulseData || []).map((p) => ({ ...p, selected: p.alertIds.has(this.selectedId) })));
    if (!alert) return this.closePopup();
    if (!alert.location || !Number.isFinite(alert.location.latitude)) return this.closePopup();
    if (fly) this._playArrival(alert.id);
    const ll = [alert.location.longitude, alert.location.latitude];
    // A circle click may target an additional affected locality rather than the alert's
    // primary pin. Keep the camera and popup anchored to the exact circle the user tapped.
    const tapped = this._popupAt && this._popupAt.id === alert.id ? this._popupAt.ll : null;
    const target = tapped || ll;
    const zs = Array.isArray(alert.zones) ? alert.zones : [];
    const archiveRoute = isLegacyQuneitraArchiveAlert(alert) ? legacyQuneitraArchivePath(alert) : [];
    const marker = alertMarkerKind(alert);
    const orbiting = marker === 'orbit' || marker === 'helicopter';
    if (archiveRoute.length === 2 && fly) {
      this.closePopup();
      const longitudes = archiveRoute.map(([lon]) => lon);
      const latitudes = archiveRoute.map(([, lat]) => lat);
      this.map.fitBounds([[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]], {
        padding: this.padding(), maxZoom: 9, duration: 950, essential: true,
      });
    } else if (fly && !tapped && !orbiting && alert.more && alert.more.length && zs.length > 1) {
      // several areas: frame all of their circles
      let w = 180, e = -180, s = 90, n = -90;
      for (const q of zs) { const dl = q.km / 111, dn = q.km / (111 * Math.cos((q.lat * Math.PI) / 180)); w = Math.min(w, q.lon - dn); e = Math.max(e, q.lon + dn); s = Math.min(s, q.lat - dl); n = Math.max(n, q.lat + dl); }
      this.map.fitBounds([[w, s], [e, n]], { padding: this.padding(), maxZoom: 11, duration: 1100, essential: true });
    } else if (fly) {
      const center = this.map.getCenter();
      const duration = alertTransitionDuration(distanceKm([center.lng, center.lat], target));
      this.map.flyTo({ center: target, zoom: alertFocusZoom(alert.scope, this.map.getZoom(), orbiting ? 11.5 : 0), padding: this.padding(), curve: 1.18, duration, essential: true });
    }
    if (popup && archiveRoute.length !== 2) this.openPopup(alert);
    else if (archiveRoute.length === 2) this.closePopup();
  }

  // the alert circle under a map point: smallest circle first (the most precise area), then live, then newest
  zoneAt(ll, point = null) {
    if (!ll || !this._hits || !this._hits.length) return null;
    const tap = point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? point
      : this.map?.project([ll.lng, ll.lat]);
    return zoneHitAt(this._hits, tap, (coords) => this.map.project(coords));
  }
  // Phone detection for mobile map rendering/3D performance; alert details use a compact bottom sheet on phones.
  dockMode() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    return window.innerWidth < 768 || (coarse && Math.min(screen.width || 9999, screen.height || 9999) < 768);
  }
  // Service and alert detail cards use the same accessible dock on phones; desktop alerts remain point-anchored.
  openDockHtml(html, ll, { id = null, cls = '', onClose = null } = {}) {
    const card = document.createElement('div');
    card.className = 'pp-dock' + (cls ? ' ' + cls : '');
    card.setAttribute('role', 'dialog');
    const x = document.createElement('button'); x.className = 'pp-dock-x'; x.type = 'button'; x.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Close' : 'إغلاق'); x.textContent = '×';
    const body = document.createElement('div'); body.className = 'pp-dock-body maplibregl-popup-content'; body.append(htmlToNode(html));
    card.append(x, body);
    for (const old of this.el.querySelectorAll('.pp-dock')) old.remove();
    this.el.append(card);
    card.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
    card.addEventListener('touchstart', (event) => { if (card.scrollHeight > card.clientHeight + 2) event.stopPropagation(); }, { passive: true });
    card.addEventListener('touchmove', (event) => { if (card.scrollHeight > card.clientHeight + 2) event.stopPropagation(); }, { passive: true });
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
    card.style.bottom = `calc(${b}px + env(safe-area-inset-bottom, 0px))`;
    const available = Math.max(160, mr.height - b - 76);
    const visualHeight = window.visualViewport?.height || window.innerHeight;
    const cap = card.classList.contains('alert-dock') ? Math.min(520, visualHeight * 0.58) : available;
    card.style.maxHeight = Math.min(available, cap) + 'px';
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
    const controlPanel = document.querySelector('#mapCtrlPanel');
    if (controlPanel) {
      controlPanel.hidden = true;
      document.querySelector('#mapControlsToggle')?.setAttribute('aria-expanded', 'false');
    }
    const groupNav = this.groupPopupNavigation(alert.id);
    this._replacingPopup = true;
    this.closePopup();
    this._replacingPopup = false;
    if (!groupNav) this._groupPopupNav = null;
    const at = this._popupAt && this._popupAt.id === alert.id ? this._popupAt.ll : null;
    this._popupAt = null;
    const M = ml();
    const contentNode = htmlToNode(this.popupHtml(alert));
    if (groupNav) {
      const root = contentNode.querySelector('.pp');
      const navNode = this.groupPopupNavigationNode(groupNav);
      const title = root?.querySelector('.pp-title');
      if (title) title.before(navNode); else root?.append(navNode);
    }
    // Keep the tip endpoint on the exact marker / circle coordinate, without a visual gap.
    this.popup = new M.Popup({ className: 'pp-alert-popup', anchor: 'bottom', closeButton: true, closeOnClick: false, maxWidth: 'min(420px, calc(100vw - 28px))', offset: [0, 0], focusAfterOpen: false })
      .setLngLat(at || [alert.location.longitude, alert.location.latitude])
      .setDOMContent(contentNode)
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
      pe?._popupConnector?.remove();
      if (!this._replacingPopup && this._groupPopupNav?.currentId === String(alert.id)) this._groupPopupNav = null;
      if (this.popup && this.popup._alertId === alert.id) this.popup = null;
    });
    this.schedulePopupFit(2);
    return this.popup;
  }

  schedulePopupFit(count = 1) {
    this._fitLeft = count;
    requestAnimationFrame(() => requestAnimationFrame(() => this.fitPopup()));
    if (!this._fitBound) {
      this._fitBound = true;
      this.map.on('movestart', (e) => { if (e.originalEvent) this._fitLeft = 0; }); // user took over
      this.map.on('moveend', (e) => { if (!e.originalEvent && !this._fitPanning && this._fitLeft > 0) this.fitPopup(); this._fitPanning = false; });
      window.addEventListener('orientationchange', () => { this._fitLeft = 1; setTimeout(() => this.fitPopup(), 400); });
    }
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
    if (p._alertId || p._groupKey) {
      // Center alert details and grouped-alert choosers; the MapLibre tip stays attached to its map coordinate.
      dx = r.left + r.width / 2 - (vis.l + vis.r) / 2;
      dy = r.top + r.height / 2 - (top + bottom) / 2;
    } else {
      if (r.width > vis.r - vis.l - 2 * m) dx = r.left + r.width / 2 - (vis.l + vis.r) / 2;
      else if (r.right > vis.r - m) dx = r.right - (vis.r - m);
      else if (r.left < vis.l + m) dx = r.left - (vis.l + m);
      if (r.top < top + m) dy = r.top - (top + m);
      else if (r.bottom > bottom - m) dy = Math.min(r.bottom - (bottom - m), r.top - (top + m));
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { this._fitPanning = true; this._fitLeft = 0; this.map.panBy([dx / scale, dy / scale], { duration: 350 }); }
  }

  syncPopupConnector(pe, ct, moved) {
    if (!pe.classList.contains('pp-alert-popup') && !pe.classList.contains('pp-group-popup')) return;
    let svg = pe._popupConnector;
    if (!moved) { svg?.remove(); delete pe._popupConnector; return; }
    if (!this.popup?.getLngLat) return;
    const point = this.map.project(this.popup.getLngLat());
    const mapRect = this.map.getContainer().getBoundingClientRect();
    const scale = this.map.getContainer().clientWidth ? mapRect.width / this.map.getContainer().clientWidth : 1;
    const x = mapRect.left + point.x * scale; const y = mapRect.top + point.y * scale;
    const r = ct.getBoundingClientRect();
    // Never draw a line through the card when zoom/pan puts the anchor under it.
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { svg?.remove(); delete pe._popupConnector; return; }
    const radius = Math.min(20, r.width / 2, r.height / 2);
    const ex = Math.max(r.left + radius, Math.min(x, r.right - radius));
    const ey = Math.max(r.top + radius, Math.min(y, r.bottom - radius));
    const edges = [];
    if (y < r.top) edges.push({ x: ex, y: r.top, horizontal: true });
    if (y > r.bottom) edges.push({ x: ex, y: r.bottom, horizontal: true });
    if (x < r.left) edges.push({ x: r.left, y: ey, horizontal: false });
    if (x > r.right) edges.push({ x: r.right, y: ey, horizontal: false });
    const edge = edges.sort((a, b) => Math.hypot(x - a.x, y - a.y) - Math.hypot(x - b.x, y - b.y))[0];
    if (!edge) return;
    const length = Math.hypot(x - edge.x, y - edge.y) || 1;
    const tx = edge.x + (x - edge.x) / length * Math.min(10, length);
    const ty = edge.y + (y - edge.y) / length * Math.min(10, length);
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('pp-popup-connector');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = '<line/><path/><circle r="3"/>';
      document.body.appendChild(svg);
      pe._popupConnector = svg;
    }
    svg.style.left = '0'; svg.style.top = '0';
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    const line = svg.querySelector('line');
    line.setAttribute('x1', x); line.setAttribute('y1', y); line.setAttribute('x2', tx); line.setAttribute('y2', ty);
    const ax = edge.horizontal ? edge.x - 5 : edge.x;
    const ay = edge.horizontal ? edge.y : edge.y - 5;
    const bx = edge.horizontal ? edge.x + 5 : edge.x;
    const by = edge.horizontal ? edge.y : edge.y + 5;
    svg.querySelector('path').setAttribute('d', `M ${ax} ${ay} L ${tx} ${ty} L ${bx} ${by} Z`);
    const dot = svg.querySelector('circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y);
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
      if ((pe.classList.contains('pp-alert-popup') || pe.classList.contains('pp-group-popup')) && this.popup?.getLngLat) {
        const cr = this.map.getContainer().getBoundingClientRect();
        const point = this.map.project(this.popup.getLngLat());
        const x = cr.left + point.x * scale; const y = cr.top + point.y * scale;
        // A clamped card must not cover its own event. Prefer its normal position
        // above the point, then the free area below; the external tail follows.
        if (x > L + dx && x < R + dx && y > Tp + dy && y < B + dy) {
          if (y - 12 - (B - Tp) >= top + m) dy = y - 12 - B;
          else if (y + 12 + (B - Tp) <= bottom - m) dy = y + 12 - Tp;
          else if (x - 12 - (R - L) >= vis.l + m) dx = x - 12 - R;
          else if (x + 12 + (R - L) <= vis.r - m) dx = x + 12 - L;
        }
      }
      const nx = Math.round(dx / scale); const ny = Math.round(dy / scale);
      ct.dataset.sx = nx; ct.dataset.sy = ny;
      const moved = Math.abs(nx) > 2 || Math.abs(ny) > 2;
      ct.style.transform = moved ? `translate(${nx}px, ${ny}px)` : '';
      pe.classList.toggle('pp-clamped', moved);
      this.syncPopupConnector(pe, ct, moved);
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
