// Explicit separate event: repairs refresh live SSE clients but never notify.
export function wireMaintenanceUpdates(store,broadcast){
  store.on('maintenance-update',alert=>broadcast('update',alert));
}
