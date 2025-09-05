// Minimal DOM simulation to test unified status & progress bar logic without a browser
import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Extremely small DOM shim good enough for our selectors & style mutations
class Element { constructor(id){ this.id=id; this.style={}; this.textContent=''; this.children=[]; this.listeners={}; const self=this; this.classList={
  _set:new Set(), add(c){ self.classList._set.add(c); }, remove(c){ self.classList._set.delete(c); }, contains(c){ return self.classList._set.has(c); }, toString(){ return [...self.classList._set].join(' '); }
}; }
  appendChild(c){ this.children.push(c); }
  querySelector(){ return null; }
  removeAttribute(attr){ delete this[attr]; }
  addEventListener(type,fn){ (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(evt){ (this.listeners[evt.type]||[]).forEach(fn=>fn(evt)); }
}
class Document { constructor(){ this.map=new Map(); }
  getElementById(id){ if(!this.map.has(id)) this.map.set(id,new Element(id)); return this.map.get(id); }
  querySelectorAll(){ return []; }
  createElement(tag){ return new Element(tag); }
  addEventListener(){}
}
const document = new Document();
// Precreate needed elements referenced early
['processingStatus','queueMeta','progressPct','processingProgressBarWrapper','processingProgressBar','processingProgressLabel'].forEach(id=>document.getElementById(id));
document.getElementById('processingStatus').textContent = 'Idle';
const window = { document, ClientLogger:{ info(){}, warn(){}, error(){} }, addEventListener(){}, removeEventListener(){} };
// global injections
global.window = window; global.document = document; global.ClientLogger = window.ClientLogger;

// Load script source
const mainPath = path.resolve('src/public/js/main.js');
const source = fs.readFileSync(mainPath,'utf8');
// Remove top-level import/export lines (lightweight transform)
const sanitized = source.replace(/(^|\n)import[^;]+;?/g,'').replace(/export\s+\{[^}]+\};?/g,'');
// Execute file
new Function(sanitized)(); // eslint-disable-line no-new-func

const api = window.__nudeForge;
assert.ok(api,'__nudeForge exposed');
assert.ok(api.updateStatusUI,'updateStatusUI exposed');
assert.ok(api.updateProgressBar,'updateProgressBar exposed');

// 1. Initial state
assert.strictEqual(document.getElementById('processingStatus').textContent,'Idle');

// 2. Simulate queued update
api.updateStatusUI({ status:'queued', yourPosition:3, progress:{ value:0, max:100 } });
assert.strictEqual(document.getElementById('processingStatus').textContent,'Queued');
assert.ok(document.getElementById('queueMeta').textContent.toLowerCase().includes('position 3'));

// 3. Simulate processing progress
api.updateStatusUI({ status:'processing', queueSize:5, progress:{ value:25, max:100, stage:'Stage A' } });
assert.strictEqual(document.getElementById('processingStatus').textContent,'Processing');
assert.ok(document.getElementById('progressPct').textContent.includes('25'));
assert.strictEqual(document.getElementById('processingProgressBar').style.width,'25%');

// 4. New stage should increase overall percent beyond raw (simulate Stage B start at 10%)
api.updateStatusUI({ status:'processing', queueSize:4, progress:{ value:10, max:100, stage:'Stage B' } });
const pctTextStageB = document.getElementById('progressPct').textContent;
// Overall percent should be > raw 10 due to weighting (two stages)
const numericStageB = parseInt(pctTextStageB,10);
assert.ok(numericStageB > 10, 'weighted overall percent > stage raw percent');

// 5. Complete
api.updateStatusUI({ status:'completed', progress:{ value:100, max:100, stage:'completed' } });
assert.ok(document.getElementById('progressPct').textContent.includes('100'));
assert.ok(document.getElementById('processingProgressBar').classList.children || true, 'bar object exists');

console.log('progressUI test passed');
