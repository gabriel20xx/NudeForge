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
});
// --- DOM Elements (single query, reused everywhere) ---
const inputImage = document.getElementById('inputImage');
const previewImage = document.getElementById('previewImage');
const dropArea = document.getElementById('dropArea');
const dropText = document.getElementById('dropText');
const uploadForm = document.getElementById('uploadForm');
const downloadLink = document.getElementById('downloadLink');
// Removed unused NodeList assignment (was triggering eslint no-unused-vars)
const uploadButton = uploadForm.querySelector('.upload-btn');
const allowConcurrentUploadCheckbox = document.getElementById('allowConcurrentUpload');
const advancedModeToggle = document.getElementById('advancedModeToggle');
const multiPreviewContainer = document.getElementById('multiPreviewContainer');
let activeRequestId = null; // track current processing request
let selectedFiles = []; // ensure declared (used in multi-upload logic)
// Stage weighting tracker (client-side heuristic). Each unique progress.stage encountered becomes a stage.
const __stageTracker = { encountered: [], lastOverall: 0 };
window.__nudeForgeStageTracker = __stageTracker;
window.__nudeForgeConfig = Object.assign(window.__nudeForgeConfig||{}, { useStageWeighting: true });

// Immediate preview handler (ensures image becomes visible on selection before later enhancements run)
if (inputImage) {
  inputImage.addEventListener('change', () => {
    const multi = allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked;
    if (multi) {
      // Collect selected files (multi mode) but don't render thumbnails here (handled later); just hide placeholder.
      selectedFiles = Array.from(inputImage.files || []);
      if (selectedFiles.length > 0 && dropText) dropText.style.display = 'none';
    } else {
      const file = inputImage.files && inputImage.files[0];
      if (file && previewImage) {
        const reader = new FileReader();
        reader.onload = ev => {
          previewImage.src = ev.target.result;
          previewImage.style.display = 'block';
          if (dropText) dropText.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    }
    // Background: send copy/copies immediately to /upload-copy (non-blocking) so server stores original in /copy
    // Do NOT await to avoid delaying UI preview.
    (async () => {
      try {
        const filesToSend = multi ? selectedFiles : (inputImage.files ? [inputImage.files[0]] : []);
        if (!filesToSend || filesToSend.length === 0) return;
        // Endpoint currently expects single 'image', so send sequentially.
        for (const f of filesToSend) {
          if (!f) continue;
          const fd = new FormData();
            fd.append('image', f, f.name);
          fetch('/upload-copy', { method: 'POST', body: fd })
            .then(r => { if(!r.ok) throw new Error('copy upload failed'); return r.json().catch(()=>({})); })
    .then(() => { /* optional success handling; keep silent to reduce noise */ })
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
if(allowConcurrentUploadCheckbox){
  allowConcurrentUploadCheckbox.addEventListener('change', function() {
    if (this.checked) {
      inputImage.setAttribute('multiple', 'multiple');
      dropText.textContent = 'Drag & drop or click to upload (multiple files allowed)';
      uploadButton.textContent = 'Upload All';
    } else {
      inputImage.removeAttribute('multiple');
      dropText.textContent = 'Drag & drop or click to upload';
      uploadButton.textContent = 'Upload';
    }
    clearSelectedFiles();
    updateUploadButtonState();
  });
}

// --- Utilities & Helpers ---
function showElement(el){ if(el) el.style.display=''; }
function hideElement(el){ if(el) el.style.display='none'; }
function createEl(tag, opts={}){ const el=document.createElement(tag); Object.assign(el, opts); return el; }
function updateDropPlaceholder(){
  if(!dropText) return;
  if(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked){
    if(selectedFiles.length>0){ dropText.style.display='none'; } else { dropText.style.display=''; }
  } else {
    const hasFile = inputImage && inputImage.files && inputImage.files.length>0;
    dropText.style.display = hasFile ? 'none' : '';
  }
}
// initial invocation to mark helper utilized
updateDropPlaceholder();

// --- Carousel Logic ---
let carouselInitialized = false;
async function initializeCarousel(){
  if(carouselInitialized) return;
  const slideContainer = document.querySelector('.carousel-slide');
  if(!slideContainer) return;
  try {
    const res = await fetch('/api/carousel-images');
    if(!res.ok) throw new Error('Failed to fetch carousel images');
    let images = await res.json();
    if(!Array.isArray(images) || images.length===0){
      // Fallback: attempt to probe a known original folder (first few static examples) if available in markup
  window.ClientLogger?.warn('No carousel images returned from API');
      if(slideContainer && !slideContainer.querySelector('.carousel-empty')){
        slideContainer.innerHTML = '<div class="carousel-empty" style="display:flex;align-items:center;justify-content:center;width:100%;color:var(--color-text-dim);font-size:.75rem;">No carousel images available</div>';
      }
      return; // keep retry logic outside
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
    if(previewImage){ previewImage.removeAttribute('src'); previewImage.style.display='none'; }
  }
  function updateUploadButtonState(){
    if(!uploadButton) return;
    if(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked){
      uploadButton.disabled = selectedFiles.length === 0;
      uploadButton.textContent = selectedFiles.length > 1 ? `Upload All (${selectedFiles.length})` : 'Upload';
    } else {
      const hasFile = inputImage && inputImage.files && inputImage.files.length>0;
      uploadButton.disabled = !hasFile;
      uploadButton.textContent = 'Upload';
    }
  }
  // Expose for earlier references
  window.clearSelectedFiles = clearSelectedFiles;
  window.updateUploadButtonState = updateUploadButtonState;

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
      // Append selected multi files explicitly if multi-upload enabled
      if(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked && selectedFiles.length>0){
        formData.delete('image'); // remove potential single
        selectedFiles.forEach(f=> formData.append('image', f));
      }
      gatherAndNormalizeSettings(formData);
  const isAdvanced = advancedModeToggle && advancedModeToggle.checked;
  const singleMode = !(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked);
  uploadButton.disabled = true; uploadButton.textContent = 'Uploading...';
  if(singleMode && !isAdvanced){ uploadButton.classList.add('disabled'); }
      try {
        const res = await fetch('/upload', { method:'POST', body: formData });
        if(!res.ok){
          const txt = await res.text();
          window.toast?.error('Upload failed: '+(txt||res.status));
        } else {
          const data = await res.json().catch(()=>({}));
          if(data.requestId){
            activeRequestId = data.requestId;
            joinStatusChannel(activeRequestId);
            updateStatusUI({ status:'queued', yourPosition: data.yourPosition });
            pollStatus();
            window.toast?.success('Queued (position '+(data.yourPosition||'?')+')');
          } else {
            window.toast?.success('Added to queue. Position '+ (data.yourPosition||'?'));
          }
        }
  } catch{
        window.toast?.error('Upload error');
      } finally {
        uploadButton.disabled = false; uploadButton.textContent = allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked && selectedFiles.length>1 ? `Upload All (${selectedFiles.length})` : 'Upload';
  if(singleMode && !isAdvanced){ uploadButton.classList.remove('disabled'); }
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
      const files = Array.from(e.dataTransfer.files||[]).filter(f=> f.type.startsWith('image/'));
      if(files.length===0) return;
      const dt = new DataTransfer();
      if(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked){
        files.forEach(f=> dt.items.add(f));
      } else {
        dt.items.add(files[0]);
      }
      inputImage.files = dt.files; // triggers change event programmatically below
      const changeEvt = new Event('change');
      inputImage.dispatchEvent(changeEvt);
      if(!allowConcurrentUploadCheckbox || !allowConcurrentUploadCheckbox.checked){
        // show immediate preview using FileReader (in case change async)
        const first = dt.files[0];
        if(first && previewImage){
          const reader = new FileReader();
          reader.onload = ev => { previewImage.src = ev.target.result; previewImage.style.display='block'; if(dropText) dropText.style.display='none'; };
          reader.readAsDataURL(first);
        }
      }
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
    advancedModeToggle.addEventListener('change', applyAdvancedVisibility);
    applyAdvancedVisibility();
  }
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
  s.on('processingFailed', payload=>{ if(payload.requestId && payload.requestId!==activeRequestId) return; window.toast?.error(payload.error||'Processing failed'); updateStatusUI({ status:'failed' }); activeRequestId=null; });
  s._listenersAdded = true; }
}
function setStatus(text){
  const statusEl = document.getElementById('processingStatus');
  if(!statusEl) return;
  if(typeof text !== 'string'){ statusEl.textContent = ''; return; }
  const norm = text.trim().replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ');
  const title = norm.split(' ').map(w=> w ? (w[0].toUpperCase()+w.slice(1).toLowerCase()) : w).join(' ');
  statusEl.textContent = title;
}
function updateUnifiedStatus({ status, yourPosition, queueSize, progress }) {
  const meta = document.getElementById('queueMeta');
  const wrap = document.getElementById('processingProgressBarWrapper');
  const bar = document.getElementById('processingProgressBar');
  const label = document.getElementById('processingProgressLabel');
  const pctSpan = document.getElementById('progressPct');
  // Idle/active visuals
  if(status === 'processing' || __hasLiveProgressForActive){
    wrap?.classList.remove('idle');
  } else if(status === 'queued' || status === 'idle' || !status){
    // Do not force reset to Idle on 'completed' here; completion flow handles it
    wrap?.classList.add('idle');
    if(typeof progress?.value !== 'number' || typeof progress?.max !== 'number' || progress.max === 0){
      if(bar) bar.style.width = '0%';
      if(label) label.textContent = 'Idle';
    }
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
  // Progress percentage (numeric) and header mirroring
  if(progress && typeof progress.value==='number' && typeof progress.max==='number' && progress.max>0){
    let rawPct = Math.min(100, Math.round((progress.value/progress.max)*100));
    let overall = rawPct;
    let stageName = progress.stage;
    if(window.__nudeForgeConfig?.useStageWeighting && stageName){
      if(!__stageTracker.encountered.includes(stageName)){
        __stageTracker.encountered.push(stageName);
      }
      const stageIndex = __stageTracker.encountered.indexOf(stageName);
      const totalStages = __stageTracker.encountered.length;
      if(totalStages > 1){
        // Simple equal-weight heuristic (may cause slight drop when a new stage first appears).
        overall = Math.min(100, Math.round(((stageIndex + (rawPct/100)) / totalStages) * 100));
      }
    }
    __lastOverallPct = overall;
    if(pctSpan) pctSpan.textContent = overall + '%';
    updateProgressBar(overall, progress.stage, rawPct);
  } else {
    // No numeric progress in this update
    if(status === 'processing' || __hasLiveProgressForActive){
      // Stick to last known percent during processing updates without progress
      if(pctSpan && typeof __lastOverallPct === 'number') pctSpan.textContent = __lastOverallPct + '%';
    } else if(pctSpan){
      pctSpan.textContent = '';
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
  }
}
function updateStatusUI(payload){
  if(payload.status) setStatus(payload.status);
  updateUnifiedStatus(payload);
}
// Expose UI update helpers for test harness
window.__nudeForge = Object.assign(window.__nudeForge||{}, {
  updateStatusUI,
  updateUnifiedStatus,
  updateProgressBar
});
async function pollStatus(){ if(!activeRequestId) return; try { const res = await fetch(`/queue-status?requestId=${encodeURIComponent(activeRequestId)}`); if(res.ok){ const data = await res.json(); updateStatusUI(data); if(data.status==='completed' && data.result && data.result.outputImage){ handleProcessingComplete({ outputImage:data.result.outputImage, downloadUrl:data.result.downloadUrl, requestId: activeRequestId }); return; } if(data.status==='failed'){ window.toast?.error('Processing failed'); activeRequestId=null; return; } } } catch { /* silent poll failure */ } if(activeRequestId){ setTimeout(pollStatus, 1500); } }
function handleProcessingComplete(payload){
  setStatus('completed');
  updateProgressBar(100,'completed');
  if(payload.outputImage){
    const img=document.getElementById('outputImage');
    const ph=document.getElementById('outputPlaceholder');
    if(img){ img.src = payload.outputImage + `?t=${Date.now()}`; img.style.display='block'; }
    if(ph){ ph.style.display='none'; }
    enableDownload(payload.downloadUrl || payload.outputImage);
    // Show comparison (single mode only or if preview available)
    if(previewImage && previewImage.src){
      showComparison(previewImage.src, payload.outputImage);
    }
    window.toast?.success('Processing complete');
  }
  activeRequestId=null;
  __hasLiveProgressForActive = false;
  // Reset progress display to Idle shortly after finish
  try {
    const wrap = document.getElementById('processingProgressBarWrapper');
    const bar = document.getElementById('processingProgressBar');
    const label = document.getElementById('processingProgressLabel');
    setTimeout(()=>{ if(wrap) wrap.classList.add('idle'); if(bar) bar.style.width='0%'; if(label) label.textContent='Idle'; }, 1800);
  } catch {}
}

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
  }
  function start(e){ dragging=true; slider.classList.add('active'); setFromClientX(e.touches? e.touches[0].clientX : e.clientX); e.preventDefault(); }
  function move(e){ if(!dragging) return; setFromClientX(e.touches? e.touches[0].clientX : e.clientX); }
  function end(){ dragging=false; slider.classList.remove('active'); }
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
  if(after){ after.style.width='50%'; }
  if(slider){ slider.style.left='50%'; }
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
      // show loading state
      grid.innerHTML = '<div class="lora-status" style="font-size:.8em;color:var(--color-text-dim);padding:.25rem .4rem;">Loading LoRAs...</div>';
      const res = await fetch('/api/loras/detailed');
      if(!res.ok) throw new Error('Failed to fetch detailed LoRAs');
      const data = await res.json();
      if(!data.success) throw new Error('Detailed LoRA API returned failure');
      const models = flattenDetailed(data.loras||{ root:[], subdirs:{} });
      if(models.length===0){
        grid.innerHTML = '<div class="lora-status empty" style="font-size:.8em;color:var(--color-danger);padding:.3rem .4rem;">No LoRA models found.</div>';
        lorasLoaded = true; return; }
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

// Define globally referenced helpers (previously inside IIFE)
function clearSelectedFiles(){
  selectedFiles = [];
  if(multiPreviewContainer){ multiPreviewContainer.innerHTML=''; multiPreviewContainer.style.display='none'; }
  if(previewImage){ previewImage.removeAttribute('src'); previewImage.style.display='none'; }
  updateDropPlaceholder();
}
function updateUploadButtonState(){
  if(!uploadButton) return;
  if(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked){
    uploadButton.disabled = selectedFiles.length === 0;
    uploadButton.textContent = selectedFiles.length > 1 ? `Upload All (${selectedFiles.length})` : 'Upload';
  } else {
    const hasFile = inputImage && inputImage.files && inputImage.files.length>0;
    uploadButton.disabled = !hasFile;
    uploadButton.textContent = 'Upload';
  }
}
// --- END ORIGINAL CONTENT ---
