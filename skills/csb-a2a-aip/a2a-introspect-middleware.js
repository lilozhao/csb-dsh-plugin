/**
 * A2A Introspect 端点 - 可热加载到任何 A2A Server
 * 
 * 使用方式：
 *   const { attachIntrospect } = require('./a2a-introspect-middleware');
 *   attachIntrospect(app, { workspace: '/path/to/workspace' });
 */

const { A2AIntrospect } = require('./a2a-introspect.js');

function attachIntrospect(app, options = {}) {
  const introspect = new A2AIntrospect(options);
  
  app.get('/a2a/introspect', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(introspect.generate());
  });
  
  console.log('[A2A] ✅ introspect endpoint: /a2a/introspect');
  return introspect;
}

module.exports = { attachIntrospect, A2AIntrospect };
