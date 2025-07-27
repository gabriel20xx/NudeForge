const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const Logger = require("./utils/logger");
const { PORT, INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR } = require("./config/config");
const { connectToComfyUIWebSocket } = require("./services/websocket");
const { router: routes } = require("./routes/routes");
const { generateAllCarouselThumbnails } = require("./services/carousel");

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
[INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

app.use(cors());
app.use(express.json());

// Routes must come before static middleware to take priority
app.use('/', routes);

// Custom static middleware that excludes carousel images
app.use((req, res, next) => {
    // Skip static serving for carousel images (not thumbnails)
    if (req.path.startsWith('/img/carousel/') && !req.path.includes('/thumbnails/')) {
        return next(); // Continue to next middleware (should hit 404 or our route)
    }
    
    // For all other files, serve statically
    express.static(path.join(__dirname, "../public"))(req, res, next);
});
app.use("/input", express.static(INPUT_DIR));
app.use("/output", express.static(OUTPUT_DIR));
app.use("/upload", express.static(UPLOAD_COPY_DIR));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../public/views"));

io.on("connection", (socket) => {
    socket.on("joinRoom", (requestId) => {
        Logger.info('SOCKET', `Client joined room: ${requestId}`);
        socket.join(requestId);
    });
});

connectToComfyUIWebSocket(io);

server.listen(PORT, async () => {
    Logger.success('SERVER', `Server running at http://localhost:${PORT}`);
    
    // Generate carousel thumbnails on startup
    await generateAllCarouselThumbnails();
});

module.exports = { app, server };
