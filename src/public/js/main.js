// NudeForge main.js (migrated from legacy /public/js/main.js). Full functionality retained.
// NOTE: This file replaces the previous bridge import and is now the canonical frontend script.
/* eslint-disable no-func-assign */
// --- BEGIN ORIGINAL CONTENT ---
// main.js: Handles upload button state for UX
// --- Download Button Helpers ---
function _disableDownload() { // renamed to avoid unused warning; keep implementation
	if (downloadLink) {
		downloadLink.classList.add('disabled');
		const btn = downloadLink.querySelector('button');
		if (btn) btn.disabled = true;
		downloadLink.removeAttribute('href');
	}
}

function enableDownload(url) {
	if (downloadLink) {
		downloadLink.classList.remove('disabled');
		const btn = downloadLink.querySelector('button');
		if (btn) btn.disabled = false;
    if (url) downloadLink.setAttribute('href', url);
    try {
      const imgs = Array.from(document.querySelectorAll('#outputGrid .output-item img'));
      if (btn) btn.textContent = (imgs.length > 1) ? 'Download All' : 'Download';
      downloadLink.setAttribute('download','');
      downloadLink.removeAttribute('title');
    } catch {}
	}
}
window.addEventListener('DOMContentLoaded', async function() {
  // CAPTCHA removed; proceed with other inits
  const comparisonPlaceholder = document.getElementById('comparisonPlaceholder');
  const comparisonContainer = document.getElementById('comparisonContainer');
  // Always show progress wrapper on load
  const progressWrap = document.getElementById('processingProgressBarWrapper');
  if(progressWrap) progressWrap.hidden = false;
  // Initialize idle state
  try {
    const bar = document.getElementById('processingProgressBar');
    const label = document.getElementById('processingProgressLabel');
    if(bar) bar.style.width = '0%';
    if(label) label.textContent = 'Idle';
    progressWrap?.classList.add('idle');
  } catch {}
  showElement(comparisonPlaceholder);
  hideElement(comparisonContainer);
  await initializeLoRAs();
  initializeCarousel();
  const headerOptions = document.querySelector('.header-options');
  if(headerOptions) headerOptions.style.display='block';
  restoreGeneratorState();
  // Output image overlay (shared design with Library)
  try{
    const grid = document.getElementById('outputGrid');
    const overlay = document.getElementById('outputOverlay');
    const frame = document.getElementById('outputFrame');
    const btnPrev = document.getElementById('outPrev');
    const btnNext = document.getElementById('outNext');
    const btnClose = document.getElementById('outClose');
    let currentIndex = -1;
    function outputItems(){ return Array.from(document.querySelectorAll('#outputGrid .output-item img')); }
    function openOutputOverlay(idx){
      const items = outputItems(); if(items.length===0) return;
      currentIndex = Math.max(0, Math.min(idx, items.length-1));
      renderOutputOverlay();
    }
    function renderOutputOverlay(){
      const items = outputItems();
      const it = items[currentIndex]; if(!it){ closeOutputOverlay(); return; }
      // Clear previous media nodes
      Array.from(frame.querySelectorAll('img,video')).forEach(n=>n.remove());
      const node = document.createElement('img');
      node.src = (it.getAttribute('src')||'').split('?')[0];
      node.alt = 'Output image';
      frame.appendChild(node);
      overlay.classList.add('open');
      try { document.body.classList.add('no-scroll'); document.documentElement.classList.add('no-scroll'); } catch {}
      btnPrev && (btnPrev.disabled = currentIndex<=0);
      btnNext && (btnNext.disabled = currentIndex>=items.length-1);
    }
    function prevOutput(){ if(currentIndex>0){ currentIndex--; renderOutputOverlay(); } }
    function nextOutput(){ const items = outputItems(); if(currentIndex<items.length-1){ currentIndex++; renderOutputOverlay(); } }
    function closeOutputOverlay(){ overlay.classList.remove('open'); try { document.body.classList.remove('no-scroll'); document.documentElement.classList.remove('no-scroll'); } catch {} currentIndex=-1; }
    if(grid && overlay && frame){
      grid.addEventListener('click', (e)=>{
        const target = e.target && e.target.closest('.output-item img');
        if(!target) return;
        e.preventDefault();
        const items = outputItems();
        const idx = items.indexOf(target);
        openOutputOverlay(idx>=0? idx : 0);
      });
    }
    btnPrev && btnPrev.addEventListener('click', prevOutput);
    btnNext && btnNext.addEventListener('click', nextOutput);
    btnClose && btnClose.addEventListener('click', closeOutputOverlay);
    overlay && overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closeOutputOverlay(); });
    window.addEventListener('keydown', (e)=>{
      if(!overlay || !overlay.classList.contains('open')) return;
      if(e.key === 'Escape') closeOutputOverlay();
      else if(e.key === 'ArrowLeft') prevOutput();
      else if(e.key === 'ArrowRight') nextOutput();
    });
  }catch{}
});
// --- DOM Elements (single query, reused everywhere) ---
const inputImage = document.getElementById('inputImage');
// previewImage element was removed; keep placeholder null for legacy checks
const previewImage = null;
const dropArea = document.getElementById('dropArea');
const dropText = document.getElementById('dropText');
const uploadForm = document.getElementById('uploadForm');
const downloadLink = document.getElementById('downloadLink');
const outputGrid = document.getElementById('outputGrid');
// Removed unused NodeList assignment (was triggering eslint no-unused-vars)
const uploadButton = uploadForm ? uploadForm.querySelector('.upload-btn') : null;
const allowConcurrentUploadCheckbox = null; // toggle removed: always multi-upload
const advancedModeToggle = document.getElementById('advancedModeToggle');
const multiPreviewContainer = document.getElementById('multiPreviewContainer');
let activeRequestId = null; // track current processing request
let activeRequestIds = []; // track multiple when multi-upload
let selectedFiles = []; // ensure declared (used in multi-upload logic)
let multiRunActive = false; // true while a multi-upload batch (>1) is being processed
let multiRunTotalCount = 0; // total images in current batch
let multiRunDoneCount = 0;  // completed (success or fail) in current batch
let __persist = { selectedPreviewSources: [], comparisonSplitPct: null }; // fallback sources for previews and comparison slider
// Stage weighting tracker (client-side heuristic). Each unique progress.stage encountered becomes a stage.
const __stageTracker = { encountered: [], lastOverall: 0 };
window.__nudeForgeStageTracker = __stageTracker;
window.__nudeForgeConfig = Object.assign(window.__nudeForgeConfig||{}, { useStageWeighting: true });

// Upload button busy-state helper
function setUploadBusy(busy){
  if(!uploadButton) return;
  if(busy){
    uploadButton.disabled = true;
    uploadButton.classList.add('disabled');
    if(!uploadButton.dataset.originalText){ uploadButton.dataset.originalText = uploadButton.textContent || 'Upload'; }
    uploadButton.textContent = 'Processing...';
  // toggle removed
  } else {
    uploadButton.disabled = false;
    uploadButton.classList.remove('disabled');
    try { updateUploadButtonState(); } catch { /* no-op */ }
  // toggle removed
  }
}

// Immediate preview handler (ensures image becomes visible on selection before later enhancements run)
// On Android, force the standard Files picker instead of the Photos picker by loosening the accept type.
// We'll still validate and only allow images on the client side.
if (inputImage) {
  try {
    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    if (isAndroid) {
      inputImage.setAttribute('accept', '*/*');
    }
  } catch { /* ignore UA errors */ }

  inputImage.addEventListener('change', () => {
    const maxFiles = Number(uploadForm?.dataset?.maxUploadFiles || 12);
    // Client-side guard: only allow images
    const allFiles = Array.from(inputImage.files || []);
    // If user cancels the picker, keep previous selection and previews
    if (allFiles.length === 0) {
      return;
    }
    const imageFiles = allFiles.filter(f => (f && typeof f.type === 'string' && f.type.startsWith('image/')));
    if (allFiles.length > 0 && imageFiles.length === 0) {
      window.toast?.error('Please select an image file.');
      inputImage.value = '';
      return;
    }
    // Enforce max file limit client-side
    if (imageFiles.length > maxFiles) {
      window.toast?.warn?.(`You selected ${imageFiles.length} images. Only the first ${maxFiles} will be uploaded.`);
    }
    const limitedImages = imageFiles.slice(0, maxFiles);
  const multi = true;
  if (multi) {
    // Collect selected files and let renderer decide single vs multi layout.
    selectedFiles = limitedImages;
    if (selectedFiles.length > 0 && dropText) dropText.style.display = 'none';
    if (window.renderMultiPreviews) { try { window.renderMultiPreviews(); } catch {} }
      // Initialize persisted preview sources from selectedFiles using data URLs (updated later if copy URL becomes available)
      try {
        __persist.selectedPreviewSources = [];
        const readers = selectedFiles.map(file => new Promise((resolve)=>{ const r=new FileReader(); r.onload=e=>resolve({ src:e.target.result, kind:'data', filename:file.name||'image' }); r.readAsDataURL(file); }));
        Promise.all(readers).then(list=>{ __persist.selectedPreviewSources = list; saveGeneratorState(); });
      } catch {}
  }
    // Background: send copy/copies immediately to /upload-copy (non-blocking) so server stores original in /copy
    // Do NOT await to avoid delaying UI preview.
    (async () => {
      try {
  const filesToSend = selectedFiles;
        if (!filesToSend || filesToSend.length === 0) return;
        // Endpoint currently expects single 'image', so send sequentially.
        for (const f of filesToSend) {
          if (!f) continue;
          const fd = new FormData();
            fd.append('image', f, f.name);
          fetch('/upload-copy', { method: 'POST', body: fd })
            .then(r => { if(!r.ok) throw new Error('copy upload failed'); return r.json().catch(()=>({})); })
    .then((resp) => { if(resp && resp.filename){
      // Update persisted preview source to use copy url if available for same name
      const url = `/copy/${encodeURIComponent(resp.filename)}`;
      const base = (f.name||'image');
      const idx = (__persist.selectedPreviewSources||[]).findIndex(it=> it && it.filename===base);
      if(idx>=0){ __persist.selectedPreviewSources[idx] = { src:url, kind:'copy', filename: base }; saveGeneratorState(); }
    } })
            .catch(err => { window.ClientLogger?.warn('Copy upload failed', { name: f.name, err }); });
        }
  } catch(err){ window.ClientLogger?.error('Copy upload dispatch error', err); }
    })();
    // Basic button enable if later helper not yet defined
    if (uploadButton && (!window.updateUploadButtonState)) {
      const hasFile = inputImage.files && inputImage.files.length > 0;
      uploadButton.disabled = !hasFile;
    } else if (window.updateUploadButtonState) {
  try { window.updateUploadButtonState(); } catch { /* ignore state update error */ }
    }
  });
}

// Multi-upload mode toggle listener (guard for element existing)
// toggle removed

// --- Utilities & Helpers ---
function showElement(el){ if(el) el.style.display=''; }
function hideElement(el){ if(el) el.style.display='none'; }
function createEl(tag, opts={}){ const el=document.createElement(tag); Object.assign(el, opts); return el; }
// Convert data URL to Blob
function dataUrlToBlob(dataUrl){
  try{
    const parts = dataUrl.split(',');
    const header = parts[0];
    const data = parts[1] || '';
    const isBase64 = /;base64/i.test(header);
    const mimeMatch = /^data:([^;]+)(;|,)/i.exec(header);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    if(isBase64){
      const byteStr = atob(data);
      const len = byteStr.length;
      const bytes = new Uint8Array(len);
      for(let i=0;i<len;i++){ bytes[i] = byteStr.charCodeAt(i); }
      return new Blob([bytes], { type: mime });
    } else {
      const decoded = decodeURIComponent(data);
      return new Blob([decoded], { type: mime });
    }
  } catch { return null; }
}
async function getBlobFromSrc(src){
  try{
    if(typeof src === 'string' && src.startsWith('data:')){
      const b = dataUrlToBlob(src); if(b) return b; throw new Error('Invalid data URL');
    }
    const res = await fetch(src, { cache: 'no-cache' });
    if(!res.ok) throw new Error('fetch failed');
    return await res.blob();
  } catch(err){ window.ClientLogger?.error('getBlobFromSrc failed', { src, err }); throw err; }
}
async function reconstructFilesFromPersistedSources(maxFiles){
  const sources = Array.isArray(__persist?.selectedPreviewSources) ? __persist.selectedPreviewSources : [];
  const slice = sources.slice(0, Math.max(1, Number(maxFiles||sources.length)));
  const out = [];
  for(const it of slice){
    try{
      const blob = await getBlobFromSrc(it.src);
      const fname = (it && it.filename) ? it.filename : 'image';
      const type = blob && blob.type ? blob.type : 'image/png';
      out.push(new File([blob], fname, { type }));
    } catch(e){ /* skip failed */ }
  }
  return out;
}
async function rehydrateSelectionFromPersisted(reason){
  try{
    const sources = Array.isArray(__persist?.selectedPreviewSources) ? __persist.selectedPreviewSources : [];
    if(!sources.length) return;
    // Render previews if missing: always grid
    if(multiPreviewContainer && multiPreviewContainer.children.length===0){
      multiPreviewContainer.innerHTML=''; multiPreviewContainer.style.display='';
      sources.forEach((it, idx)=>{ const wrap=document.createElement('div'); wrap.className='multi-preview-item'; const img=document.createElement('img'); img.className='multi-preview-img'; img.loading='lazy'; img.alt=it.filename||('image '+(idx+1)); img.src=it.src; wrap.appendChild(img); multiPreviewContainer.appendChild(wrap); });
    }
    if(dropText) dropText.style.display='none';
    const maxFiles = Number(uploadForm?.dataset?.maxUploadFiles || 12);
    const files = await reconstructFilesFromPersistedSources(maxFiles);
    if(files && files.length){
      selectedFiles = files;
      if(inputImage){ const dt = new DataTransfer(); files.forEach(f=> dt.items.add(f)); inputImage.files = dt.files; }
      updateUploadButtonState();
    }
  } catch(err){ window.ClientLogger?.warn('rehydrateSelectionFromPersisted failed', { reason, err }); }
}
function saveGeneratorState(){
  try{
    const key='nudeforge:generatorState:v1';
    const imgGrid = Array.from(document.querySelectorAll('#outputGrid .output-item img')).map(img=> img && img.src ? String(img.src).split('?')[0] : null).filter(Boolean);
    // Helpers to capture UI state
    const getComparisonSplitPct = () => {
      try {
        const container = document.getElementById('comparisonContainer');
        if(!container) return null;
        const after = container.querySelector('.comparison-after');
        const slider = container.querySelector('.comparison-slider');
        let pct = null;
        if(after && after.style.width && after.style.width.endsWith('%')) pct = parseFloat(after.style.width);
        else if(slider && slider.style.left && slider.style.left.endsWith('%')) pct = parseFloat(slider.style.left);
        if(Number.isFinite(pct)) return Math.max(0, Math.min(100, pct));
      } catch {}
      return typeof __persist?.comparisonSplitPct === 'number' ? __persist.comparisonSplitPct : null;
    };
    const applyBool = v => !!v;
    // Capture Advanced settings values
    const promptVal = (document.getElementById('prompt')?.value) ?? '';
    const stepsEl = document.getElementById('steps');
    const stepsVal = stepsEl ? String(stepsEl.value ?? '20') : '20';
    const outputHeightVal = (document.getElementById('outputHeight')?.value) ?? '1080';
    const loraRows = Array.from(document.querySelectorAll('#loraGrid .lora-row')).map(row => {
      try{
        const model = row.querySelector('select.lora-model-select')?.value || '';
        const enable = !!row.querySelector('input[type="checkbox"]')?.checked;
        const strength = row.querySelector('input.lora-strength')?.value || '1.0';
        return { model, enable, strength };
      } catch { return { model:'', enable:false, strength:'1.0' }; }
    });
    const state = {
      selectedPreviewSources: __persist.selectedPreviewSources||[],
      outputGrid: imgGrid,
      activeRequestId,
      activeRequestIds,
      advancedMode: applyBool(advancedModeToggle && advancedModeToggle.checked),
      comparisonSplitPct: getComparisonSplitPct(),
      settings: {
        prompt: String(promptVal),
        steps: String(stepsVal),
        outputHeight: String(outputHeightVal),
        loras: loraRows
      },
      // Derived UI flags for placeholder visibility
      ui: {
        inputHasSelection: Array.isArray(__persist.selectedPreviewSources) && __persist.selectedPreviewSources.length > 0,
        outputHasImages: Array.isArray(imgGrid) && imgGrid.length > 0
      },
      statusText: (document.getElementById('processingStatus')?.textContent)||'',
      progress: {
        pct: (function(){ const s=document.getElementById('processingProgressBar'); if(!s) return null; const w=s.style.width||''; const m=/^(\d+)%$/.exec(w); return m? Number(m[1]) : null; })(),
        label: (document.getElementById('processingProgressLabel')?.textContent)||''
      }
    };
    localStorage.setItem(key, JSON.stringify(state));
  }catch{}
}
function restoreGeneratorState(){
  try{
    const key='nudeforge:generatorState:v1';
    const raw = localStorage.getItem(key);
    if(!raw) return;
    const state = JSON.parse(raw);
    // Restore Advanced/settings visibility first so subsequent UI respects it
    if(typeof state?.advancedMode === 'boolean' && advancedModeToggle){
      try { advancedModeToggle.checked = !!state.advancedMode; } catch {}
      try {
        const settingsSection = document.getElementById('settingsSection');
        const comparisonSection = document.getElementById('comparisonSection');
        if(settingsSection) settingsSection.style.display = state.advancedMode ? 'block' : 'none';
        if(comparisonSection) comparisonSection.style.display = state.advancedMode ? 'block' : 'none';
      } catch {}
    }
    if(state && Array.isArray(state.selectedPreviewSources) && state.selectedPreviewSources.length>0){
      __persist.selectedPreviewSources = state.selectedPreviewSources;
      // Render previews from sources (always grid)
      if(multiPreviewContainer){ multiPreviewContainer.innerHTML=''; multiPreviewContainer.style.display=''; }
      state.selectedPreviewSources.forEach((it, idx)=>{
        const wrap=document.createElement('div'); wrap.className='multi-preview-item';
        const img=document.createElement('img'); img.className='multi-preview-img'; img.loading='lazy'; img.alt=it.filename||('image '+(idx+1)); img.src=it.src;
        wrap.appendChild(img); multiPreviewContainer.appendChild(wrap);
      });
      if(dropText) dropText.style.display='none';
      // Ensure Upload button is enabled based on persisted selection
      try{ if(uploadButton){ uploadButton.disabled = false; uploadButton.classList.remove('disabled'); uploadButton.textContent = `Upload All (${state.selectedPreviewSources.length})`; } }catch{}
      // Optionally reconstruct FileList for the input asynchronously to keep system state consistent
      try{
        const maxFiles = Number(uploadForm?.dataset?.maxUploadFiles || 12);
        reconstructFilesFromPersistedSources(maxFiles).then(files=>{
          if(files && files.length){
            selectedFiles = files;
            // Best-effort: reflect into <input type="file"> using a DataTransfer
            if(inputImage){ const dt = new DataTransfer(); files.forEach(f=> dt.items.add(f)); inputImage.files = dt.files; }
            updateUploadButtonState();
          }
        }).catch(()=>{});
      }catch{}
      // Note: selectedFiles remains empty until submission reconstructs
    }
    if(state && Array.isArray(state.outputGrid) && state.outputGrid.length>0){
      const grid = document.getElementById('outputGrid'); if(grid){ grid.style.display='grid'; grid.innerHTML=''; state.outputGrid.forEach(u=>{ const item=document.createElement('div'); item.className='output-item'; const img=document.createElement('img'); img.src=u; const dl=document.createElement('a'); dl.href=u; dl.className='download-overlay'; dl.textContent='Download'; dl.setAttribute('download',''); item.appendChild(img); item.appendChild(dl); grid.appendChild(item); }); }
      try{ const outBox = document.getElementById('outputArea'); if(outBox){ outBox.classList.add('has-previews'); } }catch{}
    }
    // Restore placeholder visibility based on derived UI flags
    try{
      const ui = state.ui || {};
      const inputPh = document.getElementById('dropText');
      if(inputPh){ inputPh.style.display = ui.inputHasSelection ? 'none' : ''; }
      const outPh = document.getElementById('outputPlaceholder');
      if(outPh){ outPh.style.display = (Array.isArray(state.outputGrid) && state.outputGrid.length>0) ? 'none' : ''; }
    }catch{}
    // Restore Advanced settings values
    if(state && state.settings){
      try{
        const promptEl = document.getElementById('prompt'); if(promptEl) promptEl.value = state.settings.prompt ?? promptEl.value;
        const stepsEl = document.getElementById('steps'); if(stepsEl){ stepsEl.value = state.settings.steps ?? stepsEl.value; const sv=document.getElementById('stepsValue'); if(sv) sv.textContent = String(stepsEl.value); }
        const outH = document.getElementById('outputHeight'); if(outH){ outH.value = state.settings.outputHeight ?? outH.value; }
        // Restore LoRA rows
        const loraGrid = document.getElementById('loraGrid');
        const addBtn = document.getElementById('addLoraBtn');
        if(loraGrid && Array.isArray(state.settings.loras)){
          // Ensure row count matches
          const target = state.settings.loras.length;
          let current = loraGrid.querySelectorAll('.lora-row').length;
          while(current < target && addBtn){ addBtn.click(); current++; }
          while(current > target){ const rows = loraGrid.querySelectorAll('.lora-row'); const last = rows[rows.length-1]; if(last) last.remove(); current--; }
          // Apply values
          const rows = loraGrid.querySelectorAll('.lora-row');
          state.settings.loras.forEach((conf, i) => {
            const row = rows[i]; if(!row) return;
            const sel = row.querySelector('select.lora-model-select'); if(sel && typeof conf.model === 'string'){ sel.value = conf.model; }
            const chk = row.querySelector('input[type="checkbox"]'); if(chk){ chk.checked = !!conf.enable; }
            const str = row.querySelector('input.lora-strength'); if(str && typeof conf.strength === 'string'){ str.value = conf.strength; }
          });
        }
      } catch {}
    }
    // Restore comparison slider position if available
    if(typeof state?.comparisonSplitPct === 'number'){
      __persist.comparisonSplitPct = state.comparisonSplitPct;
      try{
        const container = document.getElementById('comparisonContainer');
        if(container){
          const after = container.querySelector('.comparison-after');
          const slider = container.querySelector('.comparison-slider');
          if(after) after.style.width = state.comparisonSplitPct + '%';
          if(slider) slider.style.left = state.comparisonSplitPct + '%';
        }
      }catch{}
    }
    if(typeof state?.statusText==='string'){ const sEl=document.getElementById('processingStatus'); if(sEl){ sEl.textContent=state.statusText; } }
    if(state && state.progress){ const bar=document.getElementById('processingProgressBar'); const label=document.getElementById('processingProgressLabel'); if(bar && typeof state.progress.pct==='number'){ bar.style.width=state.progress.pct+'%'; } if(label && state.progress.label){ label.textContent=state.progress.label; } }
    if(state && (state.activeRequestId || (Array.isArray(state.activeRequestIds) && state.activeRequestIds.length))){
      activeRequestId = state.activeRequestId || null;
      activeRequestIds = Array.isArray(state.activeRequestIds) ? state.activeRequestIds : (activeRequestId? [activeRequestId] : []);
      if(activeRequestId){ joinStatusChannel(activeRequestId); pollStatus(); }
    }
  }catch{}
}
function updateDropPlaceholder(){
  if(!dropText) return;
  if(selectedFiles.length>0){ dropText.style.display='none'; } else { dropText.style.display=''; }
}
// initial invocation to mark helper utilized
updateDropPlaceholder();

// --- Carousel Logic ---
let carouselInitialized = false;
async function initializeCarousel(){
  if(carouselInitialized) return;
  const slideContainer = document.querySelector('.carousel-slide');
  if(!slideContainer) return;
  const cacheKey = 'nudeforge:carousel-images:v1';
  function getCached(){ try{ const raw=localStorage.getItem(cacheKey); const arr=JSON.parse(raw); return Array.isArray(arr)? arr : []; }catch{ return []; } }
  function setCached(arr){ try{ localStorage.setItem(cacheKey, JSON.stringify(Array.isArray(arr)? arr: [])); }catch{} }
  async function render(images){
    if(!Array.isArray(images) || images.length===0){
      window.ClientLogger?.warn('No carousel images (cache or API)');
      if(slideContainer && !slideContainer.querySelector('.carousel-empty')){
        slideContainer.innerHTML = '<div class="carousel-empty" style="display:flex;align-items:center;justify-content:center;width:100%;color:var(--color-text-dim);font-size:.75rem;">No carousel images available</div>';
      }
      return false;
    }
    slideContainer.innerHTML='';
    images.forEach(name => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = `/images/carousel/${encodeURIComponent(name)}`;
      img.alt = name;
      img.className='loading';
      img.addEventListener('load', ()=>{ img.classList.remove('loading'); img.classList.add('loaded'); });
      slideContainer.appendChild(img);
    });
    // Seamless loop: perform after images load (or timeout) with safety guards
    const originals = Array.from(slideContainer.children);
    let loadedCount = 0; let settled = false; const maxWaitMs = 3000; const startTs = Date.now();
    function finalizeCarousel(){
      if(settled) return; settled = true;
      // Measure original total width
      const originalWidth = originals.reduce((acc,el)=> acc + el.getBoundingClientRect().width,0) || slideContainer.scrollWidth || slideContainer.getBoundingClientRect().width;
      slideContainer.dataset.originalWidth = String(originalWidth);
      // Only clone if we have a positive width and more than one image
      if(originalWidth > 0 && originals.length > 1){
        const containerVisibleWidth = slideContainer.parentElement ? slideContainer.parentElement.getBoundingClientRect().width : originalWidth;
        // Cap total clones to avoid runaway growth
        const maxTotalImages = originals.length * 3; // at most 2x clones
        while(slideContainer.children.length < maxTotalImages && slideContainer.getBoundingClientRect().width < containerVisibleWidth * 2){
          for(const orig of originals){
            if(slideContainer.children.length >= maxTotalImages) break;
            const clone = orig.cloneNode(true);
            clone.classList.add('clone');
            slideContainer.appendChild(clone);
          }
        }
      }
      startScroll();
    }
    originals.forEach(imgEl => {
      if(imgEl.complete){ loadedCount++; }
      else { imgEl.addEventListener('load', ()=>{ loadedCount++; if(loadedCount === originals.length) finalizeCarousel(); }); imgEl.addEventListener('error', ()=>{ loadedCount++; if(loadedCount === originals.length) finalizeCarousel(); }); }
    });
    // Timeout fallback
    const checkTimeout = () => { if(!settled && (loadedCount === originals.length || Date.now()-startTs > maxWaitMs)){ finalizeCarousel(); } else if(!settled) { setTimeout(checkTimeout, 100); } };
    checkTimeout();
    let scrollPos = 0;
    function startScroll(){
      function tick(){
        const origWidth = parseFloat(slideContainer.dataset.originalWidth)||0;
        if(origWidth === 0){ return requestAnimationFrame(tick); }
        scrollPos += 0.3;
        if(scrollPos >= origWidth){ // wrap seamlessly (clones ensure continuity)
          scrollPos -= origWidth;
        }
        slideContainer.style.transform = `translateX(${-scrollPos}px)`;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    function _tick(){ /* replaced by startScroll */ }
    // previous tick logic replaced with seamless clone-based scrolling
    carouselInitialized = true;
    return true;
  }
  try {
    const cached = getCached();
    if(Array.isArray(cached) && cached.length){
      const ok = await render(cached);
      if(ok) return; // rendered from cache, avoid fetch
    }
    const res = await fetch('/api/carousel-images');
    if(!res.ok) throw new Error('Failed to fetch carousel images');
    let images = await res.json();
    if(!Array.isArray(images) || images.length===0){
      window.ClientLogger?.warn('No carousel images returned from API');
      if(slideContainer && !slideContainer.querySelector('.carousel-empty')){
        slideContainer.innerHTML = '<div class="carousel-empty" style="display:flex;align-items:center;justify-content:center;width:100%;color:var(--color-text-dim);font-size:.75rem;">No carousel images available</div>';
      }
      return;
    }
    setCached(images);
    await render(images);
  } catch(err){
    window.ClientLogger?.error('Carousel init failed', err);
  }
}

// --- LoRA Initialization ---
let lorasLoaded = false;
async function initializeLoRAs(){
  if(lorasLoaded) return;
  const grid = document.getElementById('loraGrid');
  const addBtn = document.getElementById('addLoraBtn');
  if(!grid) return;
  try {
    const res = await fetch('/api/loras');
    if(!res.ok) throw new Error('Failed to fetch LoRAs');
    const data = await res.json();
    if(!data.success) throw new Error('LoRA API returned failure');
    const models = data.loras || [];
    populateInitialLoRAEntry(grid, models);
  if(addBtn){ addBtn.addEventListener('click', ()=> addLoRAEntry(grid, models)); }
  updateDropPlaceholder();
    lorasLoaded = true;
  } catch(e){
  window.ClientLogger?.error('Failed to initialize LoRAs', e);
  }
}
function createLoraRow(index, models){
  const row = createEl('div');
  row.className='lora-row';
  const main = createEl('div'); main.className='lora-main';
  const modelContainer = createEl('div'); modelContainer.className='lora-model-container';
  const select = createEl('select'); select.name = `lora_${index}_model`; select.className='lora-model-select';
  const emptyOpt = createEl('option'); emptyOpt.value=''; emptyOpt.textContent='-- Select LoRA --'; select.appendChild(emptyOpt);
  models.forEach(m=>{ const opt=createEl('option'); opt.value=m.filename; opt.textContent=m.displayName; select.appendChild(opt); });
  modelContainer.appendChild(select);
  const enableLabel = createEl('label'); enableLabel.style.display='flex'; enableLabel.style.alignItems='center'; enableLabel.style.gap='.3em';
  const enableCheckbox = createEl('input',{ type:'checkbox', name:`lora_${index}_on` });
  enableLabel.appendChild(enableCheckbox); enableLabel.appendChild(document.createTextNode('Enable'));
  const strengthGroup = createEl('div'); strengthGroup.className='lora-strength-group';
  const strengthLabel = createEl('label'); strengthLabel.textContent='Strength:'; strengthLabel.style.fontSize='.8em';
  const strengthInput = createEl('input',{ type:'number', step:'0.05', min:'0', max:'2', value:'1.0', name:`lora_${index}_strength`, className:'lora-strength' });
  strengthGroup.appendChild(strengthLabel); strengthGroup.appendChild(strengthInput);
  main.appendChild(modelContainer); main.appendChild(enableLabel); main.appendChild(strengthGroup);
  const controls = createEl('div'); controls.className='lora-row-controls';
  const removeBtn = createEl('button',{ type:'button', textContent:'×' }); removeBtn.className='lora-remove-btn';
  removeBtn.addEventListener('click', ()=>{ row.remove(); });
  controls.appendChild(removeBtn);
  row.appendChild(main); row.appendChild(controls);
  return { row, select, enableCheckbox };
}
function populateInitialLoRAEntry(grid, models){
  const { row, select, enableCheckbox } = createLoraRow(1, models);
  grid.appendChild(row);
  const target = models.find(m => /change\s*clothes\s*to\s*nothing/i.test(m.displayName));
  if(target){ select.value = target.filename; enableCheckbox.checked = true; }
}
function addLoRAEntry(grid, models){
  const existing = grid.querySelectorAll('.lora-row').length;
  const idx = existing + 1;
  const { row } = createLoraRow(idx, models); grid.appendChild(row);
}
window.__nudeForge = Object.assign(window.__nudeForge||{}, { initializeCarousel, initializeLoRAs });
// Insert helpers and enhancements below utilities
// --- Enhancements Injected ---
(function enhanceClient(){
  // Theme applied early in header; no duplicate logic here.

  // File selection helpers
  function clearSelectedFiles(){
    selectedFiles = [];
    if(multiPreviewContainer){ multiPreviewContainer.innerHTML=''; multiPreviewContainer.style.display='none'; }
  }
  function renderMultiPreviews(){
    if(!multiPreviewContainer) return;
    multiPreviewContainer.innerHTML = '';
    const files = selectedFiles || [];
    const hasFiles = Array.isArray(files) && files.length>0;
    const sources = __persist.selectedPreviewSources || [];
    const count = hasFiles ? files.length : (Array.isArray(sources) ? sources.length : 0);
    if(count === 0){
      multiPreviewContainer.style.display='none';
      try{ const box = document.getElementById('dropArea'); if(box){ box.classList.remove('has-previews'); } }catch{}
      return;
    }
  // Always grid of thumbnails
  multiPreviewContainer.style.display = '';
    // Reset to default multi layout first
    multiPreviewContainer.style.gridTemplateColumns = 'repeat(auto-fit,minmax(120px,1fr))';
    multiPreviewContainer.style.height = '100%';
    multiPreviewContainer.style.maxHeight = '';
    try{ const box = document.getElementById('dropArea'); if(box){ box.classList.add('has-previews'); } }catch{}
    const maxThumbs = 12; // safety cap
    if(hasFiles){
      files.slice(0, maxThumbs).forEach((file, idx)=>{
        if(!file) return;
        const wrapper = document.createElement('div'); wrapper.className = 'multi-preview-item';
        const img = document.createElement('img'); img.alt = file.name || ('image ' + (idx+1)); img.loading = 'lazy'; img.className = 'multi-preview-img';
        const reader = new FileReader(); reader.onload = ev => { img.src = ev.target.result; }; reader.readAsDataURL(file);
        wrapper.appendChild(img); multiPreviewContainer.appendChild(wrapper);
      });
    } else if (Array.isArray(sources) && sources.length>0){
      sources.slice(0, maxThumbs).forEach((it, idx)=>{ const wrapper=document.createElement('div'); wrapper.className='multi-preview-item'; const img=document.createElement('img'); img.className='multi-preview-img'; img.loading='lazy'; img.alt=it.filename||('image '+(idx+1)); img.src=it.src; wrapper.appendChild(img); multiPreviewContainer.appendChild(wrapper); });
    }
    // If there is exactly one preview, expand to fill container height with non-cropping fit
    const items = multiPreviewContainer.querySelectorAll('.multi-preview-item');
    if(items.length === 1){
      multiPreviewContainer.style.gridTemplateColumns = '1fr';
      multiPreviewContainer.style.maxHeight = 'none';
      multiPreviewContainer.style.height = '100%';
      const only = items[0];
      only.style.aspectRatio = 'auto';
      only.style.height = '100%';
      const img = only.querySelector('img');
      if(img){ img.style.height='100%'; img.style.width='auto'; img.style.objectFit='contain'; }
    }
  }
  function updateUploadButtonState(){
    if(!uploadButton) return;
  uploadButton.disabled = selectedFiles.length === 0;
  uploadButton.textContent = selectedFiles.length > 1 ? `Upload All (${selectedFiles.length})` : 'Upload';
  }
  // Expose for earlier references
  window.clearSelectedFiles = clearSelectedFiles;
  window.updateUploadButtonState = updateUploadButtonState;
  window.renderMultiPreviews = renderMultiPreviews;

  // Input file change logic
  function gatherAndNormalizeSettings(formData){
    // Ensure critical settings present even if hidden UI
    const promptEl = document.getElementById('prompt');
    const stepsEl = document.getElementById('steps');
    const outputHeightEl = document.getElementById('outputHeight');
    if(promptEl) formData.set('prompt', promptEl.value || '');
    if(stepsEl) formData.set('steps', stepsEl.value || '20');
    if(outputHeightEl) formData.set('outputHeight', outputHeightEl.value || '1080');
    return formData;
  }

  if(uploadForm){
    uploadForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!uploadButton || uploadButton.disabled) return;
      const formData = new FormData(uploadForm);
      // If no live selectedFiles but we have persisted previews (after tab switch), reconstruct File objects
      if((!selectedFiles || selectedFiles.length===0) && Array.isArray(__persist?.selectedPreviewSources) && __persist.selectedPreviewSources.length>0){
        try{
          const maxFiles = Number(uploadForm?.dataset?.maxUploadFiles || 12);
          selectedFiles = await reconstructFilesFromPersistedSources(maxFiles);
        } catch {}
      }
      // Enforce server limit as final guard before appending
      const maxFiles = Number(uploadForm?.dataset?.maxUploadFiles || 12);
      if (selectedFiles.length > maxFiles) {
        window.toast?.warn?.(`Limiting to ${maxFiles} images per upload (selected ${selectedFiles.length}).`);
        selectedFiles = selectedFiles.slice(0, maxFiles);
      }
      // Always append selected files (multi-upload always on)
      if(selectedFiles.length>0){
        formData.delete('image'); // remove potential single
        selectedFiles.forEach(f=> formData.append('image', f));
      }
      gatherAndNormalizeSettings(formData);
  const isAdvanced = advancedModeToggle && advancedModeToggle.checked;
  const singleMode = false; // always multi mode
  // Determine multi run state for output box behavior
  multiRunActive = !singleMode && selectedFiles && selectedFiles.length > 1;
  // Clean output placeholder and disable download on start
  try{
    const ph=document.getElementById('outputPlaceholder');
    if(ph){ ph.style.display='none'; }
    if(typeof _disableDownload === 'function'){ _disableDownload(); }
  }catch{}
  setUploadBusy(true);
      try {
        const res = await fetch('/upload', { method:'POST', body: formData });
        if(!res.ok){
          const txt = await res.text();
          window.toast?.error('Upload failed: '+(txt||res.status));
        } else {
          const data = await res.json().catch(()=>({}));
          if(data.requestId){
            activeRequestId = data.requestId;
            activeRequestIds = Array.isArray(data.requestIds) ? data.requestIds.slice() : [activeRequestId];
              // initialize batch counters
              multiRunTotalCount = activeRequestIds.length;
              multiRunDoneCount = 0;
              multiRunActive = multiRunTotalCount > 1;
            joinStatusChannel(activeRequestId);
            updateStatusUI({ status:'queued', yourPosition: data.yourPosition });
            pollStatus();
            window.toast?.success('Queued '+(data.queued||1)+' item(s) (first position '+(data.yourPosition||'?')+')');
          } else {
            window.toast?.success('Added to queue.');
          }
        }
  } catch{
        window.toast?.error('Upload error');
      } finally {
  // Keep disabled while active request is being processed
  if(!activeRequestId){ setUploadBusy(false); multiRunActive = false; }
      }
    });
  }
  if(dropArea && inputImage){
    // Click proxy
    dropArea.addEventListener('click', (e)=>{
      // Ignore clicks on inner interactive elements if any appear later
      if(e.target && (e.target.tagName === 'INPUT' || e.target.closest('button,select'))) return;
      inputImage.click();
    });
    ;['dragenter','dragover'].forEach(evt=> dropArea.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); dropArea.classList.add('drag-over'); }));
    ;['dragleave','dragend'].forEach(evt=> dropArea.addEventListener(evt, e=>{ e.preventDefault(); e.stopPropagation(); dropArea.classList.remove('drag-over'); }));
    dropArea.addEventListener('drop', e=>{
      e.preventDefault(); e.stopPropagation(); dropArea.classList.remove('drag-over');
  const maxFiles = Number(uploadForm?.dataset?.maxUploadFiles || 12);
  const all = Array.from(e.dataTransfer.files||[]).filter(f=> f.type.startsWith('image/'));
  if(all.length > maxFiles){ window.toast?.warn?.(`Limiting to ${maxFiles} images per upload (dropped ${all.length}).`); }
  const files = all.slice(0, maxFiles);
      if(files.length===0) return;
      const dt = new DataTransfer();
  // Always multi-upload: add all files
  files.forEach(f=> dt.items.add(f));
      inputImage.files = dt.files; // triggers change event programmatically below
      const changeEvt = new Event('change');
      inputImage.dispatchEvent(changeEvt);
  // Always multi: previews handled by change event -> renderMultiPreviews()
    });
  }
})();

// === Advanced Mode Toggle Handling ===
document.addEventListener('DOMContentLoaded', ()=>{
  const settingsSection = document.getElementById('settingsSection');
  const comparisonSection = document.getElementById('comparisonSection');
  function applyAdvancedVisibility(){
    const enabled = advancedModeToggle && advancedModeToggle.checked;
    if(settingsSection) settingsSection.style.display = enabled ? 'block':'none';
    if(comparisonSection) comparisonSection.style.display = enabled ? 'block' : 'none';
  }
  if(advancedModeToggle){
    advancedModeToggle.addEventListener('change', ()=>{ applyAdvancedVisibility(); try{ saveGeneratorState(); }catch{} });
    applyAdvancedVisibility();
  }
  // Rehydrate selection when page regains visibility/focus (covers browser tab switches)
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible'){ rehydrateSelectionFromPersisted('visibilitychange'); } });
  window.addEventListener('focus', ()=>{ rehydrateSelectionFromPersisted('focus'); });
  // Persist Advanced inputs and LoRA changes
  const promptEl = document.getElementById('prompt'); if(promptEl){ promptEl.addEventListener('input', ()=>{ try{ saveGeneratorState(); }catch{} }); }
  const stepsEl = document.getElementById('steps'); if(stepsEl){ stepsEl.addEventListener('input', ()=>{ const sv=document.getElementById('stepsValue'); if(sv) sv.textContent=String(stepsEl.value); try{ saveGeneratorState(); }catch{} }); }
  const outH = document.getElementById('outputHeight'); if(outH){ outH.addEventListener('change', ()=>{ try{ saveGeneratorState(); }catch{} }); }
  const loraGrid = document.getElementById('loraGrid'); if(loraGrid){
    loraGrid.addEventListener('change', ()=>{ try{ saveGeneratorState(); }catch{} });
    loraGrid.addEventListener('click', (e)=>{ if(e.target && e.target.closest('.lora-remove-btn')){ setTimeout(()=>{ try{ saveGeneratorState(); }catch{} },0); } });
  }
  const addBtn = document.getElementById('addLoraBtn'); if(addBtn){ addBtn.addEventListener('click', ()=>{ setTimeout(()=>{ try{ saveGeneratorState(); }catch{} },0); }); }
});

// === Real-time / Polling Status Handling ===
let socketInstance = null;
let __hasLiveProgressForActive = false;
let __lastOverallPct = null;
function ensureSocket(){ if(socketInstance) return socketInstance; if(window.io){ socketInstance = window.io(); } return socketInstance; }
function joinStatusChannel(requestId){ const s = ensureSocket(); if(!s) return; __hasLiveProgressForActive = false; s.emit('joinRoom', requestId); if(!s._listenersAdded){
  s.on('queueUpdate', payload=>{ if(payload.requestId && payload.requestId!==activeRequestId) return; updateStatusUI(payload); });
  // Real-time progress events from server
  s.on('processingProgress', payload=>{
    if(payload.requestId && payload.requestId!==activeRequestId) return;
  const progress = payload && typeof payload.value==='number' && typeof payload.max==='number'
      ? { value: payload.value, max: payload.max, type: payload.type||'global_steps' }
      : undefined;
  if(progress){ __hasLiveProgressForActive = true; }
  updateStatusUI({ status:'processing', progress, stage: payload?.stage });
  });
  s.on('processingComplete', payload=>{ if(payload.requestId && payload.requestId!==activeRequestId) return; handleProcessingComplete(payload); });
  s.on('processingFailed', payload=>{
    if(payload.requestId && payload.requestId!==activeRequestId) return;
    window.toast?.error(payload.error||'Processing failed');
    // Count as done for batch tracking
    if(multiRunTotalCount > 1){ multiRunDoneCount = Math.min(multiRunTotalCount, multiRunDoneCount + 1); }
    // Advance to next ID if present
    if(Array.isArray(activeRequestIds) && activeRequestIds.length>1 && payload.requestId){
      activeRequestIds = activeRequestIds.filter(id=> id!==payload.requestId);
      const nextId = activeRequestIds[0];
      if(nextId){ activeRequestId = nextId; joinStatusChannel(activeRequestId); pollStatus(); updateStatusUI({ status:'processing' }); return; }
    }
    // No more items; finalize batch state
    activeRequestId=null; multiRunActive=false;
    updateStatusUI({ status:'failed' });
  });
  s._listenersAdded = true; }
}
function setStatus(text){
  const statusEl = document.getElementById('processingStatus');
  if(!statusEl) return;
  if(typeof text !== 'string'){ statusEl.textContent = ''; return; }
  const norm = text.trim().replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ');
  const title = norm.split(' ').map(w=> w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : w).join(' ');
  let display = title;
  if(title === 'Processing') display = 'Processing:';
  else if(title === 'Unknown' || title === 'Finished' || title === 'Completed') display = 'Finished:';
  else if(title === 'Failed' || title === 'Error') display = 'Error:';
  statusEl.textContent = display;
}
function updateUnifiedStatus({ status, yourPosition, queueSize, progress, stage }) {
  const meta = document.getElementById('queueMeta');
  const wrap = document.getElementById('processingProgressBarWrapper');
  const bar = document.getElementById('processingProgressBar');
  const label = document.getElementById('processingProgressLabel');
  // Global bar (always present in header on all pages)
  const gWrap = document.getElementById('globalProcessingProgressBarWrapper');
  const gBar = document.getElementById('globalProcessingProgressBar');
  const gLabel = document.getElementById('globalProcessingProgressLabel');
  const pctSpan = document.getElementById('progressPct');
  // Idle/active visuals and end states
  if(status === 'processing' || __hasLiveProgressForActive){
    wrap?.classList.remove('idle');
    if(bar){ bar.classList.remove('success'); bar.classList.remove('error'); }
    gWrap?.classList.remove('idle');
    if(gBar){ gBar.classList.remove('success'); gBar.classList.remove('error'); }
  setUploadBusy(true);
  } else if(status === 'queued' || status === 'idle' || !status){
    // Do not force reset to Idle on 'completed' here; completion flow handles it
    wrap?.classList.add('idle');
    gWrap?.classList.add('idle');
    if(typeof progress?.value !== 'number' || typeof progress?.max !== 'number' || progress.max === 0){
      if(bar) bar.style.width = '0%';
      if(label) label.textContent = 'Idle';
      if(gBar) gBar.style.width = '0%';
      if(gLabel) gLabel.textContent = 'Idle';
    }
  if(status === 'queued'){ setUploadBusy(true); } else { setUploadBusy(false); }
  } else if(status === 'failed'){
    wrap?.classList.remove('idle');
    if(bar){ bar.style.width='100%'; bar.classList.add('error'); bar.classList.remove('success'); }
    if(label) label.textContent = 'Failed';
    gWrap?.classList.remove('idle');
    if(gBar){ gBar.style.width='100%'; gBar.classList.add('error'); gBar.classList.remove('success'); }
    if(gLabel) gLabel.textContent = 'Failed';
  setUploadBusy(false);
  }
  // Explicitly handle completion -> turn bars green
  if(status === 'completed' || status === 'finished' || status === 'done'){
    wrap?.classList.remove('idle');
    if(bar){ bar.style.width='100%'; bar.classList.add('success'); bar.classList.remove('error'); }
    if(label) label.textContent = 'Finished';
    if(pctSpan) pctSpan.textContent = '100%';
    gWrap?.classList.remove('idle');
    if(gBar){ gBar.style.width='100%'; gBar.classList.add('success'); gBar.classList.remove('error'); }
    if(gLabel) gLabel.textContent = 'Finished';
    setUploadBusy(false);
  }
  if(meta){
    // Suppress queue meta during processing entirely
    if(status==='queued' && typeof yourPosition==='number'){
      meta.textContent = `(position ${yourPosition})`;
      meta.style.display='inline';
    } else {
      meta.textContent=''; meta.style.display='none';
    }
  }
  // Adjust percent spacing to avoid double gap when meta is hidden
  if(pctSpan){
    const metaShown = meta && meta.style.display !== 'none' && meta.textContent !== '';
    pctSpan.style.marginLeft = metaShown ? '.5em' : '.25em';
  }
  // Progress percentage (numeric) and header mirroring
  if(progress && typeof progress.value==='number' && typeof progress.max==='number' && progress.max>0){
  const stageName = stage || '';
    const rawPct = Math.min(100, Math.round((progress.value/progress.max)*100));
    // Two-stage mapping: stage 1 -> 0..80, stage 2 -> 80..100
    let overall = rawPct;
    if(/Stage\s*1/i.test(stageName)){
      overall = Math.min(80, Math.round(rawPct * 0.8));
    } else if(/Stage\s*2/i.test(stageName)){
      // Map rawPct 0..100 to 80..100
      overall = Math.min(100, Math.round(80 + (rawPct * 0.20)));
    }
    __lastOverallPct = overall;
    if(pctSpan) pctSpan.textContent = overall + '%';
  updateProgressBar(overall, stageName, rawPct);
  // Mirror to global bar
  if(gBar){ gBar.style.width = overall + '%'; gBar.classList.remove('complete'); }
  if(gLabel){ gLabel.textContent = (overall||0) + '%'; }
  } else {
    // No numeric progress in this update
    if(status === 'processing' || __hasLiveProgressForActive){
      // Stick to last known percent during processing updates without progress
  if(pctSpan && typeof __lastOverallPct === 'number') pctSpan.textContent = __lastOverallPct + '%';
  if(gLabel && typeof __lastOverallPct === 'number') gLabel.textContent = __lastOverallPct + '%';
    } else if(pctSpan){
      pctSpan.textContent = '';
  if(gLabel) gLabel.textContent = 'Idle';
    }
  }
}
function updateProgressBar(pct, stage, stagePct){
  const wrap = document.getElementById('processingProgressBarWrapper');
  const bar = document.getElementById('processingProgressBar');
  const label = document.getElementById('processingProgressLabel');
  if(!wrap || !bar || !label) return;
  // Visibility handled by updateUnifiedStatus; keep wrapper shown during processing
  bar.style.width = pct + '%';
  bar.classList.remove('complete');
  const baseLabel = (pct||0) + '%';
  // Always update label during progress
  label.textContent = baseLabel;
  if(stage){
    const cleanStage = stage.replace(/\.\.\.$/,'');
    if(typeof stagePct==='number' && stagePct!==pct){
      label.textContent = baseLabel + ' • ' + cleanStage + ' (' + stagePct + '%)';
    } else {
      label.textContent = baseLabel + ' • ' + cleanStage;
    }
  }
  if(pct>=100){
    bar.classList.add('complete');
  // Keep wrapper visible; reset to Idle handled after completion event
  // If completed, label should read Finished when handleProcessingComplete runs
  }
  try{ saveGeneratorState(); }catch{}
}
function updateStatusUI(payload){
  if(payload.status) setStatus(payload.status);
  updateUnifiedStatus(payload);
  try{ saveGeneratorState(); }catch{}
}
// Expose UI update helpers for test harness
window.__nudeForge = Object.assign(window.__nudeForge||{}, {
  updateStatusUI,
  updateUnifiedStatus,
  updateProgressBar
});
async function pollStatus(){ if(!activeRequestId) return; try { const res = await fetch(`/queue-status?requestId=${encodeURIComponent(activeRequestId)}`); if(res.ok){ const data = await res.json(); updateStatusUI(data); if(data.status==='completed' && data.result && data.result.outputImage){ handleProcessingComplete({ outputImage:data.result.outputImage, downloadUrl:data.result.downloadUrl, requestId: activeRequestId }); return; } if(data.status==='failed'){ window.toast?.error('Processing failed'); activeRequestId=null; return; } } } catch { /* silent poll failure */ } if(activeRequestId){ setTimeout(pollStatus, 1500); } }
function appendOutputThumb(src, downloadUrl){
  if(!outputGrid) return;
  outputGrid.style.display='grid';
  const item = document.createElement('div');
  item.className='output-item';
  const img = document.createElement('img');
  img.src = src + `?t=${Date.now()}`;
  const dl = document.createElement('a');
  dl.href = downloadUrl || src;
  dl.className='download-overlay';
  dl.textContent='Download';
  dl.setAttribute('download','');
  item.appendChild(img);
  item.appendChild(dl);
  outputGrid.appendChild(item);
  try{ const outBox = document.getElementById('outputArea'); if(outBox){ outBox.classList.add('has-previews'); } }catch{}
  // Adjust grid when only one image -> use full space (single cell spanning)
  try{
    const count = outputGrid.querySelectorAll('.output-item').length;
    if(count === 1){
      // Single image view should fill container like input single preview
      outputGrid.style.gridTemplateColumns = '1fr';
      outputGrid.style.height = '100%';
      outputGrid.style.maxHeight = 'none';
      item.style.aspectRatio = 'auto';
      item.style.height = '100%';
      const i = item.querySelector('img');
      if(i){ i.style.height='100%'; i.style.width='auto'; i.style.objectFit='contain'; }
    } else {
      // Multi image view: reset any single-image overrides for uniform tiles
      outputGrid.style.gridTemplateColumns = '';
      outputGrid.style.height = '';
      outputGrid.style.maxHeight = '';
      // Clear any per-item overrides introduced by single mode
      const items = outputGrid.querySelectorAll('.output-item');
      items.forEach(el=>{ el.style.aspectRatio=''; el.style.height=''; });
      const imgs = outputGrid.querySelectorAll('.output-item img');
      imgs.forEach(it=>{ it.style.height=''; it.style.width=''; it.style.objectFit=''; });
    }
  }catch{}
  // Ensure placeholder is hidden when an output exists
  try{ const ph=document.getElementById('outputPlaceholder'); if(ph){ ph.style.display='none'; } }catch{}
  try{ saveGeneratorState(); }catch{}
}
function addToLocalLibrary(url, downloadUrl){
  try {
    const key = 'nudeforge:library:v1';
    const raw = localStorage.getItem(key);
    const list = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    const cleanUrl = String(url||'').split('?')[0];
    const exists = list.some(it => (it && String(it.url||'').split('?')[0] === cleanUrl));
    if(!exists){
      list.unshift({ url: cleanUrl, downloadUrl: downloadUrl||cleanUrl, ts: Date.now() });
      // Cap to last 500 entries
      while(list.length > 500) list.pop();
      localStorage.setItem(key, JSON.stringify(list));
    }
  } catch { /* ignore storage errors */ }
}
function handleProcessingComplete(payload){
  // Batch-aware completion: only mark Finished globally when all done
  if(multiRunTotalCount > 1){
    multiRunDoneCount = Math.min(multiRunTotalCount, multiRunDoneCount + 1);
    // reflect per-item completion but keep global state processing until batch completes
    const remaining = multiRunTotalCount - multiRunDoneCount;
    if(remaining > 0){
      // Keep status as Processing and show percent based on items done
      const pctByItems = Math.round((multiRunDoneCount / multiRunTotalCount) * 100);
      updateUnifiedStatus({ status:'processing', progress: { value: pctByItems, max: 100, type:'global_steps' }, stage: 'Batch progress' });
    }
  }
  const isBatchCompleted = multiRunTotalCount <= 1 ? true : (multiRunDoneCount >= multiRunTotalCount);
  if(isBatchCompleted){
    setStatus('Finished');
    updateProgressBar(100,'completed');
  }
  if(payload.outputImage){
    const ph=document.getElementById('outputPlaceholder');
    if(ph){ ph.style.display='none'; }
  // Update download control based on how many outputs are visible
  try{
    const gridImgs = Array.from(document.querySelectorAll('#outputGrid .output-item img'));
    const total = gridImgs.length + 1; // include the one being added
    const link = document.getElementById('downloadLink');
    if(link){
      const btn = link.querySelector('button');
      if(btn) btn.textContent = (total > 1) ? 'Download All' : 'Download';
      link.classList.remove('disabled');
      if(btn) btn.disabled = false;
      // Point to the latest for single; multiple handled by click handler
      link.setAttribute('href', payload.downloadUrl || payload.outputImage);
      link.setAttribute('download','');
    }
  }catch{}
    appendOutputThumb(payload.outputImage, payload.downloadUrl);
  addToLocalLibrary(payload.outputImage, payload.downloadUrl);
  // Show comparison if a preview source is available and advanced mode enabled
  try {
    const beforeSrc = (__persist && Array.isArray(__persist.selectedPreviewSources) && __persist.selectedPreviewSources[0] && __persist.selectedPreviewSources[0].src)
      || (document.querySelector('#multiPreviewContainer .multi-preview-item img')?.src);
    if(beforeSrc){ showComparison(beforeSrc, payload.outputImage); }
  } catch {}
    window.toast?.success('Processing complete');
  }
  // If multiple were queued, remove completed ID and keep polling next
  if(Array.isArray(activeRequestIds) && activeRequestIds.length>1 && payload.requestId){
    activeRequestIds = activeRequestIds.filter(id=> id!==payload.requestId);
    // Advance to next request id for live updates
    const nextId = activeRequestIds[0];
    if(nextId){ activeRequestId = nextId; joinStatusChannel(activeRequestId); pollStatus(); updateStatusUI({ status:'processing' }); }
  } else {
    activeRequestId=null;
    // Batch completed
    if(multiRunActive){ multiRunActive = false; }
  }
  __hasLiveProgressForActive = false;
  // Reset progress display to Idle shortly after finish
  try {
    // Only mark success visuals if entire batch is complete
    if(isBatchCompleted){
      const wrap = document.getElementById('processingProgressBarWrapper');
      const bar = document.getElementById('processingProgressBar');
      const label = document.getElementById('processingProgressLabel');
      if(wrap) wrap.classList.remove('idle');
      if(bar){ bar.style.width='100%'; bar.classList.add('success'); bar.classList.remove('error'); }
      if(label) label.textContent='Finished';
      // Global bar success state
      try{
        const gWrap = document.getElementById('globalProcessingProgressBarWrapper');
        const gBar = document.getElementById('globalProcessingProgressBar');
        const gLabel = document.getElementById('globalProcessingProgressLabel');
        if(gWrap) gWrap.classList.remove('idle');
        if(gBar){ gBar.style.width='100%'; gBar.classList.add('success'); gBar.classList.remove('error'); }
        if(gLabel) gLabel.textContent='Finished';
      }catch{}
      setUploadBusy(false);
      try{ if(allowConcurrentUploadCheckbox){ allowConcurrentUploadCheckbox.disabled = false; allowConcurrentUploadCheckbox.removeAttribute('title'); } }catch{}
    }
  } catch {}
}

// Cross-tab status sync: write compact progress into localStorage so other tabs update
(function setupCrossTabSync(){
  const key = 'nudeforge:status:v1';
  let lastStr = '';
  function publish(payload){
    try{
      const gWrap = document.getElementById('globalProcessingProgressBarWrapper');
      const gBar = document.getElementById('globalProcessingProgressBar');
      // Determine visual variant from current classes/state
      let variant = 'processing';
      if(gBar && gBar.classList.contains('error')) variant = 'error';
      else if(gBar && gBar.classList.contains('success')) variant = 'success';
      else if((gWrap && gWrap.classList.contains('idle'))) variant = 'idle';
      const obj = {
        ts: Date.now(),
        status: document.getElementById('processingStatus')?.textContent || '',
        pct: (function(){ const s=document.getElementById('globalProcessingProgressBar'); if(!s) return null; const w=s.style.width||''; const m=/^(\d+)%$/.exec(w); return m? Number(m[1]) : null; })(),
        variant,
        complete: !!(gBar && gBar.classList.contains('complete'))
      };
      const str = JSON.stringify(obj);
      if(str !== lastStr){ localStorage.setItem(key, str); lastStr = str; }
    }catch{}
  }
  // Hook into our existing update points
  const _origUpdateStatus = window.__nudeForge?.updateStatusUI || updateStatusUI;
  window.__nudeForge = Object.assign(window.__nudeForge||{}, {
    updateStatusUI: (p)=>{ _origUpdateStatus(p); try{ publish(p); }catch{} }
  });
  function applyFromData(data){
    try{
      const gWrap = document.getElementById('globalProcessingProgressBarWrapper');
      const gBar = document.getElementById('globalProcessingProgressBar');
      const gLabel = document.getElementById('globalProcessingProgressLabel');
      const statusEl = document.getElementById('processingStatus');
      if(statusEl && typeof data.status === 'string'){ statusEl.textContent = data.status; }
      if(typeof data.pct === 'number'){
        if(gBar){ gBar.style.width = data.pct + '%'; }
        if(gLabel){ gLabel.textContent = data.pct + '%'; }
        if(gWrap){ gWrap.classList.toggle('idle', data.pct === 0 || data.variant === 'idle'); }
      }
      // Apply color variant
      if(gBar){
        gBar.classList.remove('success','error');
        if(data.variant === 'success') gBar.classList.add('success');
        else if(data.variant === 'error') gBar.classList.add('error');
        // maintain/reflect completion state
        gBar.classList.toggle('complete', !!data.complete);
      }
    } catch {}
  }
  window.addEventListener('storage', (e)=>{
    if(e.key !== key || !e.newValue) return;
    try{ applyFromData(JSON.parse(e.newValue)); } catch {}
  });
  // Hydrate on load for newly opened tabs
  try{
    const raw = localStorage.getItem(key);
    if(raw){ applyFromData(JSON.parse(raw)); }
  }catch{}
})();

// === Comparison Slider Logic ===
let comparisonSliderInitialized = false;
function initComparisonSlider(){
  if(comparisonSliderInitialized) return;
  const container = document.getElementById('comparisonContainer');
  const slider = container && container.querySelector('.comparison-slider');
  const after = container && container.querySelector('.comparison-after');
  if(!container || !slider || !after) return;
  let dragging = false;
  function setFromClientX(clientX){
    const rect = container.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width; pct = Math.min(1, Math.max(0, pct));
    after.style.width = (pct*100)+'%';
    slider.style.left = (pct*100)+'%';
    try { __persist.comparisonSplitPct = Math.round(pct*100); } catch {}
  }
  function start(e){ dragging=true; slider.classList.add('active'); setFromClientX(e.touches? e.touches[0].clientX : e.clientX); e.preventDefault(); }
  function move(e){ if(!dragging) return; setFromClientX(e.touches? e.touches[0].clientX : e.clientX); }
  function end(){ dragging=false; slider.classList.remove('active'); try{ saveGeneratorState(); }catch{} }
  slider.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  slider.addEventListener('touchstart', start, { passive:false });
  window.addEventListener('touchmove', move, { passive:false });
  window.addEventListener('touchend', end);
  // Allow clicking container to reposition
  container.addEventListener('click', (e)=>{ if(e.target === slider) return; setFromClientX(e.clientX); });
  comparisonSliderInitialized = true;
}
function showComparison(beforeSrc, afterSrc){
  const placeholder = document.getElementById('comparisonPlaceholder');
  const container = document.getElementById('comparisonContainer');
  const beforeImg = document.getElementById('comparisonBeforeImg');
  const afterImg = document.getElementById('comparisonAfterImg');
  if(beforeImg && beforeSrc){ beforeImg.src = beforeSrc; beforeImg.style.display='block'; }
  if(afterImg && afterSrc){ afterImg.src = afterSrc + `?t=${Date.now()}`; afterImg.style.display='block'; }
  if(placeholder) placeholder.style.display='none';
  if(container) container.style.display='block';
  // Only show comparison section when Advanced mode is enabled
  const section = document.getElementById('comparisonSection');
  const enabled = advancedModeToggle && advancedModeToggle.checked;
  if(section) section.style.display = enabled ? 'block' : 'none';
  // Reset baseline positions
  const after = container && container.querySelector('.comparison-after');
  const slider = container && container.querySelector('.comparison-slider');
  const savedPct = (function(){ try{ const raw = localStorage.getItem('nudeforge:generatorState:v1'); if(raw){ const s=JSON.parse(raw); if(typeof s?.comparisonSplitPct === 'number') return s.comparisonSplitPct; } }catch{} return (typeof __persist?.comparisonSplitPct === 'number') ? __persist.comparisonSplitPct : null; })();
  const pctToApply = (typeof savedPct === 'number') ? savedPct : 50;
  if(after){ after.style.width=pctToApply+'%'; }
  if(slider){ slider.style.left=pctToApply+'%'; }
  initComparisonSlider();
}
// Expose for debugging
window.__nudeForge = Object.assign(window.__nudeForge||{}, { showComparison });

// Patch carousel retry logic
(function patchCarousel(){
  const originalInit = initializeCarousel;
  initializeCarousel = async function(){
    let attempts = 0; const maxAttempts = 5; const delay = ms=> new Promise(r=>setTimeout(r,ms));
    while(attempts < maxAttempts){
      attempts++;
      const before = Date.now();
      await originalInit();
      const slideContainer = document.querySelector('.carousel-slide');
      if(slideContainer && slideContainer.children.length>0){
        window.ClientLogger?.info('Carousel initialized with images', { attempts, duration: Date.now()-before });
        return;
      }
      window.ClientLogger?.warn('Carousel empty, retrying...', { attempt: attempts });
      await delay(500 * attempts); // backoff
    }
    window.ClientLogger?.error('Carousel failed to load images after retries');
  };
})();

// Cross-tab carousel sync: if another tab updates image list in cache, render without fetching
window.addEventListener('storage', (e)=>{
  try{
    if(e.key !== 'nudeforge:carousel-images:v1' || !e.newValue) return;
    const slideContainer = document.querySelector('.carousel-slide');
    if(!slideContainer) return;
    if(slideContainer.children.length>0) return; // already rendered
    const arr = JSON.parse(e.newValue);
    if(Array.isArray(arr) && arr.length){
      // Ensure our initializer runs again to render from cache
      if(typeof initializeCarousel === 'function'){
        // give DOM a tick
        setTimeout(()=>{ try{ carouselInitialized = false; initializeCarousel(); }catch{} }, 0);
      }
    }
  }catch{}
});

// Cross-tab carousel sync: if another tab updates image list in cache, render without fetching
window.addEventListener('storage', (e)=>{
  try{
    if(e.key !== 'nudeforge:carousel-images:v1' || !e.newValue) return;
    const slideContainer = document.querySelector('.carousel-slide');
    if(!slideContainer) return;
    if(slideContainer.children.length>0) return; // already rendered
    const arr = JSON.parse(e.newValue);
    if(Array.isArray(arr) && arr.length){
      // render quickly using initializeCarousel's cache path next tick
      carouselInitialized = false; // force re-run
      setTimeout(()=> initializeCarousel(), 0);
    }
  }catch{}
});

// Enhance LoRA initialization with loading / empty states
(function patchLoras(){
  const originalInit = initializeLoRAs;
  initializeLoRAs = async function(){
    const grid = document.getElementById('loraGrid');
    if(grid && !grid.querySelector('.lora-status')){
      grid.innerHTML = '<div class="lora-status" style="font-size:.8em;color:var(--color-text-dim);padding:.25rem .4rem;">Loading LoRAs...</div>';
    }
    await originalInit();
    // After init
    const modelsPresent = grid && grid.querySelectorAll('.lora-row').length>0;
    if(grid && !modelsPresent){
      grid.innerHTML = '<div class="lora-status empty" style="font-size:.8em;color:var(--color-danger);padding:.3rem .4rem;">No LoRA models found.</div>';
    }
  };
})();

// Replace LoRA initialization block to support subdirectories
(function upgradeLoraLoader(){
  // (original createLoraRow preserved implicitly if needed)
  function flattenDetailed(result){
    const out=[];
    if(result.root){
      result.root.forEach(r=> out.push({ displayName:r.displayName, relativePath:r.relativePath||r.filename, filename:r.filename }));
    }
    function walkSub(obj, prefix=''){
      Object.keys(obj||{}).forEach(key=>{
        const val = obj[key];
        if(Array.isArray(val)){
          val.forEach(r=> out.push({ displayName: `${key}/${r.displayName}`, relativePath: r.relativePath|| (prefix? `${prefix}/${r.filename}`: r.filename), filename:r.filename }));
        } else if(typeof val === 'object'){ // nested folder
          walkSub(val, prefix? `${prefix}/${key}`: key);
        }
      });
    }
    walkSub(result.subdirs||{}, '');
    // De-duplicate by relativePath
    const seen = new Set();
    return out.filter(m=>{ if(seen.has(m.relativePath)) return false; seen.add(m.relativePath); return true; })
              .sort((a,b)=> a.displayName.localeCompare(b.displayName));
  }

  // Override initializeLoRAs
  const prevInit = initializeLoRAs; // kept for potential future use
  void prevInit; // reference to avoid unused warning
  initializeLoRAs = async function(){
    if(lorasLoaded) return; // reuse existing guard
    const grid = document.getElementById('loraGrid');
    const addBtn = document.getElementById('addLoraBtn');
    if(!grid) return;
    try {
      // Cache-first: use localStorage to avoid re-scanning across tabs
      const cacheKey = 'nudeforge:loras:v1';
      const getCached = () => { try{ const raw = localStorage.getItem(cacheKey); if(!raw) return null; const obj = JSON.parse(raw); if(obj && Array.isArray(obj.models) && obj.models.length){ return obj.models; } }catch{} return null; };
      const setCached = (models) => { try{ localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), models })); }catch{} };
      const cached = getCached();
      if(Array.isArray(cached) && cached.length){
        grid.innerHTML='';
        populateInitialLoRAEntryDetailed(grid, cached);
        if(addBtn){ addBtn.addEventListener('click', ()=> addLoRAEntryDetailed(grid, cached)); }
        lorasLoaded = true;
        window.ClientLogger?.info('Loaded LoRAs from cache', { count: cached.length });
        return;
      }
      // show loading state then fetch once
      grid.innerHTML = '<div class="lora-status" style="font-size:.8em;color:var(--color-text-dim);padding:.25rem .4rem;">Loading LoRAs...</div>';
      const res = await fetch('/api/loras/detailed');
      if(!res.ok) throw new Error('Failed to fetch detailed LoRAs');
      const data = await res.json();
      if(!data.success) throw new Error('Detailed LoRA API returned failure');
      const models = flattenDetailed(data.loras||{ root:[], subdirs:{} });
      if(models.length===0){
        grid.innerHTML = '<div class="lora-status empty" style="font-size:.8em;color:var(--color-danger);padding:.3rem .4rem;">No LoRA models found.</div>';
        lorasLoaded = true; return; }
      setCached(models);
      grid.innerHTML='';
      populateInitialLoRAEntryDetailed(grid, models);
      if(addBtn){ addBtn.addEventListener('click', ()=> addLoRAEntryDetailed(grid, models)); }
      lorasLoaded = true;
      window.ClientLogger?.info('Loaded LoRAs (with subdirs)', { count: models.length });
    } catch(e){
  window.ClientLogger?.error('Failed to initialize detailed LoRAs', e);
    }
  };

  // New row creators using relativePath
  function createLoraRowDetailed(index, models){
    const row = document.createElement('div'); row.className='lora-row';
    const main = document.createElement('div'); main.className='lora-main';
    const modelContainer = document.createElement('div'); modelContainer.className='lora-model-container';
    const select = document.createElement('select'); select.name = `lora_${index}_model`; select.className='lora-model-select';
    const emptyOpt = document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent='-- Select LoRA --'; select.appendChild(emptyOpt);
    models.forEach(m=>{ const opt=document.createElement('option'); opt.value=m.relativePath||m.filename; opt.textContent=m.displayName; select.appendChild(opt); });
    modelContainer.appendChild(select);
    const enableLabel = document.createElement('label'); enableLabel.style.display='flex'; enableLabel.style.alignItems='center'; enableLabel.style.gap='.3em';
    const enableCheckbox = document.createElement('input'); enableCheckbox.type='checkbox'; enableCheckbox.name=`lora_${index}_on`;
    enableLabel.appendChild(enableCheckbox); enableLabel.appendChild(document.createTextNode('Enable'));
    const strengthGroup = document.createElement('div'); strengthGroup.className='lora-strength-group';
    const strengthLabel = document.createElement('label'); strengthLabel.textContent='Strength:'; strengthLabel.style.fontSize='.8em';
    const strengthInput = document.createElement('input'); strengthInput.type='number'; strengthInput.step='0.05'; strengthInput.min='0'; strengthInput.max='2'; strengthInput.value='1.0'; strengthInput.name=`lora_${index}_strength`; strengthInput.className='lora-strength';
    strengthGroup.appendChild(strengthLabel); strengthGroup.appendChild(strengthInput);
    main.appendChild(modelContainer); main.appendChild(enableLabel); main.appendChild(strengthGroup);
    const controls = document.createElement('div'); controls.className='lora-row-controls';
    const removeBtn = document.createElement('button'); removeBtn.type='button'; removeBtn.textContent='×'; removeBtn.className='lora-remove-btn';
    removeBtn.addEventListener('click', ()=> row.remove());
    controls.appendChild(removeBtn);
    row.appendChild(main); row.appendChild(controls);
    return { row, select, enableCheckbox };
  }
  function populateInitialLoRAEntryDetailed(grid, models){
    const { row, select, enableCheckbox } = createLoraRowDetailed(1, models);
    grid.appendChild(row);
    const target = models.find(m => /change\s*clothes\s*to\s*nothing/i.test(m.displayName));
    if(target){ select.value = target.relativePath||target.filename; enableCheckbox.checked = true; }
  }
  function addLoRAEntryDetailed(grid, models){
    const existing = grid.querySelectorAll('.lora-row').length; const idx = existing + 1; const { row } = createLoraRowDetailed(idx, models); grid.appendChild(row); }

  // Expose debug
  window.__nudeForge = Object.assign(window.__nudeForge||{}, { flattenDetailedLoras: flattenDetailed });
})();

// Cross-tab LoRA cache hydration: render from cached list if present and grid is empty
window.addEventListener('DOMContentLoaded', ()=>{
  try{
    const grid = document.getElementById('loraGrid');
    if(!grid) return;
    if(grid.querySelector('.lora-row')) return; // already populated
    const raw = localStorage.getItem('nudeforge:loras:v1');
    if(!raw) return;
    const obj = JSON.parse(raw);
    const models = obj && Array.isArray(obj.models) ? obj.models : [];
    if(models.length){
      grid.innerHTML='';
      populateInitialLoRAEntryDetailed(grid, models);
      const addBtn = document.getElementById('addLoraBtn');
      if(addBtn){ addBtn.addEventListener('click', ()=> addLoRAEntryDetailed(grid, models)); }
      // do not flip lorasLoaded here to allow future refresh if needed; we only hydrate UI
    }
  }catch{}
});

window.addEventListener('storage', (e)=>{
  try{
    if(e.key !== 'nudeforge:loras:v1' || !e.newValue) return;
    const grid = document.getElementById('loraGrid'); if(!grid) return;
    if(grid.querySelector('.lora-row')) return; // already filled
    const obj = JSON.parse(e.newValue);
    const models = obj && Array.isArray(obj.models) ? obj.models : [];
    if(models.length){
      grid.innerHTML='';
      populateInitialLoRAEntryDetailed(grid, models);
      const addBtn = document.getElementById('addLoraBtn');
      if(addBtn){ addBtn.addEventListener('click', ()=> addLoRAEntryDetailed(grid, models)); }
    }
  }catch{}
});

// Define globally referenced helpers (previously inside IIFE)
function clearSelectedFiles(){
  selectedFiles = [];
  if(multiPreviewContainer){ multiPreviewContainer.innerHTML=''; multiPreviewContainer.style.display='none'; }
  updateDropPlaceholder();
}
function updateUploadButtonState(){
  if(!uploadButton) return;
  uploadButton.disabled = selectedFiles.length === 0;
  uploadButton.textContent = selectedFiles.length > 1 ? `Upload All (${selectedFiles.length})` : 'Upload';
  uploadButton.classList.toggle('disabled', !!uploadButton.disabled);
}
// --- END ORIGINAL CONTENT ---
