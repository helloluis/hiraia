// Test-only request boundary, installed through Playwright's main-process debugger.
// The function is self-contained because Playwright serializes it into Electron.
function installProductionGuard({ session }, config) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const digest = value => process.getBuiltinModule('node:crypto').createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  const state = global.__productionCheck = { ...config, writes: 0, registrations: 0,
    sections: 0, slides: 0, deletions: 0, blocked: 0, statuses: [], planId: null,
    sectionIds: [], contentSectionId: null, sectionDigests: {}, revisionContentDigest: null,
    appliedPlanDigest: null, syncApplications: 0, recordWrites: 0,
    deckId: null, slideJobId: null, finishing: false };
  const ses = session.fromPartition('persist:tala');
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => {
    let ok = false;
    try {
      const url = new URL(d.url), p = url.pathname;
      ok = url.origin === state.base;
      if (ok && !['GET', 'HEAD', 'OPTIONS'].includes(d.method)) {
        let body = null;
        try {
          const bytes = Buffer.concat((d.uploadData || []).filter(x => x.bytes).map(x => x.bytes));
          body = bytes.length ? JSON.parse(bytes.toString()) : {};
        } catch {}
        const post = d.method === 'POST';
        const cleanup = post && p === '/api/v1/account/delete' && state.native &&
          body?.confirm === 'DELETE' && typeof body.password === 'string' && state.deletions === 0;
        ok = !!body && state.writes < (cleanup ? 32 : 31);
        if (state.finishing) ok = ok && (cleanup || (post && p === '/api/v1/auth/logout'));
        else if (post && p === '/api/v1/auth/register') ok = ok && state.native && state.registrations === 0 && body.email === state.email && body.displayName === state.displayName;
        else if (post && p === '/api/v1/auth/login') ok = ok && body.email === state.email;
        else if (post && p === '/api/v1/auth/logout') ok = ok && state.writes < 31;
        else if (post && p === '/api/v1/sync/push') {
          // The unchanged web client puts 9 sections, one history row and one
          // plan. Only Content may change; compare the other eight to the seed.
          const mutations = body?.mutations;
          ok = ok && !!state.planId && !!state.contentSectionId && state.sections === 1 &&
            state.syncApplications === 0 && state.sectionIds.length === 9 &&
            Array.isArray(mutations) && mutations.length === 11 && new Set(mutations.map(m => m.id)).size === 11 &&
            mutations.filter(m => m.entity === 'plan').length === 1 &&
            mutations.filter(m => m.entity === 'plan_section').length === 9 &&
            mutations.filter(m => m.entity === 'section_revision').length === 1 &&
            mutations.every(m => m.op === 'upsert' && m.data?.id === m.id && (
              (m.entity === 'plan' && m.id === state.planId && digest(m.data) === state.appliedPlanDigest) ||
              (m.entity === 'plan_section' && state.sectionIds.includes(m.id) && m.data.planId === state.planId &&
                (m.id === state.contentSectionId ? m.data.key === 'content' && m.data.origin === 'ai' : digest(m.data) === state.sectionDigests[m.id])) ||
              (m.entity === 'section_revision' && m.baseRev === 0 && m.data.planId === state.planId &&
                m.data.sectionId === state.contentSectionId && m.data.key === 'content' && m.data.reason === 'regenerate' &&
                digest({ content: m.data.content, origin: m.data.origin, gen: m.data.gen }) === state.revisionContentDigest)));
        }
        else if (post && p === '/api/v1/generation/jobs') ok = ok && !!state.planId && body.planId === state.planId && body.kind === 'section' && body.sectionKey === 'content' && state.sections === 0;
        else if (post && p === `/api/v1/plans/${state.planId}/presentation/ai`) ok = ok && state.native && !!state.planId && body.scope === 'new' && state.slides === 0;
        else if (post && p === `/api/v1/plans/${state.planId}/presentation/ai/${state.slideJobId}/apply`) ok = ok && state.native && !!state.planId && !!state.slideJobId;
        else if (p === `/api/v1/decks/${state.deckId}` && state.deckId) ok = ok && state.native && d.method === 'PUT' && Array.isArray(body.slides);
        else ok = ok && cleanup;
        if (ok) {
          state.writes++;
          if (p === '/api/v1/auth/register') state.registrations++;
          if (p === '/api/v1/generation/jobs') state.sections++;
          if (p === '/api/v1/sync/push') { state.syncApplications++; state.recordWrites += body.mutations.length; }
          if (p === `/api/v1/plans/${state.planId}/presentation/ai`) state.slides++;
          if (cleanup) state.deletions++;
        }
      }
    } catch { ok = false; }
    if (!ok) state.blocked++;
    cb({ cancel: !ok });
  });
  ses.webRequest.onCompleted({ urls: [state.base + '/api/*'] }, d => {
    state.statuses.push({ method: d.method, path: new URL(d.url).pathname, status: d.statusCode });
  });
}
module.exports = { installProductionGuard };
