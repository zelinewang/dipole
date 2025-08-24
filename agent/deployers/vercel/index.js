const { exec, spawn } = require('child_process');
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

function execCmdStream(cmd, opts = {}, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { ...(opts || {}), shell: true });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { const t = d.toString(); stdout += t; if (onLog) onLog(t); });
    if (child.stderr) child.stderr.on('data', (d) => { const t = d.toString(); stderr += t; if (onLog) onLog(t); });
    child.on('error', (err) => reject(new Error(`Command failed: ${cmd}\n${stderr || err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command failed: ${cmd}\n${stderr}`));
    });
  });
}

async function runBuildIfNeeded(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.scripts && pkg.scripts.build) {
      // run npm run build
      await execCmd('npm run build', { cwd: projectPath, env: process.env });
    }
  } catch (e) {
    // ignore build errors here; let deploy capture them
  }
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function deploy(projectMeta = {}, options = {}) {
  const onLog = options && options.onLog ? options.onLog : null;
  // Test-only mock: if FAST_DEPLOY_MOCK is set, bypass external calls
  if (process.env.FAST_DEPLOY_MOCK) {
    const mode = String(process.env.FAST_DEPLOY_MOCK).toLowerCase();
    if (onLog) onLog(`[mock] vercel deploy starting...\n`);
    if (mode === 'success') { if (onLog) onLog(`[mock] vercel deploy success\n`); return { url: 'https://mock.vercel.app', logs: 'mocked: success', mock: true }; }
    if (mode === 'rate_limit') { if (onLog) onLog(`[mock] vercel rate_limit\n`); return { url: null, logs: '429 Too Many Requests', error: 'rate_limit', mock: true }; }
    if (mode === 'fail') { if (onLog) onLog(`[mock] vercel deploy failure\n`); return { url: null, logs: 'mocked: failure', error: 'mock_failure', mock: true }; }
  }
  const projectPath = projectMeta.path ? path.resolve(projectMeta.path) : process.cwd();
  // Ensure build step runs if present
  await runBuildIfNeeded(projectPath);

  const vercelToken = process.env.VERCEL_TOKEN || process.env.NOW_TOKEN;
  // If token provided, attempt API-based deploy using uploaded files (simple base64 approach)
  if (vercelToken) {
    try {
      // Determine build output dir
      const buildDir = projectMeta.buildOutputDir || path.join(projectPath, 'build');
      const files = [];
      if (fs.existsSync(buildDir)) {
        const walk = (dir) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else {
              const rel = path.relative(buildDir, full).split(path.sep).join('/');
              const data = fs.readFileSync(full);
              files.push({ file: rel, data: data.toString('base64') });
            }
          }
        };
        walk(buildDir);
      }

      const payload = {
        name: projectMeta.name || path.basename(projectPath),
        files,
        target: 'production'
      };

      // If payload too large, skip API-based deploy and fall back to CLI
      const totalBytes = files.reduce((s, f) => s + Buffer.from(f.data, 'base64').length, 0);
      const MAX_API_BYTES = 5 * 1024 * 1024; // 5MB conservative
      if (totalBytes > MAX_API_BYTES) {
        // skip API and proceed to CLI flow below
        throw new Error('Payload too large for API deploy; will use CLI fallback');
      }

      const opts = {
        hostname: 'api.vercel.com',
        path: '/v13/deployments',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json'
        }
      };

      const res = await httpsRequest(opts, JSON.stringify(payload));
      if (res && (res.url || res.deployments || res.deployment)) {
        // Try several fields for URL
        const url = res.url || (res.deployment && res.deployment.url) || (res.deployments && res.deployments[0] && res.deployments[0].url) || null;
        return { url, logs: JSON.stringify(res, null, 2) };
      }
    } catch (err) {
      // Continue to CLI fallback
      // capture error in logs
      const apiErr = err;
      // proceed to CLI below
    }
  }

  // Try to use Vercel CLI via npx if available
  try {
    // check CLI
    await execCmd('npx vercel --version');

    // Build deploy command; use --yes to skip prompts
    let cmd = 'npx vercel --prod --yes';
    if (vercelToken) cmd += ` --token ${vercelToken}`;

    let stdout;
    if (onLog) {
      const res = await execCmdStream(cmd, { cwd: projectPath, env: process.env }, onLog);
      stdout = res.stdout;
    } else {
      const res = await execCmd(cmd, { cwd: projectPath, env: process.env });
      stdout = res.stdout;
    }

    // Attempt to parse a URL from stdout
    const urlMatch = stdout.match(/https?:\/\/[^\s]+/);
    const url = urlMatch ? urlMatch[0].trim() : null;

    return { url, logs: stdout };
  } catch (err) {
    // Failure: do not return a fake URL; surface error and logs
    const logs = `Vercel deploy via API/CLI failed. Error: ${err.message}`;
    return { url: null, logs, error: err.message };
  }
}

module.exports = { deploy };



