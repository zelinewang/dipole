// Provider registry
function listProviders() { return ['vercel', 'netlify']; }

function getDeployer(name) {
  if (name === 'vercel') return require('../deployers/vercel');
  if (name === 'netlify') return require('../deployers/netlify');
  throw new Error(`Unknown provider: ${name}`);
}

module.exports = { listProviders, getDeployer };
