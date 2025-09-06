import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Logger from '../../../NudeShared/server/logger/serverLogger.js';
import { SITE_TITLE, MAX_UPLOAD_FILES, OUTPUT_DIR } from '../config/config.js';
import { upload, uploadCopy } from '../services/uploads.js';
import { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue, cancelAll, cancelRequest } from '../services/queue.js';
import { query as dbQuery, buildProfileRouter, buildMediaLibraryRouter, buildMediaInteractionRouter, buildGenerationRouter, initializeSharedMediaService, searchMedia, getCategories, getAllMedia, getRandomMedia } from '../../../NudeShared/server/index.js';
import { getOrCreateOutputThumbnail } from '../services/thumbnails.js';
import { getAvailableLoRAs, getAvailableLoRAsWithSubdirs } from '../services/loras.js';

// __dirname shim for ESM (this file uses __dirname for file system paths)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
// Initialize shared media service and mount shared routers (profile, media library/interaction, generation)
await initializeSharedMediaService();
const mediaService = { searchMedia, getCategories, getAllMedia, getRandomMedia };
const sharedUtils = {
        createSuccessResponse: (data, message='OK') => ({ success:true, data, message }),
        createErrorResponse: (error, message='ERR') => ({ success:false, error: (error&&error.message)||error, message })
};
router.use('/api', buildMediaLibraryRouter({ utils: sharedUtils, mediaService, outputDir: OUTPUT_DIR }));
router.use('/api', buildMediaInteractionRouter(sharedUtils));
router.use('/api', buildProfileRouter({ utils: sharedUtils, siteTitle: SITE_TITLE }));
router.use('/api', buildGenerationRouter({
    queue: { getProcessingQueue, getRequestStatus, getCurrentlyProcessingRequestId, getIsProcessing, processQueue, cancelAll, cancelRequest },
    uploads: { upload, uploadCopy },
    config: { MAX_UPLOAD_FILES, OUTPUT_DIR },
    utils: Logger
}));

// API: list current user's generated media (kept local; not yet in shared router)
router.get('/api/my-media', async (req, res) => {
    try {
        const user = req.session && req.session.user;
        if (!user || !user.id) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }
        const uid = user.id;
        const { rows } = await dbQuery('SELECT media_key, original_filename, created_at FROM media WHERE user_id = $1 ORDER BY id DESC LIMIT 1000', [uid]);
        const images = (rows || []).map(r => {
            const key = String(r.media_key || '').trim().replace(/\\/g, '/');
            // Encode each segment for safe URLs
            const encoded = key.split('/').map(encodeURIComponent).join('/');
            const name = key.split('/').pop() || key;
            return {
                name,
                url: `/output/${encoded}`,
                thumbnail: `/thumbs/output/${encoded}?w=480`
            };
        });
        return res.json({ success: true, images });
    } catch (e) {
        Logger.error('MY_MEDIA', 'Failed to list user media', e);
        return res.status(500).json({ success: false, error: 'Failed to list media' });
    }
});

// Legacy library, cancel, upload & download routes removed (now handled by shared routers)

// Output thumbnails route (serves cached resized JPEGs)
// Support nested thumbnails under OUTPUT_DIR (e.g., /thumbs/output/sub/dir/file.png)
router.get('/thumbs/output/:rest(*)', async (req, res) => {
    try {
        const { OUTPUT_DIR } = await import('../config/config.js');
        const rest = (req.params.rest || '').toString();
        // Security: ensure requested path resolves within OUTPUT_DIR
        const normalized = path.normalize(rest).replace(/^\.+[\\/]?/, '');
        const candidateAbs = path.join(OUTPUT_DIR, normalized);
        const rel = path.relative(OUTPUT_DIR, candidateAbs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return res.status(400).send('Invalid path');
        }
        // Optional query params for size
        const w = Number(req.query.w) || undefined;
        const h = Number(req.query.h) || undefined;
        const filePath = await getOrCreateOutputThumbnail(OUTPUT_DIR, normalized, { w, h });
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

// Upload / queue status / cancel / download handled by shared generation router

export { router };
