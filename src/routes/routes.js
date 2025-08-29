import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Logger from '../../../NudeShared/serverLogger.js';
import { SITE_TITLE, MAX_UPLOAD_FILES } from '../config/config.js';
import { upload, uploadCopy } from '../services/uploads.js';
import { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue } from '../services/queue.js';
import { /* generateAllCarouselThumbnails, */ getThumbnailPath, getOriginalPath } from '../services/carousel.js';
import { getOrCreateOutputThumbnail } from '../services/thumbnails.js';
import { getAvailableLoRAs, getAvailableLoRAsWithSubdirs } from '../services/loras.js';

// __dirname shim for ESM (this file uses __dirname for file system paths)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
// Inject global locals
router.use(async (req, res, next) => {
    try {
        const { PRELOAD_RADIUS } = await import('../config/config.js');
        res.locals.preloadRadius = PRELOAD_RADIUS;
    } catch {}
    next();
});

// Lightweight health endpoint (placed early to avoid 404 handling issues)
router.get('/health', (req, res) => {
    return res.json({
        status: 'ok',
        uptime: process.uptime(),
        queueSize: getProcessingQueue().length,
        processing: getIsProcessing(),
        timestamp: new Date().toISOString()
    });
});

// Default route: generator (moved former index content into generator view)
router.get('/', (req, res) => {
    res.render('generator', { title: 'Generator', siteTitle: SITE_TITLE, maxUploadFiles: MAX_UPLOAD_FILES });
});

// Library & Profile placeholder pages (reuse layout or supply minimal placeholders)
router.get('/library', async (req, res) => {
    const { PRELOAD_RADIUS } = await import('../config/config.js');
    res.render('library', { title: 'Library', siteTitle: SITE_TITLE, showLibraryModeToggle: true, preloadRadius: PRELOAD_RADIUS });
});

router.get('/profile', (req, res) => {
    res.render('profile', { title: 'Profile', siteTitle: SITE_TITLE });
});

// Optimized carousel images route - serves pre-generated thumbnails (updated path /images)
router.get('/images/carousel/:filename', async (req, res) => {
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
            
    } catch {
            Logger.error('CAROUSEL', `Thumbnail not found: ${thumbnailPath}`);
            
            // Fallback: try to serve the original file
            const originalPath = getOriginalPath(filename);
            try {
                await fs.promises.access(originalPath);
                Logger.info('CAROUSEL', `Serving original file as fallback: ${filename}`);
                res.sendFile(originalPath);
            } catch (_fallbackErr) {
                Logger.error('CAROUSEL', 'Original file also not found:', _fallbackErr);
                res.status(404).send('Image not found');
            }
        }
        
    } catch (_carouselErr) {
        Logger.error('CAROUSEL', 'Error serving carousel image:', _carouselErr);
        res.status(500).send('Error processing image');
    }
});

router.get('/api/carousel-images', (req, res) => {
    const carouselDir = path.join(__dirname, '../public/images/carousel');
    fs.readdir(carouselDir, (err, files) => {
        if (err) {
            Logger.error('CAROUSEL', 'Error reading carousel directory:', err);
            return res.status(500).json({ error: 'Failed to read carousel images' });
        }
        const carouselImages = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
        Logger.info('CAROUSEL', `Listing ${carouselImages.length} carousel image(s) from ${carouselDir}`);
        res.json(carouselImages);
    });
});

// API: list output images for Library
router.get('/api/library-images', async (req, res) => {
    try {
        const { OUTPUT_DIR } = await import('../config/config.js');
        const files = await fs.promises.readdir(OUTPUT_DIR);
        const images = files
            .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
            .sort((a,b) => fs.statSync(path.join(OUTPUT_DIR,b)).mtimeMs - fs.statSync(path.join(OUTPUT_DIR,a)).mtimeMs)
            .slice(0, 500);
        // Return paths relative to /output static mount and include thumbnail endpoint
        const items = images.map(name => ({
            name,
            url: `/output/${encodeURIComponent(name)}`,
            thumbnail: `/thumbs/output/${encodeURIComponent(name)}`
        }));
        res.json({ success: true, images: items });
    } catch (err) {
        Logger.error('LIBRARY', 'Failed to list output images:', err);
        res.status(500).json({ success: false, error: 'Failed to list library images' });
    }
});

// Output thumbnails route (serves cached resized JPEGs)
router.get('/thumbs/output/:filename', async (req, res) => {
    try {
        const { OUTPUT_DIR } = await import('../config/config.js');
        const filename = req.params.filename;
        // Optional query params for size
        const w = Number(req.query.w) || undefined;
        const h = Number(req.query.h) || undefined;
        const filePath = await getOrCreateOutputThumbnail(OUTPUT_DIR, filename, { w, h });
        res.set({ 'Cache-Control': 'public, max-age=86400', 'Content-Type': 'image/jpeg' });
        return res.sendFile(filePath);
    } catch (e) {
        Logger.error('THUMBS', 'Error serving output thumbnail:', e);
        return res.status(404).send('Thumbnail not available');
    }
});

// CAPTCHA removed

// API endpoint to get available LoRA models
router.get('/api/loras', async (req, res) => {
    try {
        const loras = await getAvailableLoRAs();
        res.json({
            success: true,
            loras: loras
        });
    } catch (_error) {
        Logger.error('LORAS_API', 'Error fetching LoRA models:', _error);
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
    } catch (_error) {
        Logger.error('LORAS_API', 'Error fetching detailed LoRA models:', _error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch LoRA models'
        });
    }
});

// Debug endpoint to check LoRA directory configuration
router.get('/api/loras/debug', async (req, res) => {
    const { LORAS_DIR } = await import('../config/config.js');
    
    try {
        const debugInfo = {
            lorasDir: LORAS_DIR,
            lorasDirExists: false,
            lorasDirAccessible: false,
            directoryContents: [],
            error: null
        };

        // Check if directory exists
        try {
            await fs.promises.access(LORAS_DIR);
            debugInfo.lorasDirExists = true;
            debugInfo.lorasDirAccessible = true;
        } catch (error) {
            debugInfo.error = `Directory access failed: ${error.message}`;
            Logger.error('LORAS_DEBUG', 'Directory access failed:', error);
        }

        // If accessible, get directory contents
        if (debugInfo.lorasDirAccessible) {
            try {
                const files = await fs.promises.readdir(LORAS_DIR, { withFileTypes: true });
                debugInfo.directoryContents = files.map(file => ({
                    name: file.name,
                    isFile: file.isFile(),
                    isDirectory: file.isDirectory(),
                    path: path.join(LORAS_DIR, file.name)
                }));
            } catch (error) {
                debugInfo.error = `Failed to read directory contents: ${error.message}`;
                Logger.error('LORAS_DEBUG', 'Failed to read directory contents:', error);
            }
        }

        res.json({
            success: true,
            debug: debugInfo
        });
    } catch (_error) {
        Logger.error('LORAS_DEBUG', 'Debug endpoint error:', _error);
        res.status(500).json({
            success: false,
            error: _error.message
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

router.post('/upload', upload.array('image', MAX_UPLOAD_FILES), async (req, res) => {
    try {
        const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
        if (!files || files.length === 0) {
            Logger.warn('UPLOAD', 'No file uploaded');
            return res.status(400).send("No file uploaded");
        }

        const { prompt, steps, outputHeight, ...loraSettings } = req.body;
        const initialQueueSize = getProcessingQueue().length;
        const createdIds = [];

        for (const f of files) {
            const uploadedFilename = f.filename;
            const originalFilename = f.originalname;
            const uploadedPathForComfyUI = path.posix.join('input', uploadedFilename);
            const requestId = uuidv4();
            createdIds.push(requestId);

            Logger.info('UPLOAD', `Received upload: filename=${uploadedFilename}, original=${originalFilename}, requestId=${requestId}`);
            Logger.debug('UPLOAD_SETTINGS', 'Raw body settings: ' + JSON.stringify({ prompt, steps, outputHeight, ...loraSettings }));

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
        }

        Logger.info('QUEUE', `Added ${createdIds.length} item(s) to queue. Queue size: ${getProcessingQueue().length}`);
        if (process.env.SKIP_QUEUE_PROCESSING === 'true') {
            Logger.info('QUEUE', 'Skipping queue processing (test mode)');
        } else {
            processQueue(req.app.get('io'));
        }

        const firstRequestId = createdIds[0];
        const yourPosition = initialQueueSize + 1;
        res.status(202).json({
            message: createdIds.length > 1 ? `Images uploaded and added to queue (${createdIds.length}).` : "Image uploaded and added to queue.",
            requestId: firstRequestId,
            requestIds: createdIds,
            queued: createdIds.length,
            queueSize: getProcessingQueue().length,
            yourPosition,
        });
    } catch (_uploadErr) {
        Logger.error('UPLOAD', 'Error handling upload:', _uploadErr);
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
    } catch (_uploadCopyErr) {
        Logger.error('UPLOAD-COPY', 'Error:', _uploadCopyErr);
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
    } catch {
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
        
    } catch (_downloadErr) {
        Logger.error('DOWNLOAD', 'Error serving download:', _downloadErr);
        res.status(500).send('Error serving download');
    }
});

    export { router };
