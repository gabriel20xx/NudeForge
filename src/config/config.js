const path = require("path");
const Logger = require("../utils/logger");
require("dotenv").config({ path: path.resolve(__dirname, '../../.env') });

// Define directories with cross-platform path handling
const INPUT_DIR = path.resolve(__dirname, "../../../input");
const OUTPUT_DIR = path.resolve(__dirname, "../../../output");
const UPLOAD_COPY_DIR = path.resolve(__dirname, "../../../copy");
const LORAS_DIR = path.resolve(__dirname, "../../../loras");
const WORKFLOW_PATH = path.resolve(__dirname, "../../workflow.json");

// ComfyUI Host
const COMFYUI_HOST = process.env.COMFYUI_HOST || '127.0.0.1:8188';

// Construct URLs from host
const COMFYUI_URL = `http://${COMFYUI_HOST}/prompt`;
const COMFYUI_WS_URL = `ws://${COMFYUI_HOST}/ws`;

const PORT = process.env.PORT || 3000;

// Validate that required environment variables are set
if (!process.env.COMFYUI_HOST) {
  Logger.warn('CONFIG', "COMFYUI_HOST is not set in .env file. Using default value '127.0.0.1:8188'.");
}

module.exports = {
    INPUT_DIR,
    OUTPUT_DIR,
    UPLOAD_COPY_DIR,
    LORAS_DIR,
    WORKFLOW_PATH,
    COMFYUI_HOST,
    COMFYUI_URL,
    COMFYUI_WS_URL,
    PORT
};
