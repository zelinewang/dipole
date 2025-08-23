const path = require('path');
const analyzer = require('../agent/analyzer');

const fixtures = [
  { dir: 'validation/fixtures/react-cra', expect: 'cra' },
  { dir: 'validation/fixtures/vite-react', expect: 'vite-react' },
  { dir: 'validation/fixtures/next-minimal', expect: 'next' },
  { dir: 'validation/fixtures/static-site', expect: 'static' },
  { dir: 'validation/fixtures/flask-minimal', expect: 'flask' }
];

let failed = 0;
for (const f of fixtures) {
  const p = path.resolve(f.dir);
  const detected = analyzer.detectProjectType(p);
  if (detected !== f.expect) {
    console.error(`FAIL: fixture ${f.dir} -> expected ${f.expect}, got ${detected}`);
    failed++;
  } else {
    console.log(`OK: ${f.dir} -> ${detected}`);
  }
}

if (failed > 0) {
  console.error(`${failed} fixture(s) failed`);
  process.exit(1);
} else {
  console.log('All validation fixtures detected correctly.');
}


