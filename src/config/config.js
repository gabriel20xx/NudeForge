import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Logger from '../../../NudeShared/serverLogger.js';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Define directories with cross-platform path handling
// Use the same pattern for all directories to ensure consistency
// Default to directories OUTSIDE the NudeForge project root (sibling folders) for persistence across deployments
const PROJECT_ROOT = path.resolve(__dirname, '../..');
// If process.env paths not provided, move one level up from project root to store data side-by-side with project folder
// Example project root: /path/NudeForge -> data dirs: /path/input, /path/output, /path/copy, /path/loras
const PARENT_OF_PROJECT = path.resolve(PROJECT_ROOT, '..');
const INPUT_DIR = process.env.INPUT_DIR || path.join(PARENT_OF_PROJECT, 'input');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(PARENT_OF_PROJECT, 'output');  
const UPLOAD_COPY_DIR = process.env.UPLOAD_COPY_DIR || path.join(PARENT_OF_PROJECT, 'copy');
const LORAS_DIR = process.env.LORAS_DIR || path.join(PARENT_OF_PROJECT, 'loras');
const WORKFLOW_PATH = process.env.WORKFLOW_PATH || path.resolve(__dirname, '../../workflow.json');
// Site branding
const SITE_TITLE = process.env.SITE_TITLE || 'NudeForge';

// Optional HTTPS Support
// Enable by setting HTTPS=true or ENABLE_HTTPS=true
const ENABLE_HTTPS = (process.env.HTTPS === 'true' || process.env.ENABLE_HTTPS === 'true');
// Optional paths to existing key/cert. If both provided and readable they are used; else a self-signed pair is generated at runtime.
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '';

// ComfyUI Host
const COMFYUI_HOST = process.env.COMFYUI_HOST || '127.0.0.1:8188';

// Construct URLs from host
const COMFYUI_URL = `http://${COMFYUI_HOST}/prompt`;
const COMFYUI_WS_URL = `ws://${COMFYUI_HOST}/ws`;

// Unified standard port across modules (both use 8080 unless overridden)
const PORT = process.env.PORT || 8080;

// Max number of images accepted per upload request
const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES || process.env.UPLOAD_MAX_FILES || 12);

// Detect if running in Docker container
const isDocker = process.env.DOCKER === 'true' || 
                 process.env.LORAS_DIR || 
                 process.env.INPUT_DIR || 
                 fs.existsSync('/.dockerenv');

// Log configuration for debugging
Logger.info('CONFIG', `Environment: ${isDocker ? 'Docker Container' : 'Development'}`);
Logger.info('CONFIG', `INPUT_DIR: ${INPUT_DIR}`);
Logger.info('CONFIG', `OUTPUT_DIR: ${OUTPUT_DIR}`);
Logger.info('CONFIG', `UPLOAD_COPY_DIR: ${UPLOAD_COPY_DIR}`);
Logger.info('CONFIG', `LORAS_DIR: ${LORAS_DIR}`);
Logger.info('CONFIG', `WORKFLOW_PATH: ${WORKFLOW_PATH}`);
Logger.info('CONFIG', `HTTPS Enabled: ${ENABLE_HTTPS}`);
if (ENABLE_HTTPS) {
  if (SSL_KEY_PATH && !fs.existsSync(SSL_KEY_PATH)) {
    Logger.warn('CONFIG', `Specified SSL_KEY_PATH not found: ${SSL_KEY_PATH}`);
  }
  if (SSL_CERT_PATH && !fs.existsSync(SSL_CERT_PATH)) {
    Logger.warn('CONFIG', `Specified SSL_CERT_PATH not found: ${SSL_CERT_PATH}`);
  }
}

// Validate external directories (warn only, do not create here to leave creation to runtime app.js logic)
const REQUIRED_EXTERNAL = [INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR, LORAS_DIR];
REQUIRED_EXTERNAL.forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      Logger.warn('CONFIG', `Directory missing at startup (will be created by app if needed): ${dir}`);
    }
  } catch (e) {
    Logger.error('CONFIG', `Error checking directory ${dir}: ${e.message}`);
  }
});

// Validate that required environment variables are set
if (!process.env.COMFYUI_HOST) {
  Logger.warn('CONFIG', "COMFYUI_HOST is not set in .env file. Using default value '127.0.0.1:8188'.");
}

export {
  INPUT_DIR,
  OUTPUT_DIR,
  UPLOAD_COPY_DIR,
  LORAS_DIR,
  WORKFLOW_PATH,
  COMFYUI_HOST,
  COMFYUI_URL,
  COMFYUI_WS_URL,
  PORT,
  MAX_UPLOAD_FILES,
  isDocker,
  SITE_TITLE,
  ENABLE_HTTPS,
  SSL_KEY_PATH,
  SSL_CERT_PATH
};
