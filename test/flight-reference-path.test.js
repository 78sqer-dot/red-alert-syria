import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flightPathBearing,
  ISRAEL_APPROX_REFERENCE,
  referenceFlightPath,
} from '../shared/flight-path.js';

const quneitra = {
  scope: 'governorate',
  longitude: 35.82461,
  latitude: 33.12595,
};

test('toward-Syria and entering routes run from the fixed approximate Israel reference to the selected governorate', () => {
  const expected = [[35.50, 33.10], [quneitra.longitude, quneitra.latitude]];
  assert.deepEqual(ISRAEL_APPROX_REFERENCE, expected[0]);
  assert.deepEqual(referenceFlightPath('toward_syria', quneitra), expected);
  assert.deepEqual(referenceFlightPath('entering_syria', quneitra), expected);
});

test('withdrawal reverses the same illustrative line toward the Israel reference', () => {
  const inbound = referenceFlightPath('toward_syria', quneitra);
  const outbound = referenceFlightPath('leaving_syria', quneitra);
  assert.deepEqual(outbound, [...inbound].reverse());
  const inboundBearing = flightPathBearing(inbound);
  const outboundBearing = flightPathBearing(outbound);
  const angularDifference = ((outboundBearing - inboundBearing + 540) % 360) - 180;
  assert.ok(Math.abs(Math.abs(angularDifference) - 180) < 1);
});

test('country-wide, missing, invalid, and unknown destinations do not invent a precise route', () => {
  assert.deepEqual(referenceFlightPath('toward_syria', { scope: 'country', longitude: 36, latitude: 34 }), []);
  assert.deepEqual(referenceFlightPath('toward_syria', null), []);
  assert.deepEqual(referenceFlightPath('unknown', quneitra), []);
  assert.deepEqual(referenceFlightPath('toward_syria', { ...quneitra, longitude: 181 }), []);
  assert.equal(flightPathBearing([]), null);
});
