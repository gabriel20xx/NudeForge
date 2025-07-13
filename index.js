const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const http = require("http"); // Import http for Socket.IO
const { Server } = require("socket.io"); // Import Server from socket.io
const WebSocket = require("ws"); // Import WebSocket for ComfyUI connection

const app = express();
const server = http.createServer(app); // Create HTTP server for Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity in development
    methods: ["GET", "POST"],
  },
});

const PORT = 3000;

// Define directories
const INPUT_DIR = path.join(__dirname, "../input");
const OUTPUT_DIR = path.join(__dirname, "../output");
const WORKFLOW_PATH = path.join(__dirname, "workflow.json");
const COMFYUI_URL = "http://192.168.2.50:8188/prompt";
const COMFYUI_WS_URL = "ws://192.168.2.50:8188/ws"; // ComfyUI WebSocket URL

console.log(`Starting server...`);
console.log(`Input directory: ${INPUT_DIR}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log(`Workflow path: ${WORKFLOW_PATH}`);
console.log(`ComfyUI URL: ${COMFYUI_URL}`);
console.log(`ComfyUI WebSocket URL: ${COMFYUI_WS_URL}`);

// Ensure input/output directories exist
[INPUT_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    console.log(`Directory ${dir} does not exist. Creating...`);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Directory ${dir} created.`);
  } else {
    console.log(`Directory ${dir} already exists.`);
  }
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/input", express.static(INPUT_DIR));
app.use("/output", express.static(OUTPUT_DIR));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log(`Multer: Setting destination to ${INPUT_DIR}`);
    cb(null, INPUT_DIR);
  },
  filename: (req, file, cb) => {
    const baseName = path.parse(file.originalname).name;
    const fileExt = path.extname(file.originalname);
    const uniquePart = uuidv4().substring(0, 8);

    const newFileName = `${uniquePart}-${baseName}${fileExt}`;
    console.log(`Multer: Generating unique filename for input: ${newFileName}`);
    cb(null, newFileName);
  },
});
const upload = multer({ storage });

// --- Server-side Queue Implementation ---
const processingQueue = [];
let isProcessing = false;
// requestStatus will now store per-request data, including totalNodesInWorkflow
const requestStatus = {};
let currentlyProcessingRequestId = null;
let comfyUiWs = null; // WebSocket connection to ComfyUI

// Function to establish and manage ComfyUI WebSocket connection
function connectToComfyUIWebSocket() {
  if (comfyUiWs && comfyUiWs.readyState === WebSocket.OPEN) {
    console.log("ComfyUI WebSocket already open.");
    return;
  }

  console.log(`Attempting to connect to ComfyUI WebSocket at ${COMFYUI_WS_URL}...`);
  comfyUiWs = new WebSocket(COMFYUI_WS_URL);

  comfyUiWs.onopen = () => {
    console.log("Connected to ComfyUI WebSocket.");
  };

  comfyUiWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const messageType = message.type;

      const handledMessageTypes = [
        "progress",
        "progress_state",
        "execution_start",
        "execution_cached",
        "execution_interrupted",
        "status",
        "executing",
        "executed",
      ];

      const ignoredMessageTypes = [
        "kaytool.resources",
        "crystools.monitor",
      ];

      if (ignoredMessageTypes.includes(messageType)) {
        return;
      }

      if (!handledMessageTypes.includes(messageType)) {
        console.log(
          `ComfyUI WebSocket: Unhandled message type: ${messageType}. Data:`,
          JSON.stringify(message, null, 2)
        );
        return;
      }

      // Ensure we have a currently processing request and its status object
      if (!currentlyProcessingRequestId || !requestStatus[currentlyProcessingRequestId]) {
        // This message isn't relevant to a tracked request or request data is missing
        return;
      }

      // Use the total nodes for the current request
      const currentRequestTotalNodes = requestStatus[currentlyProcessingRequestId].totalNodesInWorkflow || 0;

      // --- Handle specific message types ---
      if (messageType === "progress" && currentlyProcessingRequestId) {
        // This is the older, simpler progress message (value/max for overall steps)
        const progress = {
          value: message.data.value,
          max: message.data.max,
          step: message.data.value,
          steps: message.data.max,
          type: "global_steps" // Indicate this is global step progress
        };
        io.to(currentlyProcessingRequestId).emit("processingProgress", progress);
        console.log(
          `ComfyUI Progress (Type: progress - Global Steps): Emitting progress for client ${currentlyProcessingRequestId}: ${progress.value}/${progress.max}`
        );
      } else if (messageType === "progress_state" && currentlyProcessingRequestId) {
        const nodes = message.data.nodes;
        let runningNodesCount = 0;
        let finishedNodesCount = 0;
        let totalStepsInRunningNode = 0;
        let currentStepInRunningNode = 0;

        for (const nodeId in nodes) {
          if (nodes.hasOwnProperty(nodeId)) {
            const nodeInfo = nodes[nodeId];
            if (nodeInfo.state === "running") {
              runningNodesCount++;
              currentStepInRunningNode = nodeInfo.value;
              totalStepsInRunningNode = nodeInfo.max;
            } else if (nodeInfo.state === "finished") {
              finishedNodesCount++;
            }
          }
        }

        let overallProgressPercentage = 0;
        if (currentRequestTotalNodes > 0) {
            // Calculate progress based on finished nodes + current running node's progress
            // This assumes a somewhat sequential or weighted progression.
            let baseProgress = finishedNodesCount / currentRequestTotalNodes;
            let currentRunningNodeContribution = 0;

            if (runningNodesCount > 0 && totalStepsInRunningNode > 0) {
                // If a node is running, its contribution is its internal progress
                // divided by the total nodes, scaled by its potential "weight" (1/totalNodes here)
                currentRunningNodeContribution = (currentStepInRunningNode / totalStepsInRunningNode) / currentRequestTotalNodes;
            }

            overallProgressPercentage = Math.min(1, baseProgress + currentRunningNodeContribution); // Cap at 1 (100%)
            overallProgressPercentage = Math.floor(overallProgressPercentage * 100); // Convert to percentage

            const progress = {
                value: overallProgressPercentage,
                max: 100, // Always 100 for percentage
                step: overallProgressPercentage,
                steps: 100,
                type: "overall_percentage", // Indicate this is overall percentage progress
                finishedNodes: finishedNodesCount,
                totalNodes: currentRequestTotalNodes,
                runningNodes: runningNodesCount
            };
            io.to(currentlyProcessingRequestId).emit("processingProgress", progress);
            console.log(
                `ComfyUI Progress (Type: progress_state - Overall Nodes): Emitting progress for client ${currentlyProcessingRequestId}: ${overallProgressPercentage}% (Finished: ${finishedNodesCount}/${currentRequestTotalNodes}, Running: ${runningNodesCount})`
            );
        } else {
            console.log(`ComfyUI Progress (Type: progress_state): Waiting for total nodes to be determined for client ${currentlyProcessingRequestId}.`);
        }
      }
      else if (messageType === "execution_start") {
        console.log(
          `ComfyUI WebSocket: Execution started for client ID: ${message.data.client_id}`
        );
        // Do NOT reset totalNodesInWorkflow here. It's already set in processQueue.
        if (currentlyProcessingRequestId) {
          io.to(currentlyProcessingRequestId).emit("processingStarted");
          console.log(
            `ComfyUI WebSocket: Emitted 'processingStarted' for client ${currentlyProcessingRequestId}`
          );
        }
      } else if (messageType === "execution_cached") {
        console.log(
          `ComfyUI WebSocket: Execution cached for nodes: ${message.data.nodes_ran_from_cache}`
        );
      } else if (messageType === "execution_interrupted") {
        console.error(
          `ComfyUI WebSocket: Execution interrupted! Reason: ${message.data.reason}`
        );
        if (currentlyProcessingRequestId) {
          io.to(currentlyProcessingRequestId).emit("processingFailed", {
            error: "ComfyUI execution interrupted.",
            errorMessage: message.data.reason,
          });
        }
      } else if (messageType === "status") {
        console.log(
          `ComfyUI WebSocket Status: Sid: ${message.data.sid}, Queue remaining: ${message.data.status.exec_info.queue_remaining}`
        );
      } else if (messageType === "executing") {
        console.log(
          `ComfyUI WebSocket Executing: Node: ${message.data.node}, Prompt ID: ${message.data.prompt_id}`
        );
        if (message.data.node === null && currentlyProcessingRequestId) {
          // This often signifies the end of execution for a prompt
          console.log(
            `ComfyUI WebSocket: Prompt execution completed for client ${currentlyProcessingRequestId}.`
          );
        }
      } else if (messageType === "executed") {
        // This message type is sent when a node returns a UI element or output
        console.log(
          `ComfyUI WebSocket: Node executed: ${message.data.node}, Prompt ID: ${message.data.prompt_id}. Output:`,
          message.data.output
        );
      }
    } catch (parseError) {
      console.error(
        `ComfyUI WebSocket: Error parsing message from ComfyUI: ${parseError.message}`,
        event.data
      );
    }
  };

  comfyUiWs.onclose = () => {
    console.log(
      "Disconnected from ComfyUI WebSocket. Reconnecting in 5 seconds..."
    );
    setTimeout(connectToComfyUIWebSocket, 5000); // Reconnect on close
  };

  comfyUiWs.onerror = (error) => {
    console.error("ComfyUI WebSocket error:", error.message);
    comfyUiWs.close(); // Close to trigger reconnect
  };
}

// Establish WebSocket connection when server starts
connectToComfyUIWebSocket();

/**
 * Processes the next item in the queue if ComfyUI is not busy.
 */
async function processQueue() {
  updateFrontendQueueSize();

  if (isProcessing || processingQueue.length === 0) {
    console.log(
      `Queue: Not processing. isProcessing: ${isProcessing}, Queue length: ${processingQueue.length}`
    );
    return;
  }

  isProcessing = true;
  const {
    requestId,
    uploadedFilename,
    originalBasename,
    uploadedPathForComfyUI,
  } = processingQueue.shift();

  currentlyProcessingRequestId = requestId;
  requestStatus[requestId].status = "processing";
  // Inform the client that processing has started (queue position is 0)
  io.to(requestId).emit("queueUpdate", {
    queueSize: processingQueue.length,
    yourPosition: 0,
    status: "processing",
  });
  console.log(
    `Queue: Client ${requestId} notified: status 'processing', queue position 0.`
  );

  console.log(
    `Queue: Starting processing for requestId: ${requestId}, filename: ${uploadedFilename}. ${processingQueue.length} items remaining.`
  );

  const inputFileNameWithoutExt = path.parse(uploadedFilename).name; // e.g., "b4a94f00-boobs_like_these_are_gods_gift_to_men_640_high_35"

  // *** EXACT MODIFICATION HERE: Now includes _00001 before .png ***
  const expectedOutputSuffix = `${inputFileNameWithoutExt}-nudified_00001.png`; // Example: "b4a94f00-boobs_like_these_are_gods_gift_to_men_640_high_35-nudified_00001.png"

  try {
    console.log(
      `Processing Queue: Reading workflow file from ${WORKFLOW_PATH}...`
    );
    const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf-8");
    let workflow = JSON.parse(workflowJson);
    console.log(`Processing Queue: Workflow JSON parsed successfully.`);

    if (!workflow) {
      console.error(`Processing Queue: Workflow JSON is not valid`);
      throw new Error("Invalid workflow.json format.");
    }

    // Set the total nodes for this specific request before sending to ComfyUI
    requestStatus[requestId].totalNodesInWorkflow = Object.keys(workflow).length;
    console.log(`Discovered total nodes in workflow for request ${requestId}: ${requestStatus[requestId].totalNodesInWorkflow}`);


    const clipTextNode = Object.values(workflow).find(
      (node) => node.class_type === "CLIPTextEncode"
    );
    if (clipTextNode) {
      const newPrompt =
        "Change clothes to nothing revealing realistic and detailed skin, breasts and nipples. \nPreserve the person in the exact same position, scale, and pose. \nPreserve the exact same face details, shape and expression. ";
      clipTextNode.inputs.text = newPrompt;
      console.log(
        `Processing Queue: CLIPTextEncode node updated with new prompt.`
      );
    } else {
      console.warn(
        `Processing Queue: CLIPTextEncode node not found in workflow. Prompt will not be changed.`
      );
    }

    const inputNameNode = Object.values(workflow).find(
      (node) =>
        node.class_type === "PrimitiveString" &&
        node._meta?.title === "Input Name"
    );
    if (inputNameNode) {
      inputNameNode.inputs.value = inputFileNameWithoutExt;
      console.log(
        `Processing Queue: PrimitiveString node (Input Name) updated with: ${inputFileNameWithoutExt}`
      );
    } else {
      console.warn(
        `Processing Queue: PrimitiveString node with title "Input Name" not found in workflow. Output naming might be affected.`
      );
    }

    const imageNode = Object.values(workflow).find(
      (node) => node.class_type === "VHS_LoadImagePath"
    );
    if (!imageNode) {
      console.error(
        `Processing Queue: VHS_LoadImagePath node not found in workflow.`
      );
      throw new Error(
        "VHS_LoadImagePath node not found in workflow. Please check your workflow.json."
      );
    }
    imageNode.inputs["image"] = uploadedPathForComfyUI;
    console.log(
      `Processing Queue: VHS_LoadImagePath node updated with image path: ${imageNode.inputs["image"]}`
    );

    const comfyUIRequestBody = { prompt: workflow };
    console.log(
      `Processing Queue: Sending workflow to ComfyUI at ${COMFYUI_URL}...`
    );
    const axiosResponse = await axios.post(COMFYUI_URL, comfyUIRequestBody, {
      headers: { "Content-Type": "application/json" },
    });
    console.log(
      `Processing Queue: Workflow sent to ComfyUI. Response status: ${axiosResponse.status}, ComfyUI prompt ID: ${axiosResponse.data.prompt_id}`
    );
    // You might want to store axiosResponse.data.prompt_id if you want to explicitly track ComfyUI's internal prompt IDs.

    // --- Wait for the specific output file to appear (Indefinite Loop) ---
    console.log(
      `Processing Queue: Continuously waiting for expected output file ending with: ${expectedOutputSuffix}...`
    );

    let foundOutputFilename = null;
    let retryCount = 0;
    const delayBetweenChecks = 500; // Check every 0.5 seconds

    while (true) {
      // Loop indefinitely
      try {
        const filesInOutputDir = await fs.promises.readdir(OUTPUT_DIR);
        foundOutputFilename = filesInOutputDir.find((file) =>
          file.endsWith(expectedOutputSuffix)
        );

        if (foundOutputFilename) {
          const fullPath = path.join(OUTPUT_DIR, foundOutputFilename);
          // Verify file is fully written/accessible
          await fs.promises.access(fullPath, fs.constants.F_OK);
          await new Promise((resolve) => setTimeout(resolve, 100)); // Small buffer for file system writes
          console.log(
            `Processing Queue: Found and accessed expected output file: ${foundOutputFilename}`
          );
          break; // Exit the loop if file is found
        } else {
          retryCount++;
          if (retryCount % 10 === 0) {
            console.log(
              `Processing Queue: Still waiting for file ending with ${expectedOutputSuffix} (checks: ${retryCount}).`
            );
          }
          await new Promise((resolve) => setTimeout(resolve, delayBetweenChecks));
        }
      } catch (err) {
        console.error(
          `Processing Queue: Error while waiting for output file: ${err.message}`
        );
        throw err; // Re-throw to mark the job as failed
      }
    }

    const finalOutputRelativePath = `/output/${foundOutputFilename}`;

    console.log(
      `Processing Queue: Setting status to completed for requestId ${requestId}: ${finalOutputRelativePath}`
    );
    requestStatus[requestId].status = "completed";
    requestStatus[requestId].data = { outputImage: finalOutputRelativePath };
    io.to(requestId).emit("processingComplete", {
      outputImage: finalOutputRelativePath,
    });
    console.log(
      `Queue: Emitted 'processingComplete' for client ${requestId} with output: ${finalOutputRelativePath}`
    );
  } catch (err) {
    console.error(
      `Processing Queue: Error during processing for requestId ${requestId}, filename ${uploadedFilename}:`
    );
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
      console.error(`Response data:`, err.response.data);
      console.error(`Headers:`, err.response.headers);
    } else if (err.request) {
      console.error(
        `No response received from ComfyUI. Request data:`,
        err.request
      );
    } else {
      console.error(`Error message: ${err.message}`);
    }
    requestStatus[requestId].status = "failed";
    requestStatus[requestId].data = {
      error: "Processing failed. Check server logs for details.",
      errorMessage: err.message,
    };
    io.to(requestId).emit("processingFailed", {
      error: "Processing failed. Check server logs for details.",
      errorMessage: err.message,
    });
    console.log(
      `Queue: Emitted 'processingFailed' for client ${requestId}. Error: ${err.message}`
    );
  } finally {
    isProcessing = false;
    currentlyProcessingRequestId = null;
    // Clean up the request status object when processing is done for it
    if (requestStatus[requestId] && requestStatus[requestId].status !== "completed" && requestStatus[requestId].status !== "failed") {
        // If it's not explicitly completed or failed, ensure it's marked as such.
        // Or simply remove it if you don't need its history after processing.
        // For now, let's keep it to allow clients to query for completion status.
    }
    console.log(
      `Queue: Finished processing for requestId. isProcessing set to false. Calling processQueue again.`
    );
    processQueue(); // Process next item in queue
  }
}

// Serve frontend
app.get("/", (req, res) => {
  console.log(`GET /: Serving index.ejs`);
  res.render("index");
});

// New endpoint to get queue size and position
app.get("/queue-status", (req, res) => {
  const requestId = req.query.requestId;
  let yourPosition = -1;
  let status = "unknown";
  let resultData = null;

  if (requestId) {
    if (requestId === currentlyProcessingRequestId) {
      yourPosition = 0;
      status = "processing";
      console.log(
        `GET /queue-status: Request ${requestId} is currently processing.`
      );
    } else {
      const queueIndex = processingQueue.findIndex(
        (item) => item.requestId === requestId
      );
      if (queueIndex !== -1) {
        yourPosition = queueIndex + 1;
        status = "pending";
        console.log(
          `GET /queue-status: Request ${requestId} is pending at position ${yourPosition}.`
        );
      } else if (requestStatus[requestId]) {
        status = requestStatus[requestId].status;
        resultData = requestStatus[requestId].data;
        console.log(
          `GET /queue-status: Request ${requestId} status is '${status}'.`
        );
      } else {
        console.log(`GET /queue-status: Request ${requestId} not found.`);
      }
    }
  } else {
    console.log(`GET /queue-status: No requestId provided.`);
  }

  res.json({
    queueSize: processingQueue.length,
    isProcessing: isProcessing,
    yourPosition: yourPosition,
    status: status,
    result: resultData,
  });
});

// Upload and trigger workflow
app.post("/upload", upload.single("image"), async (req, res) => {
  console.log(`POST /upload: File upload request received.`);
  if (!req.file) {
    console.error(`POST /upload: No file uploaded.`);
    return res.status(400).send("No file uploaded");
  }

  const uploadedFilename = req.file.filename;
  const originalBasename = path.parse(req.file.originalname).name;
  const uploadedPathForComfyUI = path.posix.join("input", uploadedFilename);

  const requestId = uuidv4();

  console.log(
    `POST /upload: Uploaded file: ${uploadedFilename} (Original: ${req.file.originalname}) with requestId: ${requestId}`
  );
  console.log(`POST /upload: Path for ComfyUI: ${uploadedPathForComfyUI}`);

  // Initialize request status with a placeholder for totalNodesInWorkflow
  requestStatus[requestId] = { status: "pending", totalNodesInWorkflow: 0 };

  processingQueue.push({
    requestId,
    uploadedFilename,
    originalBasename,
    uploadedPathForComfyUI,
  });
  console.log(
    `POST /upload: Added ${uploadedFilename} (ID: ${requestId}) to queue. Current queue size: ${processingQueue.length}`
  );

  processQueue(); // Attempt to process queue immediately

  res.status(202).json({
    message: "Image uploaded and added to queue.",
    requestId: requestId,
    queueSize: processingQueue.length,
    yourPosition: processingQueue.length, // Initial position in queue
  });
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`Socket.IO: Client connected: ${socket.id}`);

  // Client requests to join a room specific to their requestId
  socket.on("joinRoom", (requestId) => {
    socket.join(requestId);
    console.log(`Socket.IO: Socket ${socket.id} joined room ${requestId}`);
  });

  socket.on("disconnect", () => {
    console.log(`Socket.IO: Client disconnected: ${socket.id}`);
  });

  socket.on("error", (err) => {
    console.error(`Socket.IO: Socket error for ${socket.id}:`, err.message);
  });
});

function updateFrontendQueueSize() {
  console.log(
    `Queue Status: Current queue size: ${processingQueue.length}, isProcessing: ${isProcessing}`
  );
}

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  updateFrontendQueueSize();
});