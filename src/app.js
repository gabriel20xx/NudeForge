const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Logger = require("./utils/logger");
const { PORT, INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR, LORAS_DIR } = require("./config/config");
const { connectToComfyUIWebSocket } = require("./services/websocket");
const { router: routes } = require("./routes/routes");
const { generateAllCarouselThumbnails } = require("./services/carousel");
const { getAvailableLoRAsWithSubdirs } = require("./services/loras");

const app = express();
const server = http.createServer(app);
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

connectToComfyUIWebSocket(io);

server.listen(PORT, async () => {
    Logger.success('SERVER', `Server running at http://localhost:${PORT}`);
    Logger.info('STARTUP', `Platform: ${process.platform}`);
    Logger.info('STARTUP', `Node.js version: ${process.version}`);
    
    // Log directory paths for debugging
    Logger.info('STARTUP', `Input directory: ${INPUT_DIR}`);
    Logger.info('STARTUP', `Output directory: ${OUTPUT_DIR}`);
    Logger.info('STARTUP', `Copy directory: ${UPLOAD_COPY_DIR}`);
    Logger.info('STARTUP', `LoRAs directory: ${LORAS_DIR}`);
    
    // Discover and log available LoRAs on startup
    try {
        Logger.info('STARTUP', 'Discovering available LoRA models...');
        const loras = await getAvailableLoRAsWithSubdirs();
        
        const rootCount = loras.root ? loras.root.length : 0;
        const subdirNames = Object.keys(loras.subdirs || {});
        let totalSubdirCount = 0;
        
        subdirNames.forEach(subdirName => {
            const subdirLoras = loras.subdirs[subdirName];
            if (Array.isArray(subdirLoras)) {
                totalSubdirCount += subdirLoras.length;
            }
        });
        
        Logger.success('STARTUP', `Found ${rootCount} LoRA(s) in root directory`);
        if (rootCount > 0) {
            loras.root.forEach(lora => {
                Logger.info('STARTUP', `  - ${lora.displayName} (${lora.filename})`);
            });
        }
        
        if (subdirNames.length > 0) {
            Logger.success('STARTUP', `Found ${subdirNames.length} LoRA subdirectories with ${totalSubdirCount} total LoRA(s)`);
            subdirNames.forEach(subdirName => {
                const subdirLoras = loras.subdirs[subdirName];
                if (Array.isArray(subdirLoras) && subdirLoras.length > 0) {
                    Logger.info('STARTUP', `  ${subdirName}/: ${subdirLoras.length} LoRA(s)`);
                    subdirLoras.forEach(lora => {
                        Logger.info('STARTUP', `    - ${lora.displayName} (${lora.relativePath})`);
                    });
                }
            });
        } else {
            Logger.warn('STARTUP', 'No LoRA subdirectories found');
        }
        
        const totalLoras = rootCount + totalSubdirCount;
        if (totalLoras === 0) {
            Logger.warn('STARTUP', 'No LoRA models found! Please check your LoRAs directory.');
        } else {
            Logger.success('STARTUP', `Total LoRA models available: ${totalLoras}`);
        }
        
    } catch (error) {
        Logger.error('STARTUP', 'Failed to discover LoRA models:', error);
    }
    
    // Generate carousel thumbnails on startup
    await generateAllCarouselThumbnails();
});

module.exports = { app, server };
