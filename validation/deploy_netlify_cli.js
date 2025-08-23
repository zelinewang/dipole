const { exec } = require('child_process');
const path = require('path');

function loadDotEnv() {
  try { require('dotenv').config(); return; } catch (e) {}
  const fs = require('fs');
  const p = require('path').join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  for (const l of lines) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    process.env[m[1]] = process.env[m[1]] || val;
  }
}

loadDotEnv();

function execCmd(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

(async () => {
  try {
    const projectPath = path.resolve('validation/fixtures/static-site');
    const token = process.env.NETLIFY_TOKEN;
    // no build step for static-site; if build exists, run it
    try { await execCmd('npm run build', { cwd: projectPath }); } catch(e) {}
    let siteId = null;
    let siteUrl = null;
    if (token) {
      // try to create a site via API
      try {
        const payload = JSON.stringify({ name: `fast-deploy-${Date.now()}` });
        const https = require('https');
        const opts = {
          hostname: 'api.netlify.com',
          path: '/api/v1/sites',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        };
        const apiRes = await new Promise((resolve, reject) => {
          const req = https.request(opts, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { resolve({ status: res.statusCode, text: data }); }
            });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
        siteId = apiRes && apiRes.id;
        siteUrl = apiRes && (apiRes.ssl_url || apiRes.url);
      } catch (e) {
        // ignore
      }
    }

    let cmd = `npx netlify deploy --dir=./ --prod`;
    if (siteId) cmd += ` --site=${siteId}`;
    if (token) cmd += ` --auth ${token}`;
    console.log('Running:', cmd, 'in', projectPath);
    const res = await execCmd(cmd, { cwd: projectPath, env: process.env });
    console.log('Netlify CLI output:\n', res.stdout);
    const urlMatch = res.stdout.match(/https?:\/\/[^\s]+/);
    console.log('Detected URL:', urlMatch ? urlMatch[0] : siteUrl);
  } catch (e) {
    console.error('Netlify deploy failed:', e.err ? e.err.message : e);
    if (e.stdout) console.error('stdout:', e.stdout);
    if (e.stderr) console.error('stderr:', e.stderr);
  }
})();


