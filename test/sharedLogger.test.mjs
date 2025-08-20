import assert from 'assert';
import http from 'http';
import { startServer } from '../src/app.js';

function withTimeout(promise, ms, label){
  return Promise.race([
    promise,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Timeout: ${label}`)), ms))
  ]);
}

function get(path, base){
  return new Promise((resolve,reject)=>{
    http.get(base+path, res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{ res.body = Buffer.concat(chunks).toString('utf8'); resolve(res); });
    }).on('error',reject);
  });
}


function postMultipart(pathUrl, base, fields, fileField){
  return new Promise((resolve,reject)=>{
    const boundary = '----TESTBOUNDARY' + Math.random().toString(16).slice(2);
    const newline='\r\n';
    let body='';
    for(const [k,v] of Object.entries(fields||{})){
      body += `--${boundary}${newline}` +
              `Content-Disposition: form-data; name="${k}"${newline}${newline}${v}${newline}`;
    }
    if(fileField){
      body += `--${boundary}${newline}` +
              `Content-Disposition: form-data; name="image"; filename="${fileField.filename}"${newline}` +
              `Content-Type: ${fileField.contentType || 'image/png'}${newline}${newline}`;
      body += fileField.content + newline;
    }
    body += `--${boundary}--${newline}`;
    const opts = new URL(base+pathUrl);
    const req = http.request({hostname:opts.hostname, port:opts.port, path:opts.pathname, method:'POST', headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':Buffer.byteLength(body)}}, res=>{
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>{ res.body=Buffer.concat(chunks).toString('utf8'); resolve(res); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
(async () => {
  const server = await startServer(0);
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;

  // 1. Shared client logger asset
  {
    const res = await get('/shared/clientLogger.js', base);
    assert.strictEqual(res.statusCode, 200, 'clientLogger.js 200');
    assert.ok(/ClientLogger/.test(res.body), 'client logger content snippet');
  }

  // 2. Health endpoint
  {

  // 9. Upload-copy (simple)
  {
    const res = await withTimeout(postMultipart('/upload-copy', base, {}, { filename:'test.png', content:'fakePNG', contentType:'image/png' }), 5000, 'upload-copy');
    assert.strictEqual(res.statusCode, 200, 'upload-copy 200');
  }

  // 10. Upload (queue) - should return 202 with requestId
  let uploadedRequestId;
  {
    const res = await withTimeout(postMultipart('/upload', base, { captcha_answer:'dummy', captcha_token:'dummy', prompt:'hello', steps:'5' }, { filename:'in.png', content:'filedata', contentType:'image/png' }), 5000, 'upload');
    assert.strictEqual(res.statusCode, 202, 'upload 202');
    const json = JSON.parse(res.body);
    assert.ok(json.requestId, 'requestId present');
    uploadedRequestId = json.requestId;
  }

  // 11. Queue-status for uploaded id (should be pending or unknown since processing skipped)
  {
    if(uploadedRequestId){
      const res = await withTimeout(get('/queue-status?requestId='+uploadedRequestId, base), 3000, 'queue-status-uploaded');
      assert.strictEqual(res.statusCode, 200, 'queue-status uploaded 200');
      const js = JSON.parse(res.body); assert.ok(['pending','processing','unknown','failed'].includes(js.status), 'queue status acceptable');
    }
  }
    const res = await get('/health', base);
    assert.strictEqual(res.statusCode, 200, 'health 200');
    const json = JSON.parse(res.body); assert.ok(json.status==='ok', 'health status ok');
  }

  // 3. Carousel images api (should return JSON array, possibly empty)
  {
    const res = await withTimeout(get('/api/carousel-images', base), 3000, 'carousel-images');
    assert.strictEqual(res.statusCode, 200, 'carousel images 200');
    const arr = JSON.parse(res.body); assert.ok(Array.isArray(arr), 'carousel images array');
  }

  // 4. CAPTCHA status
  {
    const res = await withTimeout(get('/api/captcha-status', base), 3000, 'captcha-status');
    assert.strictEqual(res.statusCode, 200, 'captcha-status 200');
    const json = JSON.parse(res.body); assert.ok('captchaDisabled' in json, 'captchaDisabled key');
  }

  // 5. LoRAs simple list (allow 200 or 500 depending on env)
  {
    const res = await withTimeout(get('/api/loras', base), 3000, 'loras');
    // Accept either 200 or 500 depending on env; ensure no hang
    assert.ok([200,500].includes(res.statusCode), 'loras status acceptable');
  }

  // 6. Queue status without requestId
  {
    const res = await withTimeout(get('/queue-status', base), 3000, 'queue-status');
    assert.strictEqual(res.statusCode, 200, 'queue-status 200');
    const json = JSON.parse(res.body); assert.ok('queueSize' in json, 'queueSize present');
  }

  // 7. 404 handler check
  {
    const res = await withTimeout(get('/this-route-should-not-exist-xyz', base), 3000, '404');
    assert.strictEqual(res.statusCode, 404, '404 status');
  }

  console.log('Forge endpoint tests passed');

  // 8. Attempt download with fake id (should 404 or 500, but not hang)
  {
    const res = await withTimeout(get('/download/fake-id-123', base), 3000, 'download-fake');
    assert.ok([404,500].includes(res.statusCode), 'download fake acceptable');
  }
  console.log('Forge extended tests completed');
  server.close();
})();
