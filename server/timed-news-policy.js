export const timedNewsWindow = (at) => {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Damascus', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
  return hm >= '08:00' && hm < '22:00' ? 'day' : 'night';
};
export function timedNewsDue(cardAt) { return cardAt + (timedNewsWindow(cardAt) === 'day' ? 120000 : 0); }
export function timedNewsEligible(d, policy, now) {
  return policy?.enabled === true && Number.isFinite(policy.effectiveAt) && d?.timedNews?.policyAt === policy.effectiveAt
    && d.created >= policy.effectiveAt && d.status === 'pending' && !d.test && !d.undone && !d.alertId && !d.postId && !d.duplicateOf
    && !d.operatorReview?.result?.match(/claimed|uncertain|published|map-only/) && !d.nativeReview?.result?.match(/claimed|uncertain|published/)
    && Number.isFinite(d.timedNews.cardAt) && now >= d.timedNews.dueAt && d.timedNews.state !== 'failed';
}
