const SUBSCRIPTION_ENDPOINT = '/api/push/subscribe';

export async function disablePushSubscription({ serviceWorker, fetchImpl = globalThis.fetch } = {}) {
  if (!serviceWorker || typeof fetchImpl !== 'function') {
    return { found: false, serverRemoved: false, browserUnsubscribed: false };
  }

  let subscription;
  try {
    const registration = await serviceWorker.ready;
    subscription = await registration?.pushManager?.getSubscription();
  } catch {
    return { found: false, serverRemoved: false, browserUnsubscribed: false };
  }
  if (!subscription) return { found: false, serverRemoved: false, browserUnsubscribed: false };

  const endpoint = subscription.endpoint;
  const removeOnServer = (async () => {
    try {
      const response = await fetchImpl(SUBSCRIPTION_ENDPOINT, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      return response.ok;
    } catch {
      return false;
    }
  })();
  const unsubscribeInBrowser = (async () => {
    try {
      return await subscription.unsubscribe() === true;
    } catch {
      return false;
    }
  })();

  const [serverRemoved, browserUnsubscribed] = await Promise.all([removeOnServer, unsubscribeInBrowser]);
  return { found: true, serverRemoved, browserUnsubscribed };
}
