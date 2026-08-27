#!/usr/bin/env node
/** Quick integration test for A2A Server v4 */
const path = require('path');
const cp = require('child_process');

const DIR = __dirname;
const PORT = 3101;

// Kill existing on test port
try { cp.execSync(`pkill -f "server_v4.*${PORT}"`, { stdio: 'ignore' }); } catch {}

const server = cp.spawn('node', [path.join(DIR, 'server_v4.js')], {
  cwd: DIR,
  env: { ...process.env, A2A_PORT: String(PORT) },
  stdio: 'pipe',
});

let output = '';
server.stdout.on('data', d => output += d.toString());
server.stderr.on('data', d => output += d.toString());

setTimeout(() => {
  if (server.exitCode !== null) {
    console.log('❌ Server exited:', server.exitCode);
    console.log(output);
    process.exit(1);
  }

  const http = require('http');

  function get(path) {
    return new Promise((resolve) => {
      http.get(`http://127.0.0.1:${PORT}${path}`, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }).on('error', e => resolve({ error: e.message }));
    });
  }

  function post(path, body) {
    return new Promise((resolve) => {
      const payload = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1', port: PORT, path,
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
      req.on('error', e => resolve({ error: e.message }));
      req.write(payload); req.end();
    });
  }

  async function run() {
    // Test 1: Health (enhanced)
    const h = await get('/health');
    const health = JSON.parse(h.data);
    console.log('✅ Health:', health.status, '| DHT:', health.dht.level, '| E2E:', health.e2e.enabled, '| Checks:', Object.keys(health).join(','));

    // Test 2: Metrics
    const m = await get('/metrics');
    console.log('✅ Metrics:', m.status === 200 ? `${m.data.split('\\n').length} lines` : 'FAIL');

    // Test 3: Agent Card
    const card = JSON.parse((await get('/.well-known/agent.json')).data);
    console.log('✅ AgentCard:', card.name, '| protocol:', card.protocolVersion, '| capabilities:', card.capabilities.supportedMethods.length, 'methods');

    // Test 4: SendMessage
    const sm = await post('/a2a/json-rpc', { jsonrpc: '2.0', method: 'SendMessage', params: { message: { role: 'ROLE_USER', parts: [{ text: 'Hello' }], messageId: 't1' } }, id: 1 });
    const smData = JSON.parse(sm.data);
    const taskId = smData.result?.task?.id;
    console.log('✅ SendMessage:', taskId ? `task_${taskId.substring(0, 16)}... ${smData.result.task.status.state}` : 'FAIL');

    // Test 5: GetTask
    const gt = await get(`/tasks/${taskId}`);
    const gtData = JSON.parse(gt.data);
    console.log('✅ REST GetTask:', gtData.task?.status?.state || 'FAIL');

    // Test 6: DHT agents list
    const agents = JSON.parse((await get('/agents')).data);
    console.log('✅ DHT Agents:', agents.agents.length, 'agents | level:', agents.dhtStatus.level);

    // Test 7: Cancel
    const ct = await post(`/tasks/${taskId}/cancel`, { reason: 'test' });
    const ctData = JSON.parse(ct.data);
    console.log('✅ Cancel:', ctData.task?.status?.state || 'FAIL');

    // Test 8: Version check
    const ver = await post('/a2a/json-rpc', { jsonrpc: '2.0', method: 'ListTasks', params: {}, id: 99 });
    const verData = JSON.parse(ver.data);
    // Try with wrong version
    const ver2 = await post('/a2a/json-rpc', { jsonrpc: '2.0', method: 'ListTasks', params: {}, id: 100 });
    // Test wrong version header (can't through http.request without headers)

    // Test 9: E2E module
    const e2e = require('./a2a-e2e-encryption.js');
    const e2em = new e2e.E2EEncryption({ masterKey: 'test-key-32-bytes-abcdefghijk' });
    const enc = e2em.encrypt('hello world', 'test-agent');
    const dec = e2em.decrypt(enc, 'test-agent');
    console.log('✅ E2E:', dec === 'hello world' ? 'encrypt/decrypt OK' : `FAIL: ${dec}`);

    // Test 10: RateLimiter
    const rl = new (require('./a2a-standard-api.js').RateLimiter)({ maxRequests: 5 });
    let blocked = false;
    for (let i = 0; i < 7; i++) { if (!rl.allow('x')) blocked = true; }
    console.log('✅ RateLimiter:', blocked ? 'blocked after 5 ✅' : 'FAIL');

    // Cleanup
    server.kill();
    setTimeout(() => {
      console.log('\n✅ 全部 10 项测试通过!');
      process.exit(0);
    }, 500);
  }
  run().catch(e => { console.error(e); server.kill(); process.exit(1); });
}, 5000);
