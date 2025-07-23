const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { COMFYUI_URL, WORKFLOW_PATH, OUTPUT_DIR } = require("../config");

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

async function processQueue(io) {
    if (isProcessing || processingQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const { requestId, uploadedFilename, uploadedPathForComfyUI } = processingQueue.shift();
    currentlyProcessingRequestId = requestId;
    requestStatus[requestId].status = "processing";

    io.to(requestId).emit("queueUpdate", {
        queueSize: processingQueue.length,
        yourPosition: 0,
        status: "processing",
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
            for (let i = 1; i <= 5; i++) {
                if (loraNode.inputs[`lora_${i}`]) {
                    loraNode.inputs[`lora_${i}`].on = !!loraSettings[`lora_${i}_on`];
                    loraNode.inputs[`lora_${i}`].strength = parseFloat(loraSettings[`lora_${i}_strength`]);
                }
            }
        }

        const inputNameNode = Object.values(workflow).find((node) => node.class_type === "PrimitiveString" && node._meta?.title === "Input Name");
        if (inputNameNode) inputNameNode.inputs.value = path.parse(uploadedFilename).name;

        const imageNode = Object.values(workflow).find((node) => node.class_type === "VHS_LoadImagePath");
        if (imageNode) imageNode.inputs["image"] = uploadedPathForComfyUI;

        await axios.post(COMFYUI_URL, { prompt: workflow }, { headers: { "Content-Type": "application/json" } });

        const expectedOutputSuffix = `${path.parse(uploadedFilename).name}-nudified_00001.png`;
        let foundOutputFilename = null;
        while (!foundOutputFilename) {
            const filesInOutputDir = await fs.promises.readdir(OUTPUT_DIR);
            foundOutputFilename = filesInOutputDir.find((file) => file.endsWith(expectedOutputSuffix));
            if (!foundOutputFilename) await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const finalOutputRelativePath = `/output/${foundOutputFilename}`;
        requestStatus[requestId].status = "completed";
        requestStatus[requestId].data = { outputImage: finalOutputRelativePath };

        io.to(requestId).emit("processingComplete", {
            outputImage: finalOutputRelativePath,
            requestId: requestId,
        });
    } catch (err) {
        console.error(`Error during processing for requestId ${requestId}:`, err.message);
        requestStatus[requestId].status = "failed";
        requestStatus[requestId].data = { error: "Processing failed.", errorMessage: err.message };
        io.to(requestId).emit("processingFailed", { error: "Processing failed.", errorMessage: err.message });
    } finally {
        isProcessing = false;
        currentlyProcessingRequestId = null;
        delete requestStatus[requestId];
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
