#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const analyzer = require('../analyzer');
const { decideDeployment } = require('../decision');
const vercel = require('../deployers/vercel');
const netlify = require('../deployers/netlify');

function loadDotEnv(projectPath) {
  const rootEnvPath = path.resolve(__dirname, '../../.env');
  const projEnvPath = path.join(projectPath, '.env');
  // Prefer dotenv if available; load root first, then project (do not override existing)
  try {
    const dotenv = require('dotenv');
    if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath, override: false });
    if (fs.existsSync(projEnvPath)) dotenv.config({ path: projEnvPath, override: false });
    return;
  } catch (e) {
    // Fallback manual parse for both files; root first then project
    const parseFile = (p) => {
      if (!fs.existsSync(p)) return;
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      for (const l of lines) {
        const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2];
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        if (process.env[m[1]] == null) process.env[m[1]] = val;
      }
    };
    try { parseFile(rootEnvPath); } catch (_) {}
    try { parseFile(projEnvPath); } catch (_) {}
  }
}

function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      const a = (answer || '').trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

function askInput(question, defaultValue = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      const val = (answer || '').trim();
      resolve(val || defaultValue);
    });
  });
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const noPrefix = a.replace(/^--/, '');
      if (noPrefix.includes('=')) {
        const [k, v] = noPrefix.split('=');
        args[k] = v;
      } else {
        const k = noPrefix;
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[k] = next;
          i++; // consume next as value
        } else {
          args[k] = true; // boolean flag
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function isJsonOnly(args) {
  return !!(args['json-only'] || args.jsonOnly);
}

function printJSONBlock(obj, title) {
  const tag = title ? `# ${title}\n` : '';
  console.log(tag + JSON.stringify(obj, null, 2));
}

function printError(e, args) {
  const message = (e && (e.message || e.toString())) || 'Unknown error';
  if (isJsonOnly(args)) {
    printJSONBlock({ type: 'Error', message }, '');
  } else {
    console.error('Error:', message);
  }
}

function ensureStatePaths() {
  const baseDir = path.resolve(__dirname, '../../');
  const stateDir = path.join(baseDir, 'state');
  const logsDir = path.join(stateDir, 'logs');
  const deploymentsFile = path.join(stateDir, 'deployments.json');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  if (!fs.existsSync(deploymentsFile)) fs.writeFileSync(deploymentsFile, '[]');
  return { stateDir, logsDir, deploymentsFile };
}

function sha256(obj) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(obj));
  return h.digest('hex');
}

async function cmdPlan(args) {
  // Determine project path with interactive confirmation when applicable
  const jsonOnly = isJsonOnly(args);
  const nonInteractive = !!(args['non-interactive'] || jsonOnly);
  let projectPathInput = args.path;
  if (!projectPathInput && !nonInteractive) {
    projectPathInput = await askInput('Project path', process.cwd());
  }
  const projectPath = path.resolve(projectPathInput || process.cwd());
  loadDotEnv(projectPath);
  const allowLLM = args['no-llm'] ? false : true;
  const meta = analyzer.getProjectMeta(projectPath);
  const { decision, plan } = await decideDeployment(meta, { projectPath, allowLLM, preferredProvider: args.provider, preferredMethod: args.method });
  const report = { projectPath, meta, decision, plan };
  const decisionOut = { type: 'Decision', ...decision };
  const planOut = { type: 'Plan', ...plan };
  if (isJsonOnly(args)) {
    printJSONBlock({ type: 'PlanResult', decision: decisionOut, plan: planOut }, '');
  } else {
    console.log('=== Plan Summary ===');
    console.log(`Provider: ${decision.provider} (${decision.method}), confidence ${decision.confidence}`);
    if (decision.rationale && decision.rationale.length) console.log('Rationale:\n- ' + decision.rationale.join('\n- '));
    console.log('--- JSON (PlanResult) ---');
    printJSONBlock({ type: 'PlanResult', decision: decisionOut, plan: planOut }, '');
  }
  return report;
}

async function cmdDeploy(args) {
  const t0 = Date.now();
  // Determine project path with interactive confirmation when applicable
  const jsonOnly = isJsonOnly(args);
  const isDryRun = args['dry-run'] || args.dryRun || false;
  const nonInteractive = !!(args['non-interactive'] || jsonOnly);
  let projectPathInput = args.path;
  if (!projectPathInput && !nonInteractive) {
    projectPathInput = await askInput('Project path', process.cwd());
  }
  const projectPath = path.resolve(projectPathInput || process.cwd());
  loadDotEnv(projectPath);
  const allowLLM = args['no-llm'] ? false : true;
  const meta = analyzer.getProjectMeta(projectPath);

  let preferredProvider = args.provider;
  let preferredMethod = args.method;

  // Compute initial decision/plan
  let { decision, plan } = await decideDeployment(meta, { projectPath, allowLLM, preferredProvider, preferredMethod });

  // Chat-lite adjustment (interactive, minimal)
  if (args['chat-lite'] && !jsonOnly && !nonInteractive && !args.yes) {
    console.log('=== Chat-lite Adjustments ===');
    console.log(`Current: provider=${decision.provider} (${decision.method})`);
    const newProvider = await askInput('Override provider? (vercel|netlify or blank to keep)', '');
    const newMethod = await askInput('Override method? (cli|api or blank to keep)', '');
    if (newProvider) preferredProvider = newProvider;
    if (newMethod) preferredMethod = newMethod;
    if (newProvider || newMethod) {
      ({ decision, plan } = await decideDeployment(meta, { projectPath, allowLLM, preferredProvider, preferredMethod }));
      console.log(`Updated: provider=${decision.provider} (${decision.method})`);
    }
  }

  // Preflight confirmation (interactive) unless explicitly skipped
  if (!isDryRun && !args.yes && !nonInteractive) {
    if (!jsonOnly) {
      console.log('=== Preflight ===');
      console.log(`Provider: ${decision.provider} (${decision.method})`);
      if (decision.rationale && decision.rationale.length) console.log('Rationale:\n- ' + decision.rationale.join('\n- '));
      if (plan && Array.isArray(plan.steps) && plan.steps.length) {
        console.log('Planned steps:');
        for (const s of plan.steps) {
          const run = s.run ? ` -> ${s.run}` : '';
          console.log(`- ${s.id}${run}`);
        }
      }
    }
    const proceed = await askYesNo('Proceed to deploy?');
    if (!proceed) {
      const out = { type: 'DeployAborted', reason: 'user_declined', decision, plan };
      if (!jsonOnly) console.log('Aborted by user.');
      printJSONBlock(out, '');
      return out;
    }
  }
  if (isDryRun) {
    const id = crypto.randomUUID();
    const record = {
      id,
      timestamp: Date.now(),
      projectPath,
      provider: decision.provider,
      method: decision.method,
      url: null,
      extra: { dryRun: true, plannedSteps: plan && plan.steps ? plan.steps : [] },
      status: 'dry-run',
      durationSec: 0,
      metaHash: sha256(meta),
      decisionHash: sha256(decision),
      logsPath: null
    };
    if (!jsonOnly) {
      console.log('=== Deploy (dry-run) ===');
      console.log(`Provider: ${decision.provider} (${decision.method}) | steps: ${(plan && plan.steps ? plan.steps.length : 0)}`);
      console.log('--- JSON (DeployRecord) ---');
    }
    printJSONBlock({ type: 'DeployRecord', ...record }, '');
    return record;
  }

  const { stateDir, logsDir, deploymentsFile } = ensureStatePaths();

  let deployer = null;
  if (decision.provider === 'vercel') deployer = vercel;
  else if (decision.provider === 'netlify') deployer = netlify;
  else throw new Error(`Unsupported provider: ${decision.provider}`);

  if (!jsonOnly) console.log(`Deploying via ${decision.provider} (${decision.method})...`);
  const res = await deployer.deploy({ ...meta, path: projectPath });
  const durationSec = Math.round((Date.now() - t0) / 1000);

  // Persist logs to file for later diagnosis
  const id = crypto.randomUUID();
  let logsPath = null;
  if (res && res.logs) {
    logsPath = path.join(logsDir, `${id}.log`);
    try { fs.writeFileSync(logsPath, typeof res.logs === 'string' ? res.logs : JSON.stringify(res.logs, null, 2)); } catch (e) {}
  }

  // Persist deployment record
  const record = {
    id,
    timestamp: Date.now(),
    projectPath,
    provider: decision.provider,
    method: decision.method,
    url: res ? res.url || null : null,
    extra: {},
    status: res && res.url ? 'success' : 'failed',
    durationSec,
    metaHash: sha256(meta),
    decisionHash: sha256(decision),
    logsPath
  };
  try {
    const arr = JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
    arr.push(record);
    fs.writeFileSync(deploymentsFile, JSON.stringify(arr, null, 2));
  } catch (e) {}

  if (!jsonOnly) {
    console.log('=== Deploy Result ===');
    console.log(`URL: ${record.url || 'N/A'} | status: ${record.status} | duration: ${durationSec}s`);
    console.log('--- JSON (DeployRecord) ---');
  }
  printJSONBlock({ type: 'DeployRecord', ...record }, '');
  return record;
}

async function cmdDiagnose(args) {
  const { deploymentsFile } = ensureStatePaths();
  const allowLLM = args['no-llm'] ? false : true; // default ON
  const diagnoser = require('../diagnoser');

  let logText = '';
  if (args.log) {
    logText = fs.readFileSync(path.resolve(args.log), 'utf8');
  } else if (args.id) {
    const arr = JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
    const rec = arr.find((r) => r.id === args.id);
    if (!rec || !rec.logsPath || !fs.existsSync(rec.logsPath)) throw new Error('No logs found for given id');
    logText = fs.readFileSync(rec.logsPath, 'utf8');
  } else {
    throw new Error('Provide --log <path> or --id <recordId>');
  }

  // Determine project path with interactive confirmation when applicable
  const jsonOnly = isJsonOnly(args);
  const nonInteractive = !!(args['non-interactive'] || jsonOnly);
  let projectPathInput = args.path;
  if (!projectPathInput && !nonInteractive) {
    projectPathInput = await askInput('Project path', process.cwd());
  }
  const projectPath = path.resolve(projectPathInput || process.cwd());
  loadDotEnv(projectPath);
  const meta = analyzer.getProjectMeta(projectPath);
  const result = await diagnoser.diagnose(logText, meta, { allowLLM });
  if (!isJsonOnly(args)) console.log('=== Diagnose Result ===');
  printJSONBlock(result, '');
  return result;
}

async function cmdUndeploy(args) {
  // Safe MVP: print suggested commands rather than destructive actions
  const { deploymentsFile } = ensureStatePaths();
  if (!args.id) throw new Error('Provide --id <recordId>');
  const arr = JSON.parse(fs.readFileSync(deploymentsFile, 'utf8'));
  const rec = arr.find((r) => r.id === args.id);
  if (!rec) throw new Error('Record not found');

  const suggestions = [];
  if (rec.provider === 'netlify') {
    suggestions.push('npx netlify sites:list');
    suggestions.push('npx netlify sites:delete --site <SITE_ID> --force');
  } else if (rec.provider === 'vercel') {
    suggestions.push('npx vercel ls');
    suggestions.push('npx vercel remove <PROJECT_NAME> --safe');
  }
  if (!isJsonOnly(args)) console.log('=== Undeploy Suggestions (Safe) ===');
  const out = { type: 'UndeploySuggestions', id: rec.id, provider: rec.provider, suggestions };
  printJSONBlock(out, '');
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const cmd = (args._[0] || 'plan').toLowerCase();
  try {
    if (cmd === 'plan') await cmdPlan(args);
    else if (cmd === 'deploy') await cmdDeploy(args);
    else if (cmd === 'diagnose') await cmdDiagnose(args);
    else if (cmd === 'undeploy') await cmdUndeploy(args);
    else {
      if (isJsonOnly(args)) {
        printJSONBlock({ type: 'Error', message: `Unknown command: ${cmd}` }, '');
        process.exitCode = 2;
      } else {
        console.log('Usage: fast-deploy <plan|deploy|diagnose|undeploy> [--path .] [--provider] [--method] [--no-llm] [--dry-run] [--chat-lite] [--json-only] [--non-interactive] [--yes]');
      }
    }
  } catch (e) {
    printError(e, args);
    process.exitCode = 1;
  }
}

if (require.main === module) main();


