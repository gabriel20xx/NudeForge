const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");

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
const processingQueue = [];
let isProcessing = false; // Flag to indicate if ComfyUI is currently processing

/**
 * Processes the next item in the queue if ComfyUI is not busy.
 */
async function processQueue() {
  // Update queue size for frontend immediately when processing starts/ends
  updateFrontendQueueSize();

  if (isProcessing || processingQueue.length === 0) {
    return; // Already processing or queue is empty
  }

  isProcessing = true;
  const { req, res, uploadedFilename, uploadedBasename, uploadedPathForComfyUI, filesBeforeComfyUI } = processingQueue.shift();
  console.log(`Queue: Starting processing for ${uploadedFilename}. ${processingQueue.length} items remaining.`);

  try {
    console.log(`Processing Queue: Reading workflow file from ${WORKFLOW_PATH}...`);
    const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf-8");
    let workflow = JSON.parse(workflowJson);
    console.log(`Processing Queue: Workflow JSON parsed successfully.`);

    workflow = workflow.prompt;
    if (!workflow) {
      console.error(`Processing Queue: Workflow JSON does not contain a "prompt" key.`);
      res.status(500).send("Invalid workflow.json format: Missing 'prompt' key."); // Send response
      return; // Exit
    }

    const clipTextNode = Object.values(workflow).find(
      (node) => node.class_type === "CLIPTextEncode"
    );
    if (clipTextNode) {
      const newPrompt = "Change clothes to nothing revealing realistic and detailed skin, breasts and nipples. \nPreserve the person in the exact same position, scale, and pose. \nPreserve the exact same face details, shape and expression. ";
      clipTextNode.inputs.text = newPrompt;
      console.log(`Processing Queue: CLIPTextEncode node updated with new prompt.`);
    } else {
      console.warn(`Processing Queue: CLIPTextEncode node not found in workflow. Prompt will not be changed.`);
    }

    const imageNode = Object.values(workflow).find(
      (node) => node.class_type === "VHS_LoadImagePath"
    );
    if (!imageNode) {
      console.error(`Processing Queue: VHS_LoadImagePath node not found in workflow.`);
      res.status(500).send("VHS_LoadImagePath node not found in workflow. Please check your workflow.json."); // Send response
      return; // Exit
    }

    imageNode.inputs["image"] = uploadedPathForComfyUI;
    console.log(`Processing Queue: VHS_LoadImagePath node updated with image path: ${imageNode.inputs["image"]}`);

    const comfyUIRequestBody = { prompt: workflow };
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

    console.log(`Processing Queue: Sending output image path to client for ${uploadedFilename}: ${outputRelativePath}`);
    res.json({ outputImage: outputRelativePath });

  } catch (err) {
    console.error(`Processing Queue: Error during processing for ${uploadedFilename}:`);
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

// New endpoint to get queue size
app.get("/queue-size", (req, res) => {
    res.json({ queueSize: processingQueue.length, isProcessing: isProcessing });
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

  console.log(`POST /upload: Uploaded file: ${uploadedFilename}`);
  console.log(`POST /upload: Path for ComfyUI: ${uploadedPathForComfyUI}`);

  // Capture current state of output directory before enqueuing
  const filesBeforeComfyUI = new Set(fs.readdirSync(OUTPUT_DIR));
  console.log(`POST /upload: Files in OUTPUT_DIR before enqueuing: ${Array.from(filesBeforeComfyUI).join(', ')}`);

  // Add the request details to the queue
  processingQueue.push({
    req,
    res,
    uploadedFilename,
    uploadedBasename,
    uploadedPathForComfyUI,
    filesBeforeComfyUI
  });
  console.log(`POST /upload: Added ${uploadedFilename} to queue. Queue size: ${processingQueue.length}`);

  // Immediately try to process the queue (if not already processing)
  processQueue(); // This will also trigger updateFrontendQueueSize() via processQueue start/finally

  // The client will now wait for their turn in the queue.
  // We don't send a response here, as the `res.json` or `res.status` will be called
  // by the `processQueue` function when this specific request is handled.
});

// Add a helper function to trigger frontend queue size update
function updateFrontendQueueSize() {
    // This function will eventually send updates via WebSockets if implemented.
    // For now, it just logs. The frontend will poll the /queue-size endpoint.
    console.log(`Current queue size: ${processingQueue.length}, isProcessing: ${isProcessing}`);
}


app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  // Initial update for frontend when server starts
  updateFrontendQueueSize();
});