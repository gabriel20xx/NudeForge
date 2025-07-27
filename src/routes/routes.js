const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs");
const { generateCaptcha, verifyCaptcha } = require("../captcha/captcha");
const { upload, uploadCopy } = require('../uploads/uploads');
const { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue } = require('../queue/queue');

const router = express.Router();

router.get('/', (req, res) => {
    res.render('index', { captchaDisabled: process.env.CAPTCHA_DISABLED === 'true' });
});

// Optimized carousel images route - serves compressed, resized images
router.get('/img/carousel/:filename', async (req, res) => {
    console.log(`[CAROUSEL] Optimizing image: ${req.params.filename}`);
    try {
        const filename = req.params.filename;
        const originalPath = path.join(__dirname, '../../public/img/carousel', filename);
        const thumbnailPath = path.join(__dirname, '../../public/img/carousel/thumbnails', `thumb_${filename}`);
        
        // Check if original file exists
        if (!fs.existsSync(originalPath)) {
            console.log(`[CAROUSEL] Original image not found: ${originalPath}`);
            return res.status(404).send('Image not found');
        }
        
        // Set appropriate headers for caching and compression
        res.set({
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
            'ETag': `"carousel-${filename}-optimized"`
        });
        
        // Check if client has cached version
        if (req.headers['if-none-match'] === `"carousel-${filename}-optimized"`) {
            console.log(`[CAROUSEL] Serving cached version for: ${filename}`);
            return res.status(304).end();
        }
        
        // Check if thumbnail already exists and is newer than original
        if (fs.existsSync(thumbnailPath)) {
            const originalStats = fs.statSync(originalPath);
            const thumbnailStats = fs.statSync(thumbnailPath);
            
            if (thumbnailStats.mtime > originalStats.mtime) {
                console.log(`[CAROUSEL] Serving existing thumbnail: ${filename}`);
                // Serve cached thumbnail
                return res.sendFile(thumbnailPath);
            }
        }
        
        console.log(`[CAROUSEL] Generating new thumbnail for: ${filename}`);
        // Generate new thumbnail with proper aspect ratio preservation
        // First get image metadata to calculate optimal dimensions
        const metadata = await sharp(originalPath).metadata();
        const originalWidth = metadata.width;
        const originalHeight = metadata.height;
        const originalAspectRatio = originalWidth / originalHeight;
        
        // Calculate target dimensions maintaining aspect ratio
        // Max dimensions: 800px width or 600px height, whichever is limiting
        let targetWidth, targetHeight;
        if (originalAspectRatio > (800 / 600)) {
            // Image is wider, limit by width
            targetWidth = Math.min(800, originalWidth);
            targetHeight = Math.round(targetWidth / originalAspectRatio);
        } else {
            // Image is taller, limit by height
            targetHeight = Math.min(600, originalHeight);
            targetWidth = Math.round(targetHeight * originalAspectRatio);
        }
        
        const optimizedImage = await sharp(originalPath)
            .resize(targetWidth, targetHeight, { 
                fit: 'contain', // Preserve aspect ratio exactly, no cropping
                withoutEnlargement: true
            })
            .jpeg({ 
                quality: 75,
                progressive: true,
                mozjpeg: true
            })
            .toBuffer();
        
        // Save thumbnail to cache
        await fs.promises.writeFile(thumbnailPath, optimizedImage);
        console.log(`[CAROUSEL] Thumbnail saved: ${thumbnailPath}`);
        
        res.send(optimizedImage);
        
    } catch (error) {
        console.error('[CAROUSEL] Error optimizing carousel image:', error);
        res.status(500).send('Error processing image');
    }
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
    try {
        if (!req.file) {
            console.warn('[UPLOAD] No file uploaded');
            return res.status(400).send("No file uploaded");
        }

        const uploadedFilename = req.file.filename;
        const uploadedPathForComfyUI = path.posix.join('input', uploadedFilename);
        const requestId = uuidv4();

        const { prompt, steps, outputHeight, ...loraSettings } = req.body;

        console.log(`[UPLOAD] Received upload: filename=${uploadedFilename}, requestId=${requestId}`);
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

        console.log(`[QUEUE] Added to queue. Queue size: ${getProcessingQueue().length}`);
        processQueue(req.app.get('io'));

        res.status(202).json({
            message: "Image uploaded and added to queue.",
            requestId: requestId,
            queueSize: getProcessingQueue().length,
            yourPosition: getProcessingQueue().length,
        });
    } catch (err) {
        console.error('[UPLOAD] Error handling upload:', err);
        res.status(500).json({ error: 'Internal server error during upload.' });
    }
});

router.post("/upload-copy", uploadCopy.single("image"), (req, res) => {
    try {
        if (!req.file) {
            console.warn('[UPLOAD-COPY] No file uploaded');
            return res.status(400).json({ error: "No file uploaded" });
        }
        console.log(`[UPLOAD-COPY] Image copy uploaded: ${req.file.filename}`);
        res.json({ message: "Image copy uploaded successfully", filename: req.file.filename });
    } catch (err) {
        console.error('[UPLOAD-COPY] Error:', err);
        res.status(500).json({ error: 'Internal server error during upload-copy.' });
    }
});

module.exports = router;
