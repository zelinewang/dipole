// Context packer for diagnostic LLM calls
// All code and comments are in English per project rules.
const crypto = require('crypto');

function redactText(s) {
  if (!s) return '';
  return s
    .replace(/sk-[A-Za-z0-9-_]+/g, 'sk-***')
    .replace(/(VERCEL|NETLIFY|TOKEN|AUTH|KEY|SECRET)[^\n=:\"]*[:=\"]+[^\n\"]+/gi, '$1=***')
    .replace(/[A-Za-z0-9]{8,}:[A-Za-z0-9\-_]{16,}/g, '***');
}

function summarizeLogTail(text, maxBytes = 16000) {
  if (!text) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  // Keep tail portion where most errors are usually found
  const tail = buf.subarray(buf.length - maxBytes);
  return tail.toString('utf8');
}

function pickMeta(meta) {
  const keys = [
    'type', 'buildCommand', 'startCommand', 'buildOutputDir',
    'hasDockerfile', 'hasProcfile', 'usesEnvFile', 'projectSizeBytes', 'estimatedBuildTimeSec'
  ];
  const out = {};
  for (const k of keys) if (meta && meta[k] !== undefined) out[k] = meta[k];
  return out;
}

function hash(obj) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(obj || {}));
  return h.digest('hex');
}

function packContext(logText, meta) {
  const tail = summarizeLogTail(String(logText || ''));
  const redactedLog = redactText(tail);
  const metaSubset = pickMeta(meta || {});
  const hints = [];

  if (/command not found|npx: command not found/i.test(tail)) hints.push('Tooling missing (npx/cli)');
  if (/no such file or directory/i.test(tail)) hints.push('Path issue or wrong output directory');
  if (/permission denied/i.test(tail)) hints.push('Permission issue');
  if (/env|environment|dotenv|process\.env/i.test(tail)) hints.push('Missing environment variables');
  if (/build failed|error/i.test(tail)) hints.push('Build error');

  const ctx = {
    type: 'ContextPack',
    meta: metaSubset,
    redactedLog,
    logHash: hash(redactedLog),
    metaHash: hash(metaSubset),
    hints
  };
  return ctx;
}

module.exports = { packContext };
