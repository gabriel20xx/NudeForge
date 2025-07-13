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
    // Generate a unique base filename for the input, without extension
    const baseName = path.parse(file.originalname).name;
    const uniqueId = uuidv4(); // Use uuid to ensure uniqueness, or Date.now() if that's sufficient
    const newFileName = `${baseName}-${uniqueId}${path.extname(file.originalname)}`;
    console.log(`Multer: Generating unique filename for input: ${newFileName}`);
    cb(null, newFileName);
  },
});
const upload = multer({ storage });

// --- Server-side Queue Implementation ---
const processingQueue = [];
let isProcessing = false;
const requestStatus = {};
let currentlyProcessingRequestId = null;

/**
 * Processes the next item in the queue if ComfyUI is not busy.
 */
async function processQueue() {
  updateFrontendQueueSize();

  if (isProcessing || processingQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const {
    requestId,
    uploadedFilename, // This is the unique filename saved in INPUT_DIR
    originalBasename, // This is the original base name from the client
    uploadedPathForComfyUI,
  } = processingQueue.shift();

  currentlyProcessingRequestId = requestId;
  requestStatus[requestId].status = "processing";

  console.log(
    `Queue: Starting processing for requestId: ${requestId}, filename: ${uploadedFilename}. ${processingQueue.length} items remaining.`
  );

  // Derive the expected output filename based on the input's original basename
  const inputFileNameWithoutExt = path.parse(uploadedFilename).name;
  const inputFileExt = path.parse(uploadedFilename).ext;
  // Assuming ComfyUI will output a PNG by default if not specified otherwise in workflow.
  // You might need to adjust the output extension based on your workflow's actual output node.
  const expectedOutputFilename = `${inputFileNameWithoutExt}-nudified.png`; // Or .jpg, based on your ComfyUI workflow output
  const expectedOutputFullPath = path.join(OUTPUT_DIR, expectedOutputFilename);
  const expectedOutputRelativePath = `/output/${expectedOutputFilename}`;


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

    // --- Update Workflow Nodes ---
    // Update CLIPTextEncode node (prompt)
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

    // Update PrimitiveString node (Input Name - often used for file naming)
    const inputNameNode = Object.values(workflow).find(
      (node) =>
        node.class_type === "PrimitiveString" &&
        node._meta?.title === "Input Name"
    );
    if (inputNameNode) {
      // Use the part of the filename that will be used by ComfyUI to form the output name
      // If your ComfyUI workflow uses the input name directly to append "-nudified",
      // then `inputFileNameWithoutExt` is what you want here.
      inputNameNode.inputs.value = inputFileNameWithoutExt; // Use the unique input filename base
      console.log(
        `Processing Queue: PrimitiveString node updated with input name: ${inputFileNameWithoutExt}`
      );
    } else {
      console.warn(
        `Processing Queue: PrimitiveString node with title "Input Name" not found in workflow. Input name will not be set.`
      );
    }

    // Update VHS_LoadImagePath node (input image path)
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

    // --- Wait for the specific output file to appear ---
    console.log(
      `Processing Queue: Waiting for expected output file in ${OUTPUT_DIR}: ${expectedOutputFilename}...`
    );

    const waitForFile = async (
      filePath,
      retries = 120, // Increased retries, adjust as needed (e.g., 2 minutes total)
      delay = 1000 // Check every second
    ) => {
      for (let i = 0; i < retries; i++) {
        try {
          // Check if file exists and is accessible
          await fs.promises.access(filePath, fs.constants.F_OK);
          console.log(`Processing Queue: Found expected output file: ${path.basename(filePath)}`);
          return true;
        } catch (err) {
          if (err.code === 'ENOENT') { // File not found
            console.log(
              `Processing Queue: Expected output file not found yet (attempt ${
                i + 1
              }/${retries}). Retrying in ${delay / 1000}s...`
            );
          } else { // Other access error
            console.warn(`Processing Queue: Error accessing file ${filePath}: ${err.message}`);
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
      throw new Error(
        `Timeout: Expected output file "${path.basename(filePath)}" not found or accessible in ${filePath} after ${retries} attempts.`
      );
    };

    await waitForFile(expectedOutputFullPath);

    console.log(
      `Processing Queue: Setting status to completed for requestId ${requestId}: ${expectedOutputRelativePath}`
    );
    requestStatus[requestId].status = "completed";
    requestStatus[requestId].data = { outputImage: expectedOutputRelativePath };
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
  } finally {
    isProcessing = false;
    currentlyProcessingRequestId = null;
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
  const requestId = req.query.requestId;
  let yourPosition = -1;
  let status = "unknown";
  let resultData = null;

  if (requestId) {
    if (requestId === currentlyProcessingRequestId) {
      yourPosition = 0; // Currently processing
      status = "processing";
    } else {
      const queueIndex = processingQueue.findIndex(
        (item) => item.requestId === requestId
      );
      if (queueIndex !== -1) {
        yourPosition = queueIndex + 1;
        status = "pending";
      } else if (requestStatus[requestId]) {
        status = requestStatus[requestId].status;
        resultData = requestStatus[requestId].data;
      }
    }
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

  const uploadedFilename = req.file.filename; // This is the unique filename generated by Multer
  const originalBasename = path.parse(req.file.originalname).name; // Keep original base name for potential use in ComfyUI or output naming
  const uploadedPathForComfyUI = path.posix.join("input", uploadedFilename); // Use the unique filename for ComfyUI input

  const requestId = uuidv4();

  console.log(
    `POST /upload: Uploaded file: ${uploadedFilename} (Original: ${req.file.originalname}) with requestId: ${requestId}`
  );
  console.log(`POST /upload: Path for ComfyUI: ${uploadedPathForComfyUI}`);

  requestStatus[requestId] = { status: "pending" };

  processingQueue.push({
    requestId,
    uploadedFilename,
    originalBasename, // Pass the original base name if needed in ComfyUI workflow
    uploadedPathForComfyUI,
  });
  console.log(
    `POST /upload: Added ${uploadedFilename} (ID: ${requestId}) to queue. Queue size: ${processingQueue.length}`
  );

  processQueue();

  res.status(202).json({
    message: "Image uploaded and added to queue.",
    requestId: requestId,
    queueSize: processingQueue.length,
    yourPosition: processingQueue.length,
  });
});

function updateFrontendQueueSize() {
  console.log(
    `Current queue size: ${processingQueue.length}, isProcessing: ${isProcessing}`
  );
}

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  updateFrontendQueueSize();
});