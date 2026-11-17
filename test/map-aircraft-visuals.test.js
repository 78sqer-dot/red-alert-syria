import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const mapJs = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const appJs = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const markerSvgs = await readFile(new URL('../public/js/marker-svgs.js', import.meta.url), 'utf8');
const types = await readFile(new URL('../shared/types.js', import.meta.url), 'utf8');
const targetSvgs = await readFile(new URL('../public/js/target-svgs.js', import.meta.url), 'utf8');

test('approved helicopter visual is served under fresh module cache keys', () => {
  assert.match(appJs, /from '\.\/map\.js\?v=93'/);
  assert.match(mapJs, /from '\.\/target-svgs\.js\?v=27'/);
});

test('drone keeps its top-down 24px silhouette and perimeter orbit', () => {
  assert.match(types, /uav:\s*\{[\s\S]*?glyph: 'uav'/);
  assert.ok(markerSvgs.includes('"uav": "<g> <ellipse cx=\\"256\\" cy=\\"256\\" rx=\\"18\\" ry=\\"140\\" />'));
  assert.match(mapJs, /const svgClass = signalDrone \? 'signal-sweep-uav-svg' : 'uav-svg'/);
  assert.match(mapJs, /signalDrone \? svgTag\(glyph,\s*36,[\s\S]{0,120}: svgTag\(glyph,\s*24,/);
  assert.match(css, /\.uav-svg\s*\{[^}]*width: 24px; height: 24px;/);
  assert.match(css, /\.uav\s*\{[^}]*width: 44px; height: 44px;[^}]*margin: -22px 0 0 -22px;/);
  assert.match(css, /\.uav-svg\s*\{\s*stroke: rgba\(255,255,255,\.94\);\s*stroke-width: 18;/);
});

test('drone is hidden with impact circles alone at country zoom and orbits at detail zoom', () => {
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*visibility: hidden;/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*visibility: visible;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit\.mk-sat\s*\{\s*visibility: hidden;/);
  assert.doesNotMatch(css, /uavHover/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(mapJs, /const px = Math\.max\(5, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /const circleKm = this\._screenKm\(m\._zkm, m\._lat\);[\s\S]{0,100}const px = Math\.max\(5, Math\.round\(\(circleKm \* 1000\) \/ mpp\)\)/);
  assert.doesNotMatch(mapJs, /Math\.min\(12, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /if \(z >= 10\.5 && this\.sats\)/);
});

test('helicopter uses the approved slim top-down military silhouette and circular illustrative orbit at detail zoom', () => {
  assert.match(css, /\.mk-helicopter \.mk-s\s*\{\s*transform:\s*none;\s*\}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*translateX\(var\(--heli-orbit-radius\)\);[^}]*animation:\s*heliOrbit 9s linear infinite/);
  assert.match(css, /\.heli-craft-second \{ animation-delay: -4\.5s; \}/);
  assert.match(css, /\.heli-route\s*\{[^}]*--heli-orbit-radius: max\(18px, var\(--orb, 24px\)\)/);
  assert.match(css, /\.heli-orbit-guide \{[^}]*border: 1px dashed rgba\(59,142,255,\.4\);[^}]*border-radius: 50%/);
  assert.match(css, /@keyframes heliOrbit \{ from:?.*?translateX\(var\(--heli-orbit-radius\)\).*?rotate\(-360deg\)/s);
  assert.match(css, /\.helicopter-svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*fill:\s*#13283d;[^}]*rgba\(190,207,223,\.55\)/);
  assert.match(css, /\.helicopter-svg \.heli-body \{ fill: #13283d; stroke: #091725;/);
  assert.match(css, /\.helicopter-svg \.heli-body-highlight \{ fill: #243d56; \}/);
  assert.match(css, /\.helicopter-svg \.heli-main-rotor \{ fill: #203851; stroke: #091a29;[^}]*opacity: 1;/);
  assert.match(css, /\.helicopter-svg \.heli-tail-rotor \{ fill: #203851; stroke: #091a29;[^}]*opacity: 1;/);
  assert.match(css, /\.helicopter-svg \.heli-cockpit \{ fill: #0b2034; \}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*drop-shadow\(0 0 1px rgba\(15,23,42,\.84\)\)[^}]*drop-shadow\(0 1px 1\.5px rgba\(255,255,255,\.42\)\)/);
  assert.doesNotMatch(css, /\.helicopter-svg \.heli-(?:main-rotor|tail-rotor) \{[^}]*animation:\s*heliRotor/,
    'the rotor blades stay crisp while the aircraft itself orbits');
  assert.match(css, /\.helicopter-svg \.heli-main-rotor, \.helicopter-svg \.heli-tail-rotor \{ animation: none !important; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-helicopter:not\(\.inactive\) \.heli-craft \{ animation: heliOrbit 18s linear infinite !important; \}/,
    'reduced-motion devices keep a slower, visible helicopter orbit');
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-helicopter:not\(\.inactive\) \.heli-craft-second \{ animation-delay: -9s !important; \}/,
    'the second craft remains on the opposite side of the orbit');
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.inactive\) \.uav,[\s\S]{0,150}\.maplibregl-map \.mk-sat:not\(\.inactive\) \.uav \{\s*animation: uavOrbit 18s linear infinite !important;\s*animation-delay: var\(--delay, 0s\) !important;/,
    'reduced-motion devices retain a slower, position-only drone orbit');
  assert.match(css, /\.is-moving \.heli-craft, \.is-zooming \.heli-craft \{ animation-play-state: paused !important; \}/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-helicopter \.heli-route \{ visibility: hidden; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-helicopter \.heli-route \{ visibility: visible; \}/);
  assert.match(css, /\.maplibregl-map \.mk-helicopter \{ visibility: visible; \}/);
  assert.match(css, /\.news-off \.mk-helicopter \{ display: block !important; visibility: visible !important; \}/);
  assert.doesNotMatch(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-helicopter\s*\{[^}]*visibility: hidden/);
  assert.match(css, /\.heli-orbit-guide/);
  assert.match(mapJs, /<div class="heli-route"><span class="heli-orbit-guide" aria-hidden="true"><\/span>\$\{craft\}\$\{second\}<\/div>/);
  assert.doesNotMatch(css, /\.heli-route-line|heli-route-len/);
  assert.doesNotMatch(mapJs, /helicopterScale|--heli-scale/);
  assert.match(mapJs, /svgTag\('helicopter_mobile',\s*24,\s*'class="helicopter-svg"'\)/);
  const mobile = targetSvgs.match(/helicopter_mobile:\s*'([^']+)'/)?.[1] || '';
  assert.match(mobile, /class="heli-main-rotor"[^>]*><path d="M42 182/);
  assert.match(mobile, /class="heli-body" d="M256 48c-24 0-40 24-40 57v112/);
  assert.match(mobile, /class="heli-tail-boom" d="M252 291h8v163h-8z"/);
  assert.match(mobile, /class="heli-tail-fin" d="M220 360h72v13h-72z"/);
  assert.match(mobile, /class="heli-tail-rotor"><rect x="224" y="448" width="64" height="10"/);
  assert.match(mobile, /class="heli-cockpit"[\s\S]*?class="heli-window"/);
  assert.doesNotMatch(mobile, /transform="translate\(0 69\) scale\(2\.844 4\.8\)"/);
  assert.match(mobile, /class="heli-mast" d="M256 178v44"/);
  assert.match(mapJs, /const second = a\.helicopters > 1 \?/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(css, /\.uav\s*\{[^}]*animation:\s*uavOrbit 9s linear infinite/);
  assert.match(mapJs, /classList\.toggle\('sel', a\.id === this\.selectedId\)/);
  assert.match(mapJs, /Keep the illustrative orbit tied to the display-scaled impact circle at each zoom/);
  assert.match(mapJs, /const px = Math\.max\(10, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /el\.style\.setProperty\('--orb', px \+ 'px'\)/, 'the orbit stays tied to the zoom-scaled impact circle');
  assert.match(mapJs, /const classicAircraft = t\.marker === 'squad';/, 'the helicopter uses the shared drone/signal pulse dimensions');
  assert.match(css, /animation: zpulse 3\.2s cubic-bezier/);
  assert.match(mapJs, /el\.insertAdjacentHTML\('afterbegin', '<span class="news-pulse-ring"/);
  assert.doesNotMatch(css, /\.heli-route::(?:before|after)/, 'the helicopter route must not gain decorative rings');
  assert.match(mapJs, /--orb', px \+ 'px'/, 'orbit radius continues to use the current display-scaled impact circle');
  assert.match(targetSvgs, /helicopter_simple:[\s\S]{0,850}rotate\(45 256 256\)[\s\S]{0,120}rotate\(-45 256 256\)/);
  assert.match(targetSvgs, /helicopter_simple:[\s\S]*?class="heli-body"[\s\S]*?class="heli-cockpit"[\s\S]*?class="heli-tail-boom"[\s\S]*?class="heli-tail-rotor"/);
  const side = targetSvgs.match(/helicopter_side:\s*'([^']+)'/)?.[1] || '';
  assert.match(side, /class="heli-body"[\s\S]*?class="heli-tail-boom"[\s\S]*?class="heli-main-rotor"[\s\S]*?class="heli-tail-rotor"/);
});

test('the slim helicopter tail rotor stays connected to the tail boom', () => {
  const simple = targetSvgs.match(/helicopter_simple:\s*'([^']+)'/)?.[1] || '';
  const boom = simple.match(/class="heli-tail-boom" d="M(\d+) (\d+)h(\d+)v(\d+)/);
  const rotor = simple.match(/class="heli-tail-rotor"><rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
  assert.ok(boom && rotor, 'the boom and tail rotor geometry must exist');
  assert.equal(Number(rotor[1]) + Number(rotor[3]) / 2, Number(boom[1]) + Number(boom[3]) / 2);
  const rotorY = Number(rotor[2]) + Number(rotor[4]) / 2;
  assert.ok(rotorY >= Number(boom[2]) && rotorY <= Number(boom[2]) + Number(boom[4]));
});

test('helicopter uses the simplified silhouette while legacy glyphs remain available', () => {
  assert.match(types, /helicopter:\s*\{[\s\S]*?glyph: 'helicopter_simple'/);
  assert.match(types, /helicopter:\s*\{[\s\S]*?marker: 'helicopter', glyph: 'helicopter_simple', zone: true/);
  assert.match(targetSvgs, /helicopter_simple:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter_topdown:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter_sleek:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
});

test('signal-sweep UAV uses the Lebanese four-arc emitter, separate from the generic UAV glyph', () => {
  assert.match(mapJs, /const glyph = signalDrone \? 'signal_sweep_uav'/);
  assert.match(mapJs, /const svgClass = signalDrone \? 'signal-sweep-uav-svg' : 'uav-svg'/);
  assert.ok(targetSvgs.includes('signal_sweep_uav: \'<g><circle cx="256" cy="200" r="34"></circle><rect x="240" y="226" width="32" height="250" rx="10"></rect>'));
  for (const path of ['M160 104a136 136 0 0 0 0 192', 'M352 104a136 136 0 0 1 0 192', 'M96 48a216 216 0 0 0 0 304', 'M416 48a216 216 0 0 1 0 304']) assert.ok(targetSvgs.includes(path));
  assert.match(css, /\.signal-sweep-uav-svg \{ display: block; fill: #6b7280; color: #1a1a2e;/);
});

test('signal-sweep map markers are enlarged for phone visibility', () => {
  assert.match(mapJs, /if \(a\.type === 'signal_sweep'\)[\s\S]{0,180}width:40px;height:40px[\s\S]{0,100}svgTag\(glyph, 34,/);
  assert.match(css, /\.mk\.t-signal_sweep \.ic-svg \{ width: 34px; height: 34px; \}/);
});

test('opening UAV and helicopter alerts forces detail zoom for governorate-scoped reports', () => {
  assert.match(mapJs, /const marker = alertMarkerKind\(alert\);[\s\S]{0,120}const orbiting = marker === 'orbit' \|\| marker === 'helicopter';/);
  assert.match(mapJs, /alertFocusZoom\(alert\.scope, this\.map\.getZoom\(\), orbiting \? 11\.5 : 0\)/);
});

test('warplane formation keeps the reference pass with bounded medium-sized, bright-blue airframes', () => {
  assert.match(mapJs, /\$\{pl\(36, -12, 1\)\}\$\{pl\(20, 8, 0\.85\)\}\$\{pl\(52, 8, 0\.85\)\}/, 'the three-plane group is centered on its orbit');
  assert.doesNotMatch(mapJs, /warplaneEastOffset|updateWarplaneVectors|--flight-east-[xy]|--flight-angle/, 'the group is not given a fabricated geographic flight vector');
  assert.match(css, /\.mk-squad \.squad\s*\{[^}]*width: 84px; height: 200px; left: -42px; top: -100px;/);
  assert.match(css, /\.mk-squad \.squad \.sq\s*\{[^}]*width: 24px; height: 24px; scale: 1; animation: squadFly 7s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad \.sq:first-child\s*\{ left: 30px !important; top: calc\(50% - 12px\) !important; \}/);
  assert.match(css, /\.mk-squad \.squad \.sq:nth-child\(2\)\s*\{ left: 8px !important; top: calc\(50% \+ 16px\) !important; width: 22px; height: 22px; \}/);
  assert.match(css, /\.mk-squad \.squad \.sq:nth-child\(3\)\s*\{ left: 54px !important; top: calc\(50% \+ 16px\) !important; width: 22px; height: 22px; \}/);
  assert.match(css, /\.mk-squad \.sq-svg, html\.dark \.mk-squad \.sq-svg \{ fill: #3b8eff; filter: none; \}/);
  assert.match(css, /@keyframes squadFly \{ 0% \{ transform: translateY\(110px\); opacity: 0; \} 12% \{ opacity: 1; \} 88% \{ opacity: 1; \} 100% \{ transform: translateY\(-110px\); opacity: 0; \} \}/);
  assert.doesNotMatch(css, /warplaneOrbit/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-squad:not\(\.t-warplane\) \.squad \{ visibility: hidden; \}/);
  assert.match(css, /\.maplibregl-map \.mk-squad\.t-warplane \.squad \{ visibility: visible; \}/);
  assert.match(css, /\.mk-squad \.mk-s \{ transform: none; transition: none; \}/, 'the group stays anchored in screen space while its planes pass');
  assert.match(css, /\.mk-squad \.squad \.sq \{ animation: none !important; transform: none !important; opacity: 1 !important; \}/, 'reduced-motion preferences stop each moving plane');
  assert.match(mapJs, /if \(!\['squad', 'movement', 'fly'\]\.includes\(marker\)\)/);
});

test('only the warplane area receives a larger display cap, without inflating reported radius', () => {
  assert.match(mapJs, /planeArea \? z\.km : this\._screenKm\(z\.km, z\.lat, marker === 'squad' \? 0\.28 : 0\.18\)/);
  const method = mapJs.match(/  _screenKm\(([^)]*)\) \{([\s\S]*?)\n  \}/);
  assert.ok(method, 'display-radius conversion remains independently testable');
  const screenKm = new Function(method[1], method[2]);
  for (const [width, height] of [[393, 720], [1280, 593], [980, 1740]]) {
    const map = { getContainer: () => ({ clientWidth: width, clientHeight: height }), getZoom: () => 14 };
    const context = { map };
    const reportedKm = 20;
    const original = screenKm.call(context, reportedKm, 33.3);
    const aircraft = screenKm.call(context, reportedKm, 33.3, 0.28);
    assert.ok(Math.abs(aircraft / original - 0.28 / 0.18) < 1e-10);
    assert.ok(aircraft < reportedKm, 'a display cap never exceeds the actual reported radius');
    const mpp = (40075016.686 * Math.cos(33.3 * Math.PI / 180)) / (512 * 2 ** 14);
    assert.ok(Math.abs(aircraft * 1000 / mpp - Math.min(width, height) * 0.28) < 1e-9);
    assert.equal(screenKm.call(context, 0.1, 33.3, 0.28), screenKm.call(context, 0.1, 33.3));
    assert.equal(reportedKm, 20, 'the source radius is input only');
  }
});

test('entry flight marker keeps its schematic approach animation while the route line is separate', () => {
  assert.match(css, /\.map-flight-track-marker\.is-plane\.is-entering-syria \.map-flight-track-squad \{ animation-name: flightTrackPlaneApproach/ );
  assert.match(css, /@keyframes flightTrackEnterFromEast \{ 0% \{ transform: translateX\(44px\); opacity: 0; \}/);
  assert.match(css, /Icon motion is schematic; any geographic line uses only separately selected endpoints, never live tracking/);
  assert.match(mapJs, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
});

test('movement stays anchored to the observed location and draws only the selected direct route', () => {
  assert.match(mapJs, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(mapJs, /track\.marker\.setLngLat\(position\)/);
  assert.match(mapJs, /const heading = isReferenceRoute && Number\.isFinite\(routeBearing\) \? routeBearing : aircraftHeading\(alert, savedBearing\)/);
  assert.match(mapJs, /track\.marker\.setRotation\(heading\)/);
  assert.match(mapJs, /maplibregl-marker map-flight-track-marker/);
  assert.match(css, /\.map-flight-track-marker \{ position: absolute;/);
  assert.match(mapJs, /directFlightPath\(alert\.location, alert\.flight_target\)/);
  assert.match(mapJs, /geometry: \{ type: 'LineString', coordinates: route \}/);
  assert.match(mapJs, /const routeColor = aircraft === 'uav' \? '#e5484d' : '#2476c9'/);
  assert.match(mapJs, /const iconColor = aircraft === 'uav' \? color : '#3b8eff'/);
  assert.match(mapJs, /properties: \{ color: routeColor, arrow: '➤'/);
  assert.match(mapJs, /'symbol-placement': 'line-center'/);
  assert.match(mapJs, /'text-rotation-alignment': 'map', 'text-keep-upright': false/);
  assert.match(mapJs, /'line-opacity': \['case', \['get', 'referenceRoute'\], 0\.92, \['get', 'planeRoute'\], 0\.45, 0\.9\]/);
  assert.match(mapJs, /fill="\$\{iconColor\}" class="map-flight-track-svg"/);
  assert.match(mapJs, /source\.setData\(\{ type: 'FeatureCollection', features: routeFeatures \}\)/);
  assert.match(mapJs, /&& Number\.isFinite\(a\.location\?\.latitude\) && Number\.isFinite\(a\.location\?\.longitude\)/);
  assert.match(css, /\.map-flight-track-marker\.is-plane \.map-flight-track-svg \{ transform: rotate\(-45deg\); \}/);
});
