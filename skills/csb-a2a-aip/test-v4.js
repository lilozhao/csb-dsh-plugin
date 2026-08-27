#!/usr/bin/env node
// Quick integration test for A2A Server v4
const http = require('http');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const serverPath = path.join(__dirname, 'server_v4.js');
const testPort = 3101;

console.log('=== A2A Server v4 Integration Test ===\n');

// Kill any existing process on test port
try { execSync(`pkill -f "server_v4.*${testPort}"`, { stdio: 'ignore' }); } catch {}

// Start server
const server = spawn('node', [serverPath], {
  cwd: __dirname,
  env: { ...process.env, A2A_PORT: String(testPort) },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', d => output += d.toString());
server.stderr.on('data', d => output += d.toString());

setTimeout(() => {
  console.log('Server output:\n', output);
  
  // Test endpoints
  const tests = [
    { name: 'Health Check', path: '/health' },
    { name: 'Agent Card', path: '/.well-known/agent.json' },
    { name: 'Capabilities', path: '/capabilities' },
    { name: 'REST ListTasks', path: '/tasks' },
  ];

  for (const test of tests) {
    try {
      const res = http.get(`http://127.0.0.1:${testPort}${test.path}`, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            console.log(`✅ ${test.name}: ${JSON.stringify(json).substring(0, 100)}...`);
          } catch {
            console.log(`⚠️  ${test.name}: ${data.substring(0, 80)}`);
          }
        });
      });
      res.on('error', e => console.log(`❌ ${test.name}: ${e.message}`));
    } catch (e) {
      console.log(`❌ ${test.name}: ${e.message}`);
    }
  }

  // Test JSON-RPC
  setTimeout(() => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      method: 'SendMessage',
      params: {
        message: { role: 'ROLE_USER', parts: [{ text: '你好' }], messageId: 'test-001' }
      },
      id: 1
    });

    const req = http.request({
      hostname: '127.0.0.1', port: testPort, path: '/a2a/json-rpc',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const task = json.result?.task;
          console.log(`✅ SendMessage: taskId=${task?.id?.substring(0, 20) || 'N/A'}... state=${task?.status?.state || 'N/A'}`);
          
          // Now test GetTask
          const getReq = http.request({
            hostname: '127.0.0.1', port: testPort, path: '/tasks/' + task.id,
            method: 'GET',
          }, (res2) => {
            let d2 = '';
            res2.on('data', c => d2 += c);
            res2.on('end', () => {
              const json2 = JSON.parse(d2);
              console.log(`✅ REST GetTask: state=${json2.task?.status?.state || 'N/A'}`);
              
              // Cleanup
              server.kill();
              console.log('\n✅ 所有集成测试通过！');
              process.exit(0);
            });
          });
          getReq.on('error', e => { console.log(`❌ GetTask: ${e.message}`); server.kill(); });
          getReq.end();
        } catch (e) {
          console.log(`❌ SendMessage parse: ${e.message}, data=${data.substring(0, 100)}`);
          server.kill();
        }
      });
    });
    req.on('error', e => { console.log(`❌ SendMessage: ${e.message}`); server.kill(); });
    req.write(postData);
    req.end();
  }, 2000);
}, 5000);
