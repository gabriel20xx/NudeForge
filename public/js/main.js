// DOM Elements
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

// State Variables
let currentRequestId = null;
let pollingIntervalId = null;

// --- Socket.IO Setup ---
const socket = io();

socket.on('connect', () => {
    if (currentRequestId) {
        socket.emit('joinRoom', currentRequestId);
    }
});

// Helper to update all progress percentage spans
function updateProgressPercentage(text) {
    progressPercentageSpans.forEach(span => {
        span.textContent = text;
    });
}

// Listen for processing progress updates from the server
socket.on('processingProgress', (progress) => {
    let percentage;
    if (progress.type === "global_steps") {
        percentage = Math.round((progress.value / progress.max) * 100);
    } else {
        percentage = Math.round((progress.value / progress.max) * 100);
    }

    if (isNaN(percentage)) {
        return;
    }

    updateProgressPercentage(`: ${percentage}%`);
    processingStatusSpan.textContent = 'Processing';
    outputPlaceholder.textContent = `Processing your image: ${percentage}% Done`;
});

// Listen for immediate queue updates
socket.on('queueUpdate', (data) => {
    queueSizeSpan.textContent = data.queueSize;

    if (currentRequestId && data.requestId === currentRequestId) {
        if (data.status === 'processing') {
            yourPositionSpan.textContent = 'Processing';
            processingStatusSpan.textContent = 'Processing';
            updateProgressPercentage('');
            outputPlaceholder.textContent = `Processing your image...`;
            outputPlaceholder.style.display = 'block';
            outputImage.style.display = 'none';
            downloadLink.style.display = 'none';
        } else if (data.status === 'pending') {
            yourPositionSpan.textContent = `${data.yourPosition}`;
            processingStatusSpan.textContent = 'Waiting';
            updateProgressPercentage('');
            outputPlaceholder.textContent = `Waiting in queue: Position ${data.yourPosition}`;
            outputPlaceholder.style.display = 'block';
            outputImage.style.display = 'none';
            downloadLink.style.display = 'none';
        }
    } else if (!currentRequestId && !data.isProcessing && data.queueSize === 0) {
        processingStatusSpan.textContent = 'Idle';
        yourPositionSpan.textContent = 'N/A';
        updateProgressPercentage('');
        outputPlaceholder.textContent = 'Your processed image will appear here.';
        outputPlaceholder.style.display = 'block';
        outputImage.style.display = 'none';
        downloadLink.style.display = 'none';
    }
});

// Handle processing completion via Socket.IO
socket.on('processingComplete', (data) => {
    if (currentRequestId && data.requestId === currentRequestId && data.outputImage) {
        yourPositionSpan.textContent = 'Done!';
        processingStatusSpan.textContent = 'Complete';
        updateProgressPercentage('');

        displayResult(data.outputImage);

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

// --- UI Helper Functions ---

function disableUpload() {
    uploadButton.disabled = true;
    uploadButton.textContent = 'Processing...';
    inputImage.disabled = true;
    dropArea.classList.add('disabled');
    dropArea.style.pointerEvents = 'none';
}

function enableUpload() {
    uploadButton.disabled = false;
    uploadButton.textContent = 'Upload';
    inputImage.disabled = false;
    dropArea.classList.remove('disabled');
    dropArea.style.pointerEvents = 'auto';
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isLocal && !captchaDisabled) {
        fetchCaptcha();
    }
    var captchaAnswer = document.getElementById('captcha_answer');
    if (captchaAnswer) captchaAnswer.value = '';
}

function resetUIForNewUpload() {
    outputImage.style.display = 'none';
    outputImage.src = '';
    outputPlaceholder.style.display = 'block';
    outputPlaceholder.style.color = '#fff';
    outputPlaceholder.textContent = 'Uploading...';
    downloadLink.style.display = 'none';
    downloadLink.href = '#';
    currentRequestId = null;
    yourPositionSpan.textContent = 'Submitting...';
    processingStatusSpan.textContent = 'Uploading...';
    updateProgressPercentage('');
    queueSizeSpan.textContent = '0';

    const comparisonContainer = document.querySelector('.comparison-container');
    if (comparisonContainer) {
        comparisonContainer.style.display = 'none';
    }

    if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
        pollingIntervalId = null;
    }
}

function displayResult(imageUrl) {
    if (!imageUrl) {
        displayError("No image URL provided for display.");
        return;
    }

    outputImage.src = imageUrl;

    outputImage.onload = () => {
        outputImage.style.display = 'block';
        outputPlaceholder.style.display = 'none';

        const comparisonContainer = document.querySelector('.comparison-container');
        const comparisonInputImage = document.getElementById('comparison-input-image');
        const comparisonOutputImage = document.getElementById('comparison-output-image');
        const previewImageSrc = previewImage.src;

        if (comparisonContainer && comparisonInputImage && comparisonOutputImage && previewImageSrc) {
            comparisonInputImage.style.backgroundImage = `url(${previewImageSrc})`;
            comparisonOutputImage.style.backgroundImage = `url(${imageUrl})`;
            comparisonContainer.style.display = 'block';
        }
    };

    outputImage.onerror = () => {
        displayError("Failed to load processed image. Check console for network errors.");
        outputImage.style.display = 'none';
        outputPlaceholder.style.display = 'block';
    };

    const filename = imageUrl.split('/').pop();
    downloadLink.href = imageUrl;
    downloadLink.setAttribute('download', filename);
    downloadLink.style.display = 'inline-block';
}

function displayError(errorMessage) {
    outputPlaceholder.textContent = `Error: ${errorMessage}`;
    outputPlaceholder.style.color = 'red';
    outputPlaceholder.style.display = 'block';
    outputImage.style.display = 'none';
    downloadLink.style.display = 'none';
}

// --- Image Preview and Drag/Drop ---
function showPreview(file) {
    const reader = new FileReader();
    reader.onload = e => {
        previewImage.src = e.target.result;
        previewImage.style.display = 'block';
        dropText.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

inputImage.addEventListener('change', () => {
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
    e.preventDefault();

    if (!inputImage.files || inputImage.files.length === 0) {
        alert('Please select an image before uploading.');
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
        }
    });

    xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
            if (xhr.status === 202) {
                const response = JSON.parse(xhr.responseText);
                currentRequestId = response.requestId;
                sessionStorage.setItem('activeRequestId', currentRequestId);

                socket.emit('joinRoom', currentRequestId);

                queueSizeSpan.textContent = response.queueSize;
                yourPositionSpan.textContent = response.yourPosition > 0 ? response.yourPosition : 'Processing';
                processingStatusSpan.textContent = 'Waiting';
                updateProgressPercentage('');
                outputPlaceholder.textContent = `Image uploaded. Waiting for processing.`;

                if (!pollingIntervalId) {
                    pollingIntervalId = setInterval(fetchQueueStatus, 2000);
                }
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
            }
        }
    };

    xhr.open('POST', '/upload', true);
    xhr.send(formData);
});

// --- Frontend Queue Polling ---
async function fetchQueueStatus() {
    try {
        let url = '/queue-status';
        if (currentRequestId) {
            url += `?requestId=${currentRequestId}`;
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

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
                    downloadLink.style.display = 'none';
                    break;
                case 'processing':
                    yourPositionSpan.textContent = 'Processing';
                    processingStatusSpan.textContent = 'Processing';
                    outputPlaceholder.style.display = 'block';
                    outputImage.style.display = 'none';
                    downloadLink.style.display = 'none';
                    break;
                case 'completed':
                    yourPositionSpan.textContent = 'Done!';
                    processingStatusSpan.textContent = 'Complete';
                    updateProgressPercentage('');
                    if (data.result && data.result.outputImage) {
                        displayResult(data.result.outputImage);
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
                    displayError(data.result.errorMessage || 'Unknown processing error from polling.');
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
            downloadLink.style.display = 'none';
            if (pollingIntervalId) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
            }
        }
    } catch (error) {
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
    const carouselSlide = document.querySelector('.carousel-slide');
    if (!carouselSlide) return;

    try {
        const response = await fetch('/api/carousel-images');
        if (!response.ok) {
            throw new Error('Failed to fetch carousel images');
        }
        const carouselImages = await response.json();

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
