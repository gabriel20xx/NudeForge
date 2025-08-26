import express from 'express';
import http from 'http';
import https from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { createRequire } from 'module';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Logger from '../../shared/serverLogger.js';
import { PORT, INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR, LORAS_DIR, ENABLE_HTTPS, SSL_KEY_PATH, SSL_CERT_PATH } from './config/config.js';
import { connectToComfyUIWebSocket } from './services/websocket.js';
import { router as routes } from './routes/routes.js';
import { generateAllCarouselThumbnails } from './services/carousel.js';
import { getAvailableLoRAsWithSubdirs } from './services/loras.js';

const app = express();
let server; // will initialize after potential cert generation
async function buildServer() {
    if (!ENABLE_HTTPS) {
        return http.createServer(app);
    }
    // Attempt to load existing certs, else generate self-signed
    let key; let cert;
    const useProvided = SSL_KEY_PATH && SSL_CERT_PATH && fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);
    if (useProvided) {
        try {
            key = fs.readFileSync(SSL_KEY_PATH);
            cert = fs.readFileSync(SSL_CERT_PATH);
            Logger.success('HTTPS', `Loaded provided certificate and key (key=${SSL_KEY_PATH}, cert=${SSL_CERT_PATH})`);
        } catch (e) {
            Logger.error('HTTPS', 'Failed reading provided key/cert, falling back to self-signed generation', e);
        }
    }
    if (!key || !cert) {
        try {
            // Lazy-require selfsigned to avoid dependency if HTTPS disabled
            const selfsigned = (await import('selfsigned')).default;
            const attrs = [{ name: 'commonName', value: 'localhost' }];
            const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048, algorithm: 'sha256' });
            key = pems.private;
            cert = pems.cert;
            Logger.warn('HTTPS', 'Using generated self-signed certificate (valid 365 days)');
        } catch (e) {
            Logger.error('HTTPS', 'Failed to generate self-signed certificate. Falling back to HTTP.', e);
            return http.createServer(app);
        }
    }
    return https.createServer({ key, cert }, app);
}
await (async () => { server = await buildServer(); })();
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

app.set('io', io);

// Ensure required directories exist
[INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR, LORAS_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

app.use(cors());
app.use(express.json());

// Routes must come before static middleware to take priority
app.use('/', routes);
// Lightweight health route (before static to ensure quick response)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve static assets from src/public (standard layout)
const staticDir = path.join(__dirname, 'public'); // assets migrated from legacy /public
// Expose shared client assets from installed package (robust resolution)
app.use('/shared', express.static(path.join(__dirname, '..', '..', 'shared')));
Logger.info('STARTUP', 'Mounted shared static assets at /shared (repo local)');

// Serve theme.css from app public if present (synced from shared)
const themeLocal = path.join(__dirname, 'public', 'css', 'theme.css');
if (fs.existsSync(themeLocal)) {
    app.get('/assets/theme.css', (req, res) => res.sendFile(themeLocal));
    Logger.info('STARTUP', `Exposed local theme at /assets/theme.css (path=${themeLocal})`);
}
app.use((req, res, next) => {
    // Allow carousel images route to be handled by dedicated route to apply caching/processing logic
    if (req.path.startsWith('/images/carousel/') && !req.path.includes('/thumbnails/')) {
        return next();
    }
    express.static(staticDir)(req, res, next);
});
app.use('/input', express.static(INPUT_DIR));
app.use('/output', express.static(OUTPUT_DIR));
app.use('/copy', express.static(UPLOAD_COPY_DIR));
app.use('/loras', express.static(LORAS_DIR));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public', 'views'));

io.on("connection", (socket) => {
    socket.on("joinRoom", (requestId) => {
        Logger.info('SOCKET', `Client joined room: ${requestId}`);
        socket.join(requestId);
    });
});

// Skip external websocket in test environments to avoid hanging tests
if (process.env.NODE_ENV !== 'test' && process.env.SKIP_WEBSOCKET !== 'true') {
    connectToComfyUIWebSocket(io);
}

// Attach 404 & error handlers (exported for test harness registration consistency)
function attachTerminalMiddleware() {
    // 404 handler
    app.use((req, res) => {
        if (req.accepts('html')) {
            return res.status(404).render('404', { title: 'Page Not Found' });
        }
        if (req.accepts('json')) {
            return res.status(404).json({ error: 'Not Found' });
        }
        return res.status(404).type('txt').send('Not Found');
    });
    // Global error handler
    app.use((err, req, res) => {
        Logger.error('SERVER', 'Unhandled error', err);
        if (res.headersSent) return; 
        const wantsJson = req.accepts('json') && !req.accepts('html');
        if (wantsJson) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        return res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong' });
    });
}

// Startup logic separated for parity with NudeFlow
async function startServer(port = PORT) {
    attachTerminalMiddleware();
    return new Promise((resolve) => {
        const listener = server.listen(port, () => {
            const protocol = ENABLE_HTTPS ? 'https' : 'http';
            Logger.success('SERVER', `Server running at ${protocol}://localhost:${port}`);
            Logger.info('STARTUP', `Platform: ${process.platform}`);
            Logger.info('STARTUP', `Node.js version: ${process.version}`);
            Logger.info('STARTUP', `Input directory: ${INPUT_DIR}`);
            Logger.info('STARTUP', `Output directory: ${OUTPUT_DIR}`);
            Logger.info('STARTUP', `Copy directory: ${UPLOAD_COPY_DIR}`);
            Logger.info('STARTUP', `LoRAs directory: ${LORAS_DIR}`);
            (async () => {
            try {
                Logger.info('STARTUP', 'Discovering available LoRA models...');
                const loras = await getAvailableLoRAsWithSubdirs();
                const rootCount = loras.root ? loras.root.length : 0;
                const subdirNames = Object.keys(loras.subdirs || {});
                let totalSubdirCount = 0;
                subdirNames.forEach(subdirName => {
                    const subdirLoras = loras.subdirs[subdirName];
                    if (Array.isArray(subdirLoras)) totalSubdirCount += subdirLoras.length;
                });
                Logger.success('STARTUP', `Found ${rootCount} LoRA(s) in root directory`);
                if (rootCount > 0) {
                    loras.root.forEach(lora => Logger.info('STARTUP', `  - ${lora.displayName} (${lora.filename})`));
                }
                if (subdirNames.length > 0) {
                    Logger.success('STARTUP', `Found ${subdirNames.length} LoRA subdirectories with ${totalSubdirCount} total LoRA(s)`);
                } else {
                    Logger.warn('STARTUP', 'No LoRA subdirectories found');
                }
                const totalLoras = rootCount + totalSubdirCount;
                if (totalLoras === 0) {
                    Logger.warn('STARTUP', 'No LoRA models found!');
                } else {
                    Logger.success('STARTUP', `Total LoRA models available: ${totalLoras}`);
                }
            } catch (error) {
                Logger.error('STARTUP', 'Failed to discover LoRA models:', error);
            }
            try {
                if (process.env.NODE_ENV === 'test' || process.env.SKIP_CAROUSEL_THUMBS === 'true') {
                    Logger.info('CAROUSEL', 'Skipping thumbnail generation in test mode');
                } else {
                    const thumbStats = await generateAllCarouselThumbnails();
                const carouselDir = path.join(__dirname, 'public/images/carousel');
                const existing = await fs.promises.readdir(carouselDir);
                const imgs = existing.filter(f=>/\.(jpg|jpeg|png|gif)$/i.test(f));
                if(imgs.length===0){
                    Logger.warn('CAROUSEL', `No images found in ${carouselDir}.`);
                } else {
                    Logger.info('CAROUSEL', `Carousel ready with ${imgs.length} image(s). Thumbnails processed=${thumbStats.processed}, skipped=${thumbStats.skipped}`);
                }
                }
            } catch(e){ Logger.error('CAROUSEL','Post-startup check failed:', e); }
            })();
            resolve(listener);
        });
    });
}

try {
    const executedScript = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const currentModule = path.resolve(fileURLToPath(import.meta.url));
    if (executedScript && executedScript === currentModule) {
        const desiredPort = process.env.PORT || PORT;
        startServer(desiredPort);
    }
} catch {
    // no-op
}

export { app, server, startServer };
