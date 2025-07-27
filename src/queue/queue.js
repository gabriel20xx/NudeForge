const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
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
            console.log(`[PROCESS] Successfully sent workflow to ComfyUI for requestId=${requestId}`);
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
                console.log(`[PROCESS] ComfyUI connection error for requestId=${requestId}, attempt ${attempt}. Retrying in ${delay}ms...`);
                console.log(`[PROCESS] Error details: ${error.code} - ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // If it's not a connection error, throw the error immediately
                console.error(`[PROCESS] Non-connection error sending workflow to ComfyUI for requestId=${requestId}: ${error.message}`);
                throw error;
            }
        }
    }
}

async function processQueue(io) {
    if (isProcessing || processingQueue.length === 0) {
        if (isProcessing) console.log("[QUEUE] Already processing.");
        if (processingQueue.length === 0)
            console.log("[QUEUE] No items to process.");
        return;
    }

    isProcessing = true;
    const { requestId, uploadedFilename, uploadedPathForComfyUI } =
        processingQueue.shift();
    currentlyProcessingRequestId = requestId;
    requestStatus[requestId].status = "processing";

    console.log(
        `[PROCESS] Starting processing for requestId=${requestId}, file=${uploadedFilename}`
    );
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
            (node) =>
                typeof node === "object" && node !== null && node.class_type
        );
        requestStatus[requestId].totalNodesInWorkflow = actualNodes.length;

        const { prompt, steps, outputHeight, ...loraSettings } =
            requestStatus[requestId].settings || {};

        const clipTextNode = Object.values(workflow).find(
            (node) => node.class_type === "CLIPTextEncode"
        );
        if (clipTextNode && prompt) clipTextNode.inputs.text = prompt;

        const ksamplerNode = Object.values(workflow).find(
            (node) => node.class_type === "KSamplerAdvanced"
        );
        if (ksamplerNode && steps) ksamplerNode.inputs.steps = Number(steps);

        const heightNode = Object.values(workflow).find(
            (node) =>
                node.class_type === "PrimitiveInt" &&
                node._meta?.title === "Height"
        );
        if (heightNode && outputHeight)
            heightNode.inputs.value = Number(outputHeight);

        const loraNode = Object.values(workflow).find(
            (node) => node.class_type === "Power Lora Loader (rgthree)"
        );
        if (loraNode) {
            for (let i = 1; i <= 5; i++) {
                if (loraNode.inputs[`lora_${i}`]) {
                    loraNode.inputs[`lora_${i}`].on =
                        !!loraSettings[`lora_${i}_on`];
                    loraNode.inputs[`lora_${i}`].strength = parseFloat(
                        loraSettings[`lora_${i}_strength`]
                    );
                }
            }
        }

        const inputNameNode = Object.values(workflow).find(
            (node) =>
                node.class_type === "PrimitiveString" &&
                node._meta?.title === "Input Name"
        );
        if (inputNameNode)
            inputNameNode.inputs.value = path.parse(uploadedFilename).name;

        const imageNode = Object.values(workflow).find(
            (node) => node.class_type === "VHS_LoadImagePath"
        );
        if (imageNode) imageNode.inputs["image"] = uploadedPathForComfyUI;

        console.log(
            `[PROCESS] Sending workflow to ComfyUI for requestId=${requestId}`
        );
        
        // Update status to indicate we're starting image generation
        io.to(requestId).emit("queueUpdate", {
            queueSize: processingQueue.length,
            yourPosition: 0,
            status: "processing",
            stage: "Stage 1: Generating image...",
            progress: { value: 0, max: 100, type: "global_steps" },
        });
        
        await sendWorkflowWithRetry(workflow, requestId);

        // Update status to indicate we're now scaling the image
        io.to(requestId).emit("queueUpdate", {
            queueSize: processingQueue.length,
            yourPosition: 0,
            status: "processing", 
            stage: "Stage 2: Scaling image to correct size...",
            progress: { value: 50, max: 100, type: "global_steps" },
        });

        const expectedOutputSuffix = `${
            path.parse(uploadedFilename).name
        }-nudified_00001.png`;
        let foundOutputFilename = null;
        while (!foundOutputFilename) {
            const filesInOutputDir = await fs.promises.readdir(OUTPUT_DIR);
            foundOutputFilename = filesInOutputDir.find((file) =>
                file.endsWith(expectedOutputSuffix)
            );
            if (!foundOutputFilename) {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        // Wait for file size to stabilize (ensure fully written)
        const outputPath = path.join(OUTPUT_DIR, foundOutputFilename);
        let lastSize = -1,
            stableCount = 0;
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
        requestStatus[requestId].status = "completed";
        requestStatus[requestId].data = {
            outputImage: finalOutputRelativePath,
        };

        console.log(
            `[PROCESS] Completed for requestId=${requestId}, output=${finalOutputRelativePath}`
        );
        io.to(requestId).emit("processingComplete", {
            outputImage: finalOutputRelativePath,
            requestId: requestId,
        });
    } catch (err) {
        console.error(
            `[PROCESS] Error during processing for requestId ${requestId}:`,
            err
        );
        requestStatus[requestId].status = "failed";
        requestStatus[requestId].data = {
            error: "Processing failed.",
            errorMessage: err.message,
        };
        io.to(requestId).emit("processingFailed", {
            error: "Processing failed.",
            errorMessage: err.message,
        });
    } finally {
        isProcessing = false;
        currentlyProcessingRequestId = null;
        delete requestStatus[requestId];
        console.log(
            "[QUEUE] Processing finished. Next in queue:",
            processingQueue.length
        );
        processQueue(io);
    }
}

module.exports = {
    getProcessingQueue,
    getRequestStatus,
    getCurrentlyProcessingRequestId,
    getIsProcessing,
    processQueue,
};
