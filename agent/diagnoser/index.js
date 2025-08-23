const https = require('https');
const { packContext } = require('./context_pack');
const { buildDiagnosticPrompt } = require('./prompt_templates');

// Minimal OpenAI chat client using HTTPS
async function openAIChat(messages, { apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4o-mini', timeoutMs = 15000 } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY required');
  const body = JSON.stringify({ model, messages, temperature: 0 });
  return new Promise((resolve, reject) => {
    if (process.env.FAST_DEPLOY_DEBUG_LLM === '1') {
      try { console.error(`[fast-deploy][diagnoser] openai model=${model}`); } catch {}
    }
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          resolve(content || '');
        } catch (e) {
          reject(new Error('Failed to parse OpenAI response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function heuristicDiagnosis(logText, meta) {
  const findings = [];
  const actions = { patches: [], commands: [], configs: [] };
  const notes = [];

  const t = String(logText || '');
  if (/ERR_MODULE_NOT_FOUND|module not found|cannot find module/i.test(t)) {
    findings.push('Missing dependency');
    actions.commands.push('npm install');
  }
  if (/dotenv|process\.env|Missing required env/i.test(t)) {
    findings.push('Missing environment variables');
    actions.configs.push({ file: '.env', example: 'MY_KEY=...' });
  }
  if (/npx: command not found|vercel: not found|netlify: not found/i.test(t)) {
    findings.push('CLI tooling missing');
    actions.commands.push('npm i -D vercel netlify-cli');
  }
  if (/build failed|Error: Command failed/i.test(t)) {
    findings.push('Build failed');
    actions.commands.push('npm run build');
  }

  // Meta-based heuristics (work without logs)
  if (meta && typeof meta === 'object') {
    // Missing build command for buildable front-end projects
    const buildable = ['vite-react', 'cra', 'next', 'static'];
    if (!meta.buildCommand && buildable.includes(meta.type)) {
      findings.push('Missing build command');
      actions.configs.push({ file: 'package.json', example: '{ "scripts": { "build": "<your build command>" } }' });
    }

    // Missing server runtime definition (Procfile/Dockerfile) for server apps
    const isServerType = meta.type === 'express' || meta.type === 'flask';
    const looksServerStart = typeof meta.startCommand === 'string' && /(node|python|gunicorn|uvicorn)/i.test(meta.startCommand);
    if ((isServerType || looksServerStart) && !meta.hasDockerfile && !meta.hasProcfile) {
      findings.push('Missing server runtime definition');
      if (meta.type === 'express' || /node/i.test(meta.startCommand || '')) {
        actions.configs.push({ file: 'Procfile', example: 'web: node server.js' });
      } else if (meta.type === 'flask' || /python|gunicorn|uvicorn/i.test(meta.startCommand || '')) {
        actions.configs.push({ file: 'Procfile', example: 'web: gunicorn app:app' });
      } else {
        actions.configs.push({ file: 'Procfile', example: 'web: <start command>' });
      }
    }

    // .env present: remind to set required keys
    if (meta.usesEnvFile) {
      notes.push('Detected .env file; ensure required keys are set in the deployment environment.');
    }
  }

  // Choose a high-level category compatible with roadmap schema
  const lc = t.toLowerCase();
  let category = 'unknown';
  if (findings.includes('Missing dependency')) category = 'missing_dependency';
  else if (findings.includes('Missing build command')) category = 'missing_script';
  else if (findings.includes('Missing environment variables')) category = 'config_error';
  else if (findings.includes('CLI tooling missing')) category = 'missing_dependency';
  else if (findings.includes('Missing server runtime definition')) category = 'config_error';
  else if (/rate limit|429|too many requests/.test(lc)) category = 'rate_limit';
  else if (findings.includes('Build failed')) category = 'config_error';

  // Confidence calibration: more corroborating findings -> higher confidence
  let confidence = 0.2;
  if (findings.length === 1) confidence = 0.5;
  else if (findings.length >= 2) confidence = 0.7;
  if (category === 'unknown') confidence = Math.min(confidence, 0.3);

  const summary = findings.length ? findings.join('; ') : 'No obvious issues detected';
  return { summary, category, rootCauses: findings, actions, confidence, notes };
}

async function diagnose(logText, meta, { allowLLM = true } = {}) {
  const ctx = packContext(logText, meta);
  const base = heuristicDiagnosis(logText, meta);
  let result = { ...base };

  if (allowLLM && process.env.OPENAI_API_KEY) {
    try {
      const { system, user } = buildDiagnosticPrompt(ctx);
      const content = await openAIChat([
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]);
      // Try parse JSON from LLM
      const json = JSON.parse(content.trim());
      // Merge conservatively
      result = {
        summary: json.summary || base.summary,
        category: json.category || base.category,
        rootCauses: Array.isArray(json.rootCauses) && json.rootCauses.length ? json.rootCauses : base.rootCauses,
        actions: json.actions || base.actions,
        confidence: typeof json.confidence === 'number' ? json.confidence : base.confidence,
        notes: Array.isArray(json.notes) ? json.notes : base.notes
      };
    } catch (e) {
      // keep heuristic
    }
  }

  return { type: 'DiagnoseResult', context: { meta: ctx.meta, hints: ctx.hints }, ...result };
}

module.exports = { diagnose };
