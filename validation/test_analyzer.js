const path = require('path');
const analyzer = require('../agent/analyzer');

const fixtures = [
  { dir: 'validation/fixtures/react-cra', type: 'cra', buildDir: 'build', buildCmd: 'react-scripts build' },
  { dir: 'validation/fixtures/vite-react', type: 'vite-react', buildDir: 'dist', buildCmd: 'vite build' },
  { dir: 'validation/fixtures/next-minimal', type: 'next', buildDir: '.next', buildCmd: 'next build' }
];

let failed = 0;
for (const f of fixtures) {
  const p = path.resolve(f.dir);
  const meta = analyzer.getProjectMeta(p);
  if (meta.type !== f.type) {
    console.error(`FAIL type: ${f.dir} -> expected ${f.type}, got ${meta.type}`);
    failed++;
  } else if (!meta.buildCommand || !meta.buildCommand.includes(f.buildCmd.split(' ')[0])) {
    console.error(`FAIL buildCmd: ${f.dir} -> expected build command containing ${f.buildCmd}, got ${meta.buildCommand}`);
    failed++;
  } else if (!meta.buildOutputDir || meta.buildOutputDir !== f.buildDir) {
    console.error(`FAIL buildDir: ${f.dir} -> expected ${f.buildDir}, got ${meta.buildOutputDir}`);
    failed++;
  } else {
    console.log(`OK: ${f.dir} -> type=${meta.type}, build=${meta.buildCommand}, out=${meta.buildOutputDir}`);
    // additional checks
    if (f.type === 'next') {
      if (!meta.hasDockerfile) {
        console.error(`FAIL dockerfile: expected Dockerfile for ${f.dir}`);
        failed++;
        continue;
      }
    }
    if (!meta.projectSizeBytes || typeof meta.estimatedBuildTimeSec !== 'number') {
      console.error(`FAIL size/estimate: ${f.dir} -> got size=${meta.projectSizeBytes}, estimate=${meta.estimatedBuildTimeSec}`);
      failed++;
      continue;
    }
  }
}

if (failed > 0) {
  console.error(`${failed} analyzer test(s) failed`);
  process.exit(1);
} else {
  console.log('All analyzer tests passed.');
}


