const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const port = 3000;

// Configure paths
const inputFolder = path.join(__dirname, '../input');
const outputFolder = path.join(__dirname, '../output');
const workflowPath = path.join(__dirname, 'workflow.json');

// Serve static files
app.use('/input', express.static(inputFolder));
app.use('/output', express.static(outputFolder));

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, inputFolder),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safeName);
  },
});
const upload = multer({ storage });

// GET: show upload form
app.get('/', (req, res) => {
  res.render('index');
});

// POST: handle upload
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded');
    }

    const uploadedFileName = req.file.filename;
    const uploadedFilePath = path.join('input', uploadedFileName); // relative for workflow

    // Load and modify workflow.json
    let workflowJson = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

    // Find the VHS_LoadImagePath node
    for (const node of Object.values(workflowJson)) {
      if (
        node.class_type === 'VHS_LoadImagePath' &&
        node.inputs &&
        node.inputs.IMAGEUPLOAD !== undefined
      ) {
        node.inputs.IMAGEUPLOAD = uploadedFilePath;
        node.widgets_values = [uploadedFilePath];
        node.videopreview = { params: { filename: uploadedFilePath } };
      }
    }

    // Send updated workflow to ComfyUI
    const comfyResponse = await axios.post('http://192.168.2.50:8188/prompt', workflowJson);
    const promptId = comfyResponse.data.prompt_id;

    // Poll output folder until a file with same base name appears
    const outputFile = await waitForOutputFile(uploadedFileName);

    // Render result
    res.render('index', { inputImage: uploadedFileName, outputImage: outputFile });
  } catch (error) {
    console.error('Error in /upload:', error);
    res.status(500).send('Server error');
  }
});

// Helper: Wait for output file
function waitForOutputFile(baseInputName, timeout = 20000, interval = 1000) {
  const expectedName = path.parse(baseInputName).name; // Remove extension
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      fs.readdir(outputFolder, (err, files) => {
        if (err) return reject(err);

        const match = files.find(f => f.startsWith(expectedName));
        if (match) return resolve(match);

        if (Date.now() - start >= timeout) {
          return reject(new Error('Output not found in time'));
        }
        setTimeout(check, interval);
      });
    };
    check();
  });
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
