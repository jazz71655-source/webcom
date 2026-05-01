const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC_FILES = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
};

const server = http.createServer((req, res) => {
  const fileName = PUBLIC_FILES[req.url];

  if (!fileName) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const filePath = path.join(__dirname, fileName);
  const ext = path.extname(filePath);
  const contentType = ext === ".js" ? "text/javascript" : "text/html";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("Server error");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const clients = new Set();

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(sender, message) {
  for (const client of clients) {
    if (client !== sender) {
      send(client, message);
    }
  }
}

wss.on("connection", (ws) => {
  if (clients.size >= 2) {
    send(ws, { type: "full" });
    ws.close();
    return;
  }

  const isInitiator = clients.size === 0;
  clients.add(ws);

  // The first client creates the offer. When the second client joins,
  // both peers are notified that signaling can begin.
  send(ws, { type: "role", initiator: isInitiator });

  if (clients.size === 2) {
    for (const client of clients) {
      send(client, { type: "ready" });
    }
  }

  ws.on("message", (data) => {
    let message;

    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    // Relay offer / answer / ICE candidate messages to the other peer.
    if (["offer", "answer", "candidate"].includes(message.type)) {
      broadcast(ws, message);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcast(ws, { type: "peer-left" });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
