import express from 'express';
import { operatorNewsReview, prepareReviewedNewsCopy, prepareAttributedNewsDraft, correctOperatorNewsDraft, operateNewsDraft } from './news-monitor.js';
/** Mounted by the production app and exercised through HTTP in integration tests. */
export function mountNewsReviewRoutes(app, { adminKeyOk, apiLimiter }) {
  app.get('/api/admin/news/:id', apiLimiter, (req, res) => {
    if (!adminKeyOk(req)) return res.status(404).end();
    const review = operatorNewsReview(req.params.id);
    return review ? res.json(review) : res.status(404).json({error:'unknown-draft'});
  });
  for (const [suffix, operation] of [['prepare-reviewed',prepareReviewedNewsCopy], ['prepare-attributed', prepareAttributedNewsDraft], ['correct', correctOperatorNewsDraft]]) {
    app.post(`/api/admin/news/:id/${suffix}`, apiLimiter, express.json({limit:'12kb'}), async (req,res) => {
      if (!adminKeyOk(req)) return res.status(404).end();
      try { return res.json(await operation(req.params.id,req.body)); }
      catch(e) { return res.status(409).json({ok:false,error:e.message}); }
    });
  }
  app.post('/api/admin/news/:id/review', apiLimiter, express.json({limit:'8kb'}), async (req,res) => {
    if (!adminKeyOk(req)) return res.status(404).end();
    try {
      const result=await operateNewsDraft(req.params.id,{action:req.body?.action,revision:req.body?.revision,approval_reference:req.body?.approval_reference,single_source_acknowledged:req.body?.single_source_acknowledged,copy_hash:req.body?.copy_hash});
      return res.status(result.ok?200:409).json(result);
    } catch(e) { return res.status(409).json({ok:false,error:e.message}); }
  });
}
