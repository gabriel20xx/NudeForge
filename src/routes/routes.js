const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const Logger = require("../utils/logger");
const { generateCaptcha, verifyCaptcha } = require("../services/captcha");
const { upload, uploadCopy } = require('../services/uploads');
const { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue } = require('../services/queue');
const { generateAllCarouselThumbnails, getThumbnailPath, getOriginalPath } = require('../services/carousel');
const { getAvailableLoRAs, getAvailableLoRAsWithSubdirs } = require('../services/loras');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('index', { captchaDisabled: process.env.CAPTCHA_DISABLED === 'true' });
});

// Optimized carousel images route - serves pre-generated thumbnails
router.get('/img/carousel/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const thumbnailPath = getThumbnailPath(filename);
        
        Logger.info('CAROUSEL', `Serving thumbnail for: ${filename}`);
        
        // Check if thumbnail exists
        try {
            await fs.promises.access(thumbnailPath);
            
            // Set proper headers for caching
            res.set({
                'Cache-Control': 'public, max-age=86400', // 24 hours
                'Content-Type': 'image/jpeg'
            });
            
            // Serve cached thumbnail
            return res.sendFile(thumbnailPath);
            
        } catch (err) {
            Logger.error('CAROUSEL', `Thumbnail not found: ${thumbnailPath}`);
            
            // Fallback: try to serve the original file
            const originalPath = getOriginalPath(filename);
            try {
                await fs.promises.access(originalPath);
                Logger.info('CAROUSEL', `Serving original file as fallback: ${filename}`);
                res.sendFile(originalPath);
            } catch (fallbackError) {
                Logger.error('CAROUSEL', 'Original file also not found:', fallbackError);
                res.status(404).send('Image not found');
            }
        }
        
    } catch (error) {
        Logger.error('CAROUSEL', 'Error serving carousel image:', error);
        res.status(500).send('Error processing image');
    }
});

router.get('/api/carousel-images', (req, res) => {
    const carouselDir = path.join(__dirname, '../../public/img/carousel');
    fs.readdir(carouselDir, (err, files) => {
        if (err) {
            Logger.error('CAROUSEL', 'Error reading carousel directory:', err);
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

// API endpoint to get available LoRA models
router.get('/api/loras', async (req, res) => {
    try {
        const loras = await getAvailableLoRAs();
        res.json({
            success: true,
            loras: loras
        });
    } catch (error) {
        Logger.error('LORAS_API', 'Error fetching LoRA models:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch LoRA models'
        });
    }
});

// API endpoint to get available LoRA models with subdirectories
router.get('/api/loras/detailed', async (req, res) => {
    try {
        const loras = await getAvailableLoRAsWithSubdirs();
        res.json({
            success: true,
            loras: loras
        });
    } catch (error) {
        Logger.error('LORAS_API', 'Error fetching detailed LoRA models:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch LoRA models'
        });
    }
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
        uploadedFilename: getRequestStatus()[requestId]?.uploadedFilename,
    });
});

router.post('/upload', upload.single('image'), verifyCaptcha, async (req, res) => {
    try {
        if (!req.file) {
            Logger.warn('UPLOAD', 'No file uploaded');
            return res.status(400).send("No file uploaded");
        }

        const uploadedFilename = req.file.filename;
        const originalFilename = req.file.originalname;
        const uploadedPathForComfyUI = path.posix.join('input', uploadedFilename);
        const requestId = uuidv4();

        const { prompt, steps, outputHeight, ...loraSettings } = req.body;

        Logger.info('UPLOAD', `Received upload: filename=${uploadedFilename}, original=${originalFilename}, requestId=${requestId}`);
        getRequestStatus()[requestId] = {
            status: "pending",
            totalNodesInWorkflow: 0,
            originalFilename: originalFilename,
            uploadedFilename: uploadedFilename,
            settings: { prompt, steps, outputHeight, ...loraSettings },
        };

        getProcessingQueue().push({
            requestId,
            uploadedFilename,
            originalFilename,
            uploadedPathForComfyUI,
        });

        Logger.info('QUEUE', `Added to queue. Queue size: ${getProcessingQueue().length}`);
        processQueue(req.app.get('io'));

        res.status(202).json({
            message: "Image uploaded and added to queue.",
            requestId: requestId,
            queueSize: getProcessingQueue().length,
            yourPosition: getProcessingQueue().length,
        });
    } catch (err) {
        Logger.error('UPLOAD', 'Error handling upload:', err);
        res.status(500).json({ error: 'Internal server error during upload.' });
    }
});

router.post("/upload-copy", uploadCopy.single("image"), (req, res) => {
    try {
        if (!req.file) {
            Logger.warn('UPLOAD-COPY', 'No file uploaded');
            return res.status(400).json({ error: "No file uploaded" });
        }
        Logger.info('UPLOAD-COPY', `Image copy uploaded: ${req.file.filename}`);
        res.json({ message: "Image copy uploaded successfully", filename: req.file.filename });
    } catch (err) {
        Logger.error('UPLOAD-COPY', 'Error:', err);
        res.status(500).json({ error: 'Internal server error during upload-copy.' });
    }
});

// Download route that serves output files with original filenames
router.get('/download/:requestId', async (req, res) => {
    try {
        const requestId = req.params.requestId;
        const requestData = getRequestStatus()[requestId];
        
        if (!requestData || requestData.status !== 'completed') {
            return res.status(404).send('File not found or processing not completed');
        }
        
        if (!requestData.data || !requestData.data.outputImage) {
            return res.status(404).send('Output file not found');
        }
        
        // Get the actual output file path
        const outputRelativePath = requestData.data.outputImage; // e.g., "/output/12345678-myimage-nudified_00001.png"
        const outputFilename = path.basename(outputRelativePath); // e.g., "12345678-myimage-nudified_00001.png"
        const outputPath = path.join(__dirname, '../..', 'output', outputFilename);
        
        // Check if file exists
        try {
            await fs.promises.access(outputPath);
        } catch (err) {
            Logger.error('DOWNLOAD', `File not found: ${outputPath}`);
            return res.status(404).send('Output file not found');
        }
        
        // Generate download filename from original filename
        const originalFilename = requestData.originalFilename || 'processed-image.png';
        const originalBaseName = path.parse(originalFilename).name;
        const originalExt = path.extname(originalFilename);
        
        // Create a clean download filename: originalname-processed.png
        let downloadFilename;
        if (originalExt.toLowerCase() === '.png') {
            downloadFilename = `${originalBaseName}-processed.png`;
        } else {
            downloadFilename = `${originalBaseName}-processed.png`; // Always PNG output
        }
        
        Logger.info('DOWNLOAD', `Serving ${outputFilename} as ${downloadFilename} for request ${requestId}`);
        
        // Set headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        res.setHeader('Content-Type', 'image/png');
        
        // Send the file
        res.sendFile(outputPath);
        
    } catch (error) {
        Logger.error('DOWNLOAD', 'Error serving download:', error);
        res.status(500).send('Error serving download');
    }
});

module.exports = { router };
