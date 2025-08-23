// Minimal fallback manager skeleton
async function tryProviders(projectMeta, providers) {
  for (const p of providers) {
    try {
      const res = await p.deploy(projectMeta);
      return { provider: p.name || 'unknown', result: res };
    } catch (err) {
      // continue to next provider
    }
  }
  throw new Error('All providers failed');
}

module.exports = { tryProviders };


