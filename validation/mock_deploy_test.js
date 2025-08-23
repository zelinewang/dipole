#!/usr/bin/env node
/*
  Adapter mock tests for deploy command
  - Uses FAST_DEPLOY_MOCK env to simulate deploy outcomes without external calls
  - Covers providers: vercel, netlify
  - Scenarios: success, fail, rate_limit
  - Runs CLI with --json-only and asserts DeployRecord shape
*/

const { spawnSync } = require('child_process');
const path = require('path');

function runCli(args, envExtra = {}) {
  const cliPath = path.resolve(__dirname, '../agent/cli/index.js');
  const cwd = path.resolve(__dirname, '..');
  const res = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
  });
  return res;
}

function parseJSONOrThrow(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch (e) {
    throw new Error('Output is not valid JSON');
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testCase(provider, mode) {
  const args = ['deploy', '--json-only', '--no-llm', '--provider', provider, '--path', '.'];
  const res = runCli(args, { FAST_DEPLOY_MOCK: mode });
  if (res.status !== 0) {
    throw new Error(`deploy(${provider}, ${mode}) exited ${res.status}: ${res.stderr}`);
  }
  const json = parseJSONOrThrow(res.stdout);
  assert(json && json.type === 'DeployRecord', 'DeployRecord.type mismatch');
  if (mode === 'success') {
    assert(json.status === 'success', 'Expected status success');
    assert(typeof json.url === 'string' && json.url.length > 0, 'Expected non-empty URL');
  } else {
    assert(json.status === 'failed', 'Expected status failed');
    assert(json.url === null, 'Expected null URL on failure');
  }
}

function main() {
  const providers = ['vercel', 'netlify'];
  const modes = ['success', 'fail', 'rate_limit'];
  for (const p of providers) {
    for (const m of modes) {
      process.stdout.write(`Mock deploy ${p} -> ${m} ... `);
      testCase(p, m);
      console.log('OK');
    }
  }
  console.log('All mock deploy tests passed.');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('MOCK TEST FAILED:', e.message || e);
    process.exit(1);
  }
}
