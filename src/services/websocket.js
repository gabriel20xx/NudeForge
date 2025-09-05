import WebSocket from 'ws';
import Logger from '../../../NudeShared/server/logger/serverLogger.js';
import { COMFYUI_WS_URL } from '../config/config.js';
import { getRequestStatus, getCurrentlyProcessingRequestId } from './queue.js';

let comfyUiWs = null;
// Track stage progress for each request
const requestStageTracker = new Map();

function connectToComfyUIWebSocket(io) {
    if (comfyUiWs && comfyUiWs.readyState === WebSocket.OPEN) {
        return;
    }

    comfyUiWs = new WebSocket(COMFYUI_WS_URL);

    comfyUiWs.onopen = () => {
        Logger.success('WEBSOCKET', 'Connected to ComfyUI WebSocket.');
    };

    comfyUiWs.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            const currentlyProcessingRequestId = getCurrentlyProcessingRequestId();
            const requestStatus = getRequestStatus();

            if (!currentlyProcessingRequestId || !requestStatus[currentlyProcessingRequestId]) {
                return;
            }

            if (message.type === 'progress' && currentlyProcessingRequestId) {
                const progress = {
                    value: message.data.value,
                    max: message.data.max,
                    type: "global_steps",
                };
                
                // Initialize tracking for this request if not exists
                if (!requestStageTracker.has(currentlyProcessingRequestId)) {
                    requestStageTracker.set(currentlyProcessingRequestId, {
                        stage: 1,
                        hasCompletedStage1: false,
                        lastProgressValue: 0
                    });
                }
                
                const tracker = requestStageTracker.get(currentlyProcessingRequestId);
                const currentProgress = message.data.value / message.data.max;
                
                // Check if we've completed stage 1 and are starting stage 2
                if (tracker.stage === 1 && currentProgress >= 0.95) {
                    tracker.hasCompletedStage1 = true;
                } else if (tracker.hasCompletedStage1 && currentProgress < 0.3 && message.data.value < tracker.lastProgressValue) {
                    // Progress reset to low value after completing stage 1 - we're in stage 2
                    tracker.stage = 2;
                }
                
                tracker.lastProgressValue = message.data.value;
                
                let stage = tracker.stage === 1 ? "Stage 1: Generating image..." : "Stage 2: Scaling image to correct size...";
                
                io.to(currentlyProcessingRequestId).emit(
                    "processingProgress",
                    { ...progress, stage }
                );
            }
        } catch (parseError) {
            Logger.error('WEBSOCKET', `Error parsing message from ComfyUI: ${parseError.message}`, event.data);
        }
    };

    comfyUiWs.onclose = () => {
        Logger.warn('WEBSOCKET', 'Disconnected from ComfyUI WebSocket. Reconnecting in 5 seconds...');
        setTimeout(() => connectToComfyUIWebSocket(io), 5000);
    };

    comfyUiWs.onerror = (error) => {
        Logger.error('WEBSOCKET', 'ComfyUI WebSocket error:', error.message);
        comfyUiWs.close();
    };
}

// Function to clean up stage tracking for a completed request
function cleanupStageTracker(requestId) {
    if (requestStageTracker.has(requestId)) {
        requestStageTracker.delete(requestId);
        Logger.debug('WEBSOCKET', `Cleaned up stage tracker for requestId=${requestId}`);
    }
}

export { connectToComfyUIWebSocket, cleanupStageTracker };
