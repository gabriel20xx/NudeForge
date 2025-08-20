import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { INPUT_DIR, UPLOAD_COPY_DIR } from '../config/config.js';

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

export { upload, uploadCopy };
