const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3000;

const INPUT_DIR = path.join(__dirname, '../input');
const OUTPUT_DIR = path.join(__dirname, '../output');
const WORKFLOW_PATH = path.join(__dirname, 'workflow.json');
const COMFYUI_URL = 'http://192.168.2.50:8188/prompt';

[INPUT_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/input', express.static(INPUT_DIR));
app.use('/output', express.static(OUTPUT_DIR));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer config
const storage = multer.diskStorage({
    destination: INPUT_DIR,
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});
const upload = multer({ storage });

// Serve frontend
app.get('/', (req, res) => {
    res.render('index');
});

// Handle image upload and trigger processing
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const uploadedFilename = req.file.filename;
    const uploadedPath = path.posix.join('input', uploadedFilename);

    try {
        // Load workflow.json
        const workflowRaw = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
        const workflow = JSON.parse(workflowRaw);

        // Find the VHS_LoadImagePath node
        const imageNode = workflow.nodes.find(node => node.type === 'VHS_LoadImagePath');
        if (!imageNode) return res.status(500).send('VHS_LoadImagePath node not found');

        // Update image path in widgets_values
        imageNode.widgets_values.image = uploadedPath;
        imageNode.widgets_values.videopreview.params.filename = uploadedPath;

        // Send updated workflow to ComfyUI
        try {
          const response = await axios.post('http://192.168.2.50:8188/prompt', workflowJson, {
            headers: { 'Content-Type': 'application/json' },
          });
          console.log('Response:', response.data);
        } catch (error) {
          if (error.response) {
            console.error('Server responded with error:', error.response.status);
            console.error('Response data:', error.response.data);
          } else {
            console.error('Axios error:', error.message);
          }
        }

        // Get image filename from response
        const outputs = response.data?.output?.['244']?.['images'];
        if (!outputs || outputs.length === 0) {
            return res.status(500).send('No output image from ComfyUI');
        }

        const outputImage = outputs[0].filename;
        const outputPath = path.join('output', path.basename(outputImage));

        // Wait for the output file to exist (polling)
        const outputFullPath = path.join(OUTPUT_DIR, path.basename(outputImage));
        const waitForFile = (file, retries = 20) => new Promise((resolve, reject) => {
            const check = () => {
                fs.access(file, fs.constants.F_OK, err => {
                    if (!err) return resolve();
                    if (retries <= 0) return reject(new Error('Output not ready'));
                    setTimeout(() => check(--retries), 500);
                });
            };
            check();
        });

        await waitForFile(outputFullPath);

        // Respond with path to processed image
        res.json({ outputImage: `/output/${path.basename(outputImage)}` });

    } catch (err) {
        console.error(err);
        res.status(500).send('Processing failed');
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
