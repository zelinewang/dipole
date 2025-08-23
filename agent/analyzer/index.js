const fs = require('fs');
const path = require('path');

function readJSONIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function detectProjectType(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  const reqPath = path.join(projectPath, 'requirements.txt');
  const indexHtml = path.join(projectPath, 'index.html');

  const pkg = readJSONIfExists(pkgPath);
  if (pkg) {
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    const depKeys = Object.keys(deps).map((d) => d.toLowerCase());

    if (depKeys.includes('next')) return 'next';
    // check Vite before generic React to avoid mis-detection when both exist
    if (depKeys.includes('vite')) return 'vite-react';
    if (depKeys.includes('react-scripts') || depKeys.includes('react')) {
      // differentiate static/react app vs express server by presence of "start" script
      return 'cra';
    }
    if (depKeys.includes('express')) return 'express';
  }

  if (fs.existsSync(reqPath)) {
    const txt = fs.readFileSync(reqPath, 'utf8').toLowerCase();
    if (txt.indexOf('flask') !== -1) return 'flask';
  }

  if (fs.existsSync(indexHtml)) return 'static';

  return 'unknown';
}

function inferBuildInfo(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  const info = {
    buildCommand: null,
    startCommand: null,
    buildOutputDir: null
  };

  const pkg = readJSONIfExists(pkgPath);
  if (!pkg) return info;

  const scripts = pkg.scripts || {};
  if (scripts.build) info.buildCommand = scripts.build;
  if (scripts.start) info.startCommand = scripts.start;

  // Heuristic for output dir based on dependencies and scripts
  const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  const depKeys = Object.keys(deps).map((d) => d.toLowerCase());

  if (depKeys.includes('vite')) info.buildOutputDir = 'dist';
  else if (depKeys.includes('next')) {
    // If next export script present, use 'out', otherwise .next (server)
    if (scripts.export || (scripts['export'] === 'next export')) info.buildOutputDir = 'out';
    else info.buildOutputDir = '.next';
  } else if (depKeys.includes('react-scripts') || depKeys.includes('react')) info.buildOutputDir = 'build';

  // If build script mentions output directory like "vite build --outDir=...", attempt to parse
  if (info.buildCommand && info.buildCommand.indexOf('--outDir=') !== -1) {
    const m = info.buildCommand.match(/--outDir=([^\s]+)/);
    if (m) info.buildOutputDir = m[1];
  }

  return info;
}

function getProjectMeta(projectPath) {
  const type = detectProjectType(projectPath);
  const buildInfo = inferBuildInfo(projectPath);
  // Additional heuristics
  const meta = Object.assign({ type }, buildInfo);
  const dockerfile = require('path').join(projectPath, 'Dockerfile');
  const procfile = require('path').join(projectPath, 'Procfile');
  meta.hasDockerfile = require('fs').existsSync(dockerfile);
  meta.hasProcfile = require('fs').existsSync(procfile);
  meta.usesEnvFile = require('fs').existsSync(require('path').join(projectPath, '.env'));

  // Project size estimation (bytes)
  function walkSize(dir) {
    const fs = require('fs');
    const path = require('path');
    let total = 0;
    if (!fs.existsSync(dir)) return 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) total += walkSize(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch (e) {}
      }
    }
    return total;
  }

  const projectBytes = walkSize(projectPath);
  meta.projectSizeBytes = projectBytes;
  // crude build time estimate (seconds): 1s per 100KB, clamped
  meta.estimatedBuildTimeSec = Math.max(5, Math.min(600, Math.round(projectBytes / 100000)));

  return meta;
}

module.exports = { detectProjectType, inferBuildInfo, getProjectMeta };


