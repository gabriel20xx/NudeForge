const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/processed', express.static(path.join(__dirname, 'processed')));

// Home page
app.get('/', (req, res) => {
  res.render('index', { inputImage: null, outputImage: null });
});

// Upload and process image
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const uploadedFilename = req.file.filename;
    const inputRelativePath = `input/${uploadedFilename}`; // For ComfyUI
    const sharedInputPath = path.join(__dirname, 'uploads', uploadedFilename);

    // Load & update workflow.json
    const workflowPath = path.join(__dirname, 'workflow.json');
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

    // Update image path in VHS_LoadImagePath node
    for (const node of Object.values(workflow.prompt)) {
      if (node.type === 'VHS_LoadImagePath') {
        if (node.inputs?.image) {
          node.inputs.image = inputRelativePath;
        }
        if (node.widgets_values) {
          node.widgets_values.image = inputRelativePath;
          if (node.widgets_values.videopreview?.params) {
            node.widgets_values.videopreview.params.filename = inputRelativePath;
          }
        }
      }
    }

    // Send to ComfyUI
    const response = await axios.post('http://192.168.2.50:8188/prompt', workflow);
    const prompt_id = response.data.prompt_id;

    console.log('✅ Prompt sent. Waiting for output...');

    // Wait for result
    const outputImage = await waitForComfyImage(prompt_id);

    res.render('index', {
      inputImage: '/uploads/' + uploadedFilename,
      outputImage
    });
  } catch (err) {
    console.error('❌ Upload error:', err);
    res.status(500).send('Error processing image');
  }
});

// Poll for result
async function waitForComfyImage(prompt_id, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const { data } = await axios.get(`http://192.168.2.50:8188/history/${prompt_id}`);
      const outputs = data.outputs;
      for (const key in outputs) {
        const images = outputs[key].images;
        if (images?.length) {
          const image = images[0];
          return `http://192.168.2.50:8188/view?filename=${image.filename}&subfolder=${image.subfolder}&type=output`;
        }
      }
    } catch (_) {
      // ignore
    }
    await new Promise(res => setTimeout(res, 1000));
  }
  throw new Error('Timed out waiting for ComfyUI output');
}

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
