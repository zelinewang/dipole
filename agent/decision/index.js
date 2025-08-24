const fs = require('fs');
const path = require('path');
const https = require('https');

// Simple OpenAI chat wrapper using HTTPS (no extra deps)
async function openAIChat(messages, { apiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL || 'gpt-4o-mini', timeoutMs = 15000 } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for LLM-assisted decisions');
  const body = JSON.stringify({ model, messages, temperature: 0.2 });
  return new Promise((resolve, reject) => {
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

function ruleBasedDecision(meta, opts = {}) {
  const tokens = {
    vercel: !!process.env.VERCEL_TOKEN || !!process.env.NOW_TOKEN,
    netlify: !!process.env.NETLIFY_AUTH_TOKEN || !!process.env.NETLIFY_TOKEN,
  };

  const decision = {
    provider: 'netlify',
    method: 'cli',
    confidence: 0.7,
    rationale: [],
    envNeeded: [],
    risks: [],
    alternatives: []
  };

  const type = meta.type || 'unknown';
  const size = meta.projectSizeBytes || 0;
  const outDir = meta.buildOutputDir || null;

  if (type === 'next') {
    if (outDir === 'out') {
      decision.provider = 'netlify';
      decision.method = 'cli';
      decision.rationale.push('Next.js static export detected (out) – static hosting fits Netlify.');
      decision.envNeeded.push('NETLIFY_AUTH_TOKEN or NETLIFY_TOKEN');
      decision.alternatives.push({ provider: 'vercel', method: 'cli', when: 'Netlify CLI unavailable or auth fails' });
    } else {
      decision.provider = 'vercel';
      decision.method = 'cli';
      decision.rationale.push('Next.js server build detected (.next) – Vercel is the most compatible default.');
      decision.envNeeded.push('VERCEL_TOKEN');
      decision.alternatives.push({ provider: 'netlify', method: 'cli', when: 'Vercel fails; try Netlify as fallback for static parts' });
    }
  } else if (type === 'vite-react' || type === 'cra' || type === 'static') {
    if (size < 10 * 1024 * 1024) {
      decision.provider = 'netlify';
      decision.method = 'cli';
      decision.rationale.push('Small static build (<10MB) – Netlify CLI path is fast and stable.');
      decision.envNeeded.push('NETLIFY_AUTH_TOKEN or NETLIFY_TOKEN');
      decision.alternatives.push({ provider: 'vercel', method: 'cli', when: 'Netlify CLI unavailable or auth fails' });
    } else {
      decision.provider = 'netlify';
      decision.method = 'cli';
      decision.rationale.push('Large static build (>=10MB) – prefer CLI deploy, avoid naive API uploads.');
      decision.envNeeded.push('NETLIFY_AUTH_TOKEN or NETLIFY_TOKEN');
      decision.alternatives.push({ provider: 'vercel', method: 'cli', when: 'Netlify CLI unavailable or auth fails' });
      decision.risks.push('Build artifact size may cause slow uploads; ensure outputDir is correct.');
    }
  } else if (type === 'express' || type === 'flask') {
    decision.provider = 'vercel';
    decision.method = 'cli';
    decision.rationale.push(`${type} detected – current flow does not auto-provision servers. Consider Railway/Docker future provider.`);
    decision.risks.push('Runtime servers may not run on static hosts.');
    decision.alternatives.push({ provider: 'netlify', method: 'cli', when: 'Static export only' });
  } else {
    decision.provider = 'netlify';
    decision.method = 'cli';
    decision.rationale.push('Unknown type – defaulting to Netlify CLI for static fallback.');
    decision.alternatives.push({ provider: 'vercel', method: 'cli', when: 'If Netlify fails' });
  }

  // Respect preferred overrides
  if (opts.preferredProvider) decision.provider = opts.preferredProvider;
  if (opts.preferredMethod) decision.method = opts.preferredMethod;

  // Env/token notes
  if (decision.provider === 'vercel' && !tokens.vercel) decision.risks.push('VERCEL_TOKEN not set: CLI may prompt or fallback.');
  if (decision.provider === 'netlify' && !tokens.netlify) decision.risks.push('NETLIFY_AUTH_TOKEN/NETLIFY_TOKEN not set: CLI may prompt or fallback.');

  return decision;
}

function buildPlan(decision, meta, projectPath) {
  const outputDir = meta.buildOutputDir || 'build';
  const plan = {
    steps: [],
    artifacts: { outputDir },
    verifications: [ { id: 'url-check', type: 'http', expect: 200 } ]
  };

  if (meta.buildCommand) {
    plan.steps.push({ id: 'build-if-needed', run: 'npm run build', cwd: projectPath, skipIf: 'no build script' });
  }
  if (decision.provider === 'netlify') {
    plan.steps.push({ id: 'deploy', run: `npx netlify deploy --dir=${outputDir} --prod`, cwd: projectPath });
  } else if (decision.provider === 'vercel') {
    plan.steps.push({ id: 'deploy', run: 'npx vercel --prod --yes', cwd: projectPath });
  }

  return plan;
}

function redact(obj) {
  const s = JSON.stringify(obj);
  return s
    .replace(/([A-Za-z0-9_]*TOKEN[^"]*)\"\s*:\s*\"[^\"]+\"/g, '$1":"***"')
    .replace(/sk-[A-Za-z0-9-_]+/g, 'sk-***')
    .replace(/[A-Za-z0-9]{8,}:[A-Za-z0-9\-_]{16,}/g, '***');
}

async function llmRefineDecision(decision, meta, opts = {}) {
  if (opts.allowLLM === false) return decision;
  if (!process.env.OPENAI_API_KEY) return decision;

  const sys = 'You refine deployment decisions. Output compact JSON only with keys: provider, method, confidence, addRationales (array of strings), addRisks (array), addAlternatives (array of {provider, method, when}). You may keep provider/method or suggest changes with reason.';
  const user = `ProjectMeta: ${redact(meta)}\nCurrentDecision: ${redact(decision)}\nConstraints: prefer CLI for large static, prefer Vercel for Next server. Tokens may be missing.`;

  try {
    const content = await openAIChat([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ]);
    const json = JSON.parse(content.trim());
    const refined = { ...decision };
    if (json.provider) refined.provider = json.provider;
    if (json.method) refined.method = json.method;
    if (typeof json.confidence === 'number') refined.confidence = json.confidence;
    if (Array.isArray(json.addRationales)) refined.rationale.push(...json.addRationales);
    if (Array.isArray(json.addRisks)) refined.risks.push(...json.addRisks);
    if (Array.isArray(json.addAlternatives)) refined.alternatives.push(...json.addAlternatives);
    // Remove conflicting baseline rationales when provider/method changes
    if (refined.provider !== decision.provider || refined.method !== decision.method) {
      refined.rationale = (refined.rationale || []).filter((r) => r !== 'Unknown type – defaulting to Netlify CLI for static fallback.');
    }
    return refined;
  } catch (e) {
    return decision; // fall back silently
  }
}

async function decideDeployment(meta, opts = {}) {
  const projectPath = opts.projectPath || process.cwd();
  let decision = ruleBasedDecision(meta, opts);
  decision = await llmRefineDecision(decision, meta, { allowLLM: opts.allowLLM !== false });
  const plan = buildPlan(decision, meta, projectPath);
  return { decision, plan };
}

module.exports = { decideDeployment };
