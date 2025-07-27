const WebSocket = require("ws");
const { COMFYUI_WS_URL } = require("../config/config");
const {
    getRequestStatus,
    getCurrentlyProcessingRequestId,
} = require("../queue/queue");

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
            const currentlyProcessingRequestId =
                getCurrentlyProcessingRequestId();
            const requestStatus = getRequestStatus();

            if (
                !currentlyProcessingRequestId ||
                !requestStatus[currentlyProcessingRequestId]
            ) {
                return;
            }

            if (message.type === "progress" && currentlyProcessingRequestId) {
                const progress = {
                    value: message.data.value,
                    max: message.data.max,
                    type: "global_steps",
                };
                io.to(currentlyProcessingRequestId).emit(
                    "processingProgress",
                    progress
                );
            }
        } catch (parseError) {
            console.error(
                `Error parsing message from ComfyUI: ${parseError.message}`,
                event.data
            );
        }
    };

    comfyUiWs.onclose = () => {
        console.log(
            "Disconnected from ComfyUI WebSocket. Reconnecting in 5 seconds..."
        );
        setTimeout(() => connectToComfyUIWebSocket(io), 5000);
    };

    comfyUiWs.onerror = (error) => {
        console.error("ComfyUI WebSocket error:", error.message);
        comfyUiWs.close();
    };
}

module.exports = { connectToComfyUIWebSocket };
