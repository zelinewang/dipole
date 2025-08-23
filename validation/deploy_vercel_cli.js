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
    const token = process.env.VERCEL_TOKEN || process.env.NOW_TOKEN;
    // run build if present
    try { await execCmd('npm run build', { cwd: projectPath }); } catch(e) {}

    let cmd = 'npx vercel --prod --yes';
    if (token) cmd += ` --token ${token}`;
    console.log('Running:', cmd, 'in', projectPath);
    const res = await execCmd(cmd, { cwd: projectPath, env: process.env });
    console.log('Vercel CLI output:\n', res.stdout);
    const urlMatch = res.stdout.match(/https?:\/\/[^\s]+/);
    console.log('Detected URL:', urlMatch ? urlMatch[0] : null);
  } catch (e) {
    console.error('Vercel deploy failed:', e.err ? e.err.message : e);
    if (e.stdout) console.error('stdout:', e.stdout);
    if (e.stderr) console.error('stderr:', e.stderr);
  }
})();


