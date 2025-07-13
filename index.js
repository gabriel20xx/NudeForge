const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs

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

/**
 * Processes the next item in the queue if ComfyUI is not busy.
 */
async function processQueue() {
  // Update queue size for frontend immediately when processing starts/ends
  updateFrontendQueueSize(); // This is just a log, client polls

  if (isProcessing || processingQueue.length === 0) {
    return; // Already processing or queue is empty
  }

  isProcessing = true;
  const { req, res, requestId, uploadedFilename, uploadedBasename, uploadedPathForComfyUI, filesBeforeComfyUI } = processingQueue.shift();
  console.log(`Queue: Starting processing for requestId: ${requestId}, filename: ${uploadedFilename}. ${processingQueue.length} items remaining.`);

  try {
    console.log(`Processing Queue: Reading workflow file from ${WORKFLOW_PATH}...`);
    const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf-8");
    let workflow = JSON.parse(workflowJson);
    console.log(`Processing Queue: Workflow JSON parsed successfully.`);

    if (!workflow) {
      console.error(`Processing Queue: Workflow JSON is not valid`);
      res.status(500).send("Invalid workflow.json format."); // Send response
      return; // Exit
    }

    const clipTextNode = Object.values(promptNodes).find(
      (node) => node.class_type === "CLIPTextEncode"
    );
    if (clipTextNode) {
      const newPrompt = "Change clothes to nothing revealing realistic and detailed skin, breasts and nipples. \nPreserve the person in the exact same position, scale, and pose. \nPreserve the exact same face details, shape and expression. ";
      clipTextNode.inputs.text = newPrompt;
      console.log(`Processing Queue: CLIPTextEncode node updated with new prompt.`);
    } else {
      console.warn(`Processing Queue: CLIPTextEncode node not found in workflow. Prompt will not be changed.`);
    }

    const inputNameNode = Object.values(promptNodes).find(
      (node) => node.class_type === "PrimitiveString" && node._meta?.title === "Input Name"
    );
    if (inputNameNode) {
      inputNameNode.inputs.value = uploadedBasename;
      console.log(`Processing Queue: PrimitiveString node updated with input name.`);
    } else {
      console.warn(`Processing Queue: PrimitiveString node with title "Input Name" not found in workflow. Input name will not be set.`);
    }

    const imageNode = Object.values(promptNodes).find(
      (node) => node.class_type === "VHS_LoadImagePath"
    );
    if (!imageNode) {
      console.error(`Processing Queue: VHS_LoadImagePath node not found in workflow.`);
      res.status(500).send("VHS_LoadImagePath node not found in workflow. Please check your workflow.json."); // Send response
      return; // Exit
    }

    imageNode.inputs["image"] = uploadedPathForComfyUI;
    console.log(`Processing Queue: VHS_LoadImagePath node updated with image path: ${imageNode.inputs["image"]}`);

    // Re-wrap the promptNodes in the "prompt" key before sending to ComfyUI
    const comfyUIRequestBody = { prompt: promptNodes };
    console.log(`Processing Queue: Sending workflow to ComfyUI at ${COMFYUI_URL}...`);
    const axiosResponse = await axios.post(COMFYUI_URL, comfyUIRequestBody, {
      headers: { "Content-Type": "application/json" },
    });
    console.log(`Processing Queue: Workflow sent to ComfyUI. Response status: ${axiosResponse.status}`);
    console.log(`Processing Queue: ComfyUI response data:`, axiosResponse.data);

    const expectedOutputPrefix = "Nudified";

    console.log(`Processing Queue: Waiting for NEW output file with prefix "${expectedOutputPrefix}" in ${OUTPUT_DIR}...`);

    const findNewOutputFile = async (directory, prefix, filesAlreadyExist, retries = 1000, delay = 1000) => {
      let foundNewFile = null;
      for (let i = 0; i < retries; i++) {
        const filesAfterComfyUI = fs.readdirSync(directory);
        const newFiles = filesAfterComfyUI.filter(file =>
          file.startsWith(prefix) && !filesAlreadyExist.has(file)
        );

        if (newFiles.length > 0) {
          newFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(directory, a)).mtime.getTime();
            const statB = fs.statSync(path.join(directory, b)).mtime.getTime();
            return statB - statA;
          });
          foundNewFile = newFiles[0];
          console.log(`Processing Queue: Found NEW output file: ${foundNewFile}`);
          return foundNewFile;
        }
        console.log(`Processing Queue: No new output file found yet (attempt ${i + 1}/${retries}). Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      throw new Error(`Timeout: No NEW output file with prefix "${prefix}" found in ${directory} after ${retries} attempts.`);
    };

    const outputFilename = await findNewOutputFile(OUTPUT_DIR, expectedOutputPrefix, filesBeforeComfyUI);
    const outputRelativePath = `/output/${outputFilename}`;
    const outputFullPath = path.join(OUTPUT_DIR, outputFilename);

    await new Promise((resolve, reject) => {
      fs.access(outputFullPath, fs.constants.F_OK, (err) => {
        if (err) {
          console.error(`Processing Queue: Final check failed - output file not accessible: ${err.message}`);
          return reject(new Error("Output file not fully accessible after generation."));
        }
        console.log(`Processing Queue: Output file "${outputFilename}" is ready.`);
        resolve();
      });
    });

    console.log(`Processing Queue: Sending output image path to client for requestId ${requestId}: ${outputRelativePath}`);
    res.json({ outputImage: outputRelativePath });

  } catch (err) {
    console.error(`Processing Queue: Error during processing for requestId ${requestId}, filename ${uploadedFilename}:`);
    if (err.response) {
      console.error(`Status: ${err.response.status}`);
      console.error(`Response data:`, err.response.data);
      console.error(`Headers:`, err.response.headers);
    } else if (err.request) {
      console.error(`No response received from ComfyUI. Request data:`, err.request);
    } else {
      console.error(`Error message: ${err.message}`);
    }
    res.status(500).send("Processing failed. Check server logs for details.");
  } finally {
    isProcessing = false; // Mark processing as complete
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
app.get("/queue-status", (req, res) => { // Renamed from /queue-size to be more generic
    const requestId = req.query.requestId; // Get requestId from query parameter
    let positionInQueue = -1; // -1 means not found

    if (requestId) {
        // Find the index of the request with the given ID
        positionInQueue = processingQueue.findIndex(item => item.requestId === requestId);
        // If the item is currently being processed, it's not in the queue anymore, but its status is 'processing'
        // For simplicity, we'll say its position is 0 (or 'now processing') if it was the last one picked up
        // A more robust solution might track the currently processing item separately.
        // Here, if it's not in the queue, it means it's either processed or being processed.
        if (positionInQueue === -1 && isProcessing) {
             // If the client's request *just* got picked up, it's no longer in the queue,
             // but it's the one currently being processed.
             // We can signal this by setting position to 0.
             // This is a simplification; ideally, you'd track the `currentlyProcessingRequestId`.
             // For now, if they ask for their ID and it's not in the queue but something IS processing,
             // we assume it's them.
             // This needs refinement for absolute accuracy if multiple clients are polling VERY rapidly.
             // Best practice: ComfyUI's /history endpoint combined with websocket
             // updates for the client's specific job.
             // For a simple polling solution:
             // If client's request ID is not in queue AND isProcessing is true, it implies client's request
             // is the one being processed.
             // However, `processingQueue.shift()` already removes it.
             // A better way is for the server to explicitly keep track of `currentProcessingRequestId`.
             // For this simple queue, if it's not in queue, it's already past it.
             // We return -1 if not found in queue.
        }
    }

    res.json({
        queueSize: processingQueue.length,
        isProcessing: isProcessing,
        yourPosition: positionInQueue === -1 ? -1 : positionInQueue + 1 // +1 for 1-based indexing
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

  console.log(`POST /upload: Uploaded file: ${uploadedFilename} with requestId: ${requestId}`);
  console.log(`POST /upload: Path for ComfyUI: ${uploadedPathForComfyUI}`);

  // Capture current state of output directory before enqueuing
  const filesBeforeComfyUI = new Set(fs.readdirSync(OUTPUT_DIR));
  console.log(`POST /upload: Files in OUTPUT_DIR before enqueuing: ${Array.from(filesBeforeComfyUI).join(', ')}`);

  // Add the request details to the queue
  processingQueue.push({
    req,
    res,
    requestId, // Store the unique ID with the request
    uploadedFilename,
    uploadedBasename,
    uploadedPathForComfyUI,
    filesBeforeComfyUI
  });
  console.log(`POST /upload: Added ${uploadedFilename} (ID: ${requestId}) to queue. Queue size: ${processingQueue.length}`);

  // Immediately try to process the queue (if not already processing)
  processQueue();

  // Send the requestId back to the client immediately so they can track their position
  res.status(202).json({
      message: "Image uploaded and added to queue.",
      requestId: requestId,
      queueSize: processingQueue.length, // Initial queue size
      yourPosition: processingQueue.length // Initial position (last in queue)
  });
});

// Add a helper function to trigger frontend queue size update
function updateFrontendQueueSize() {
    console.log(`Current queue size: ${processingQueue.length}, isProcessing: ${isProcessing}`);
}


app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  // Initial update for frontend when server starts
  updateFrontendQueueSize();
});
