const fs = require('fs');
const path = require('path');
const { LORAS_DIR } = require('../config/config');
const Logger = require('../utils/logger');

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
        // Check if loras directory exists
        try {
            await fs.promises.access(LORAS_DIR);
        } catch (error) {
            Logger.warn('LORAS', `LoRAs directory not found: ${LORAS_DIR}`);
            return [];
        }

        // Read directory contents
        const files = await fs.promises.readdir(LORAS_DIR, { withFileTypes: true });
        
        // Filter for common LoRA file extensions and process them
        const loraExtensions = ['.safetensors', '.ckpt', '.pt', '.pth'];
        const loraFiles = files
            .filter(file => file.isFile() && loraExtensions.some(ext => file.name.toLowerCase().endsWith(ext)))
            .map(file => ({
                filename: file.name,
                displayName: formatDisplayName(file.name),
                path: path.join(LORAS_DIR, file.name)
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName)); // Sort alphabetically by display name

        Logger.info('LORAS', `Found ${loraFiles.length} LoRA models in ${LORAS_DIR}`);
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
        const result = {
            root: [],
            subdirs: {}
        };

        // Check if loras directory exists
        try {
            await fs.promises.access(LORAS_DIR);
        } catch (error) {
            Logger.warn('LORAS', `LoRAs directory not found: ${LORAS_DIR}`);
            return result;
        }

        async function processDirectory(dirPath, relativePath = '') {
            const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
            const loraExtensions = ['.safetensors', '.ckpt', '.pt', '.pth'];
            const loraFiles = [];

            for (const file of files) {
                const fullPath = path.join(dirPath, file.name);
                const relativeFilePath = relativePath ? path.join(relativePath, file.name) : file.name;

                if (file.isFile() && loraExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
                    // Normalize path separators to forward slashes for ComfyUI compatibility
                    const normalizedRelativePath = relativePath ? relativeFilePath.replace(/\\/g, '/') : file.name;
                    
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
        return result;

    } catch (error) {
        Logger.error('LORAS', 'Error reading LoRA directory with subdirectories:', error);
        return { root: [], subdirs: {} };
    }
}

module.exports = {
    getAvailableLoRAs,
    getAvailableLoRAsWithSubdirs,
    formatDisplayName
};
