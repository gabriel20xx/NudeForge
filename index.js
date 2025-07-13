const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 3000;

// Define directories
const INPUT_DIR = path.join(__dirname, "../input");
const OUTPUT_DIR = path.join(__dirname, "../output");
const WORKFLOW_PATH = path.join(__dirname, "workflow.json");
const COMFYUI_URL = "http://192.168.2.50:8188/prompt";

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
  // In your server-side index.js, inside multer.diskStorage.filename
  filename: (req, file, cb) => {
    const baseName = path.parse(file.originalname).name; // Original file name without extension
    const fileExt = path.extname(file.originalname); // Original file extension
    const uniquePart = uuidv4().substring(0, 8); // Short UUID for uniqueness

    // *** THIS IS THE CRUCIAL LINE I MODIFIED LAST TIME ***
    // It should put the UUID at the front:
    const newFileName = `${uniquePart}-${baseName}${fileExt}`; // e.g., "bf32d6b1-boobs_like_these_are_gods_gift_to_men_640_high_35.png"

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
    uploadedFilename,
    originalBasename,
    uploadedPathForComfyUI,
  } = processingQueue.shift();

  currentlyProcessingRequestId = requestId;
  requestStatus[requestId].status = "processing";

  console.log(
    `Queue: Starting processing for requestId: ${requestId}, filename: ${uploadedFilename}. ${processingQueue.length} items remaining.`
  );

  const inputFileNameWithoutExt = path.parse(uploadedFilename).name; // e.g., "myimage-uuidpart"
  // The expected suffix of the output file from ComfyUI
  const expectedOutputSuffix = `${inputFileNameWithoutExt}-nudified.png`; // Or .jpg, based on your ComfyUI workflow output

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
      // This value is what ComfyUI will use as its base prefix.
      // E.g., if this is "myimage-uuidpart", ComfyUI's Save Image node
      // configured with "${input_name}-nudified" will produce "myimage-uuidpart-nudified.png"
      // and then prepend its timestamp.
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
      `Processing Queue: Workflow sent to ComfyUI. Response status: ${axiosResponse.status}`
    );

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
          await new Promise((resolve) =>
            setTimeout(resolve, delayBetweenChecks)
          );
        }
      } catch (err) {
        // Handle errors during readdir or access (e.g., directory not found, permissions)
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
    fs.unlink(path.join(INPUT_DIR, uploadedFilename), (err) => {
      if (err)
        console.error(`Error deleting input file ${uploadedFilename}:`, err);
      else console.log(`Deleted input file: ${uploadedFilename}`);
    });
    processQueue();
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

  const uploadedFilename = req.file.filename;
  const originalBasename = path.parse(req.file.originalname).name;
  const uploadedPathForComfyUI = path.posix.join("input", uploadedFilename);

  const requestId = uuidv4();

  console.log(
    `POST /upload: Uploaded file: ${uploadedFilename} (Original: ${req.file.originalname}) with requestId: ${requestId}`
  );
  console.log(`POST /upload: Path for ComfyUI: ${uploadedPathForComfyUI}`);

  requestStatus[requestId] = { status: "pending" };

  processingQueue.push({
    requestId,
    uploadedFilename,
    originalBasename,
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
