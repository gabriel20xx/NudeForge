import assert from 'assert';
import http from 'http';
import { app } from '../src/app.js';

function request(appInst, method, path, data) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(appInst);
    server.listen(0, () => {
      const port = server.address().port;
      const payload = data ? Buffer.from(JSON.stringify(data)) : null;
      const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', 'Content-Length': payload ? payload.length : 0 } }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body }); });
      });
      req.on('error', err => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// Health
{
  const r = await request(app, 'GET', '/health');
  assert.equal(r.status, 200);
}

// Auth me (no session)
{
  const r = await request(app, 'GET', '/auth/me');
  assert.equal(r.status, 200);
}
