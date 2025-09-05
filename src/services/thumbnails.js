import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import Logger from '../../../NudeShared/server/logger/serverLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generic thumbnail generator for files in OUTPUT_DIR.
 * Caches thumbnails under OUTPUT_DIR/.thumbs with same filename but .jpg extension.
 */
async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Compute the cache path for an output thumbnail.
 * @param {string} outputDir Absolute path to OUTPUT_DIR
 * @param {string} filename Filename within OUTPUT_DIR
 */
function getOutputThumbCachePath(outputDir, filename) {
  const nameNoExt = path.parse(filename).name;
  const cacheDir = path.join(outputDir, '.thumbs');
  const cacheFile = path.join(cacheDir, `${nameNoExt}.jpg`);
  return { cacheDir, cacheFile };
}

/**
 * Create or reuse a thumbnail for a given file in OUTPUT_DIR.
 * @param {string} outputDir Absolute path to OUTPUT_DIR
 * @param {string} filename Filename within OUTPUT_DIR
 * @param {{w?:number,h?:number,quality?:number}} opts Resize options
 * @returns {Promise<string>} Absolute path to cached thumbnail
 */
export async function getOrCreateOutputThumbnail(outputDir, filename, opts = {}) {
  const width = Math.max(32, Math.min(2048, Number(opts.w) || 480));
  const height = Math.max(0, Math.min(2048, Number(opts.h) || 0)); // 0 = auto
  const quality = Math.max(40, Math.min(90, Number(opts.quality) || 75));

  const originalPath = path.join(outputDir, filename);
  const { cacheDir, cacheFile } = getOutputThumbCachePath(outputDir, filename);
  await ensureDir(cacheDir);

  let needsRender = true;
  try {
    const [origStat, cacheStat] = await Promise.all([
      fs.promises.stat(originalPath),
      fs.promises.stat(cacheFile)
    ]);
    if (cacheStat.mtimeMs >= origStat.mtimeMs) {
      needsRender = false;
    }
  } catch {
    // cache missing or stale
    needsRender = true;
  }

  if (needsRender) {
    try {
      const pipeline = sharp(originalPath);
      const meta = await pipeline.metadata();
      let resizeW = width;
      let resizeH = height || null;
      if (!height && meta.width && meta.height) {
        // Bound longest side
        const ar = meta.width / meta.height;
        if (meta.width >= meta.height) {
          resizeW = Math.min(width, meta.width);
          resizeH = Math.round(resizeW / ar);
        } else {
          resizeH = Math.min(width, meta.height);
          resizeW = Math.round(resizeH * ar);
        }
      }
      const buf = await sharp(originalPath)
        .resize(resizeW, resizeH, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality, progressive: true, mozjpeg: true })
        .toBuffer();
      await fs.promises.writeFile(cacheFile, buf);
      Logger.info('THUMBS', `Generated thumbnail for ${filename} -> ${cacheFile}`);
    } catch (e) {
      Logger.error('THUMBS', 'Failed generating thumbnail:', e);
      throw e;
    }
  }

  return cacheFile;
}
