const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { INPUT_DIR, UPLOAD_COPY_DIR } = require('../config');

// Multer config for /upload (input dir)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, INPUT_DIR);
    },
    filename: (req, file, cb) => {
        const baseName = path.parse(file.originalname).name;
        const fileExt = path.extname(file.originalname);
        const uniquePart = uuidv4().substring(0, 8);
        const newFileName = `${uniquePart}-${baseName}${fileExt}`;
        cb(null, newFileName);
    },
});

// Multer config for /upload-copy (upload dir)
const uploadCopyStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_COPY_DIR);
    },
    filename: (req, file, cb) => {
        const baseName = path.parse(file.originalname).name;
        const fileExt = path.extname(file.originalname);
        const uniquePart = uuidv4().substring(0, 8);
        const newFileName = `${uniquePart}-${baseName}${fileExt}`;
        cb(null, newFileName);
    },
});

const upload = multer({ storage });
const uploadCopy = multer({ storage: uploadCopyStorage });

module.exports = { upload, uploadCopy };
