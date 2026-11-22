import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeJobApplicationLink,jobApplicationLinks,jobApplicationLinksFromText} from '../shared/job-links.js';
import {initialJobsState,createPendingJob,decideJob,publicJobs} from '../server/jobs.js';
import {labelledApplicationDeadline,isApplicationDeadlineExpired} from '../server/application-deadline.js';
const LINK='http://www.job.sy/company/vacancy/view.php?id=52346';
test('jobs-only HTTP numeric job.sy vacancy routes preserve original scheme and do not permit other HTTP links',()=>{
 assert.equal(normalizeJobApplicationLink(LINK),LINK);assert.equal(normalizeJobApplicationLink(LINK.replace('www.','')),LINK.replace('www.',''));
 for(const url of ['http://example.org/apply','http://www.job.sy/','http://www.job.sy/company/vacancy/view.php?id=x','http://www.job.sy/company/vacancy/view.php?id=1&id=2','http://www.job.sy/company/vacancy/view.php?id=1&next=evil','http://www.job.sy/company/vacancy/view.php?id=1#x','http://www.job.sy:8080/company/vacancy/view.php?id=1','http://www.job.sy.evil.org/company/vacancy/view.php?id=1','http://user:pass@www.job.sy/company/vacancy/view.php?id=1','javascript:alert(1)','https://user:pass@example.org','https://example.org/with space','https://example.org/"bad'])assert.equal(normalizeJobApplicationLink(url),null,url);
});
test('new intake merges supplied destinations and body links, removes known aggregator aliases, deduplicates',()=>{
 const j=initialJobsState(),{job}=createPendingJob({kind:'source',text:`فرصة عمل في دمشق\nالتقديم: ${LINK}`,links:['https://t.me/Syrian_jobbb','https://example.org/apply'],sourceKey:'links:test:1'},j);
 assert.deepEqual(job.links,['https://example.org/apply',LINK]);assert.deepEqual(jobApplicationLinks(['https://t.me/syrian_jobb','https://t.me/Syrian_jobbb',LINK,LINK]),[LINK]);assert.deepEqual(jobApplicationLinksFromText(`التقديم (${LINK}).`),[LINK]);
});
test('legacy published links are not globally rewritten and correct NRC-style rows remain unchanged',()=>{
 const j=initialJobsState(),{job}=createPendingJob({kind:'source',text:'فرصة عمل في دمشق',links:['https://example.org/apply'],sourceKey:'links:test:2'},j);job.links=['https://example.org/apply','https://t.me/Syrian_jobbb'];decideJob(job.id,'approve_without_location',j);assert.deepEqual(publicJobs(j)[0].links,job.links);
});
test('application period resolves its stated end date and expires only after Damascus midnight',()=>{
 const text='فرصة عمل في مشفى\nفترة تقديم الطلبات: اعتباراً من 15-11-2026 ولغاية 22-11-2026.';assert.equal(labelledApplicationDeadline(text),'2026-11-22');assert.equal(isApplicationDeadlineExpired('2026-11-22',Date.parse('2026-11-22T20:59:59Z')),false);assert.equal(isApplicationDeadlineExpired('2026-11-22',Date.parse('2026-11-22T21:00:00Z')),true);
 const j=initialJobsState(),{job}=createPendingJob({kind:'source',text,sourceKey:'period:test:1'},j);decideJob(job.id,'approve_without_location',j,null,Date.parse('2026-11-22T18:00:00Z'));assert.equal(publicJobs(j,Date.parse('2026-11-22T20:59:59Z')).length,1);assert.equal(publicJobs(j,Date.parse('2026-11-22T21:00:00Z')).length,0);
});
