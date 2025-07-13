const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid"); // For generating unique IDs

const app = express();
const PORT = 3000;

// Define directories
const INPUT_DIR = path.join(__dirname, "../input");
const OUTPUT_DIR = path.join(__dirname, "../output");
const WORKFLOW_PATH = path.join(__dirname, "workflow.json");
const COMFYUI_URL = "http://192.168.2.50:8188/prompt"; // Ensure this is correct

console.log(`Starting server...`);
console.log(`Input directory: ${INPUT_DIR}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log(`Workflow path: ${WORKFLOW_PATH}`);
console.log(`ComfyUI URL: ${COMFYUI_URL}`);

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
    const uniqueName = `${Date.now()}-${file.originalname}`;
    console.log(`Multer: Generating unique filename: ${uniqueName}`);
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// --- Server-side Queue Implementation ---
// Add a requestId to each item in the queue for client tracking
const processingQueue = [];
let isProcessing = false; // Flag to indicate if ComfyUI is currently processing

// Store results or errors for requests
const requestStatus = {}; // { requestId: { status: 'pending'|'processing'|'completed'|'failed', data: any } }
let currentlyProcessingRequestId = null; // Track the ID of the request currently being processed

/**
 * Processes the next item in the queue if ComfyUI is not busy.
 */
async function processQueue() {
  updateFrontendQueueSize();

  if (isProcessing || processingQueue.length === 0) {
    return; // Already processing or queue is empty
  }

  isProcessing = true;
  const {
    requestId,
    uploadedFilename,
    uploadedBasename,
    uploadedPathForComfyUI,
    filesBeforeComfyUI,
  } = processingQueue.shift();

  currentlyProcessingRequestId = requestId;
  requestStatus[requestId].status = "processing";

  console.log(
    `Queue: Starting processing for requestId: ${requestId}, filename: ${uploadedFilename}. ${processingQueue.length} items remaining.`
  );

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
      inputNameNode.inputs.value = uploadedBasename;
      console.log(
        `Processing Queue: PrimitiveString node updated with input name.`
      );
    } else {
      console.warn(
        `Processing Queue: PrimitiveString node with title "Input Name" not found in workflow. Input name will not be set.`
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

    // Re-wrap the promptNodes in the "prompt" key before sending to ComfyUI
    const comfyUIRequestBody = { prompt: workflow };
    console.log(
      `Processing Queue: Sending workflow to ComfyUI at ${COMFYUI_URL}...`
    );
    const axiosResponse = await axios.post(COMFYUI_URL, comfyUIRequestBody, {
      headers: { "Content-Type": "application/json" },
    });
    console.log(
      `Processing Queue: Workflow sent to ComfyUI. Response status: ${axiosResponse.status}`
    );
    console.log(`Processing Queue: ComfyUI response data:`, axiosResponse.data);

    console.log(
      `Processing Queue: Waiting for NEW output file in ${OUTPUT_DIR}...`
    );

    const findNewOutputFile = async (
      directory,
      filesAlreadyExist,
      retries = 1000,
      delay = 1000
    ) => {
      let foundNewFile = null;
      for (let i = 0; i < retries; i++) {
        const filesAfterComfyUI = fs.readdirSync(directory);
        const newFiles = filesAfterComfyUI.filter(
          (file) => !filesAlreadyExist.has(file)
        );

        if (newFiles.length > 0) {
          newFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(directory, a)).mtime.getTime();
            const statB = fs.statSync(path.join(directory, b)).mtime.getTime();
            return statB - statA;
          });
          foundNewFile = newFiles[0];
          console.log(
            `Processing Queue: Found NEW output file: ${foundNewFile}`
          );
          return foundNewFile;
        }
        console.log(
          `Processing Queue: No new output file found yet (attempt ${
            i + 1
          }/${retries}). Retrying in ${delay / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      throw new Error(
        `Timeout: No NEW output file found in ${directory} after ${retries} attempts.`
      );
    };

    const outputFilename = await findNewOutputFile(
      OUTPUT_DIR,
      filesBeforeComfyUI
    );
    const outputRelativePath = `/output/${outputFilename}`;
    const outputFullPath = path.join(OUTPUT_DIR, outputFilename);

    await new Promise((resolve, reject) => {
      fs.access(outputFullPath, fs.constants.F_OK, (err) => {
        if (err) {
          console.error(
            `Processing Queue: Final check failed - output file not accessible: ${err.message}`
          );
          return reject(
            new Error("Output file not fully accessible after generation.")
          );
        }
        console.log(
          `Processing Queue: Output file "${outputFilename}" is ready.`
        );
        resolve();
      });
    });

    console.log(
      `Processing Queue: Setting status to completed for requestId ${requestId}: ${outputRelativePath}`
    );
    requestStatus[requestId].status = "completed";
    requestStatus[requestId].data = { outputImage: outputRelativePath };
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
      errorMessage: err.message, // Provide a more specific error message
    };
  } finally {
    isProcessing = false; // Mark processing as complete
    currentlyProcessingRequestId = null; // Clear the currently processing ID
    processQueue(); // Attempt to process the next item in the queue
  }
}
// --- End Server-side Queue Implementation ---

// Serve frontend
app.get("/", (req, res) => {
  console.log(`GET /: Serving index.ejs`);
  res.render("index");
});

// New endpoint to get queue size and position
app.get("/queue-status", (req, res) => {
  const requestId = req.query.requestId; // Get requestId from query parameter
  let yourPosition = -1; // -1 means not found
  let status = "unknown";
  let resultData = null;

  if (requestId) {
    if (requestId === currentlyProcessingRequestId) {
      yourPosition = 0; // Currently processing
      status = "processing";
    } else {
      // Find the index of the request with the given ID in the queue
      const queueIndex = processingQueue.findIndex(
        (item) => item.requestId === requestId
      );
      if (queueIndex !== -1) {
        yourPosition = queueIndex + 1; // +1 for 1-based indexing
        status = "pending";
      } else if (requestStatus[requestId]) {
        // Check if the request has completed or failed
        status = requestStatus[requestId].status;
        resultData = requestStatus[requestId].data;
        // If completed or failed, we can remove it from requestStatus after a while
        // or let the client handle cleanup. For now, keep it.
      }
    }
  }

  res.json({
    queueSize: processingQueue.length,
    isProcessing: isProcessing,
    yourPosition: yourPosition,
    status: status, // pending, processing, completed, failed, unknown
    result: resultData, // Contains outputImage or error
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
  const uploadedBasename = path.basename(uploadedFilename);
  const uploadedPathForComfyUI = path.posix.join("input", uploadedBasename);
  const requestId = uuidv4(); // Generate a unique ID for this request

  console.log(
    `POST /upload: Uploaded file: ${uploadedFilename} with requestId: ${requestId}`
  );
  console.log(`POST /upload: Path for ComfyUI: ${uploadedPathForComfyUI}`);

  // Capture current state of output directory before enqueuing
  const filesBeforeComfyUI = new Set(fs.readdirSync(OUTPUT_DIR));
  console.log(
    `POST /upload: Files in OUTPUT_DIR before enqueuing: ${Array.from(
      filesBeforeComfyUI
    ).join(", ")}`
  );

  // Initialize status for this request
  requestStatus[requestId] = { status: "pending" };

  // Add the request details to the queue
  processingQueue.push({
    requestId, // Store the unique ID with the request
    uploadedFilename,
    uploadedBasename,
    uploadedPathForComfyUI,
    filesBeforeComfyUI,
  });
  console.log(
    `POST /upload: Added ${uploadedFilename} (ID: ${requestId}) to queue. Queue size: ${processingQueue.length}`
  );

  // Immediately try to process the queue (if not already processing)
  processQueue();

  // Send the requestId back to the client immediately so they can track their position
  res.status(202).json({
    message: "Image uploaded and added to queue.",
    requestId: requestId,
    queueSize: processingQueue.length, // Initial queue size
    yourPosition: processingQueue.length, // Initial position (last in queue)
  });
});

// Add a helper function to trigger frontend queue size update
function updateFrontendQueueSize() {
  console.log(
    `Current queue size: ${processingQueue.length}, isProcessing: ${isProcessing}`
  );
}

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  // Initial update for frontend when server starts
  updateFrontendQueueSize();
});