
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
    
    // Show advanced upload options if URL parameter is present
    const urlParams = new URLSearchParams(window.location.search);
    const uploadOptions = document.getElementById('uploadOptions');
    if (urlParams.get('advanced') === 'true' && uploadOptions) {
        uploadOptions.style.display = 'block';
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
            // Clear multiple selection if switching back to single mode
            selectedFiles = [];
            hideMultiPreview();
        }
    });
}

// --- Helper functions for show/hide ---
function debugLog(...args) {
    // Use the new Logger for debug messages
    Logger.debug('FRONTEND', ...args);
}
function showElement(el) {
    if (el) {
        el.style.display = 'block';
        debugLog('Show element:', el.id || el.className || el);
    }
}
function hideElement(el) {
    if (el) {
        el.style.display = 'none';
        debugLog('Hide element:', el.id || el.className || el);
    }
}

// --- Centralized upload button state ---
function setUploadButtonState({ disabled, text }) {
    if (!uploadButton) {
        debugLog('Upload button not found');
        return;
    }
    uploadButton.disabled = !!disabled;
    if (disabled) {
        uploadButton.classList.add('disabled');
    } else {
        uploadButton.classList.remove('disabled');
    }
    if (typeof text === 'string') uploadButton.textContent = text;
    debugLog('Set upload button state:', { disabled, text });
}

// --- Multi-file preview functions ---
function showMultiPreview(files) {
    if (!multiPreviewContainer) return;
    
    debugLog('showMultiPreview called with files:', files);
    
    multiPreviewContainer.innerHTML = '';
    multiPreviewContainer.style.display = 'grid';
    hideElement(previewImage);
    hideElement(dropText);
    
    selectedFiles = Array.from(files);
    debugLog('selectedFiles array:', selectedFiles);
    
    // Update upload button text to show count
    if (uploadButton) {
        uploadButton.textContent = `Upload All (${selectedFiles.length})`;
    }
    
    selectedFiles.forEach((file, index) => {
        debugLog(`Processing file ${index}:`, file.name, file.type);
        
        const previewItem = document.createElement('div');
        previewItem.className = 'multi-preview-item';
        previewItem.dataset.index = index;
        
        const img = document.createElement('img');
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = file.name;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-file';
        removeBtn.innerHTML = '×';
        removeBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeFileFromSelection(index);
        };
        
        const reader = new FileReader();
        reader.onload = (e) => {
            debugLog(`Image loaded for file ${index}:`, file.name);
            img.src = e.target.result;
            img.style.display = 'block';
        };
        reader.onerror = (e) => {
            console.error('Error reading file:', file.name, e);
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwIiB5PSI1MCIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEyIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVycm9yPC90ZXh0Pjwvc3ZnPg==';
            img.style.display = 'block';
        };
        
        // Only read as data URL if it's actually an image file
        if (file.type && file.type.startsWith('image/')) {
            debugLog(`Reading image file ${index}:`, file.name, file.type);
            reader.readAsDataURL(file);
        } else {
            debugLog(`Non-image file ${index}:`, file.name, file.type);
            // For non-image files, show a placeholder
            img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iIzIzMjcyZiIgc3Ryb2tlPSIjZmZiODRkIiBzdHJva2Utd2lkdGg9IjIiLz48dGV4dCB4PSI1MCIgeT0iNDAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMCIgZmlsbD0iI2ZmYjg0ZCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RklMRTwvdGV4dD48dGV4dCB4PSI1MCIgeT0iNjAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSI4IiBmaWxsPSIjZmZiODRkIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj4oTm90IGFuIGltYWdlKTwvdGV4dD48L3N2Zz4=';
            img.style.display = 'block';
        }
        
        previewItem.appendChild(img);
        previewItem.appendChild(fileName);
        previewItem.appendChild(removeBtn);
        multiPreviewContainer.appendChild(previewItem);
        
        debugLog(`Added preview item ${index} to container`);
    });
    
    debugLog('Multi-preview setup complete, container children:', multiPreviewContainer.children.length);
}

function hideMultiPreview() {
    if (multiPreviewContainer) {
        multiPreviewContainer.style.display = 'none';
        multiPreviewContainer.innerHTML = '';
    }
    showElement(dropText);
}

function removeFileFromSelection(index) {
    selectedFiles.splice(index, 1);
    
    if (selectedFiles.length === 0) {
        hideMultiPreview();
        inputImage.value = ''; // Clear the input
        if (uploadButton) {
            uploadButton.textContent = 'Upload All';
        }
    } else {
        // Recreate the FileList (this is a bit tricky as FileList is read-only)
        const dt = new DataTransfer();
        selectedFiles.forEach(file => dt.items.add(file));
        inputImage.files = dt.files;
        showMultiPreview(selectedFiles);
    }
}

function showSinglePreview(file) {
    hideElement(multiPreviewContainer);
    showElement(previewImage);
    hideElement(dropText);
    
    const reader = new FileReader();
    reader.onload = (e) => {
        previewImage.src = e.target.result;
        showElement(previewImage);
    };
    reader.readAsDataURL(file);
}

// State Variables
let currentRequestId = null;
let pollingIntervalId = null;

// --- Socket.IO Setup ---
const socket = io();
debugLog('Socket.IO initialized');

socket.on('connect', () => {
    debugLog('Socket connected');
    if (currentRequestId) {
        debugLog('Joining room for requestId:', currentRequestId);
        socket.emit('joinRoom', currentRequestId);
    }
});

// Helper to update all progress percentage spans
function updateProgressPercentage(text) {
    progressPercentageSpans.forEach(span => {
        span.textContent = text;
    });
    debugLog('Progress percentage updated:', text);
}

// Listen for processing progress updates from the server (highest priority)
socket.on('processingProgress', (progress) => {
    debugLog('Received processingProgress:', progress);
    let percentage;
    try {
        if (progress.type === "global_steps") {
            percentage = Math.round((progress.value / progress.max) * 100);
        } else {
            percentage = Math.round((progress.value / progress.max) * 100);
        }
    } catch (err) {
        Logger.error('PROGRESS', 'Error calculating progress percentage:', err, progress);
        return;
    }
    if (isNaN(percentage)) {
        debugLog('Progress percentage is NaN, skipping update.');
        return;
    }
    updateProgressPercentage(`: ${percentage}%`);
    // Use detailed status for header: stage name + percentage
    const stageText = progress.stage || "Processing";
    processingStatusSpan.textContent = `${stageText}: ${percentage}%`;
    setPlaceholderText(`${stageText}: ${percentage}% Done`);
});

// Listen for immediate queue updates (lower priority than progress)
socket.on('queueUpdate', (data) => {
    debugLog('Received queueUpdate:', data);
    queueSizeSpan.textContent = data.queueSize;

    if (currentRequestId && data.requestId === currentRequestId) {
        if (data.status === "processing") {
            yourPositionSpan.textContent = "Processing";
            // Only update status if no detailed progress is showing
            if (!processingStatusSpan.textContent.includes('%')) {
                processingStatusSpan.textContent = data.stage || "Processing";
            }
            updateProgressPercentage("");
            setPlaceholderText(data.stage || `Processing your image...`);
            outputPlaceholder.style.display = "block";
            outputImage.style.display = "none";
        } else if (data.status === "pending") {
            yourPositionSpan.textContent = `${data.yourPosition}`;
            processingStatusSpan.textContent = "Waiting";
            updateProgressPercentage("");
            setPlaceholderText(`Waiting in queue: Position ${data.yourPosition}`);
            outputPlaceholder.style.display = 'block';
            outputImage.style.display = 'none';
        }
    } else if (!currentRequestId && !data.isProcessing && data.queueSize === 0) {
        processingStatusSpan.textContent = 'Idle';
        updateProgressPercentage('');
        setPlaceholderText('Your processed image will appear here.');
        outputPlaceholder.style.display = 'block';
        outputImage.style.display = 'none';
    }
});

// Handle processing completion via Socket.IO
socket.on('processingComplete', (data) => {
    debugLog('Received processingComplete:', data);
    if (currentRequestId && data.requestId === currentRequestId && data.outputImage) {
        processingStatusSpan.textContent = 'Complete';
        updateProgressPercentage('');
        try {
            displayResult(data.outputImage, data.downloadUrl);
        } catch (err) {
            Logger.error('SOCKETIO', 'Error displaying result image:', err, data);
        }
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
        sessionStorage.removeItem("activeRequestId");
        currentRequestId = null;
        enableUpload();
    }
    fetchQueueStatus();
});

// Listen for processing failure
socket.on('processingFailed', (data) => {
    debugLog('Received processingFailed:', data);
    if (currentRequestId && data.requestId === currentRequestId) {
        processingStatusSpan.textContent = 'Failed';
        updateProgressPercentage('');
        displayError(data.errorMessage || 'Unknown processing error.');
        currentRequestId = null;
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
        sessionStorage.removeItem('activeRequestId');
        enableUpload();
    }
    fetchQueueStatus();
});


function resetUIForNewUpload() {
    debugLog('Resetting UI for new upload');
    hideElement(outputImage);
    outputImage.src = '';
    showElement(outputPlaceholder);
    setPlaceholderText('Uploading...');
    disableDownload();
    // Do NOT clear currentRequestId here; it is set only after a successful upload response
    processingStatusSpan.textContent = 'Uploading...';
    updateProgressPercentage('');
    queueSizeSpan.textContent = '0';

    // Clear uploaded copy filename for fresh comparison
    uploadedCopyFilename = null;
    mainUploadFilename = null;

    // Reset comparison section - show placeholder, hide container during upload
    const comparisonPlaceholder = document.getElementById('comparisonPlaceholder');
    const comparisonContainer = document.getElementById('comparisonContainer');
    showElement(comparisonPlaceholder);
    hideElement(comparisonContainer);
    
    const comparisonBeforeImg = document.getElementById('comparisonBeforeImg');
    const comparisonAfterImg = document.getElementById('comparisonAfterImg');
    if (comparisonBeforeImg) comparisonBeforeImg.src = '';
    if (comparisonAfterImg) comparisonAfterImg.src = '';

    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

function displayResult(imageUrl, downloadUrl) {
    if (!imageUrl) {
        displayError("No image URL provided for display.");
        return;
    }
    
    outputImage.src = imageUrl;
    outputImage.onload = () => {
        showElement(outputImage);
        hideElement(outputPlaceholder);
        enableDownload(downloadUrl || imageUrl);
        
        // Setup comparison slider only if we have a valid uploaded copy filename
        if (uploadedCopyFilename) {
            const beforeImageUrl = `/uploads/${uploadedCopyFilename}`;
            Logger.info('FRONTEND', 'Setting up comparison with uploaded copy file');
            setupComparison(beforeImageUrl, imageUrl);
        } else if (mainUploadFilename) {
            // Fallback to main upload filename if copy is not available
            const beforeImageUrl = `/input/${mainUploadFilename}`;
            Logger.info('FRONTEND', 'Setting up comparison with main upload file');
            setupComparison(beforeImageUrl, imageUrl);
        } else {
            Logger.warn('FRONTEND', 'No upload filename available for comparison');
        }
    };
    
    outputImage.onerror = () => {
        displayError("Failed to load processed image.");
        hideElement(outputImage);
        showElement(outputPlaceholder);
        disableDownload();
    };
}

function setupComparison(beforeImageUrl, afterImageUrl) {
    const comparisonContainer = document.getElementById('comparisonContainer');
    const comparisonPlaceholder = document.getElementById('comparisonPlaceholder');
    const beforeImg = document.getElementById('comparisonBeforeImg');
    const afterImg = document.getElementById('comparisonAfterImg');
    
    debugLog('Setting up comparison with:', { beforeImageUrl, afterImageUrl });
    
    if (!comparisonContainer || !beforeImg || !afterImg || !beforeImageUrl || !afterImageUrl) {
        debugLog('Comparison setup failed - missing elements or URLs');
        return;
    }
    
    // Set image sources
    beforeImg.src = beforeImageUrl;
    afterImg.src = afterImageUrl;
    
    let imagesLoaded = 0;
    
    function onImageLoad() {
        imagesLoaded++;
        debugLog(`Comparison image loaded: ${imagesLoaded}/2`);
        if (imagesLoaded === 2) {
            hideElement(comparisonPlaceholder);
            showElement(comparisonContainer);
            initializeSlider();
            debugLog('Comparison setup complete');
        }
    }
    
    function onImageError(imgType) {
        Logger.warn('COMPARISON', `Failed to load ${imgType} image for comparison - hiding comparison slider`);
        debugLog('Comparison setup failed due to image load error');
        // Hide comparison section if images fail to load
        hideElement(comparisonContainer);
        showElement(comparisonPlaceholder);
    }
    
    beforeImg.onload = onImageLoad;
    afterImg.onload = onImageLoad;
    beforeImg.onerror = () => onImageError('before');
    afterImg.onerror = () => onImageError('after');
    
    // Check if images are already loaded
    if (beforeImg.complete && beforeImg.naturalWidth > 0) onImageLoad();
    if (afterImg.complete && afterImg.naturalWidth > 0) onImageLoad();
}

function initializeSlider() {
    const container = document.getElementById('comparisonContainer');
    const afterDiv = container.querySelector('.comparison-after');
    const slider = container.querySelector('.comparison-slider');
    
    if (!container || !afterDiv || !slider) return;
    
    let isDragging = false;
    
    function updateSlider(clientX) {
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
        
        afterDiv.style.width = percentage + '%';
        slider.style.left = percentage + '%';
    }
    
    function startDrag(e) {
        isDragging = true;
        e.preventDefault();
        updateSlider(e.touches ? e.touches[0].clientX : e.clientX);
    }
    
    function onDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        updateSlider(e.touches ? e.touches[0].clientX : e.clientX);
    }
    
    function stopDrag() {
        isDragging = false;
    }
    
    // Mouse events
    slider.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
    
    // Touch events
    slider.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
    
    // Click to move slider
    container.addEventListener('click', (e) => {
        if (e.target !== slider) {
            updateSlider(e.clientX);
        }
    });
}

function displayError(errorMessage) {
    outputPlaceholder.textContent = `Error: ${errorMessage}`;
    outputPlaceholder.classList.add('error');
    showElement(outputPlaceholder);
    hideElement(outputImage);
}

function clearErrorState() {
    outputPlaceholder.classList.remove('error');
}

function setPlaceholderText(text) {
    clearErrorState();
    outputPlaceholder.textContent = text;
}

// --- Image Preview and Drag/Drop ---
function showPreview(file) {
    debugLog('Showing preview for file:', file);
    const reader = new FileReader();
    reader.onload = e => {
        previewImage.src = e.target.result;
        previewImage.style.display = 'block';
        dropText.style.display = 'none';
    };
    reader.onerror = err => {
        Logger.error('PREVIEW', 'Error reading file for preview:', err);
    };
    try {
        reader.readAsDataURL(file);
    } catch (err) {
        Logger.error('PREVIEW', 'Error in showPreview:', err);
    }
}

inputImage.addEventListener('change', () => {
    debugLog('inputImage changed:', inputImage.files);
    debugLog('Number of files selected:', inputImage.files ? inputImage.files.length : 0);
    
    if (inputImage.files && inputImage.files.length > 0) {
        const allowConcurrent = allowConcurrentUploadCheckbox?.checked || false;
        debugLog('Allow concurrent uploads:', allowConcurrent);
        
        if (allowConcurrent && inputImage.files.length > 1) {
            // Multiple files selected - show multi-preview
            debugLog('Showing multi-preview for', inputImage.files.length, 'files');
            showMultiPreview(inputImage.files);
        } else {
            // Single file or concurrent not enabled - show single preview
            debugLog('Showing single preview for file:', inputImage.files[0].name);
            showSinglePreview(inputImage.files[0]);
        }
        
        // Handle upload copy for all selected files (for comparison functionality)
        if (inputImage.files && inputImage.files.length > 0) {
            const fileCount = inputImage.files.length;
            let copiesCompleted = 0;
            
            // Process all files for upload copies
            Array.from(inputImage.files).forEach((file, index) => {
                const formData = new FormData();
                formData.append('image', file);
                fetch('/upload-copy', {
                    method: 'POST',
                    body: formData
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to upload image copy for ${file.name}`);
                    }
                    return response.json();
                })
                .then(data => {
                    copiesCompleted++;
                    // Store filename silently for comparison (no console output)
                    // For multiple files, we'll store the first one as the main comparison file
                    if (index === 0) {
                        uploadedCopyFilename = data.filename;
                    }
                    debugLog(`Upload copy created for ${file.name} (${copiesCompleted}/${fileCount}):`, data.filename);
                })
                .catch(error => {
                    copiesCompleted++;
                    // Silent error handling for upload-copy (no console output)
                    debugLog(`Upload copy failed for ${file.name} (${copiesCompleted}/${fileCount}):`, error);
                });
            });
        }
    }
});

['dragenter', 'dragover'].forEach(event =>
    dropArea.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.add('drag-over');
    })
);

['dragleave', 'drop'].forEach(event =>
    dropArea.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.remove('drag-over');
    })
);

dropArea.addEventListener('click', (e) => {
    // Don't trigger file selector if clicking on remove buttons or multi-preview items
    if (e.target.closest('.remove-file') || e.target.closest('.multi-preview-item')) {
        return;
    }
    inputImage.click();
});

dropArea.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
        inputImage.files = files;
        
        const allowConcurrent = allowConcurrentUploadCheckbox?.checked || false;
        
        if (allowConcurrent && files.length > 1) {
            // Multiple files dropped - show multi-preview
            showMultiPreview(files);
        } else {
            // Single file or concurrent not enabled - show single preview
            showSinglePreview(files[0]);
        }
    }
});

// --- Upload Form Submission ---
uploadForm.addEventListener('submit', function (e) {
    try {
        debugLog('Upload form submitted');
        e.preventDefault();
        if (!inputImage.files || inputImage.files.length === 0) {
            alert('Please select an image before uploading.');
            debugLog('No image selected for upload');
            return;
        }
        
        const allowConcurrentUpload = document.getElementById('allowConcurrentUpload')?.checked || false;
        const files = Array.from(inputImage.files);
        
        // Prevent double submission (only if a request is actively being processed or queued and concurrent uploads are not allowed)
        if (currentRequestId && !allowConcurrentUpload) {
            alert('A request is already being processed or queued. Please wait or enable "Allow uploading while processing".');
            debugLog('Upload blocked: currentRequestId exists and concurrent uploads disabled', currentRequestId);
            return;
        }
        
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        
        // Only disable upload UI if concurrent uploads are not allowed
        if (!allowConcurrentUpload) {
            disableUpload();
        }
        
        resetUIForNewUpload();
        
        // If multiple files and concurrent upload is enabled, queue them all
        if (allowConcurrentUpload && files.length > 1) {
            submitMultipleFiles(files, isLocal);
        } else {
            // Submit single file (original behavior)
            submitSingleFile(files[0], isLocal);
        }
        
    } catch (err) {
        debugLog('Error in uploadForm submit handler:', err);
        console.error('Unexpected error in uploadForm submit:', err);
        enableUpload();
        displayError('An unexpected error occurred. Please try again.');
    }
});

// Function to submit a single file
function submitSingleFile(file, isLocal) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('prompt', document.getElementById('prompt').value);
    formData.append('steps', document.getElementById('steps').value);
    formData.append('outputHeight', document.getElementById('outputHeight').value);
    
    // Add dynamic LoRA models
    const selectedLoRAModels = getSelectedLoRAModels();
    Object.entries(selectedLoRAModels).forEach(([key, value]) => {
        formData.append(key, value);
        debugLog(`LoRA setting ${key}: ${value}`);
    });
    
    if (!isLocal && !captchaDisabled) {
        var captchaAnswer = document.getElementById('captcha_answer');
        var captchaToken = document.getElementById('captcha_token');
        if (captchaAnswer && captchaToken) {
            formData.append('captcha_answer', captchaAnswer.value.trim());
            formData.append('captcha_token', captchaToken.value);
        }
    }
    
    submitFormData(formData, file.name);
}

// Function to submit multiple files
function submitMultipleFiles(files, isLocal) {
    let submittedCount = 0;
    const totalFiles = files.length;
    
    setPlaceholderText(`Queuing ${totalFiles} images for processing...`);
    
    files.forEach((file, index) => {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('prompt', document.getElementById('prompt').value);
        formData.append('steps', document.getElementById('steps').value);
        formData.append('outputHeight', document.getElementById('outputHeight').value);
        
        // Add dynamic LoRA models
        const selectedLoRAModels = getSelectedLoRAModels();
        Object.entries(selectedLoRAModels).forEach(([key, value]) => {
            formData.append(key, value);
            debugLog(`LoRA setting ${key}: ${value}`);
        });
        
        if (!isLocal && !captchaDisabled) {
            var captchaAnswer = document.getElementById('captcha_answer');
            var captchaToken = document.getElementById('captcha_token');
            if (captchaAnswer && captchaToken) {
                formData.append('captcha_answer', captchaAnswer.value.trim());
                formData.append('captcha_token', captchaToken.value);
            }
        }
        
        // Submit with a slight delay to avoid overwhelming the server
        setTimeout(() => {
            submitFormData(formData, file.name, index === 0, () => {
                submittedCount++;
                if (submittedCount === totalFiles) {
                    setPlaceholderText(`All ${totalFiles} images queued for processing.`);
                }
            });
        }, index * 100); // 100ms delay between submissions
    });
}

// Function to handle the actual form submission
function submitFormData(formData, fileName, isFirstFile = true, onComplete = null) {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
            const percent = (e.loaded / e.total) * 100;
            processingStatusSpan.textContent = `Uploading ${fileName}: ${Math.round(percent)}%`;
            debugLog('Upload progress:', percent);
        }
    });
    xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
            debugLog('XHR upload complete, status:', xhr.status, xhr.responseText);
            if (xhr.status === 202) {
                let response;
                try {
                    response = JSON.parse(xhr.responseText);
                } catch (err) {
                    enableUpload();
                    displayError('Invalid server response.');
                    console.error('Error parsing upload response:', err, xhr.responseText);
                    if (onComplete) onComplete();
                    return;
                }
                
                // For multiple files, only set currentRequestId for the first file
                if (isFirstFile) {
                    currentRequestId = response.requestId;
                    sessionStorage.setItem('activeRequestId', currentRequestId);
                    // Always join the room for this request
                    socket.emit('joinRoom', currentRequestId);
                    queueSizeSpan.textContent = response.queueSize;
                    processingStatusSpan.textContent = response.yourPosition > 0 ? `Waiting (Position ${response.yourPosition})` : 'Processing';
                    updateProgressPercentage('');
                    setPlaceholderText(`Image uploaded. Waiting for processing.`);
                    // Always clear and start polling
                    if (pollingIntervalId) {
                        clearInterval(pollingIntervalId);
                    }
                    pollingIntervalId = setInterval(fetchQueueStatus, 2000);
                    fetchQueueStatus();
                } else {
                    // For additional files, just join their rooms to monitor progress
                    socket.emit('joinRoom', response.requestId);
                    queueSizeSpan.textContent = response.queueSize;
                }
                
                if (onComplete) onComplete();
            } else {
                enableUpload();
                let errorMsg = 'Upload failed: ';
                if (xhr.status === 0) {
                    errorMsg += 'Network error or server not reachable.';
                } else if (xhr.status === 400 && xhr.responseText && xhr.responseText.includes('CAPTCHA')) {
                    errorMsg += 'CAPTCHA validation failed. Please try again.';
                    if (typeof fetchCaptcha === 'function') fetchCaptcha();
                } else if (xhr.responseText) {
                    errorMsg += xhr.responseText;
                } else {
                    errorMsg += 'Unknown error';
                }
                alert(errorMsg);
                displayError(errorMsg);
                if (isFirstFile) {
                    currentRequestId = null;
                    if (pollingIntervalId) {
                        clearInterval(pollingIntervalId);
                        pollingIntervalId = null;
                    }
                    processingStatusSpan.textContent = 'Failed';
                    updateProgressPercentage('');
                }
                debugLog('Upload error:', errorMsg);
                if (onComplete) onComplete();
            }
        }
    };
    xhr.onerror = err => {
        enableUpload();
        displayError('Network error during upload.');
        console.error('XHR upload error:', err);
        if (onComplete) onComplete();
    };
    xhr.open('POST', '/upload', true);
    xhr.send(formData);
}

// --- Frontend Queue Polling ---
async function fetchQueueStatus() {
    try {
        debugLog('Fetching queue status...');
        let url = '/queue-status';
        if (currentRequestId) {
            url += `?requestId=${currentRequestId}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        debugLog('Queue status response:', data);
        
        // Store the uploaded filename for comparison when available
        if (data.uploadedFilename) {
            mainUploadFilename = data.uploadedFilename;
        }
        
        queueSizeSpan.textContent = data.queueSize;
        if (currentRequestId) {
            switch (data.status) {
                case 'pending':
                    processingStatusSpan.textContent = `Waiting (Position ${data.yourPosition})`;
                    updateProgressPercentage('');
                    setPlaceholderText(`Waiting in queue: Position ${data.yourPosition}`);
                    outputPlaceholder.style.display = 'block';
                    outputImage.style.display = 'none';
                    break;
                case 'processing':
                    // Only update if no detailed progress is showing
                    if (!processingStatusSpan.textContent.includes('%')) {
                        processingStatusSpan.textContent = 'Processing';
                    }
                    outputPlaceholder.style.display = 'block';
                    outputImage.style.display = 'none';
                    break;
                case 'completed':
                    processingStatusSpan.textContent = 'Complete';
                    updateProgressPercentage('');
                    if (data.result && data.result.outputImage) {
                        try {
                            displayResult(data.result.outputImage, data.result.downloadUrl);
                        } catch (err) {
                            console.error('Error displaying result from polling:', err, data);
                        }
                    }
                    sessionStorage.removeItem('activeRequestId');
                    enableUpload();
                    currentRequestId = null;
                    if (pollingIntervalId) {
                        clearInterval(pollingIntervalId);
                        pollingIntervalId = null;
                    }
                    break;
                case 'failed':
                    processingStatusSpan.textContent = 'Failed';
                    updateProgressPercentage('');
                    displayError(data.result && data.result.errorMessage ? data.result.errorMessage : 'Unknown processing error from polling.');
                    sessionStorage.removeItem('activeRequestId');
                    enableUpload();
                    currentRequestId = null;
                    if (pollingIntervalId) {
                        clearInterval(pollingIntervalId);
                        pollingIntervalId = null;
                    }
                    break;
                default:
                    updateProgressPercentage('');
                    break;
            }
        } else if (!data.isProcessing && data.queueSize === 0) {
            processingStatusSpan.textContent = 'Idle';
            updateProgressPercentage('');
            setPlaceholderText('Your processed image will appear here.');
            outputPlaceholder.style.display = 'block';
            outputImage.style.display = 'none';
            if (pollingIntervalId) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
            }
        }
    } catch (error) {
        console.error('Error fetching queue status:', error);
        if (currentRequestId || processingStatusSpan.textContent !== 'Idle') {
            queueSizeSpan.textContent = 'Error';
            processingStatusSpan.textContent = 'Error';
            updateProgressPercentage('');
            displayError('Failed to get status. Please check connection.');
            if (pollingIntervalId) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
            }
        }
    }
}

// --- Responsive Carousel Setup ---
let carouselImages = [];
let carouselAnimation = null;
let carouselCurrentPosition = 0;

function setupCarouselLayout() {
    const carouselSlide = document.querySelector('.carousel-slide');
    const carouselContainer = document.querySelector('.carousel-container');
    if (!carouselSlide || !carouselContainer || carouselImages.length === 0) return;

    const containerWidth = carouselContainer.offsetWidth;
    const containerHeight = carouselContainer.offsetHeight;
    
    // Calculate widths based on image aspect ratios to ensure full visibility
    const images = carouselSlide.querySelectorAll('img');
    let totalCalculatedWidth = 0;
    
    // First pass: calculate natural widths for all images
    const imageWidths = [];
    images.forEach((img, index) => {
        let calculatedWidth;
        
        if (img.naturalWidth && img.naturalHeight && img.naturalWidth > 0 && img.naturalHeight > 0) {
            // Calculate width based on container height and image aspect ratio
            const aspectRatio = img.naturalWidth / img.naturalHeight;
            calculatedWidth = Math.floor(containerHeight * aspectRatio);
        } else {
            // Fallback for images not yet loaded - use a reasonable default
            calculatedWidth = Math.floor(containerHeight * (16/9)); // Assume 16:9 aspect ratio
        }
        
        // Ensure minimum width to prevent too narrow images
        calculatedWidth = Math.max(calculatedWidth, Math.floor(containerHeight * 0.5));
        
        imageWidths.push(calculatedWidth);
        totalCalculatedWidth += calculatedWidth;
    });
    
    // Apply calculated widths to ensure full image visibility
    images.forEach((img, index) => {
        const width = imageWidths[index];
        img.style.width = width + 'px';
        img.style.minWidth = width + 'px';
        img.style.maxWidth = width + 'px';
        img.style.height = containerHeight + 'px';
        img.style.objectFit = 'contain';
    });
    
    // Set total slide width with a small buffer to prevent gaps
    carouselSlide.style.width = (totalCalculatedWidth + 10) + 'px';
    
    // Reset position to ensure we start correctly
    carouselCurrentPosition = 0;
    carouselSlide.style.transform = 'translateX(0px)';
    
    // Start animation after a brief delay to ensure layout is stable
    setTimeout(() => {
        startCarouselAnimation();
    }, 100);
}

function startCarouselAnimation() {
    const carouselSlide = document.querySelector('.carousel-slide');
    const carouselContainer = document.querySelector('.carousel-container');
    if (!carouselSlide || !carouselContainer) return;
    
    // Stop existing animation
    if (carouselAnimation) {
        cancelAnimationFrame(carouselAnimation);
    }
    
    const images = carouselSlide.querySelectorAll('img');
    const totalImages = carouselImages.length; // Original images count
    
    // Calculate total width of original images only
    let originalSetWidth = 0;
    for (let i = 0; i < totalImages; i++) {
        if (images[i] && images[i].offsetWidth > 0) {
            originalSetWidth += images[i].offsetWidth;
        }
    }
    
    // If we don't have proper dimensions yet, try again in a moment
    if (originalSetWidth === 0) {
        setTimeout(() => startCarouselAnimation(), 200);
        return;
    }
    
    // Speed: move the width of one average image every 3 seconds
    const averageImageWidth = originalSetWidth / totalImages;
    const pixelsPerSecond = averageImageWidth / 3;
    
    let lastTime = performance.now();
    
    function animate(currentTime) {
        const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
        lastTime = currentTime;
        
        // Move the carousel (in pixels)
        carouselCurrentPosition += pixelsPerSecond * deltaTime;
        
        // Reset position when we've moved past the original set of images
        // Reset exactly at the boundary for seamless transition
        if (carouselCurrentPosition >= originalSetWidth) {
            carouselCurrentPosition = carouselCurrentPosition - originalSetWidth;
        }
        
        // Apply transform in pixels
        carouselSlide.style.transform = `translateX(-${carouselCurrentPosition}px)`;
        
        carouselAnimation = requestAnimationFrame(animate);
    }
    
    carouselAnimation = requestAnimationFrame(animate);
}

async function setupCarousel() {
    const carouselSlide = document.querySelector('.carousel-slide');
    if (!carouselSlide) {
        console.error('Carousel slide element not found');
        return;
    }
    
    Logger.info('CAROUSEL', 'Setting up carousel...');

    try {
        console.log('Fetching carousel images from API...');
        const response = await fetch('/api/carousel-images');
        if (!response.ok) {
            throw new Error('Failed to fetch carousel images');
        }
        
        carouselImages = await response.json();
        console.log('Carousel images loaded:', carouselImages);
        
        if (carouselImages.length > 0) {
            // Clear existing content
            carouselSlide.innerHTML = '';
            
            // Create promises for image loading
            const imageLoadPromises = [];
            
            console.log('Creating carousel image elements...');
            // Add original images
            carouselImages.forEach((image, index) => {
                const img = document.createElement('img');
                img.src = `/img/carousel/${image}`;
                img.alt = "Carousel Image";
                img.style.display = 'block'; // Ensure images are displayed
                img.classList.add('loading'); // Add loading class initially
                carouselSlide.appendChild(img);
                
                console.log(`Added carousel image ${index + 1}: ${img.src}`);
                
                // Create promise for image load
                const loadPromise = new Promise((resolve) => {
                    if (img.complete && img.naturalWidth > 0) {
                        img.classList.remove('loading');
                        img.classList.add('loaded');
                        resolve();
                    } else {
                        img.onload = () => {
                            img.classList.remove('loading');
                            img.classList.add('loaded');
                            resolve();
                        };
                        img.onerror = () => {
                            img.classList.remove('loading');
                            resolve(); // Resolve even on error to continue
                        };
                        // Timeout fallback in case image doesn't load
                        setTimeout(() => {
                            img.classList.remove('loading');
                            resolve();
                        }, 5000);
                    }
                });
                imageLoadPromises.push(loadPromise);
            });
            
            // Add duplicate images for seamless loop
            carouselImages.forEach(image => {
                const img = document.createElement('img');
                img.src = `/img/carousel/${image}`;
                img.alt = "Carousel Image";
                img.style.display = 'block'; // Ensure images are displayed
                img.classList.add('loading'); // Add loading class initially
                carouselSlide.appendChild(img);
                
                // Create promise for image load
                const loadPromise = new Promise((resolve) => {
                    if (img.complete && img.naturalWidth > 0) {
                        img.classList.remove('loading');
                        img.classList.add('loaded');
                        resolve();
                    } else {
                        img.onload = () => {
                            img.classList.remove('loading');
                            img.classList.add('loaded');
                            resolve();
                        };
                        img.onerror = () => {
                            img.classList.remove('loading');
                            resolve(); // Resolve even on error to continue
                        };
                        // Timeout fallback in case image doesn't load
                        setTimeout(() => {
                            img.classList.remove('loading');
                            resolve();
                        }, 5000);
                    }
                });
                imageLoadPromises.push(loadPromise);
            });
            
            // Wait for all images to load before setting up layout
            await Promise.all(imageLoadPromises);
            
            // Setup layout and start animation after images are loaded
            setupCarouselLayout();
            
            // Handle window resize
            let resizeTimeout;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(() => {
                    // Stop current animation before recalculating
                    if (carouselAnimation) {
                        cancelAnimationFrame(carouselAnimation);
                        carouselAnimation = null;
                    }
                    setupCarouselLayout();
                }, 150);
            });
            
        } else {
            carouselSlide.innerHTML = '<p>No images found in carousel.</p>';
        }
    } catch (error) {
        console.error('Error setting up carousel:', error);
        carouselSlide.innerHTML = '<p>Error loading carousel images.</p>';
    }
}

// --- Initial Page Load Logic ---
function initialize() {
    console.log('🚀 Initialize function called!');
    debugLog('Initializing page...');
    console.log('🎠 About to setup carousel...');
    setupCarousel();

    const storedRequestId = sessionStorage.getItem('activeRequestId');
    if (storedRequestId) {
        currentRequestId = storedRequestId;
        disableUpload();
        socket.emit('joinRoom', currentRequestId);
    }

    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal || captchaDisabled) {
        const captchaContainer = document.getElementById('captchaContainer');
        if (captchaContainer) {
            captchaContainer.style.display = 'none';
        }
    }

    fetchQueueStatus();
    pollingIntervalId = setInterval(fetchQueueStatus, 2000);
}

Logger.info('MAIN', '🔧 Main.js loaded, calling initialize...');
initialize();
Logger.success('MAIN', '✅ Initialize called, main.js setup complete');

function disableUpload() {
    debugLog('Disabling upload button');
    setUploadButtonState({ disabled: true, text: 'Processing...' });
    processingStatusSpan.textContent = 'Processing';
    outputPlaceholder.textContent = 'Uploading and processing your image...';
    showElement(outputPlaceholder);
    hideElement(outputImage);
}

function enableUpload() {
    debugLog('Enabling upload button');
    setUploadButtonState({ disabled: false, text: 'Upload' });
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isLocal && !captchaDisabled) {
        fetchCaptcha();
    }
    var captchaAnswer = document.getElementById('captcha_answer');
    if (captchaAnswer) captchaAnswer.value = '';
}

// --- LoRA Management Functions ---
let availableLoRAs = [];
let loraCounter = 0;
const defaultLoRAs = [
    { model: 'fluxkontext/change_clothes_to_nothing_000011200.safetensors', strength: 1, enabled: true },
    { model: 'flux/aidmaRealisticSkin-FLUX-v0.1.safetensors', strength: 0.6, enabled: true }
];

/**
 * Fetch available LoRA models from the server
 */
async function fetchAvailableLoRAs() {
    try {
        const response = await fetch('/api/loras/detailed');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data.success) {
            // Flatten the structure - combine root and subdirectory LoRAs
            availableLoRAs = [...data.loras.root];
            
            // Add LoRAs from subdirectories
            Object.values(data.loras.subdirs).forEach(subdirLoRAs => {
                if (Array.isArray(subdirLoRAs)) {
                    availableLoRAs.push(...subdirLoRAs);
                }
            });
            
            debugLog(`Loaded ${availableLoRAs.length} LoRA models`);
            return availableLoRAs;
        } else {
            throw new Error(data.error || 'Failed to fetch LoRA models');
        }
    } catch (error) {
        console.error('Error fetching LoRA models:', error);
        debugLog(`Error fetching LoRA models: ${error.message}`);
        return [];
    }
}

/**
 * Create a LoRA selection dropdown for a specific LoRA slot
 */
function createLoRADropdown(loraIndex, currentValue = '') {
    const select = document.createElement('select');
    select.id = `lora_${loraIndex}_model`;
    select.name = `lora_${loraIndex}_model`;
    select.className = 'lora-model-select';
    
    // Add default/empty option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Select LoRA Model --';
    select.appendChild(defaultOption);
    
    // Add LoRA options
    availableLoRAs.forEach(lora => {
        const option = document.createElement('option');
        option.value = lora.relativePath || lora.filename; // Use relativePath for ComfyUI compatibility
        option.textContent = lora.displayName;
        
        // Add subdirectory info if it's in a subdirectory
        if (lora.relativePath && (lora.relativePath.includes('') || lora.relativePath.includes('/'))) {
            const subdirName = lora.relativePath.split(/[\/]/)[0];
            option.textContent += ` (${subdirName})`;
        }
        
        if (option.value === currentValue) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    return select;
}

/**
 * Create a single LoRA row element
 */
function createLoRARow(index, config = {}) {
    const { model = '', strength = 0.7, enabled = false } = config;
    
    const row = document.createElement('div');
    row.className = 'lora-row';
    row.dataset.index = index;
    
    row.innerHTML = `
        <div class="lora-main">
            <input type="checkbox" id="lora_${index}_on" name="lora_${index}_on" ${enabled ? 'checked' : ''}>
            <div class="lora-model-container">
                <!-- Dropdown will be inserted here -->
            </div>
        </div>
        <div class="lora-strength-group">
            <input type="number" id="lora_${index}_strength" name="lora_${index}_strength" 
                   value="${strength}" min="0" max="2" step="0.01" class="lora-strength" />
            <label for="lora_${index}_strength">Strength</label>
        </div>
        <div class="lora-row-controls">
            <button type="button" class="lora-remove-btn" onclick="removeLoRARow(${index})">×</button>
        </div>
    `;
    
    // Insert the dropdown
    const dropdown = createLoRADropdown(index, model);
    const container = row.querySelector('.lora-model-container');
    container.appendChild(dropdown);
    
    // Add change event listener
    dropdown.addEventListener('change', function() {
        const selectedLora = availableLoRAs.find(lora => 
            (lora.relativePath || lora.filename) === this.value
        );
        if (selectedLora) {
            debugLog(`LoRA ${index} changed to: ${selectedLora.displayName} (${this.value})`);
        }
    });
    
    return row;
}

/**
 * Update remove button states based on number of entries
 */
function updateRemoveButtonStates() {
    const allRows = document.querySelectorAll('.lora-row');
    const removeButtons = document.querySelectorAll('.lora-remove-btn');
    
    // Disable remove buttons if there's only one entry
    removeButtons.forEach(btn => {
        btn.disabled = allRows.length <= 1;
        if (allRows.length <= 1) {
            btn.title = 'Cannot remove the last LoRA entry';
        } else {
            btn.title = 'Remove this LoRA entry';
        }
    });
}

/**
 * Add a new LoRA row
 */
function addLoRARow(config = {}) {
    loraCounter++;
    const row = createLoRARow(loraCounter, config);
    const grid = document.getElementById('loraGrid');
    grid.appendChild(row);
    debugLog(`Added LoRA row ${loraCounter}`);
    return loraCounter;
}

/**
 * Remove a LoRA row
 */
function removeLoRARow(index) {
    const row = document.querySelector(`[data-index="${index}"]`);
    if (row) {
        // Check if this is the last LoRA entry
        const allRows = document.querySelectorAll('.lora-row');
        if (allRows.length <= 1) {
            // Don't allow removing the last LoRA entry
            debugLog('Cannot remove the last LoRA entry');
            return;
        }
        
        row.remove();
        debugLog(`Removed LoRA row ${index}`);
        
        // Update remove button states
        updateRemoveButtonStates();
    }
}

// Make removeLoRARow globally accessible
window.removeLoRARow = removeLoRARow;

/**
 * Get selected LoRA models for form submission
 */
function getSelectedLoRAModels() {
    const selectedModels = {};
    const loraRows = document.querySelectorAll('.lora-row');
    
    loraRows.forEach(row => {
        const index = row.dataset.index;
        const checkbox = document.getElementById(`lora_${index}_on`);
        const dropdown = document.getElementById(`lora_${index}_model`);
        const strength = document.getElementById(`lora_${index}_strength`);
        
        if (checkbox && dropdown && strength) {
            selectedModels[`lora_${index}_on`] = checkbox.checked ? 'true' : 'false';
            selectedModels[`lora_${index}_strength`] = strength.value;
            if (dropdown.value) {
                selectedModels[`lora_${index}_model`] = dropdown.value;
            }
        }
    });
    
    return selectedModels;
}

/**
 * Initialize default LoRA entries
 */
function initializeDefaultLoRAs() {
    // Clear existing entries
    const grid = document.getElementById('loraGrid');
    grid.innerHTML = '';
    loraCounter = 0;
    
    // Add default LoRAs, or at least one empty entry if no defaults
    if (defaultLoRAs.length > 0) {
        defaultLoRAs.forEach(config => {
            addLoRARow(config);
        });
    } else {
        // Ensure at least one LoRA entry exists
        addLoRARow();
    }
    
    // Update remove button states after initialization
    updateRemoveButtonStates();
}

/**
 * Initialize LoRA functionality
 */
async function initializeLoRAs() {
    debugLog('Initializing LoRA system...');
    await fetchAvailableLoRAs();
    
    if (availableLoRAs.length > 0) {
        initializeDefaultLoRAs();
        
        // Add event listener for add button
        const addBtn = document.getElementById('addLoraBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                addLoRARow();
                updateRemoveButtonStates();
            });
        }
        
        debugLog('LoRA system initialized successfully');
    } else {
        debugLog('No LoRA models found or failed to load');
        // Still initialize with empty dropdowns
        initializeDefaultLoRAs();
    }
}

/**
 * Create a LoRA selection dropdown for a specific LoRA slot
 */
function createLoRADropdown(loraIndex, currentValue = '') {
    const select = document.createElement('select');
    select.id = `lora_${loraIndex}_model`;
    select.name = `lora_${loraIndex}_model`;
    select.className = 'lora-model-select';
    
    // Add default/empty option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Select LoRA Model --';
    select.appendChild(defaultOption);
    
    // Add LoRA options
    availableLoRAs.forEach(lora => {
        const option = document.createElement('option');
        option.value = lora.relativePath || lora.filename; // Use relativePath for ComfyUI compatibility
        option.textContent = lora.displayName;
        
        // Add subdirectory info if it's in a subdirectory
        if (lora.relativePath && lora.relativePath.includes('\\') || lora.relativePath && lora.relativePath.includes('/')) {
            option.textContent += ` (${lora.relativePath.split(/[\\\/]/)[0]})`;
        }
        
        if (option.value === currentValue) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    return select;
}

/**
 * Update LoRA labels with dropdown selections
 */
function makeLoRALabelsSelectable() {
    // Get current LoRA mappings from workflow.json (hardcoded for now)
    const currentLoRAs = {
        1: 'fluxkontext/change_clothes_to_nothing_000011200.safetensors',
        2: 'flux/real_textures-000011.safetensors',
        3: 'flux/Flux_Ultimator.safetensors',
        4: 'flux/FLUX_FD-Nipple-Detail-R4.safetensors',
        5: 'flux/aidmaRealisticSkin-FLUX-v0.1.safetensors'
    };
    
    for (let i = 1; i <= 5; i++) {
        const label = document.querySelector(`label[for="lora_${i}_on"]`);
        if (label) {
            // Store original text
            const originalText = label.textContent;
            
            // Create dropdown
            const dropdown = createLoRADropdown(i, currentLoRAs[i] || '');
            
            // Replace label content with dropdown
            label.innerHTML = '';
            label.appendChild(dropdown);
            
            // Add change event listener to update form data
            dropdown.addEventListener('change', function() {
                const selectedLora = availableLoRAs.find(lora => 
                    (lora.relativePath || lora.filename) === this.value
                );
                if (selectedLora) {
                    debugLog(`LoRA ${i} changed to: ${selectedLora.displayName} (${this.value})`);
                }
            });
        }
    }
}

/**
 * Get selected LoRA models for form submission
 */
function getSelectedLoRAModels() {
    const selectedModels = {};
    for (let i = 1; i <= 5; i++) {
        const dropdown = document.getElementById(`lora_${i}_model`);
        if (dropdown && dropdown.value) {
            selectedModels[`lora_${i}_model`] = dropdown.value;
        }
    }
    return selectedModels;
}

/**
 * Initialize LoRA functionality
 */
async function initializeLoRAs() {
    debugLog('Initializing LoRA system...');
    await fetchAvailableLoRAs();
    
    if (availableLoRAs.length > 0) {
        makeLoRALabelsSelectable();
        debugLog('LoRA system initialized successfully');
    } else {
        debugLog('No LoRA models found or failed to load');
    }
}
