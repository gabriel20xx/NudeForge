const path = require("path");
const sharp = require("sharp");
const fs = require("fs");

/**
 * Carousel image optimization service
 * Handles thumbnail generation and management for carousel images
 */

/**
 * Generate all carousel thumbnails on server startup
 * @returns {Promise<{processed: number, skipped: number}>}
 */
async function generateAllCarouselThumbnails() {
    try {
        console.log('[CAROUSEL STARTUP] Starting thumbnail pre-generation...');
        
        // Handle both development and production paths
        const baseDir = process.env.NODE_ENV === 'production' ? '/app' : path.join(__dirname, '../..');
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
                const result = await generateThumbnail(filename, carouselDir, thumbnailsDir);
                if (result.generated) {
                    processed++;
                } else {
                    skipped++;
                }
            } catch (error) {
                console.error(`[CAROUSEL STARTUP] Error processing ${filename}:`, error);
            }
        }
        
        console.log(`[CAROUSEL STARTUP] Thumbnail generation complete! Processed: ${processed}, Skipped: ${skipped}`);
        return { processed, skipped };
        
    } catch (error) {
        console.error('[CAROUSEL STARTUP] Error during thumbnail generation:', error);
        throw error;
    }
}

/**
 * Generate a single thumbnail for a carousel image
 * @param {string} filename - Original image filename
 * @param {string} carouselDir - Directory containing original images
 * @param {string} thumbnailsDir - Directory for thumbnails
 * @returns {Promise<{generated: boolean, thumbnailPath?: string}>}
 */
async function generateThumbnail(filename, carouselDir, thumbnailsDir) {
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
            return { generated: false, thumbnailPath };
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
    
    return { generated: true, thumbnailPath };
}

/**
 * Get the thumbnail path for a given image filename
 * @param {string} filename - Original image filename
 * @returns {string} Path to the thumbnail
 */
function getThumbnailPath(filename) {
    const baseDir = process.env.NODE_ENV === 'production' ? '/app' : path.join(__dirname, '../..');
    const thumbnailsDir = path.join(baseDir, 'public/img/carousel/thumbnails');
    
    const ext = path.extname(filename);
    const nameWithoutExt = path.basename(filename, ext);
    const thumbnailFilename = `thumb_${nameWithoutExt}.jpg`;
    
    return path.join(thumbnailsDir, thumbnailFilename);
}

/**
 * Get the original image path for a given filename
 * @param {string} filename - Image filename
 * @returns {string} Path to the original image
 */
function getOriginalPath(filename) {
    const baseDir = process.env.NODE_ENV === 'production' ? '/app' : path.join(__dirname, '../..');
    return path.join(baseDir, 'public/img/carousel', filename);
}

module.exports = {
    generateAllCarouselThumbnails,
    generateThumbnail,
    getThumbnailPath,
    getOriginalPath
};
