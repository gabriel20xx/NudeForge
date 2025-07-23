const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { generateCaptcha, verifyCaptcha } = require('../captcha');
const { upload, uploadCopy } = require('../uploads');
const { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue } = require('../queue');

const router = express.Router();

const fs = require('fs');

router.get('/', (req, res) => {
    res.render('index', { captchaDisabled: process.env.CAPTCHA_DISABLED === 'true' });
});

router.get('/api/carousel-images', (req, res) => {
    const carouselDir = path.join(__dirname, '../../public/img/carousel');
    fs.readdir(carouselDir, (err, files) => {
        if (err) {
            console.error('Error reading carousel directory:', err);
            return res.status(500).json({ error: 'Failed to read carousel images' });
        }
        const carouselImages = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
        res.json(carouselImages);
    });
});

router.get('/captcha', generateCaptcha);

router.get('/api/captcha-status', (req, res) => {
    res.json({ captchaDisabled: process.env.CAPTCHA_DISABLED === 'true' });
});

router.get('/queue-status', (req, res) => {
    const requestId = req.query.requestId;
    let yourPosition = -1;
    let status = 'unknown';
    let resultData = null;

    if (requestId) {
        if (requestId === getCurrentlyProcessingRequestId()) {
            yourPosition = 0;
            status = 'processing';
        } else {
            const queueIndex = getProcessingQueue().findIndex((item) => item.requestId === requestId);
            if (queueIndex !== -1) {
                yourPosition = queueIndex + 1;
                status = 'pending';
            } else if (getRequestStatus()[requestId]) {
                status = getRequestStatus()[requestId].status;
                resultData = getRequestStatus()[requestId].data;
            }
        }
    }

    res.json({
        queueSize: getProcessingQueue().length,
        isProcessing: getIsProcessing(),
        yourPosition: yourPosition,
        status: status,
        result: resultData,
    });
});

router.post('/upload', upload.single('image'), verifyCaptcha, async (req, res) => {
    if (!req.file) {
        return res.status(400).send("No file uploaded");
    }

    const uploadedFilename = req.file.filename;
    const uploadedPathForComfyUI = path.posix.join('input', uploadedFilename);
    const requestId = uuidv4();

    const { prompt, steps, outputHeight, ...loraSettings } = req.body;

    getRequestStatus()[requestId] = {
        status: "pending",
        totalNodesInWorkflow: 0,
        settings: { prompt, steps, outputHeight, ...loraSettings },
    };

    getProcessingQueue().push({
        requestId,
        uploadedFilename,
        uploadedPathForComfyUI,
    });

    processQueue(req.app.get('io'));

    res.status(202).json({
        message: "Image uploaded and added to queue.",
        requestId: requestId,
        queueSize: getProcessingQueue().length,
        yourPosition: getProcessingQueue().length,
    });
});

router.post("/upload-copy", uploadCopy.single("image"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ message: "Image copy uploaded successfully", filename: req.file.filename });
});

module.exports = router;
