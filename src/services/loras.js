import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LORAS_DIR } from '../config/config.js';
import Logger from '@gabriel20xx/nude-shared/serverLogger.js';

// __dirname shim for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Format a filename into a display name
 * - Remove file extension
 * - Replace underscores and hyphens with spaces
 * - Capitalize first letter of each word
 */
function formatDisplayName(filename) {
    // Remove file extension
    const nameWithoutExt = path.parse(filename).name;
    
    // Replace underscores and hyphens with spaces
    const spacedName = nameWithoutExt.replace(/[-_]/g, ' ');
    
    // Capitalize first letter of each word
    const displayName = spacedName.replace(/\b\w/g, l => l.toUpperCase());
    
    return displayName;
}

/**
 * Get all LoRA model files from the loras directory
 * Returns an array of objects with filename and displayName
 */
async function getAvailableLoRAs() {
    try {
        Logger.info('LORAS', `Starting LoRA scan. LORAS_DIR: ${LORAS_DIR}`);
        
        // Check if loras directory exists
        try {
            await fs.promises.access(LORAS_DIR);
            Logger.info('LORAS', `LoRAs directory exists and is accessible: ${LORAS_DIR}`);
        } catch (error) {
            Logger.warn('LORAS', `LoRAs directory not found or not accessible: ${LORAS_DIR}`, error);
            return [];
        }

        // Read directory contents
        const files = await fs.promises.readdir(LORAS_DIR, { withFileTypes: true });
        Logger.info('LORAS', `Found ${files.length} items in directory:`, files.map(f => `${f.name} (${f.isFile() ? 'file' : 'directory'})`));
        
        // Filter for common LoRA file extensions and process them
        const loraExtensions = ['.safetensors', '.ckpt', '.pt', '.pth'];
        Logger.info('LORAS', `Looking for files with extensions: ${loraExtensions.join(', ')}`);
        
        const loraFiles = files
            .filter(file => {
                const isLoraFile = file.isFile() && loraExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
                Logger.debug('LORAS', `File ${file.name}: isFile=${file.isFile()}, hasValidExtension=${loraExtensions.some(ext => file.name.toLowerCase().endsWith(ext))}, included=${isLoraFile}`);
                return isLoraFile;
            })
            .map(file => ({
                filename: file.name,
                displayName: formatDisplayName(file.name),
                path: path.join(LORAS_DIR, file.name)
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName)); // Sort alphabetically by display name

        Logger.info('LORAS', `Found ${loraFiles.length} LoRA models in ${LORAS_DIR}:`, loraFiles.map(f => f.filename));
        return loraFiles;

    } catch (error) {
        Logger.error('LORAS', 'Error reading LoRA directory:', error);
        return [];
    }
}

/**
 * Get LoRA models in subdirectories as well
 * Returns a nested structure with subdirectories
 */
async function getAvailableLoRAsWithSubdirs() {
    try {
        Logger.info('LORAS', `Starting detailed LoRA scan with subdirectories. LORAS_DIR: ${LORAS_DIR}`);
        Logger.info('LORAS', `process.cwd(): ${process.cwd()}`);
        Logger.info('LORAS', `__dirname: ${__dirname}`);
        
        const result = {
            root: [],
            subdirs: {}
        };

        // Check if loras directory exists
        try {
            await fs.promises.access(LORAS_DIR);
            Logger.info('LORAS', `LoRAs directory exists and is accessible for detailed scan: ${LORAS_DIR}`);
        } catch (error) {
            Logger.warn('LORAS', `LoRAs directory not found for detailed scan: ${LORAS_DIR}`, error);
            return result;
        }

        async function processDirectory(dirPath, relativePath = '') {
            Logger.info('LORAS', `Processing directory: ${dirPath}, relativePath: ${relativePath}`);
            const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
            Logger.info('LORAS', `Found ${files.length} items in ${dirPath}:`, files.map(f => `${f.name} (${f.isFile() ? 'file' : 'directory'})`));
            
            const loraExtensions = ['.safetensors', '.ckpt', '.pt', '.pth'];
            const loraFiles = [];

            for (const file of files) {
                const fullPath = path.join(dirPath, file.name);
                const relativeFilePath = relativePath ? path.join(relativePath, file.name) : file.name;

                if (file.isFile() && loraExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
                    // Use forward slashes for ComfyUI compatibility (cross-platform)
                    const normalizedRelativePath = relativePath ? 
                        path.posix.join(relativePath.replace(/\\/g, '/'), file.name) : 
                        file.name;
                    
                    loraFiles.push({
                        filename: file.name,
                        displayName: formatDisplayName(file.name),
                        relativePath: normalizedRelativePath,
                        fullPath: fullPath
                    });
                } else if (file.isDirectory()) {
                    // Recursively process subdirectories
                    const subdirResults = await processDirectory(fullPath, relativeFilePath);
                    if (subdirResults.length > 0) {
                        if (relativePath === '') {
                            result.subdirs[file.name] = subdirResults;
                        } else {
                            // Handle nested subdirectories
                            const pathParts = relativeFilePath.split(path.sep);
                            let current = result.subdirs;
                            for (let i = 0; i < pathParts.length - 1; i++) {
                                if (!current[pathParts[i]]) current[pathParts[i]] = {};
                                current = current[pathParts[i]];
                            }
                            current[file.name] = subdirResults;
                        }
                    }
                }
            }

            return loraFiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
        }

        result.root = await processDirectory(LORAS_DIR);
        Logger.info('LORAS', `Found ${result.root.length} root LoRA models and subdirectories in ${LORAS_DIR}`);
        Logger.info('LORAS', `Final result:`, JSON.stringify(result, null, 2));
        return result;

    } catch (error) {
        Logger.error('LORAS', 'Error reading LoRA directory with subdirectories:', error);
        return { root: [], subdirs: {} };
    }
}

export {
    getAvailableLoRAs,
    getAvailableLoRAsWithSubdirs,
    formatDisplayName
};
