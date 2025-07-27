const WebSocket = require('ws');
const { COMFYUI_WS_URL } = require('../config');
const { getRequestStatus, getCurrentlyProcessingRequestId } = require('../queue');

let comfyUiWs = null;

function connectToComfyUIWebSocket(io) {
    if (comfyUiWs && comfyUiWs.readyState === WebSocket.OPEN) {
        return;
    }

    comfyUiWs = new WebSocket(COMFYUI_WS_URL);

    comfyUiWs.onopen = () => {
        console.log("Connected to ComfyUI WebSocket.");
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
                
                // Determine which stage we're in based on progress
                let stage = "Stage 1: Generating image...";
                if (message.data.value > message.data.max * 0.6) {
                    stage = "Stage 2: Scaling image to correct size...";
                }
                
                io.to(currentlyProcessingRequestId).emit(
                    "processingProgress",
                    { ...progress, stage }
                );
            }
        } catch (parseError) {
            console.error(`Error parsing message from ComfyUI: ${parseError.message}`, event.data);
        }
    };

    comfyUiWs.onclose = () => {
        console.log("Disconnected from ComfyUI WebSocket. Reconnecting in 5 seconds...");
        setTimeout(() => connectToComfyUIWebSocket(io), 5000);
    };

    comfyUiWs.onerror = (error) => {
        console.error("ComfyUI WebSocket error:", error.message);
        comfyUiWs.close();
    };
}

module.exports = { connectToComfyUIWebSocket };
