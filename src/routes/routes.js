const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs");
const { generateCaptcha, verifyCaptcha } = require("../captcha/captcha");
const { upload, uploadCopy } = require('../uploads/uploads');
const { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue } = require('../queue/queue');

const router = express.Router();

// Function to generate all carousel thumbnails on server startup
async function generateAllCarouselThumbnails() {
    try {
        console.log('[CAROUSEL STARTUP] Starting thumbnail pre-generation...');
        
        // Handle both development and production paths
        const baseDir = process.env.NODE_ENV === 'production' ? '/app' : __dirname + '/../..';
        const carouselDir = path.join(baseDir, 'public/img/carousel');
        const thumbnailsDir = path.join(baseDir, 'public/img/carousel/thumbnails');
        
        // Ensure thumbnails directory exists
        await fs.promises.mkdir(thumbnailsDir, { recursive: true });
        
        // Get all image files
        const files = await fs.promises.readdir(carouselDir);
        const imageFiles = files.filter(file => 
            /\.(jpg|jpeg|png|gif)$/i.test(file) && 
            !file.startsWith('thumb_') // Skip existing thumbnails
        );
        
        console.log(`[CAROUSEL STARTUP] Found ${imageFiles.length} images to process`);
        
        let processed = 0;
        let skipped = 0;
        
        // Process each image
        for (const filename of imageFiles) {
            try {
                const originalPath = path.join(carouselDir, filename);
                const ext = path.extname(filename);
                const nameWithoutExt = path.basename(filename, ext);
                const thumbnailFilename = `thumb_${nameWithoutExt}.jpg`;
                const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);
                
                // Check if thumbnail already exists and is newer than original
                try {
                    const [thumbnailStats, originalStats] = await Promise.all([
                        fs.promises.stat(thumbnailPath),
                        fs.promises.stat(originalPath)
                    ]);
                    
                    if (thumbnailStats.mtime > originalStats.mtime) {
                        console.log(`[CAROUSEL STARTUP] Thumbnail already exists for: ${filename}`);
                        skipped++;
                        continue;
                    }
                } catch (err) {
                    // Thumbnail doesn't exist, we'll create it
                }
                
                console.log(`[CAROUSEL STARTUP] Generating thumbnail for: ${filename}`);
                
                // Get image metadata to calculate optimal dimensions
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
                
                // Generate optimized thumbnail
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
                
                // Save thumbnail
                await fs.promises.writeFile(thumbnailPath, optimizedImage);
                console.log(`[CAROUSEL STARTUP] Thumbnail saved: ${thumbnailPath}`);
                processed++;
                
            } catch (error) {
                console.error(`[CAROUSEL STARTUP] Error processing ${filename}:`, error);
            }
        }
        
        console.log(`[CAROUSEL STARTUP] Thumbnail generation complete! Processed: ${processed}, Skipped: ${skipped}`);
        
    } catch (error) {
        console.error('[CAROUSEL STARTUP] Error during thumbnail generation:', error);
    }
}

// Generate all carousel thumbnails on server startup
generateAllCarouselThumbnails();

router.get('/', (req, res) => {
    res.render('index', { captchaDisabled: process.env.CAPTCHA_DISABLED === 'true' });
});

// Optimized carousel images route - serves pre-generated thumbnails
router.get('/img/carousel/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        
        // Handle both development and production paths
        const baseDir = process.env.NODE_ENV === 'production' ? '/app' : __dirname + '/../..';
        const thumbnailsDir = path.join(baseDir, 'public/img/carousel/thumbnails');
        
        // Create thumbnail filename - always JPEG
        const ext = path.extname(filename);
        const nameWithoutExt = path.basename(filename, ext);
        const thumbnailFilename = `thumb_${nameWithoutExt}.jpg`;
        const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);
        
        console.log(`[CAROUSEL] Serving thumbnail for: ${filename}`);
        
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
            console.error(`[CAROUSEL] Thumbnail not found: ${thumbnailPath}`);
            
            // Fallback: try to serve the original file
            const originalPath = path.join(baseDir, 'public/img/carousel', filename);
            try {
                await fs.promises.access(originalPath);
                console.log(`[CAROUSEL] Serving original file as fallback: ${filename}`);
                res.sendFile(originalPath);
            } catch (fallbackError) {
                console.error('[CAROUSEL] Original file also not found:', fallbackError);
                res.status(404).send('Image not found');
            }
        }
        
    } catch (error) {
        console.error('[CAROUSEL] Error serving carousel image:', error);
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

// Debug route for carousel troubleshooting
router.get('/debug/carousel', (req, res) => {
    const carouselDir = path.join(__dirname, '../../public/img/carousel');
    const thumbnailsDir = path.join(carouselDir, 'thumbnails');
    
    try {
        const files = fs.readdirSync(carouselDir);
        const thumbnails = fs.existsSync(thumbnailsDir) ? fs.readdirSync(thumbnailsDir) : [];
        
        const debug = {
            carouselDir,
            thumbnailsDir,
            originalFiles: files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file)),
            thumbnails,
            sharpAvailable: !!sharp,
            nodeVersion: process.version,
            platform: process.platform
        };
        
        res.json(debug);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test route to manually trigger carousel images
router.get('/test/carousel', (req, res) => {
    const carouselDir = path.join(__dirname, '../../public/img/carousel');
    fs.readdir(carouselDir, (err, files) => {
        if (err) {
            console.error('Error reading carousel directory:', err);
            return res.status(500).json({ error: 'Failed to read carousel images' });
        }
        const carouselImages = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
        
        let html = '<h1>Carousel Images Test</h1>';
        html += '<p>Found ' + carouselImages.length + ' images:</p>';
        carouselImages.forEach(image => {
            html += `<div style="margin: 10px 0;">`;
            html += `<p><strong>${image}</strong></p>`;
            html += `<img src="/img/carousel/${image}" style="max-width: 300px; height: auto; border: 1px solid #ccc;" onerror="this.style.border='3px solid red'; this.alt='Failed to load';">`;
            html += `</div>`;
        });
        
        res.send(html);
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

module.exports = { router, generateAllCarouselThumbnails };
