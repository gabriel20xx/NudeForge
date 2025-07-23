
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
}

window.addEventListener('DOMContentLoaded', checkCaptchaStatusAndInit);
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
const yourPositionSpan = document.getElementById('yourPosition');
const progressPercentageSpans = document.querySelectorAll('.progressPercentage');
const uploadButton = uploadForm.querySelector('.upload-btn');

// --- Helper functions for show/hide ---
function debugLog(...args) {
    if (window.DEBUG_MODE) {
        console.debug('[DEBUG]', ...args);
    }
}
function showElement(el) {
    if (el) {
        el.style.display = '';
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

// Listen for processing progress updates from the server
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
        console.error('Error calculating progress percentage:', err, progress);
        return;
    }
    if (isNaN(percentage)) {
        debugLog('Progress percentage is NaN, skipping update.');
        return;
    }
    updateProgressPercentage(`: ${percentage}%`);
    processingStatusSpan.textContent = 'Processing';
    outputPlaceholder.textContent = `Processing your image: ${percentage}% Done`;
});

// Listen for immediate queue updates
socket.on('queueUpdate', (data) => {
    debugLog('Received queueUpdate:', data);
    queueSizeSpan.textContent = data.queueSize;

    if (currentRequestId && data.requestId === currentRequestId) {
        if (data.status === 'processing') {
            yourPositionSpan.textContent = 'Processing';
            processingStatusSpan.textContent = 'Processing';
            updateProgressPercentage('');
            outputPlaceholder.textContent = `Processing your image...`;
            outputPlaceholder.style.display = 'block';
            outputImage.style.display = 'none';
        } else if (data.status === 'pending') {
            yourPositionSpan.textContent = `${data.yourPosition}`;
            processingStatusSpan.textContent = 'Waiting';
            updateProgressPercentage('');
            outputPlaceholder.textContent = `Waiting in queue: Position ${data.yourPosition}`;
            outputPlaceholder.style.display = 'block';
            outputImage.style.display = 'none';
        }
    } else if (!currentRequestId && !data.isProcessing && data.queueSize === 0) {
        processingStatusSpan.textContent = 'Idle';
        yourPositionSpan.textContent = 'N/A';
        updateProgressPercentage('');
        outputPlaceholder.textContent = 'Your processed image will appear here.';
        outputPlaceholder.style.display = 'block';
        outputImage.style.display = 'none';
    }
});

// Handle processing completion via Socket.IO
socket.on('processingComplete', (data) => {
    debugLog('Received processingComplete:', data);
    if (currentRequestId && data.requestId === currentRequestId && data.outputImage) {
        yourPositionSpan.textContent = 'Done!';
        processingStatusSpan.textContent = 'Complete';
        updateProgressPercentage('');
        try {
            displayResult(data.outputImage);
        } catch (err) {
            console.error('Error displaying result image:', err, data);
        }
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            pollingIntervalId = null;
        }
        sessionStorage.removeItem('activeRequestId');
        enableUpload();
    }
    fetchQueueStatus();
});

// Listen for processing failure
socket.on('processingFailed', (data) => {
    debugLog('Received processingFailed:', data);
    if (currentRequestId && data.requestId === currentRequestId) {
        yourPositionSpan.textContent = 'Error!';
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
    outputPlaceholder.style.color = '#fff';
    outputPlaceholder.textContent = 'Uploading...';
    disableDownload();
    // Do NOT clear currentRequestId here; it is set only after a successful upload response
    yourPositionSpan.textContent = 'Submitting...';
    processingStatusSpan.textContent = 'Uploading...';
    updateProgressPercentage('');
    queueSizeSpan.textContent = '0';

    const comparisonPlaceholder = document.getElementById('comparisonPlaceholder');
    showElement(comparisonPlaceholder);
    // Hide the comparison slider and images until output image is present
    const comparisonSlider = document.getElementById('comparison-slider');
    hideElement(comparisonSlider);
    const comparisonInputImage = document.getElementById('comparison-input-image');
    const comparisonOutputImage = document.getElementById('comparison-output-image');
    if (comparisonInputImage) comparisonInputImage.style.display = 'none';
    if (comparisonOutputImage) comparisonOutputImage.style.display = 'none';

    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

function displayResult(imageUrl) {
    debugLog('Displaying result image:', imageUrl);
    if (!imageUrl) {
        displayError("No image URL provided for display.");
        return;
    }
    outputImage.src = imageUrl;
    outputImage.onload = () => {
        try {
            showElement(outputImage);
            hideElement(outputPlaceholder);
            const comparisonCol = document.querySelector('.comparison-col');
            const comparisonInputImage = document.getElementById('comparison-input-image');
            const comparisonOutputImage = document.getElementById('comparison-output-image');
            const comparisonPlaceholder = document.getElementById('comparisonPlaceholder');
            const comparisonSlider = document.getElementById('comparison-slider');
            const previewImageSrc = previewImage.src;
            if (comparisonCol && comparisonInputImage && comparisonOutputImage && previewImageSrc) {
                comparisonInputImage.style.backgroundImage = `url(${previewImageSrc})`;
                comparisonOutputImage.style.backgroundImage = `url(${imageUrl})`;
                comparisonInputImage.style.display = 'block';
                comparisonOutputImage.style.display = 'block';
                hideElement(comparisonPlaceholder);
                showElement(comparisonSlider);
            }
            enableDownload(imageUrl);
        } catch (err) {
            console.error('Error in outputImage.onload:', err);
        }
    };
    outputImage.onerror = () => {
        displayError("Failed to load processed image. Check console for network errors.");
        hideElement(outputImage);
        showElement(outputPlaceholder);
        disableDownload();
        // Hide the comparison slider if error
        const comparisonSlider = document.getElementById('comparison-slider');
        hideElement(comparisonSlider);
        debugLog('Error loading output image:', imageUrl);
    };
}

function displayError(errorMessage) {
    debugLog('Display error:', errorMessage);
    outputPlaceholder.textContent = `Error: ${errorMessage}`;
    outputPlaceholder.style.color = 'red';
    showElement(outputPlaceholder);
    hideElement(outputImage);
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
        console.error('Error reading file for preview:', err);
    };
    try {
        reader.readAsDataURL(file);
    } catch (err) {
        console.error('Error in showPreview:', err);
    }
}

inputImage.addEventListener('change', () => {
    debugLog('inputImage changed:', inputImage.files[0]);
    if (inputImage.files[0]) showPreview(inputImage.files[0]);
    if (inputImage.files[0]) {
        const formData = new FormData();
        formData.append('image', inputImage.files[0]);
        fetch('/upload-copy', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to upload image copy');
            }
            return response.json();
        })
        .then(data => debugLog('Image copy uploaded:', data))
        .catch(error => {
            console.error('Error uploading image copy:', error);
        });
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

dropArea.addEventListener('click', () => inputImage.click());

dropArea.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file) {
        inputImage.files = e.dataTransfer.files;
        showPreview(file);
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
        // Prevent double submission (only if a request is actively being processed or queued)
        if (currentRequestId) {
            alert('A request is already being processed or queued. Please wait.');
            debugLog('Upload blocked: currentRequestId exists', currentRequestId);
            return;
        }
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        disableUpload();
        resetUIForNewUpload();
        const formData = new FormData();
        formData.append('image', inputImage.files[0]);
        formData.append('prompt', document.getElementById('prompt').value);
        formData.append('steps', document.getElementById('steps').value);
        formData.append('outputHeight', document.getElementById('outputHeight').value);
        for (let i = 1; i <= 5; i++) {
            formData.append(`lora_${i}_on`, document.getElementById(`lora_${i}_on`).checked ? 'true' : 'false');
            formData.append(`lora_${i}_strength`, document.getElementById(`lora_${i}_strength`).value);
        }
        if (!isLocal && !captchaDisabled) {
            var captchaAnswer = document.getElementById('captcha_answer');
            var captchaToken = document.getElementById('captcha_token');
            if (captchaAnswer && captchaToken) {
                formData.append('captcha_answer', captchaAnswer.value.trim());
                formData.append('captcha_token', captchaToken.value);
            }
        }
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', e => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                processingStatusSpan.textContent = `Uploading: ${Math.round(percent)}%`;
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
                        return;
                    }
                    currentRequestId = response.requestId;
                    sessionStorage.setItem('activeRequestId', currentRequestId);
                    // Always join the room for this request
                    socket.emit('joinRoom', currentRequestId);
                    queueSizeSpan.textContent = response.queueSize;
                    yourPositionSpan.textContent = response.yourPosition > 0 ? response.yourPosition : 'Processing';
                    processingStatusSpan.textContent = 'Waiting';
                    updateProgressPercentage('');
                    outputPlaceholder.textContent = `Image uploaded. Waiting for processing.`;
                    // Always clear and start polling
                    if (pollingIntervalId) {
                        clearInterval(pollingIntervalId);
                    }
                    pollingIntervalId = setInterval(fetchQueueStatus, 2000);
                    fetchQueueStatus();
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
                    currentRequestId = null;
                    if (pollingIntervalId) {
                        clearInterval(pollingIntervalId);
                        pollingIntervalId = null;
                    }
                    yourPositionSpan.textContent = 'Error';
                    processingStatusSpan.textContent = 'Failed';
                    updateProgressPercentage('');
                    debugLog('Upload error:', errorMsg);
                }
            }
        };
        xhr.onerror = err => {
            enableUpload();
            displayError('Network error during upload.');
            console.error('XHR upload error:', err);
        };
        xhr.open('POST', '/upload', true);
        xhr.send(formData);
    } catch (err) {
        enableUpload();
        displayError('Unexpected error during upload.');
        console.error('Unexpected error in uploadForm submit:', err);
    }
});

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
        queueSizeSpan.textContent = data.queueSize;
        if (currentRequestId) {
            switch (data.status) {
                case 'pending':
                    yourPositionSpan.textContent = `${data.yourPosition}`;
                    processingStatusSpan.textContent = 'Waiting';
                    updateProgressPercentage('');
                    outputPlaceholder.textContent = `Waiting in queue: Position ${data.yourPosition}`;
                    outputPlaceholder.style.display = 'block';
                    outputImage.style.display = 'none';
                    break;
                case 'processing':
                    yourPositionSpan.textContent = 'Processing';
                    processingStatusSpan.textContent = 'Processing';
                    outputPlaceholder.style.display = 'block';
                    outputImage.style.display = 'none';
                    break;
                case 'completed':
                    yourPositionSpan.textContent = 'Done!';
                    processingStatusSpan.textContent = 'Complete';
                    updateProgressPercentage('');
                    if (data.result && data.result.outputImage) {
                        try {
                            displayResult(data.result.outputImage);
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
                    yourPositionSpan.textContent = 'Error!';
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
                    yourPositionSpan.textContent = 'N/A';
                    updateProgressPercentage('');
                    break;
            }
        } else if (!data.isProcessing && data.queueSize === 0) {
            processingStatusSpan.textContent = 'Idle';
            yourPositionSpan.textContent = 'N/A';
            updateProgressPercentage('');
            outputPlaceholder.textContent = 'Your processed image will appear here.';
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
            yourPositionSpan.textContent = 'Error';
            updateProgressPercentage('');
            displayError('Failed to get status. Please check connection.');
            if (pollingIntervalId) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
            }
        }
    }
}

// --- Seamless Carousel Setup ---
async function setupCarousel() {
    debugLog('Setting up carousel...');
    const carouselSlide = document.querySelector('.carousel-slide');
    if (!carouselSlide) {
        debugLog('No carousel-slide element found');
        return;
    }
    try {
        const response = await fetch('/api/carousel-images');
        if (!response.ok) {
            throw new Error('Failed to fetch carousel images');
        }
        const carouselImages = await response.json();
        debugLog('Carousel images:', carouselImages);
        if (carouselImages.length > 0) {
            carouselImages.forEach(image => {
                const img = document.createElement('img');
                img.src = `/img/carousel/${image}`;
                img.alt = "Carousel Image";
                carouselSlide.appendChild(img);
            });
            const images = carouselSlide.querySelectorAll('img');
            images.forEach(img => {
                const clone = img.cloneNode(true);
                carouselSlide.appendChild(clone);
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
    debugLog('Initializing page...');
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

    // Settings Toggle
    const settingsToggle = document.getElementById('settings-toggle');
    const settingsCol = document.querySelector('.settings-col.collapsible');
    settingsToggle.addEventListener('click', () => {
        settingsCol.classList.toggle('open');
    });

    // Image Comparison Slider
    const slider = document.getElementById('comparison-slider');
    const outputImage = document.getElementById('comparison-output-image');

    slider.addEventListener('input', (e) => {
        outputImage.style.clipPath = `inset(0 ${100 - e.target.value}% 0 0)`;
    });
}

initialize();

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
