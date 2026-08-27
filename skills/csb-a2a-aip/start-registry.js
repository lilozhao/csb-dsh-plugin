// Registry starter - run with: node start-registry.js
const { fork } = require('child_process');
const path = require('path');

const child = fork(path.join(__dirname, 'registry.js'), [], {
  env: { ...process.env, REGISTRY_PORT: '3099', REGISTRY_HOST: '0.0.0.0' },
  stdio: 'inherit'
});

console.log(`Registry started (PID: ${child.pid})`);
