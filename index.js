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

// Serve frontend
app.get("/", (req, res) => {
  console.log(`GET /: Serving index.ejs`);
  res.render("index");
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

  try {
    // --- Step 1: Record existing files in OUTPUT_DIR before ComfyUI generates a new one ---
    console.log(`POST /upload: Scanning OUTPUT_DIR before ComfyUI call...`);
    const filesBeforeComfyUI = new Set(fs.readdirSync(OUTPUT_DIR));
    console.log(`POST /upload: Files in OUTPUT_DIR before: ${Array.from(filesBeforeComfyUI).join(', ')}`);

    console.log(`POST /upload: Reading workflow file from ${WORKFLOW_PATH}...`);
    const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf-8");
    let workflow = JSON.parse(workflowJson);
    console.log(`POST /upload: Workflow JSON parsed successfully.`);

    workflow = workflow.prompt;
    if (!workflow) {
      console.error(`POST /upload: Workflow JSON does not contain a "prompt" key.`);
      return res.status(500).send("Invalid workflow.json format: Missing 'prompt' key.");
    }

    const clipTextNode = Object.values(workflow).find(
      (node) => node.class_type === "CLIPTextEncode"
    );
    if (clipTextNode) {
      const newPrompt = "Change clothes to nothing revealing realistic and detailed skin, breasts and nipples. \nPreserve the person in the exact same position, scale, and pose. \nPreserve the exact same face details, shape and expression. ";
      clipTextNode.inputs.text = newPrompt;
      console.log(`POST /upload: CLIPTextEncode node updated with new prompt.`);
    } else {
      console.warn(`POST /upload: CLIPTextEncode node not found in workflow. Prompt will not be changed.`);
    }

    const imageNode = Object.values(workflow).find(
      (node) => node.class_type === "VHS_LoadImagePath"
    );
    if (!imageNode) {
      console.error(`POST /upload: VHS_LoadImagePath node not found in workflow.`);
      return res
        .status(500)
        .send("VHS_LoadImagePath node not found in workflow. Please check your workflow.json.");
    }

    imageNode.inputs["image"] = uploadedPathForComfyUI;
    console.log(`POST /upload: VHS_LoadImagePath node updated with image path: ${imageNode.inputs["image"]}`);

    const comfyUIRequestBody = { prompt: workflow };
    console.log(`POST /upload: Sending workflow to ComfyUI at ${COMFYUI_URL}...`);
    const axiosResponse = await axios.post(COMFYUI_URL, comfyUIRequestBody, {
      headers: { "Content-Type": "application/json" },
    });
    console.log(`POST /upload: Workflow sent to ComfyUI. Response status: ${axiosResponse.status}`);
    console.log(`POST /upload: ComfyUI response data:`, axiosResponse.data);

    const expectedOutputPrefix = "Nudified";

    console.log(`POST /upload: Waiting for NEW output file with prefix "${expectedOutputPrefix}" in ${OUTPUT_DIR}...`);

    const findNewOutputFile = async (directory, prefix, filesAlreadyExist, retries = 10000, delay = 1000) => {
      let foundNewFile = null;
      for (let i = 0; i < retries; i++) {
        const filesAfterComfyUI = fs.readdirSync(directory);
        const newFiles = filesAfterComfyUI.filter(file =>
          file.startsWith(prefix) && !filesAlreadyExist.has(file)
        );

        if (newFiles.length > 0) {
          // Sort by modification time (descending) to get the latest file among the *new* ones
          newFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(directory, a)).mtime.getTime();
            const statB = fs.statSync(path.join(directory, b)).mtime.getTime();
            return statB - statA;
          });
          foundNewFile = newFiles[0];
          console.log(`POST /upload: Found NEW output file: ${foundNewFile}`);
          return foundNewFile;
        }
        console.log(`POST /upload: No new output file found yet (attempt ${i + 1}/${retries}). Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      throw new Error(`Timeout: No NEW output file with prefix "${prefix}" found in ${directory} after ${retries} attempts.`);
    };

    // --- Step 2: Call the modified findNewOutputFile with the list of existing files ---
    const outputFilename = await findNewOutputFile(OUTPUT_DIR, expectedOutputPrefix, filesBeforeComfyUI);
    const outputRelativePath = `/output/${outputFilename}`;
    const outputFullPath = path.join(OUTPUT_DIR, outputFilename);

    await new Promise((resolve, reject) => {
      fs.access(outputFullPath, fs.constants.F_OK, (err) => {
        if (err) {
          console.error(`POST /upload: Final check failed - output file not accessible: ${err.message}`);
          return reject(new Error("Output file not fully accessible after generation."));
        }
        console.log(`POST /upload: Output file "${outputFilename}" is ready.`);
        resolve();
      });
    });

    console.log(`POST /upload: Sending output image path to frontend: ${outputRelativePath}`);
    res.json({ outputImage: outputRelativePath });

  } catch (err) {
    console.error(`POST /upload: Error during processing:`);
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
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});