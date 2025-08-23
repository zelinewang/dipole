const path = require('path');
const vercel = require('../agent/deployers/vercel');

(async () => {
  try {
    const projectPath = path.resolve('validation/fixtures/static-site');
    const res = await vercel.deploy({ path: projectPath });
    console.log('Deploy result:', res);
    if (!res.url) {
      console.error('Adapter did not return a URL');
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('Deploy failed:', e.message || e);
    process.exit(1);
  }
})();


