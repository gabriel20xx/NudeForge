const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const Logger = require("../utils/logger");
const { COMFYUI_URL, WORKFLOW_PATH, OUTPUT_DIR } = require("../config/config");

const processingQueue = [];
let isProcessing = false;
const requestStatus = {};
let currentlyProcessingRequestId = null;

function getProcessingQueue() {
    return processingQueue;
}

function getRequestStatus() {
    return requestStatus;
}

function getCurrentlyProcessingRequestId() {
    return currentlyProcessingRequestId;
}

function getIsProcessing() {
    return isProcessing;
}

// Function to send workflow with retry logic for connection errors
async function sendWorkflowWithRetry(workflow, requestId) {
    let attempt = 0;
    while (true) { // Wait indefinitely
        try {
            await axios.post(
                COMFYUI_URL,
                { prompt: workflow },
                { 
                    headers: { "Content-Type": "application/json" },
                    timeout: 30000 // 30 second timeout
                }
            );
            Logger.info('PROCESS', `Successfully sent workflow to ComfyUI for requestId=${requestId}`);
            return; // Success, exit the retry loop
        } catch (error) {
            attempt++;
            const isConnectionError = error.code === 'ECONNREFUSED' || 
                                    error.code === 'ECONNRESET' || 
                                    error.code === 'ENOTFOUND' ||
                                    error.code === 'ETIMEDOUT' ||
                                    error.message.includes('connect') ||
                                    error.message.includes('timeout');
            
            if (isConnectionError) {
                const delay = Math.min(1000 * Math.pow(2, Math.min(attempt - 1, 6)), 30000); // Exponential backoff, max 30s, cap at 2^6
                Logger.warn('PROCESS', `ComfyUI connection error for requestId=${requestId}, attempt ${attempt}. Retrying in ${delay}ms...`);
                Logger.debug('PROCESS', `Error details: ${error.code} - ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // If it's not a connection error, throw the error immediately
                Logger.error('PROCESS', `Non-connection error sending workflow to ComfyUI for requestId=${requestId}: ${error.message}`);
                throw error;
            }
        }
    }
}

async function processQueue(io) {
    if (isProcessing || processingQueue.length === 0) {
        if (isProcessing) Logger.debug('QUEUE', 'Already processing.');
        if (processingQueue.length === 0) Logger.debug('QUEUE', 'No items to process.');
        return;
    }

    isProcessing = true;
    const { requestId, uploadedFilename, originalFilename, uploadedPathForComfyUI } = processingQueue.shift();
    currentlyProcessingRequestId = requestId;
    requestStatus[requestId].status = "processing";

    Logger.info('PROCESS', `Starting processing for requestId=${requestId}, file=${uploadedFilename}`);
    io.to(requestId).emit("queueUpdate", {
        queueSize: processingQueue.length,
        yourPosition: 0,
        status: "processing",
        stage: "Initializing workflow...",
        progress: { value: 0, max: 100, type: "global_steps" },
    });

    try {
        const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf-8");
        let workflow = JSON.parse(workflowJson);

        const actualNodes = Object.values(workflow).filter(
            (node) => typeof node === "object" && node !== null && node.class_type
        );
        requestStatus[requestId].totalNodesInWorkflow = actualNodes.length;

        const { prompt, steps, outputHeight, ...loraSettings } = requestStatus[requestId].settings || {};

        const clipTextNode = Object.values(workflow).find((node) => node.class_type === "CLIPTextEncode");
        if (clipTextNode && prompt) clipTextNode.inputs.text = prompt;

        const ksamplerNode = Object.values(workflow).find((node) => node.class_type === "KSamplerAdvanced");
        if (ksamplerNode && steps) ksamplerNode.inputs.steps = Number(steps);

        const heightNode = Object.values(workflow).find((node) => node.class_type === "PrimitiveInt" && node._meta?.title === "Height");
        if (heightNode && outputHeight) heightNode.inputs.value = Number(outputHeight);

        const loraNode = Object.values(workflow).find((node) => node.class_type === "Power Lora Loader (rgthree)");
        if (loraNode) {
            // Clear existing LoRA settings
            for (let i = 1; i <= 10; i++) {
                if (loraNode.inputs[`lora_${i}`]) {
                    loraNode.inputs[`lora_${i}`].on = false;
                    loraNode.inputs[`lora_${i}`].strength = 0;
                    loraNode.inputs[`lora_${i}`].lora = "";
                }
            }
            
            // Process dynamic LoRA entries
            const loraEntries = {};
            Object.keys(loraSettings).forEach(key => {
                const match = key.match(/^lora_(\d+)_(.+)$/);
                if (match) {
                    const index = match[1];
                    const property = match[2];
                    if (!loraEntries[index]) loraEntries[index] = {};
                    loraEntries[index][property] = loraSettings[key];
                }
            });
            
            // Apply LoRA settings
            Object.entries(loraEntries).forEach(([index, settings]) => {
                if (loraNode.inputs[`lora_${index}`]) {
                    loraNode.inputs[`lora_${index}`].on = settings.on === 'true';
                    loraNode.inputs[`lora_${index}`].strength = parseFloat(settings.strength) || 0;
                    
                    if (settings.model) {
                        // Ensure the path uses forward slashes for ComfyUI compatibility
                        const loraPath = settings.model.replace(/\\/g, '/');
                        loraNode.inputs[`lora_${index}`].lora = loraPath;
                        Logger.info('PROCESS', `LoRA ${index}: enabled=${settings.on}, strength=${settings.strength}, model=${loraPath}`);
                    }
                }
            });
        }

        const inputNameNode = Object.values(workflow).find((node) => node.class_type === "PrimitiveString" && node._meta?.title === "Input Name");
        if (inputNameNode) inputNameNode.inputs.value = path.parse(uploadedFilename).name;

        const imageNode = Object.values(workflow).find((node) => node.class_type === "VHS_LoadImagePath");
        if (imageNode) imageNode.inputs["image"] = uploadedPathForComfyUI;

        Logger.info('PROCESS', `Sending workflow to ComfyUI for requestId=${requestId}`);
        
        await sendWorkflowWithRetry(workflow, requestId);

        const expectedOutputSuffix = `${path.parse(uploadedFilename).name}-nudified_00001.png`;
        let foundOutputFilename = null;
        while (!foundOutputFilename) {
            const filesInOutputDir = await fs.promises.readdir(OUTPUT_DIR);
            foundOutputFilename = filesInOutputDir.find((file) => file.endsWith(expectedOutputSuffix));
            if (!foundOutputFilename) {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        // Wait for file size to stabilize (ensure fully written)
        const outputPath = path.join(OUTPUT_DIR, foundOutputFilename);
        let lastSize = -1, stableCount = 0;
        while (stableCount < 2) {
            try {
                const stats = await fs.promises.stat(outputPath);
                if (stats.size === lastSize && stats.size > 0) {
                    stableCount++;
                } else {
                    stableCount = 0;
                }
                lastSize = stats.size;
            } catch (e) {
                stableCount = 0;
            }
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        // Add a short delay to further ensure file is ready
        await new Promise((resolve) => setTimeout(resolve, 300));
        const finalOutputRelativePath = `/output/${foundOutputFilename}`;
        const downloadUrl = `/download/${requestId}`;
        requestStatus[requestId].status = "completed";
        requestStatus[requestId].data = { 
            outputImage: finalOutputRelativePath,
            downloadUrl: downloadUrl
        };

        Logger.success('PROCESS', `Completed for requestId=${requestId}, output=${finalOutputRelativePath}, download=${downloadUrl}`);
        io.to(requestId).emit("processingComplete", {
            outputImage: finalOutputRelativePath,
            downloadUrl: downloadUrl,
            requestId: requestId,
        });
    } catch (err) {
        Logger.error('PROCESS', `Error during processing for requestId ${requestId}:`, err);
        requestStatus[requestId].status = "failed";
        requestStatus[requestId].data = { error: "Processing failed.", errorMessage: err.message };
        io.to(requestId).emit("processingFailed", { error: "Processing failed.", errorMessage: err.message });
    } finally {
        isProcessing = false;
        // Clean up stage tracker - use require here to avoid circular dependency
        try {
            const { cleanupStageTracker } = require("./websocket");
            cleanupStageTracker(requestId);
        } catch (err) {
            Logger.warn('QUEUE', 'Could not cleanup stage tracker:', err.message);
        }
        currentlyProcessingRequestId = null;
        delete requestStatus[requestId];
        Logger.info('QUEUE', `Processing finished. Next in queue: ${processingQueue.length}`);
        processQueue(io);
    }
}

module.exports = {
    getProcessingQueue,
    getRequestStatus,
    getCurrentlyProcessingRequestId,
    getIsProcessing,
    processQueue
};
