import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { alertMarkerKind, droneAuto, droneLevel } from '../shared/types.js';
import { hasSecondaryDrone, mapDroneCount } from '../shared/map-drone-visuals.js';

const CURRENT_ALERT_ID = 'a547f1dc-073a-4c81-a8cb-ae921c7d75e4';
const [mapSource, css] = await Promise.all([
  readFile(new URL('../public/js/map.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/css/app.css', import.meta.url), 'utf8'),
]);

test('political, normal drone and warplane alerts keep distinct map markers', () => {
  const political = { type: 'political' };
  const drone = { type: 'uav' };
  const warplane = { type: 'warplane' };
  assert.equal(alertMarkerKind(political), 'icon');
  assert.equal(alertMarkerKind(drone), 'orbit');
  assert.equal(alertMarkerKind(warplane), 'squad');
  assert.equal(alertMarkerKind({ type: 'signal_sweep', signal_platform: 'uav' }), 'orbit');
  assert.deepEqual(political, { type: 'political' }, 'choosing a visual never mutates alert data');
  assert.match(mapSource, /const marker = alertMarkerKind\(a\);/);
  assert.match(mapSource, /\$\{pl\(36, -12, 1\)\}\$\{pl\(20, 8, 0\.85\)\}\$\{pl\(52, 8, 0\.85\)\}/);
  assert.match(css, /\.maplibregl-map \.mk-squad\.t-warplane \.squad \{ visibility: visible; \}/);
});

test('the live alert displays one drone, while other intensive reports still display two', () => {
  const title = 'تحليق مسيّرة — يعفور ومنطقتان أخريان';
  const description = 'مصادر محلية: طائرات استطلاع إسرائيلية تقوم بعمليات مسح مكثف لمناطق يعفور والديماس ومنطقة قطنا بريف دمشق';
  const computed = droneLevel({ type: 'uav', title, description });
  const current = { id: CURRENT_ALERT_ID, type: 'uav', title, description, drones: computed };
  const original = structuredClone(current);
  assert.equal(droneAuto(description), 2, 'any mention of مكثف means two by the general rule');
  assert.equal(computed, 2, 'the general alert classification remains two');
  assert.equal(mapDroneCount(current), 1, 'the owner-requested exception is display-only and limited to this alert ID');
  assert.equal(mapDroneCount({ ...current, drones: 3 }), 1, 'this alert remains one even if its incoming count changes');
  assert.equal(mapDroneCount({ ...current, id: 'another-alert' }), 2, 'the same wording on another alert gets two');
  assert.equal(droneLevel({ type: 'uav', title: 'تحليق مسيّرة', description: 'رصد اعتيادي' }), 1);
  assert.equal(droneLevel({ type: 'uav', title, description, meta: { intense: false } }), 2, 'text evidence is not suppressed');
  assert.equal(droneLevel({ type: 'uav', title: 'تحليق مسيّرة', meta: { intense: false } }), 1);
  assert.equal(droneAuto('سرب من المسيّرات فوق دمشق'), 3);
  assert.deepEqual(current, original, 'display choice never changes the record');
  assert.match(mapSource, /import \{ mapDroneCount, hasSecondaryDrone \} from '\/shared\/map-drone-visuals\.js\?v=2'/);
  assert.match(mapSource, /const per = secondaryDrone \? 1 : mapDroneCount\(a\);/);
  assert.match(mapSource, /for \(let j = secondaryDrone \? 0 : i === mi \? 1 : 0; j < per; j\+\+\)/);
  assert.match(mapSource, /el\.style\.setProperty\('--delay', `\$\{\(-\(9 \* j\) \/ per - i \* 1\.3\)\.toFixed\(2\)\}s`\)/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-sat \.uav \{ animation: uavOrbit 9s linear infinite; animation-delay: var\(--delay, 0s\); \}/);
});

test('a ground incursion can carry one secondary drone without replacing its primary marker', () => {
  const report = { id: 'synthetic-incursion', type: 'military_incursion', drone_presence: true };
  const original = structuredClone(report);
  assert.equal(alertMarkerKind(report), 'icon', 'the ground-incursion marker stays primary');
  assert.equal(hasSecondaryDrone(report), true);
  assert.equal(mapDroneCount(report), 1, 'the secondary overlay is singular');
  assert.deepEqual(report, original, 'the display choice does not mutate the alert');
  assert.match(mapSource, /const secondaryDrone = hasSecondaryDrone\(a\) && typeOf\(a\.type\)\.marker !== 'orbit';/);
  assert.match(mapSource, /this\.markerEl\(secondaryDrone \? \{ \.\.\.a, type: 'uav', drones: 1 \} : a\)/);
  assert.match(mapSource, /if \(secondaryDrone\) el\.classList\.add\('drone-secondary'\)/);
  assert.match(css, /\.maplibregl-map \.mk-sat\.drone-secondary \{ visibility: hidden; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-sat\.drone-secondary\.sel \{ visibility: visible; \}/);
});

test('primary and second drone markers orbit the exact displayed circle on phone and desktop viewports', () => {
  const screenMethod = mapSource.match(/  _screenKm\(([^)]*)\) \{([\s\S]*?)\n  \}/);
  const orbitMethod = mapSource.match(/  _orbitPx\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(screenMethod, 'the displayed circle radius remains testable');
  assert.ok(orbitMethod, 'orbit updates remain testable');
  const screenKm = new Function(screenMethod[1], screenMethod[2]);
  const orbitPx = new Function(orbitMethod[1]);
  const viewports = [
    { label: 'phone', width: 393, height: 720 },
    { label: 'phone in desktop-site mode', width: 980, height: 1740 },
    { label: 'laptop', width: 1440, height: 900 },
  ];
  const zooms = [10.5, 11.5, 14];
  const lat = 33.5102;
  const rawRadiusKm = 4.5;

  for (const viewport of viewports) {
    for (const zoom of zooms) {
      const map = {
        getZoom: () => zoom,
        getContainer: () => ({ clientWidth: viewport.width, clientHeight: viewport.height }),
      };
      const makeMarker = () => {
        const element = { style: { values: {}, setProperty(name, value) { this.values[name] = value; } } };
        return { marker: { getElement: () => element }, element };
      };
      const main = makeMarker();
      const second = makeMarker();
      second.marker._zkm = rawRadiusKm;
      second.marker._lat = lat;
      const context = {
        map,
        _screenKm: screenKm,
        _orb: new Map(),
        markers: new Map([['drone-alert', main.marker]]),
        sats: new Map([['drone-alert:second-drone', second.marker]]),
      };
      const displayedRadiusKm = screenKm.call(context, rawRadiusKm, lat);
      context._orb.set('drone-alert', { km: displayedRadiusKm, lat });
      orbitPx.call(context);

      const metersPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
      const expectedRadiusPx = `${Math.max(5, Math.round((displayedRadiusKm * 1000) / metersPerPixel))}px`;
      assert.equal(main.element.style.values['--orb'], expectedRadiusPx, `${viewport.label}, zoom ${zoom}: primary drone`);
      assert.equal(second.element.style.values['--orb'], expectedRadiusPx, `${viewport.label}, zoom ${zoom}: second drone`);
      assert.ok(Number.parseFloat(expectedRadiusPx) > 12, 'test radius is large enough to detect the old 8–12px clamp');
    }
  }
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit:not\(\.mk-sat\) \.uav \{ visibility: hidden; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-orbit:not\(\.mk-sat\) \.uav \{ visibility: visible; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-sat \.uav \{ animation: uavOrbit 9s linear infinite;/);
});
