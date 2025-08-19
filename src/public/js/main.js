// NudeForge main.js (migrated from legacy /public/js/main.js). Full functionality retained.
// NOTE: This file replaces the previous bridge import and is now the canonical frontend script.
// --- BEGIN ORIGINAL CONTENT ---
// main.js: Handles upload button state for UX
// --- Download Button Helpers ---
function disableDownload() {
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
// --- CAPTCHA Logic (moved from index.ejs) ---
// Fetch and display advanced SVG CAPTCHA
async function fetchCaptcha() {
	const captchaContainer = document.getElementById('captchaContainer');
	const captchaImage = document.getElementById('captchaImage');
	const captchaToken = document.getElementById('captcha_token');
	const captchaAnswer = document.getElementById('captcha_answer');
	if (captchaAnswer) captchaAnswer.value = '';
	try {
		const res = await fetch('/captcha');
		if (!res.ok) throw new Error('Failed to fetch CAPTCHA');
		const data = await res.json();
		if (captchaImage) captchaImage.innerHTML = data.image;
		if (captchaToken) captchaToken.value = data.token;
	} catch (e) {
		if (captchaImage) captchaImage.innerHTML = '<span style="color:#ff4d4d">Failed to load CAPTCHA</span>';
		if (captchaToken) captchaToken.value = '';
	}
}

// Fetch captchaDisabled from API and show/hide CAPTCHA accordingly
let captchaDisabled = false;
async function checkCaptchaStatusAndInit() {
	const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
	try {
		const res = await fetch('/api/captcha-status');
		if (res.ok) {
			const data = await res.json();
			captchaDisabled = !!data.captchaDisabled;
		}
	} catch (e) {
		captchaDisabled = false;
	}
	const captchaContainer = document.getElementById('captchaContainer');
	const captchaAnswer = document.getElementById('captcha_answer');
	if (captchaContainer) {
		if (isLocal || captchaDisabled) {
			captchaContainer.style.display = 'none';
			if (captchaAnswer) captchaAnswer.removeAttribute('required');
		} else {
			captchaContainer.style.display = '';
			if (captchaAnswer) captchaAnswer.setAttribute('required', 'required');
		}
	}
	if (!isLocal && !captchaDisabled) fetchCaptcha();
    
	// Initialize comparison section - show placeholder, hide container
	const comparisonPlaceholder = document.getElementById('comparisonPlaceholder');
	const comparisonContainer = document.getElementById('comparisonContainer');
	showElement(comparisonPlaceholder);
	hideElement(comparisonContainer);
}

window.addEventListener('DOMContentLoaded', async function() {
	await checkCaptchaStatusAndInit();
	await initializeLoRAs();
	initializeCarousel();
	// Show header options (advanced features) if URL parameter is present
	const urlParams = new URLSearchParams(window.location.search);
	const headerOptions = document.querySelector('.header-options');
	if (urlParams.get('advanced') === 'true' && headerOptions) {
		headerOptions.style.display = 'block';
	} else if (headerOptions) {
		headerOptions.style.display = 'none';
	}
});
// --- DOM Elements (single query, reused everywhere) ---
const inputImage = document.getElementById('inputImage');
const previewImage = document.getElementById('previewImage');
const dropArea = document.getElementById('dropArea');
const dropText = document.getElementById('dropText');
const uploadForm = document.getElementById('uploadForm');
const outputImage = document.getElementById('outputImage');
const outputPlaceholder = document.getElementById('outputPlaceholder');
const downloadLink = document.getElementById('downloadLink');
const queueSizeSpan = document.getElementById('queueSize');
const processingStatusSpan = document.getElementById('processingStatus');
const progressPercentageSpans = document.querySelectorAll('.progressPercentage');
const uploadButton = uploadForm.querySelector('.upload-btn');
const allowConcurrentUploadCheckbox = document.getElementById('allowConcurrentUpload');
const multiPreviewContainer = document.getElementById('multiPreviewContainer');

// Global variable to store the uploaded copy filename for comparison
let uploadedCopyFilename = null;
// Global variable to store the main upload filename for comparison
let mainUploadFilename = null;
// Global variable to store selected files for multi-upload
let selectedFiles = [];

// Add event listener for concurrent upload checkbox to toggle multiple file selection
if (allowConcurrentUploadCheckbox) {
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
      if(window.ClientLogger) ClientLogger.warn('No carousel images returned from API');
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
    let scrollPos = 0;
    function tick(){
      const totalWidth = Array.from(slideContainer.children).reduce((acc,el)=>acc+el.getBoundingClientRect().width,0);
      if(totalWidth <= 0) return requestAnimationFrame(tick);
      scrollPos += 0.3;
      if(scrollPos >= totalWidth) scrollPos = 0;
      slideContainer.style.transform = `translateX(${-scrollPos}px)`;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    carouselInitialized = true;
  } catch(err){
  if(window.ClientLogger) ClientLogger.error('Carousel init failed', err);
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
    lorasLoaded = true;
  } catch(e){
    if(window.ClientLogger) ClientLogger.error('Failed to initialize LoRAs', e);
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
  if(inputImage){
    inputImage.addEventListener('change', ()=>{
      if(allowConcurrentUploadCheckbox && allowConcurrentUploadCheckbox.checked){
        selectedFiles = Array.from(inputImage.files||[]);
        if(selectedFiles.length>0 && multiPreviewContainer){
          multiPreviewContainer.style.display='flex';
          multiPreviewContainer.innerHTML='';
          selectedFiles.forEach(file=>{
            const reader = new FileReader();
            reader.onload = ev => {
              const img = document.createElement('img');
              img.src = ev.target.result; img.alt=file.name; img.style.maxWidth='90px'; img.style.objectFit='cover'; img.style.borderRadius='6px'; img.style.margin='4px';
              multiPreviewContainer.appendChild(img);
            }; reader.readAsDataURL(file);
          });
        }
      } else {
        // Single preview
        const file = inputImage.files && inputImage.files[0];
        if(file && previewImage){
          const reader = new FileReader();
            reader.onload = ev => { previewImage.src = ev.target.result; previewImage.style.display='block'; };
            reader.readAsDataURL(file);
        }
      }
      updateUploadButtonState();
    });
  }
})();

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
        if(window.ClientLogger) ClientLogger.info('Carousel initialized with images', { attempts, duration: Date.now()-before });
        return;
      }
      if(window.ClientLogger) ClientLogger.warn('Carousel empty, retrying...', { attempt: attempts });
      await delay(500 * attempts); // backoff
    }
    if(window.ClientLogger) ClientLogger.error('Carousel failed to load images after retries');
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
  const originalCreateLoraRow = createLoraRow; // preserve if needed
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
  const prevInit = initializeLoRAs;
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
      if(window.ClientLogger) ClientLogger.info('Loaded LoRAs (with subdirs)', { count: models.length });
    } catch(e){
      if(window.ClientLogger) ClientLogger.error('Failed to initialize detailed LoRAs', e);
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
// ...existing code...
// --- END ORIGINAL CONTENT ---
