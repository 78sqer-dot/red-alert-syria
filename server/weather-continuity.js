// Cache continuity only. No bot, store, model data, publication or user messages.
import { officialWeatherWarnings, officialWeatherDebug } from './weather-official.js';
export function createOfficialWeatherContinuity({read = officialWeatherWarnings, health = officialWeatherDebug, schedule = setInterval, clear = clearInterval, report = (state) => console.log('[official-weather-health]', JSON.stringify(state))} = {}) {
  let timer = null, running = false, stopped = true, last = '';
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // Existing TTL/backoff and shared busy promise own network eligibility.
      await read({waitMs: 300_000});
      const state = health();
      if (!stopped && state.health !== last) {
        last = state.health;
        report({health: state.health, successAt: state.successAt, failureAt: state.failureAt, stale: state.stale});
      }
    } catch {
      if (!stopped && last !== 'failed') { last = 'failed'; report({health: 'failed'}); }
    } finally { running = false; }
  };
  return {
    start() { if (!stopped) return; stopped = false; void tick(); timer = schedule(tick, 5 * 60_000); timer?.unref?.(); },
    stop() { stopped = true; if (timer !== null) clear(timer); timer = null; },
    tick,
  };
}
let lifecycle;
export function startOfficialWeatherContinuity() {
  lifecycle ||= createOfficialWeatherContinuity();
  lifecycle.start();
}
