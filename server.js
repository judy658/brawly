const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// HARİTA VE FİZİK AYARLARI
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const PLAYER_RADIUS = 30; // Çarpışma kutusu (AABB) yarıçapı
const OBSTACLE_SIZE = 100; // Her bir duvarın boyutu (100x100)

// Rastgele engeller oluştur
const obstacles = [];
for (let i = 0; i < 40; i++) {
  obstacles.push({
    x: Math.floor(Math.random() * (MAP_WIDTH - OBSTACLE_SIZE)),
    y: Math.floor(Math.random() * (MAP_HEIGHT - OBSTACLE_SIZE)),
    width: OBSTACLE_SIZE,
    height: OBSTACLE_SIZE
  });
}

const players = {};

// Basit Çarpışma Tespiti (AABB)
function checkCollision(px, py, radius) {
  // Harita sınırları
  if (px < radius) return true;
  if (py < radius) return true;
  if (px > MAP_WIDTH - radius) return true;
  if (py > MAP_HEIGHT - radius) return true;

  // Engeller
  for (let obs of obstacles) {
    let closestX = Math.max(obs.x, Math.min(px, obs.x + obs.width));
    let closestY = Math.max(obs.y, Math.min(py, obs.y + obs.height));
    let distanceX = px - closestX;
    let distanceY = py - closestY;
    let distanceSquared = (distanceX * distanceX) + (distanceY * distanceY);
    if (distanceSquared < (radius * radius)) {
      return true; // Çarpışma var
    }
  }
  return false;
}

io.on('connection', (socket) => {
  console.log(`Biri arenaya katıldı: ${socket.id}`);

  players[socket.id] = {
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
    email: 'misafir',
    charId: 'Acemi'
  };

  // Yeni oyuncuya harita verilerini ve mevcut oyuncuları gönder
  socket.emit('initGame', { 
    players: players, 
    obstacles: obstacles,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT
  });

  socket.broadcast.emit('newPlayer', { id: socket.id, playerInfo: players[socket.id] });

  socket.on('playerJoined', (data) => {
    if (players[socket.id]) {
      players[socket.id].email = data.email;
      players[socket.id].charId = data.charId;
      // İstersek oyuncuyu haritanın ortasına güvenli bir yere de doğurabiliriz
      io.emit('playerUpdated', { id: socket.id, playerInfo: players[socket.id] });
    }
  });

  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      // Çarpışma yoksa harekete izin ver
      if (!checkCollision(movementData.x, movementData.y, PLAYER_RADIUS)) {
        players[socket.id].x = movementData.x;
        players[socket.id].y = movementData.y;
        socket.broadcast.emit('playerMoved', { id: socket.id, x: movementData.x, y: movementData.y });
      } else {
        // Çarpışma varsa, oyuncunun ekranını düzeltmek için geçerli pozisyonunu ona geri gönder
        socket.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Biri arenadan ayrıldı: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Brawly sunucusu ${PORT} portunda başarıyla başlatıldı! 🚀`);
});
