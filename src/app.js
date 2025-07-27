const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { PORT, INPUT_DIR, OUTPUT_DIR, UPLOAD_COPY_DIR } = require("./config");
const { connectToComfyUIWebSocket } = require("./websocket/websocket");
const routes = require("./routes/routes");

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
app.use(express.static(path.join(__dirname, "../public")));
app.use("/input", express.static(INPUT_DIR));
app.use("/output", express.static(OUTPUT_DIR));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../public/views"));

app.use('/', routes);

io.on("connection", (socket) => {
    socket.on("joinRoom", (requestId) => {
        console.log(`[SOCKET] Client joined room: ${requestId}`);
        socket.join(requestId);
    });
});

connectToComfyUIWebSocket(io);

server.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});

module.exports = { app, server };
