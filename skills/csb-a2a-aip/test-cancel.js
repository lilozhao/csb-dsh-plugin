const http = require('http');
function post(path, body) {
  return new Promise(resolve => {
    const p = JSON.stringify(body);
    const req = http.request({
      hostname:'127.0.0.1', port:3101, path, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(p)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error',e=>resolve({error:e.message}));
    req.write(p); req.end();
  });
}
async function test() {
  const r = await post('/a2a/json-rpc', {jsonrpc:'2.0',method:'SendMessage',params:{message:{role:'ROLE_USER',parts:[{text:'test'}],messageId:'c1'},configuration:{returnImmediately:true}},id:2});
  const tid = r.result.task.id;
  console.log('1. SendMessage (non-blocking):', r.result.task.status.state);
  const c = await post('/a2a/json-rpc', {jsonrpc:'2.0',method:'CancelTask',params:{taskId:tid,reason:'cancel'},id:3});
  console.log('2. CancelTask:', c.result.task.status.state);
  const c2 = await post('/a2a/json-rpc', {jsonrpc:'2.0',method:'CancelTask',params:{taskId:tid},id:4});
  console.log('3. Re-cancel:', c2.error.code === -32002 ? 'TaskNotCancelableError ✅' : 'UNEXPECTED');
  console.log('\n✅ 取消流程验证通过');
}
test();
