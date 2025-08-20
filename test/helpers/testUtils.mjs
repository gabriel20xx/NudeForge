import assert from 'assert';

export function withTimeout(promise, ms, label='operation'){ 
  let to; 
  const timeout = new Promise((_,rej)=>{ to=setTimeout(()=>rej(new Error(label+' timed out after '+ms+'ms')), ms); });
  return Promise.race([promise.finally(()=>clearTimeout(to)), timeout]);
}

export function assertJSON(res, field){
  assert.strictEqual(res.statusCode, 200, 'expected 200');
  const data = JSON.parse(res.body);
  if(field) assert.ok(field in data, 'missing field '+field);
  return data;
}
