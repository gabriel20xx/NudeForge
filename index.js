const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = 3000;

const INPUT_DIR = path.join(__dirname, "../input");
const OUTPUT_DIR = path.join(__dirname, "../output");
const WORKFLOW_PATH = path.join(__dirname, "workflow.json");
const COMFYUI_URL = "http://192.168.2.50:8188/prompt";

// Ensure input/output directories exist
[INPUT_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/input", express.static(INPUT_DIR));
app.use("/output", express.static(OUTPUT_DIR));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Multer config
const storage = multer.diskStorage({
  destination: INPUT_DIR,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// Serve frontend
app.get("/", (req, res) => {
  res.render("index");
});

// Upload and trigger workflow
app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");

  const uploadedFilename = req.file.filename;
  const uploadedPath = path.posix.join("input", uploadedFilename);

  try {
    const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf-8");
    const workflow = JSON.parse(workflowJson);

    // After parsing workflow JSON
    const clipTextNode = Object.values(workflow).find(
      (node) => node.class_type === "CLIPTextEncode"
    );
    if (clipTextNode) {
      clipTextNode.inputs.text =
        "Change clothes to nothing revealing realistic and detailed skin, breasts and nipples. \nPreserve the person in the exact same position, scale, and pose. \nPreserve the exact same face details, shape and expression. ";
    }

    // Find VHS_LoadImagePath node
    const imageNode = Object.values(workflow).find(
      (node) => node.class_type === "VHS_LoadImagePath"
    );
    if (!imageNode) {
      return res
        .status(500)
        .send("VHS_LoadImagePath node not found in workflow");
    }

    // Replace the image input path with the uploaded file path
    imageNode.inputs["image"] = uploadedPath; // e.g. "input/1690012345678-myphoto.png"

    console.log("Sending workflow with image path:", imageNode.inputs["image"]);

    // POST updated workflow
    const axiosResponse = await axios.post(COMFYUI_URL, workflow, {
      headers: { "Content-Type": "application/json" },
    });

    console.log("Workflow sent, waiting for output...");

    // Grab output filename(s)
    const outputNode = Object.entries(axiosResponse.data).find(
      ([key, val]) =>
        val.class_type === "SaveImage" && val.outputs?.images?.length
    );

    const outputFilename = outputNode?.[1]?.outputs?.images?.[0]?.filename;
    if (!outputFilename) {
      return res.status(500).send("No output image returned from ComfyUI");
    }

    const outputRelativePath = `/output/${path.basename(outputFilename)}`;
    const outputFullPath = path.join(OUTPUT_DIR, path.basename(outputFilename));

    // Wait for file to appear
    const waitForFile = (filePath, retries = 20) =>
      new Promise((resolve, reject) => {
        const check = () => {
          fs.access(filePath, fs.constants.F_OK, (err) => {
            if (!err) return resolve();
            if (retries <= 0) return reject(new Error("Output not ready"));
            setTimeout(() => check(--retries), 500);
          });
        };
        check();
      });

    await waitForFile(outputFullPath);

    // Send path to frontend
    res.json({ outputImage: outputRelativePath });
  } catch (err) {
    if (error.response) {
      console.error("Error in /upload:", error.response.status);
      console.error("Response data:", error.response.data);
    } else {
      console.error("Error in /upload:", error.message);
    }
    res.status(500).send("Processing failed");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
