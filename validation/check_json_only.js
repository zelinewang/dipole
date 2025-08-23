#!/usr/bin/env node
/*
  JSON-only stability checker
  - Runs CLI commands with --json-only and --no-llm
  - Asserts outputs are valid JSON with expected shapes
  - Exits non-zero if any check fails
*/

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runNodeCli(args, opts = {}) {
  const cliPath = path.resolve(__dirname, '../agent/cli/index.js');
  const res = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: process.env,
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

function testPlan() {
  const res = runNodeCli(['plan', '--json-only', '--no-llm']);
  if (res.status !== 0) {
    throw new Error(`plan exited with code ${res.status}: ${res.stderr}`);
  }
  const json = parseJSONOrThrow(res.stdout);
  assert(json && json.type === 'PlanResult', 'PlanResult.type mismatch');
  assert(json.decision && json.plan, 'PlanResult missing decision/plan');
}

function testDeployDryRun() {
  const res = runNodeCli(['deploy', '--dry-run', '--json-only', '--no-llm']);
  if (res.status !== 0) {
    throw new Error(`deploy --dry-run exited with code ${res.status}: ${res.stderr}`);
  }
  const json = parseJSONOrThrow(res.stdout);
  assert(json && json.type === 'DeployRecord', 'DeployRecord.type mismatch');
  assert(json.status === 'dry-run', 'DeployRecord.status should be "dry-run"');
}

function testDiagnose() {
  // Create a temporary log file with a common error pattern
  const tmpLog = path.join(__dirname, 'tmp_diagnose.log');
  fs.writeFileSync(tmpLog, 'ERR_MODULE_NOT_FOUND: cannot find module "foo"');
  try {
    const res = runNodeCli(['diagnose', '--log', tmpLog, '--json-only', '--no-llm']);
    if (res.status !== 0) {
      throw new Error(`diagnose exited with code ${res.status}: ${res.stderr}`);
    }
    const json = parseJSONOrThrow(res.stdout);
    assert(json && json.type === 'DiagnoseResult', 'DiagnoseResult.type mismatch');
  } finally {
    try { fs.unlinkSync(tmpLog); } catch (_) {}
  }
}

function testUnknownCommand() {
  const res = runNodeCli(['unknown-subcmd', '--json-only']);
  // Unknown command should not crash; expect exit code 2 (as set in CLI) or non-zero
  if (res.status === 0) {
    throw new Error('unknown-subcmd should exit non-zero');
  }
  const json = parseJSONOrThrow(res.stdout);
  assert(json && json.type === 'Error', 'Unknown command should output {type:"Error"}');
}

function main() {
  const cases = [
    ['plan --json-only', testPlan],
    ['deploy --dry-run --json-only', testDeployDryRun],
    ['diagnose --json-only', testDiagnose],
    ['unknown cmd --json-only', testUnknownCommand],
  ];
  for (const [name, fn] of cases) {
    process.stdout.write(`Running ${name} ... `);
    fn();
    console.log('OK');
  }
  console.log('All JSON-only checks passed.');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error('CHECK FAILED:', e.message || e);
    process.exit(1);
  }
}
