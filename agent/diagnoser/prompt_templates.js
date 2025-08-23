// Prompt templates for diagnostic LLM calls

function buildDiagnosticPrompt(context) {
  const system = [
    'You are an expert CI/CD deployment diagnostician.',
    'Strictly output JSON only with keys: summary (string),',
    'rootCauses (array of strings), actions { patches:[], commands:[], configs:[] },',
    'confidence (0..1), notes (array). No prose outside JSON.'
  ].join(' ');

  const user = [
    'Context:',
    `Meta: ${JSON.stringify(context.meta)}`,
    `Hints: ${JSON.stringify(context.hints)}`,
    'LogTail (redacted):',
    '---BEGIN LOG---',
    context.redactedLog || '',
    '---END LOG---',
    'Produce actionable, minimal changes.'
  ].join('\n');

  return { system, user };
}

module.exports = { buildDiagnosticPrompt };
