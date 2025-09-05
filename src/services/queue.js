import fs from 'fs';
import path from 'path';
import axios from 'axios';
// import { v4 as uuidv4 } from 'uuid'; // (unused) keep commented for potential future use
import Logger from '../../../NudeShared/server/logger/serverLogger.js';
import { query as dbQuery } from '../../../NudeShared/server/index.js';
import { COMFYUI_URL, WORKFLOW_PATH, WORKFLOWS_DIR, OUTPUT_DIR, INPUT_DIR, COMFYUI_HOST } from '../config/config.js';
import crypto from 'crypto';

const processingQueue = [];
let isProcessing = false;
const requestStatus = {};
let currentlyProcessingRequestId = null;
let cancelRequestedFor = null; // requestId to cancel (active only)

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

// Sanitize a username to a safe folder name
function sanitizeFolderName(name) {
    if (!name) return '';
    // Normalize unicode, remove leading/trailing whitespace
    let n = name.toString().normalize('NFKC').trim();
    // Replace path separators and control chars
    n = n.replace(/[\/:*?"<>|\x00-\x1F]/g, '');
    // Collapse spaces -> underscore
    n = n.replace(/\s+/g, '_');
    // Allow only common characters: letters, numbers, underscore, hyphen
    n = n.replace(/[^A-Za-z0-9_-]/g, '');
    // Lowercase for consistency
    n = n.toLowerCase();
    // Avoid empty
    if (!n) n = 'user';
    // Trim length
    if (n.length > 64) n = n.slice(0, 64);
    // Avoid Windows reserved names
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reserved.test(n)) n = `_${n}`;
    return n;
}

// Function to send workflow with retry logic for connection errors
async function sendWorkflowWithRetry(workflow, requestId) {
    let attempt = 0;
    while (true) { // Wait indefinitely
        try {
            const body = { prompt: workflow };
            try { Logger.debug('COMFY_POST', 'Sending to ComfyUI URL=' + COMFYUI_URL + ' body=' + JSON.stringify(body).substring(0, 1000)); } catch {}
            await axios.post(
                COMFYUI_URL,
                body,
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
    const { requestId, uploadedFilename, originalFilename: _originalFilename, uploadedPathForComfyUI, workflowName, userId, userName, saveNodeTarget } = processingQueue.shift();
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
        // Resolve workflow path: prefer selected workflow under WORKFLOWS_DIR, else default WORKFLOW_PATH
        let selectedWorkflowPath = WORKFLOW_PATH;
        try {
            if (workflowName && typeof workflowName === 'string') {
                const safeBase = path.basename(workflowName);
                if (/\.json$/i.test(safeBase)) {
                    const candidate = path.join(WORKFLOWS_DIR, safeBase);
                    const rel = path.relative(WORKFLOWS_DIR, candidate);
                    if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(candidate)) {
                        selectedWorkflowPath = candidate;
                        Logger.info('WORKFLOWS', `Using selected workflow: ${safeBase}`);
                    } else {
                        Logger.warn('WORKFLOWS', `Selected workflow not found or invalid: ${safeBase}. Falling back to default.`);
                    }
                }
            }
        } catch {}
        const workflowJson = fs.readFileSync(selectedWorkflowPath, "utf-8");
    let workflow = JSON.parse(workflowJson);

        const actualNodes = Object.values(workflow).filter(
            (node) => typeof node === "object" && node !== null && node.class_type
        );
        requestStatus[requestId].totalNodesInWorkflow = actualNodes.length;

        const { prompt, steps, outputHeight, ...loraSettings } = requestStatus[requestId].settings || {};
        // Sanitize prompt: remove literal \n sequences and real newline characters
        const sanitizedPrompt = (prompt || '')
            .replace(/\\n|\r?\n/g, ' ') // replace escaped and actual newlines with space
            .replace(/\s+/g, ' ')         // collapse multiple whitespace
            .trim();

        const clipTextNode = Object.values(workflow).find((node) => node.class_type === "CLIPTextEncode");
        if (clipTextNode && prompt !== undefined) {
            clipTextNode.inputs.text = sanitizedPrompt;
            if (prompt !== sanitizedPrompt) {
                Logger.debug('PROCESS_PROMPT_SANITIZE', 'Prompt sanitized before send. Original length=' + prompt.length + ' sanitized length=' + sanitizedPrompt.length);
            }
        }

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
            
            // Always inject default LoRA as lora_1
            loraNode.inputs["lora_1"].on = true;
            loraNode.inputs["lora_1"].strength = 1.0;
            loraNode.inputs["lora_1"].lora = "fluxkontext/change_clothes_to_nothing_000011200.safetensors";
            Logger.info('PROCESS', 'Default LoRA injected: fluxkontext/change_clothes_to_nothing_000011200.safetensors');

            // Inject user LoRAs into lora_2+ slots (never override lora_1)
            let loraSlot = 2;
            Object.keys(loraEntries).sort((a,b)=>Number(a)-Number(b)).forEach(index => {
                const settings = loraEntries[index];
                if (!loraNode.inputs[`lora_${loraSlot}`]) return;
                const requestedOn = settings.on === 'true';
                if (requestedOn) {
                    loraNode.inputs[`lora_${loraSlot}`].on = true;
                    loraNode.inputs[`lora_${loraSlot}`].strength = parseFloat(settings.strength) || 0;
                    if (settings.model) {
                        const loraPath = settings.model.replace(/\\/g, '/');
                        loraNode.inputs[`lora_${loraSlot}`].lora = loraPath;
                        Logger.info('PROCESS', `User LoRA injected: slot=${loraSlot}, strength=${settings.strength}, model=${loraPath}`);
                    }
                    loraSlot++;
                }
            });
        }

        const inputNameNode = Object.values(workflow).find((node) => node.class_type === "PrimitiveString" && node._meta?.title === "Input Name");
        if (inputNameNode) inputNameNode.inputs.value = path.parse(uploadedFilename).name;

        // Adjust SaveImagePlus custom_path to include username subfolder for a targeted node when available
        try {
            // Collect SaveImagePlus nodes with their ids
            const saveNodes = Object.entries(workflow)
                .filter(([id, node]) => node && node.class_type === 'LayerUtility: SaveImagePlus')
                .map(([id, node]) => ({ id, node }));

            // Helper: choose node based on target preference
            const chooseSaveNode = () => {
                const target = (saveNodeTarget || requestStatus[requestId]?.settings?.saveNodeTarget || '').toString().toLowerCase();
                if (target.startsWith('id:')) {
                    const idWanted = target.slice(3);
                    return saveNodes.find(s => String(s.id) === idWanted);
                }
                if (target === 'single') {
                    return saveNodes.find(s => String(s.node?.inputs?.custom_path || '').toLowerCase().includes('/nudify/single/'))
                        || saveNodes[0];
                }
                if (target === 'comparison') {
                    return saveNodes.find(s => String(s.node?.inputs?.custom_path || '').toLowerCase().includes('/nudify/comparison/'))
                        || saveNodes[0];
                }
                if (target.startsWith('path:')) {
                    const sub = target.slice(5);
                    return saveNodes.find(s => String(s.node?.inputs?.custom_path || '').toLowerCase().includes(sub));
                }
                // Default heuristic: prefer 'Single' path if present
                return saveNodes.find(s => String(s.node?.inputs?.custom_path || '').toLowerCase().includes('/nudify/single/'))
                    || saveNodes[0];
            };

            const chosen = chooseSaveNode();
            const saveNode = chosen && chosen.node;
            if (saveNode && saveNode.inputs && typeof saveNode.inputs.custom_path === 'string') {
                const base = saveNode.inputs.custom_path || '';
                // Normalize to forward slashes and ensure trailing slash
                const normBase = base.replace(/\\/g,'/');
                const hasSlash = normBase.endsWith('/') ? normBase : normBase + '/';
                // Choose folder name: userName or fallback from request status
        const rawUser = (userName || requestStatus[requestId]?.userName || '').toString().trim();
        const userFolder = sanitizeFolderName(rawUser);
                if (userFolder) {
                    saveNode.inputs.custom_path = hasSlash + userFolder + '/';
                } else {
                    // If no user, keep original path
                    saveNode.inputs.custom_path = hasSlash;
                }
            }
        } catch { /* non-fatal */ }

        const imageNode = Object.values(workflow).find((node) => node.class_type === "VHS_LoadImagePath");
        if (imageNode) imageNode.inputs["image"] = uploadedPathForComfyUI;

        Logger.info('PROCESS', `Sending workflow to ComfyUI for requestId=${requestId}`);
        try {
            Logger.debug('PROCESS_SETTINGS', 'Final workflow settings: ' + JSON.stringify(requestStatus[requestId]?.settings || {}));
    } catch { /* ignore */ }
        
        await sendWorkflowWithRetry(workflow, requestId);

        const expectedOutputSuffix = `${path.parse(uploadedFilename).name}-nudified_00001.png`;
        // Helper: recursively search OUTPUT_DIR for a file whose basename ends with expected suffix
        async function findOutputRelPath(baseDir) {
            const stack = ['']; // relative paths
            while (stack.length) {
                if (cancelRequestedFor === requestId) throw new Error('CANCELLED_BY_USER');
                const rel = stack.pop();
                const abs = path.join(baseDir, rel);
                let entries;
                try {
                    entries = await fs.promises.readdir(abs, { withFileTypes: true });
                } catch {
                    continue;
                }
                for (const e of entries) {
                    if (e.name.startsWith('.')) continue;
                    if (e.isDirectory()) {
                        stack.push(path.join(rel, e.name));
                    } else if (e.isFile()) {
                        if (e.name.endsWith(expectedOutputSuffix)) {
                            return path.join(rel, e.name);
                        }
                    }
                }
            }
            return null;
        }

        let foundOutputRelPath = null;
        while (!foundOutputRelPath) {
            if (cancelRequestedFor === requestId) {
                throw new Error('CANCELLED_BY_USER');
            }
            foundOutputRelPath = await findOutputRelPath(OUTPUT_DIR);
            if (!foundOutputRelPath) {
                await new Promise((resolve) => setTimeout(resolve, 500));
            }
        }
        // Wait for file size to stabilize (ensure fully written)
        const outputPath = path.join(OUTPUT_DIR, foundOutputRelPath);
        let lastSize = -1, stableCount = 0;
        while (stableCount < 2) {
            if (cancelRequestedFor === requestId) {
                throw new Error('CANCELLED_BY_USER');
            }
            try {
                const stats = await fs.promises.stat(outputPath);
                if (stats.size === lastSize && stats.size > 0) {
                    stableCount++;
                } else {
                    stableCount = 0;
                }
                lastSize = stats.size;
        } catch {
                stableCount = 0;
            }
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        // Add a short delay to further ensure file is ready
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Normalize to URL-style forward slashes for client
        const finalOutputRelUrl = foundOutputRelPath.split(path.sep).map(encodeURIComponent).join('/');
        const finalOutputRelativePath = `/output/${finalOutputRelUrl}`;
        // --- Integrity / Non-copy validation ---
        try {
            const inputPath = path.join(INPUT_DIR, uploadedFilename);
            const outputPathAbs = path.join(OUTPUT_DIR, foundOutputRelPath);
            if (fs.existsSync(inputPath) && fs.existsSync(outputPathAbs)) {
                const hashFile = (p)=> crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
                const inHash = hashFile(inputPath);
                const outHash = hashFile(outputPathAbs);
                if (inHash === outHash) {
                    Logger.warn('PROCESS', `Output appears identical to input (hash=${inHash}). This may indicate the workflow returned the original image.`);
                } else {
                    Logger.info('PROCESS', `Output hash differs from input as expected (in=${inHash.substring(0,8)} out=${outHash.substring(0,8)})`);
                }
            }
        } catch (_hashErr) {
            Logger.warn('PROCESS', `Hash comparison failed: ${_hashErr.message}`);
        }
        const downloadUrl = `/download/${requestId}`;
        requestStatus[requestId].status = "completed";
        requestStatus[requestId].data = { 
            outputImage: finalOutputRelativePath,
            downloadUrl: downloadUrl
        };
        // Persist media ownership to DB
        try {
            // Store relative path under OUTPUT_DIR using forward slashes
            const mediaKey = foundOutputRelPath.split(path.sep).join('/');
            const uid = userId || requestStatus[requestId]?.userId || null;
            const origName = _originalFilename || requestStatus[requestId]?.originalFilename || null;
            await dbQuery('INSERT INTO media (user_id, media_key, app, original_filename) VALUES ($1,$2,$3,$4)', [uid, mediaKey, 'NudeForge', origName]);
            Logger.info('DB', `Recorded media for user_id=${uid || 'null'} key=${mediaKey}`);
        } catch (dbErr) {
            Logger.warn('DB', 'Failed to record media ownership: ' + (dbErr && dbErr.message ? dbErr.message : dbErr));
        }

        Logger.success('PROCESS', `Completed for requestId=${requestId}, output=${finalOutputRelativePath}, download=${downloadUrl}`);
        io.to(requestId).emit("processingComplete", {
            outputImage: finalOutputRelativePath,
            downloadUrl: downloadUrl,
            requestId: requestId,
        });
    } catch (_err) {
        if (_err && _err.message === 'CANCELLED_BY_USER') {
            Logger.warn('PROCESS', `Processing cancelled by user for requestId=${requestId}`);
            requestStatus[requestId].status = "cancelled";
            requestStatus[requestId].data = { error: "Cancelled by user" };
            io.to(requestId).emit("processingFailed", { error: "Cancelled by user" });
        } else {
            Logger.error('PROCESS', `Error during processing for requestId ${requestId}:`, _err);
            requestStatus[requestId].status = "failed";
            requestStatus[requestId].data = { error: "Processing failed.", errorMessage: _err.message };
            io.to(requestId).emit("processingFailed", { error: "Processing failed.", errorMessage: _err.message });
        }
    } finally {
        isProcessing = false;
        // Clean up stage tracker - use require here to avoid circular dependency
        try {
            const mod = await import('./websocket.js');
            mod.cleanupStageTracker(requestId);
        } catch (err) {
            Logger.warn('QUEUE', 'Could not cleanup stage tracker:', err.message);
        }
        currentlyProcessingRequestId = null;
        if (cancelRequestedFor === requestId) {
            cancelRequestedFor = null;
        }
        delete requestStatus[requestId];
        Logger.info('QUEUE', `Processing finished. Next in queue: ${processingQueue.length}`);
        processQueue(io);
    }
}

function cancelAll(io) {
    try {
        // Empty the pending queue
        processingQueue.splice(0, processingQueue.length);
        const activeId = currentlyProcessingRequestId;
        if (activeId) {
            cancelRequestedFor = activeId; // signal active loop to abort
            // Also proactively notify client
            try { io && io.to(activeId).emit('processingFailed', { error: 'Cancelled by user' }); } catch {}
        }
        Logger.warn('QUEUE', `Cancellation requested. Cleared pending queue. Active request: ${activeId || 'none'}`);
        return { cancelledActive: !!activeId, clearedPending: true };
    } catch (e) {
        Logger.error('QUEUE', 'Cancellation failed', e);
        return { error: e.message };
    }
}

// Cancel a specific request: if active, signal loop and call ComfyUI /interrupt; if pending, remove from queue.
async function cancelRequest(io, requestId) {
    try {
        if (!requestId) return { error: 'requestId is required' };
        // If it's the active request
        if (currentlyProcessingRequestId && currentlyProcessingRequestId === requestId) {
            cancelRequestedFor = requestId; // signal active loop to abort
            // Best-effort ComfyUI interrupt
            try {
                const url = `http://${COMFYUI_HOST}/interrupt`;
                await axios.post(url, {}, { timeout: 5000 });
                Logger.info('QUEUE', `Sent ComfyUI /interrupt for active requestId=${requestId}`);
            } catch (e) {
                Logger.warn('QUEUE', `ComfyUI /interrupt failed or unavailable: ${e.message}`);
            }
            try { io && io.to(requestId).emit('processingFailed', { error: 'Cancelled by user' }); } catch {}
            if (requestStatus[requestId]) {
                requestStatus[requestId].status = 'cancelled';
                requestStatus[requestId].data = { error: 'Cancelled by user' };
            }
            return { ok: true, cancelledActive: true };
        }
        // If it's pending in the queue, remove it
        const idx = processingQueue.findIndex(item => item.requestId === requestId);
        if (idx !== -1) {
            const [removed] = processingQueue.splice(idx, 1);
            try { io && io.to(requestId).emit('processingFailed', { error: 'Cancelled by user (pending)' }); } catch {}
            if (requestStatus[requestId]) {
                requestStatus[requestId].status = 'cancelled';
                requestStatus[requestId].data = { error: 'Cancelled by user' };
            }
            Logger.warn('QUEUE', `Cancelled pending requestId=${requestId} (file=${removed?.uploadedFilename || 'n/a'})`);
            return { ok: true, cancelledPending: true };
        }
        // Not found
        return { ok: false, notFound: true };
    } catch (e) {
        Logger.error('QUEUE', 'cancelRequest failed', e);
        return { error: e.message };
    }
}

export {
    getProcessingQueue,
    getRequestStatus,
    getCurrentlyProcessingRequestId,
    getIsProcessing,
    processQueue,
    cancelAll,
    cancelRequest
};
