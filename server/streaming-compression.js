import compression from 'compression';
import { constants } from 'node:zlib';

// SSE is long-lived. Flush each compressed chunk so snapshots, alerts and pings
// arrive immediately rather than waiting for the compression buffer to fill.
// Negotiation stays with compression: clients without support get plain SSE.
export function streamingCompression() {
  const regular = compression();
  const stream = compression({ threshold: 0, flush: constants.Z_SYNC_FLUSH });
  return (req, res, next) => (req.path === '/api/stream' ? stream : regular)(req, res, next);
}
