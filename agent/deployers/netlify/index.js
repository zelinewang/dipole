const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

function execCmd(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`Command failed: ${cmd}\n${stderr || err.message}`);
        e.stdout = stdout;
        e.stderr = stderr;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function deploy(projectMeta = {}) {
  // Test-only mock: if FAST_DEPLOY_MOCK is set, bypass external calls
  if (process.env.FAST_DEPLOY_MOCK) {
    const mode = String(process.env.FAST_DEPLOY_MOCK).toLowerCase();
    if (mode === 'success') return { url: 'https://mock.netlify.app', logs: 'mocked: success', mock: true };
    if (mode === 'rate_limit') return { url: null, logs: '429 Too Many Requests', error: 'rate_limit', mock: true };
    if (mode === 'fail') return { url: null, logs: 'mocked: failure', error: 'mock_failure', mock: true };
  }
  const projectPath = projectMeta.path ? path.resolve(projectMeta.path) : process.cwd();
  const buildDir = projectMeta.buildOutputDir || path.join(projectPath, 'build');

  const netlifyToken = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN;
  // If token provided, try minimal API flow: create a site and then use CLI to deploy to site
  if (netlifyToken) {
    try {
      // Create a new site via API
      const payload = JSON.stringify({ name: projectMeta.name || `fast-deploy-${Date.now()}` });
      const opts = {
        hostname: 'api.netlify.com',
        path: '/api/v1/sites',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${netlifyToken}`,
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

      const siteId = apiRes && apiRes.id;
      const siteUrl = apiRes && (apiRes.ssl_url || apiRes.url);

      // If site created, try to use CLI to deploy the build dir to that site id
      if (siteId) {
        try {
          await execCmd('npx netlify --version');
          let cmd = `npx netlify deploy --dir=${buildDir} --prod --site=${siteId}`;
          if (netlifyToken) cmd += ` --auth ${netlifyToken}`;
          const { stdout } = await execCmd(cmd, { cwd: projectPath, env: process.env });
          const urlMatch = stdout.match(/https?:\/\/[^\s]+/);
          const url = urlMatch ? urlMatch[0].trim() : siteUrl || null;
          return { url, logs: JSON.stringify({ api: apiRes, cli: stdout }, null, 2) };
        } catch (cliErr) {
          return { url: siteUrl || null, logs: `Site created via API but CLI deploy failed: ${cliErr.message}` };
        }
      }
    } catch (err) {
      // proceed to CLI fallback
    }
  }

  // Fallback: CLI-only deploy
  try {
    await execCmd('npx netlify --version');
    let cmd = `npx netlify deploy --dir=${buildDir} --prod`;
    if (netlifyToken) cmd += ` --auth ${netlifyToken}`;
    const { stdout } = await execCmd(cmd, { cwd: projectPath, env: process.env });
    const urlMatch = stdout.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0].trim() : null;
    return { url, logs: stdout };
  } catch (err) {
    const logs = `Netlify CLI unavailable or deploy failed. Error: ${err.message}`;
    return { url: null, logs, error: err.message };
  }
}

module.exports = { deploy };


