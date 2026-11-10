import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const html = read('public/index.html');
const app = read('public/js/app.js');
const settings = read('public/js/settings.js');
const map = read('public/js/map.js');
const css = read('public/css/app.css');

test('map tools are grouped accessibly and the Syria overview remains a separate button', () => {
  assert.match(html, /id="mapControlsToggle"[^>]*aria-expanded="false"[^>]*aria-controls="mapCtrlPanel"/);
  const panel = html.match(/<div class="map-ctrl-panel" id="mapCtrlPanel"[\s\S]*?<\/div>/)?.[0];
  assert.ok(panel, 'a collapsed map-tools panel must exist');
  for (const id of ['zoomIn', 'zoomOut', 'locateMe', 'shareSite']) assert.match(panel, new RegExp(`id="${id}"`));
  assert.doesNotMatch(panel, /id="resetView"/);
  assert.match(html, /id="resetView"[^>]*type="button"/);
  assert.match(app, /setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(app, /e\.key !== 'Escape'[^\n]*[\s\S]{0,100}setMapControlsOpen\(false\)/);
});

test('map attribution keeps a compact information button and readable credits', () => {
  assert.match(map, /new M\.AttributionControl\(\{ compact: true, customAttribution:/);
  assert.match(map, /OpenFreeMap<\/a> © <a href="https:\/\/www\.openstreetmap\.org\/copyright"/);
  assert.match(map, /classList\.remove\('maplibregl-compact-show'\)/);
  assert.match(css, /\.maplibregl-ctrl-attrib \.maplibregl-ctrl-attrib-inner \{[^}]*white-space: normal/);
  assert.match(css, /\.maplibregl-ctrl-attrib\.maplibregl-compact:not\(\.maplibregl-compact-show\) \{[^}]*width: 24px;[^}]*height: 24px/);
  assert.match(css, /html\[dir='rtl'\] \.maplibregl-ctrl-bottom-left \{[^}]*left: calc\(50% \+ 50px\);[^}]*transform: translateX\(-50%\)/);
  assert.match(css, /html\[dir='ltr'\] \.maplibregl-ctrl-bottom-right \{[^}]*left: calc\(50% - 50px\);[^}]*transform: translateX\(-50%\)/);
  assert.match(css, /@media \(max-width: 340px\)[\s\S]{0,220}\.about-pill \{ max-width: calc\(100vw - 170px\)/);
});

test('phone map controls and about pill share a lower safe-area-aware bottom row', () => {
  assert.match(css, /\.map-ctrls \{ bottom: calc\(20px \+ env\(safe-area-inset-bottom, 0px\)\); gap: 7px;/);
  assert.match(css, /\.about-pill \{\s*bottom: calc\(23px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(css, /\.map-ctrls > \.ctrl-btn \{ width: 44px; height: 44px;/);
  assert.match(css, /\.map-ctrl-panel \{ position: absolute; bottom: calc\(100% \+ 9px\)/);
});

test('alert details stay centered on the map and their popup tip points to the event on every screen', () => {
  assert.doesNotMatch(map, /cls: 'alert-dock'/);
  assert.match(map, /new M\.Popup\(\{ className: 'pp-alert-popup', anchor: 'bottom'/);
  assert.match(map, /offset: \[0, 0\]/);
  assert.doesNotMatch(map, /off\.y\s*-\s*26/);
  assert.match(map, /if \(p\._alertId \|\| p\._groupKey\)\s*\{[\s\S]{0,250}r\.left \+ r\.width \/ 2 - \(vis\.l \+ vis\.r\) \/ 2[\s\S]{0,180}r\.top \+ r\.height \/ 2 - \(top \+ bottom\) \/ 2/);
  assert.match(map, /this\.schedulePopupFit\(1\)/);
  assert.match(map, /schedulePopupFit\(count = 1\)[\s\S]{0,140}this\.fitPopup\(\)/);
  assert.match(map, /openPopup\(alert\)\s*\{\s*const controlPanel = document\.querySelector\('#mapCtrlPanel'\);[\s\S]{0,180}controlPanel\.hidden = true/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \{ z-index: 60; \}/);
  assert.match(css, /\.pp-alert-popup \.maplibregl-popup-content \{ max-height: min\(62dvh, 600px\); \}/);
  assert.match(css, /\.maplibregl-popup-anchor-bottom \.maplibregl-popup-tip \{ border-top-color: var\(--bg-elevated\); \}/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \.maplibregl-popup-tip \{ opacity: 1/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup\.pp-clamped \.maplibregl-popup-tip \{ opacity: 0; visibility: hidden; animation: none !important; \}/);
  assert.match(map, /syncPopupConnector\(pe, ct, moved\)[\s\S]{0,650}this\.map\.project\(this\.popup\.getLngLat\(\)\)/);
  assert.match(map, /if \(x >= r\.left && x <= r\.right && y >= r\.top && y <= r\.bottom\)[\s\S]{0,100}remove\(\)/);
  assert.match(map, /pe\?\._popupConnector\?\.remove\(\)/);
  assert.match(css, /\.pp-popup-connector \{ position: fixed;[^}]*pointer-events: none/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \{ max-width: calc\(100vw - 20px\) !important; \}/);
  assert.match(css, /\.pp-alert-popup \.pp-more, \.pp-alert-popup \.pp-share \{ min-height: 44px/);
  assert.match(css, /\.brand img \{ height: 28px; width: auto; \}/);
  assert.match(css, /\.pp-alert-popup \.pp, \.pp-group-popup \.alert-group-chooser \{[^}]*animation: popupEmergesFromEvent/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \.maplibregl-popup-tip, \.maplibregl-popup\.pp-group-popup \.maplibregl-popup-tip \{[^}]*drop-shadow/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation: none !important/);
  assert.match(app, /from '\.\/map\.js\?v=82'/);
  assert.match(html, /app\.css\?v=75/);
  assert.match(html, /app\.js\?v=91/);
});

test('changed type and icon modules use fresh cache keys', () => {
  assert.match(app, /from '\.\/services\.js\?v=37'/);
  assert.match(app, /from '\.\/icons\.js\?v=7'/);
  assert.match(app, /from '\.\/i18n\.js\?v=6'/);
  assert.match(app, /from '\/shared\/types\.js\?v=41'/);
  assert.match(app, /from '\.\/settings\.js\?v=14'/);
  assert.match(map, /from '\/shared\/types\.js\?v=41'/);
  assert.match(map, /from '\.\/target-svgs\.js\?v=20'/);
  assert.match(map, /from '\.\/type-icons\.js\?v=7'/);
  assert.match(map, /from '\.\/marker-layout\.js\?v=3'/);
  assert.match(map, /from '\/shared\/zone-visuals\.js\?v=3'/);
  assert.match(settings, /from '\/shared\/types\.js\?v=41'/);
});

test('alert popup switches between news and attached photo/video in the same window', () => {
  assert.match(app, /const mediaItems = \['photo', 'video'\]\.map\(\(type\) => rawMediaItems\.find\(\(item\) => item\?\.type === type\)\)\.filter\(Boolean\)/);
  assert.match(app, /const illustrationFallback = mediaItems\.length === 0/);
  assert.match(app, /const displayModes = availableAlertDisplayModes\(newsText, mediaItems, \{ illustrationFallback \}\)/);
  assert.match(app, /const displayMediaItems = mediaItems\.length \? mediaItems : illustrationFallback \? \[\{ type: 'photo', illustration: true \}\] : \[\]/);
  assert.match(app, /const initialMode = initialAlertDisplayMode\(displayModes\)/);
  assert.match(app, /const mediaActions = displayModes\.length \?/);
  assert.match(app, /const titleRow = `<div class="pp-title-row"><p class="pp-title">[\s\S]*?<\/p><\/div>`;/);
  assert.match(app, /const content = `\$\{titleRow\}\$\{mediaActions\}\$\{newsPanel\}\$\{mediaViewer\}`/);
  assert.match(app, /class="pp-news-panel" data-pp-news-panel/);
  assert.match(app, /class="pp-media-panel" data-pp-media-panel/);
  assert.match(app, /const content = `\$\{titleRow\}\$\{mediaActions\}\$\{newsPanel\}\$\{mediaViewer\}`/);
  assert.doesNotMatch(app, /pp-view-tabs|data-pp-tab/);
  assert.match(app, /data-pp-mode="\$\{mode\}"/);
  assert.match(app, /alertDisplayPanelState\(mode\)/);
  assert.match(app, /newsPanel\.hidden = !panels\.news/);
  assert.match(app, /panel\.hidden = !panels\.media/);
  assert.match(app, /mode === 'news' \? T\.alertNewsTab/);
  assert.match(app, /mediaVideo' : 'mediaImage/);
  assert.match(app, /function alertMediaFrameHtml\(item, alertId\)/);
  assert.match(app, /<video class="pp-media-video" controls playsinline preload="none"/);
  assert.equal((app.match(/<img class="pp-media-image"[^>]*loading="eager"/g) || []).length, 1, 'source and illustrative images share one frame renderer');
  assert.match(app, /data-pp-illustration=/);
  assert.match(app, /display\.innerHTML = alertMediaFrameHtml\(/);
  assert.match(app, /Source media; source marks, if present, are left visible\./);
  assert.match(app, /Illustrative design based on alert details; not a scene photograph\./);
  assert.match(css, /\.ras-media-frame-stage \{/);
  assert.match(css, /\.ras-media-frame-note \{/);
  assert.match(app, /schedulePopupFit\?\.\(2\)/);
  assert.match(css, /\.pp-title-row \{ display: flex/);
  assert.match(css, /\.pp-media-actions \{ display: flex/);
  assert.match(css, /\.pp-title-row \{[^}]*padding-inline-end: 34px/);
  assert.match(css, /\.pp-media-actions \{[^}]*width: 100%[^}]*justify-content: flex-start[^}]*margin: 8px 0 0/);
  assert.match(css, /\.pp-media-action \{/);
  assert.match(css, /\.pp-news-panel\[hidden\], \.pp-media-panel\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /\.pp-media-image, \.pp-media-video/);
  assert.match(app, /https:\/\/whatsapp\.com\/channel\/0029VbEO1eGCBtxLP3jW8e1k/);
  assert.match(app, /wa-channel-btn/);
});

test('alert popup text and media are modestly smaller while controls remain touch accessible', () => {
  assert.match(css, /\.pp-title \{ margin: 0; color: var\(--text-primary\); font-weight: 900; font-size: clamp\(14px, 1\.05rem, 16px\)/);
  assert.match(css, /\.pp-desc \{ margin: 9px 0 0; color: var\(--text-secondary\); font-size: 12px/);
  assert.match(css, /\.pp-media-image, \.pp-media-video \{ max-height: min\(32dvh, 280px\); \}/);
  assert.match(css, /\.pp-media-action \{[^}]*min-height: 36px/);
  assert.match(css, /\.pp-alert-popup \.maplibregl-popup-content \{ width: min\(420px, calc\(100vw - 20px\)\); max-height: min\(44dvh, 400px\); \}/);
  assert.match(css, /\.pp-alert-popup \.pp-more, \.pp-alert-popup \.pp-share \{ min-height: 44px/);
});

test('share preview shows the map snapshot, direct link, location, and last update time', () => {
  assert.match(app, /function openShareCard\(a\)/);
  assert.match(app, /\/og\/a\/\$\{encodeURIComponent\(a\.id\)\}-\$\{LANG\}\.png\?v=/);
  assert.match(app, /T\.shareCardLocation/);
  assert.match(app, /T\.lastUpdated/);
  assert.match(app, /data-share-act="copy"/);
  assert.match(app, /data-share-act="share"/);
  assert.match(app, /data-pp="share"/);
  assert.match(app, /data-share-act/);
  assert.match(css, /\.share-card-map img \{ display: block; width: 100%; max-height: 330px; object-fit: contain; \}/);
});

test('follow area picker saves local preferences and only sends area IDs to push subscription', () => {
  assert.match(app, /data-follow-gov/);
  assert.match(app, /\/api\/places\/search\?/);
  assert.match(app, /matchesFollowArea\(a, s\.followArea\)/);
  assert.match(app, /function pushPreferences\(\)[\s\S]{0,520}type: 'place', placeId: Number\(area\.placeId\)/);
  assert.match(app, /settings\.set\(\{ followArea: area \}\)/);
  assert.match(settings, /followArea: null/);
  assert.match(settings, /state\.followArea = sanitizeFollowArea\(state\.followArea\)/);
  assert.match(css, /\.follow-area-results \{ display: grid; gap: 5px/);
});

test('alert symbols use shared category colors in badges, filters and map markers', () => {
  assert.match(app, /eventVisual\(a\.type\)\.color/);
  assert.match(app, /eventVisual\(t\)\.color/);
  assert.match(css, /\.badge svg \{ color: var\(--symbol-color, currentColor\)/);
  assert.match(map, /eventVisual\(a\.type\)/);
  assert.doesNotMatch(app, /HAZARD_EMOJI\[a\.hazard\]/);
  assert.match(css, /background: color-mix\(in srgb, var\(--c\) 4%, var\(--bg-card\)\)/);
});

test('tapping an individual map symbol zooms to its alert and opens details on phones', () => {
  assert.match(map, /selectMarker\(id\)[\s\S]{0,500}if \(group\?\.alerts\.length > 1\) return this\.zoomToGroupChooser\(group\);[\s\S]{0,140}this\.onSelect\(id, \{ fromMap: true, fly: true \}\)/);
  assert.match(map, /if \(fly\) \{[\s\S]{0,600}this\.map\.flyTo\(\{ center: target, zoom: alertFocusZoom/);
  assert.match(map, /if \(popup && archiveRoute\.length !== 2\) this\.openPopup\(alert\)/);
  assert.match(app, /amap && amap\.select\(shown, \{ fly: fly, popup: true \}\);[\s\S]{0,150}showDetail\(\);[\s\S]{0,120}if \(isMobile\(\)\) setSheetOpen\(false\)/);
});

test('count-marker taps zoom to the group before showing a bottom-anchored chooser on phones', () => {
  assert.match(map, /if \(group\?\.alerts\.length > 1\) return this\.zoomToGroupChooser\(group\)/);
  assert.match(map, /zoomToGroupChooser\(group\)[\s\S]{0,1000}this\.map\.once\('moveend', \(\) => this\.openGroupChooser\(group\)\)[\s\S]{0,180}this\.map\.flyTo/);
  assert.match(map, /className: 'pp-group-popup', anchor: 'bottom', offset: \[0, 0\]/);
  assert.equal((map.match(/if \(!ids\.length \|\| ids\.some\(\(id\) => !liveIds\.has\(String\(id\)\)\)\) this\.closePopup\(\);/g) || []).length, 2);
});

test('group alert popup has accessible previous and next buttons and opens on the selected event', () => {
  assert.match(map, /groupPopupNavigationNode\(nav\)[\s\S]{0,1200}aria-live', 'polite'[\s\S]{0,700}pp-group-next/);
  assert.match(map, /root\?\.querySelector\('\.pp-title'\)[\s\S]{0,100}title\.before\(navNode\)/);
  assert.match(map, /this\.onSelect\(id, \{ fromMap: true, fly: false \}\)/);
  assert.match(css, /\.pp-group-nav button \{[^}]*min-width: 44px; min-height: 44px;[^}]*font: 600 15px\/1/);
  assert.match(css, /transition: color \.16s ease, background-color \.16s ease, transform \.16s ease/);
  assert.match(css, /\.pp-group-nav button:active:not\(:disabled\) \{ transform: scale\(\.94\); \}/);
});

test('general alert pulses are gentler while the legacy blue aircraft pulse remains specialized', () => {
  assert.match(css, /\.zp-fill \{ animation: none; opacity: \.035/);
  assert.match(css, /@keyframes zpulse \{ 0% \{ transform: scale\(1\); opacity: \.27; \} 100% \{ transform: scale\(1\.65\); opacity: 0; \} \}/);
  assert.match(css, /\.zp\.zp-aircraft::before, \.zp\.zp-aircraft::after[\s\S]{0,230}animation: zpulseAircraft 2\.6s/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('alert list shows loading placeholders before the first server snapshot and virtualizes offscreen cards', () => {
  assert.match(app, /box\.setAttribute\('aria-busy', String\(state\.firstSnapshot\)\)/);
  assert.match(app, /if \(state\.firstSnapshot\) \{[\s\S]{0,260}card-skeleton/);
  assert.match(css, /\.card \{[^}]*content-visibility: auto; contain-intrinsic-size: auto 150px/);
  assert.match(css, /\.card-skeleton/);
});
