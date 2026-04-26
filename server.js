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
const PLAYER_RADIUS = 30; // Oyuncu hitbox
const OBSTACLE_SIZE = 100; // Görsel Boyut
const OBSTACLE_HIT_SIZE = 70; // Gerçek Çarpışma Boyutu (Küçültüldü)
const OBSTACLE_OFFSET = 15; // Hitbox'ı merkeze almak için 15 piksel boşluk

// Rastgele ve Üst Üste Binmeyen Engeller Oluştur
const obstacles = [];
const NUM_OBSTACLES = 40;

for (let i = 0; i < NUM_OBSTACLES; i++) {
  let x, y, overlap;
  let attempts = 0;
  do {
    overlap = false;
    x = Math.floor(Math.random() * (MAP_WIDTH - OBSTACLE_SIZE));
    y = Math.floor(Math.random() * (MAP_HEIGHT - OBSTACLE_SIZE));
    
    for (let obs of obstacles) {
      if (x < obs.x + obs.width && x + OBSTACLE_SIZE > obs.x &&
          y < obs.y + obs.height && y + OBSTACLE_SIZE > obs.y) {
          overlap = true;
          break;
      }
    }
    attempts++;
  } while (overlap && attempts < 100);
  
  if (!overlap) {
    obstacles.push({
      x: x,
      y: y,
      width: OBSTACLE_SIZE,
      height: OBSTACLE_SIZE,
      // Hitbox sınırları
      hitX: x + OBSTACLE_OFFSET,
      hitY: y + OBSTACLE_OFFSET,
      hitW: OBSTACLE_HIT_SIZE,
      hitH: OBSTACLE_HIT_SIZE
    });
  }
}

const players = {};
let bullets = [];
let bulletIdCounter = 0;

// Çarpışma (AABB - Daire vs Dikdörtgen)
function checkCollision(px, py, radius) {
  if (px < radius) return true;
  if (py < radius) return true;
  if (px > MAP_WIDTH - radius) return true;
  if (py > MAP_HEIGHT - radius) return true;

  for (let obs of obstacles) {
    let closestX = Math.max(obs.hitX, Math.min(px, obs.hitX + obs.hitW));
    let closestY = Math.max(obs.hitY, Math.min(py, obs.hitY + obs.hitH));
    let distanceX = px - closestX;
    let distanceY = py - closestY;
    if ((distanceX * distanceX) + (distanceY * distanceY) < (radius * radius)) {
      return true;
    }
  }
  return false;
}

// Mermi vs Dikdörtgen Çarpışması
function checkBulletCollision(bx, by, bradius) {
  if (bx < bradius || by < bradius || bx > MAP_WIDTH - bradius || by > MAP_HEIGHT - bradius) return true;

  for (let obs of obstacles) {
    let closestX = Math.max(obs.hitX, Math.min(bx, obs.hitX + obs.hitW));
    let closestY = Math.max(obs.hitY, Math.min(by, obs.hitY + obs.hitH));
    let distanceX = bx - closestX;
    let distanceY = by - closestY;
    if ((distanceX * distanceX) + (distanceY * distanceY) < (bradius * bradius)) {
      return true;
    }
  }
  return false;
}

io.on('connection', (socket) => {
  console.log(`Biri arenaya katıldı: ${socket.id}`);

  players[socket.id] = {
    id: socket.id,
    x: MAP_WIDTH / 2,
    y: MAP_HEIGHT / 2,
    email: 'misafir',
    charId: 'Acemi'
  };

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
      io.emit('playerUpdated', { id: socket.id, playerInfo: players[socket.id] });
    }
  });

  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      if (!checkCollision(movementData.x, movementData.y, PLAYER_RADIUS)) {
        players[socket.id].x = movementData.x;
        players[socket.id].y = movementData.y;
      } else {
        socket.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
      }
    }
  });

  // Ateş Etme İsteği
  socket.on('shoot', (angle) => {
    if (players[socket.id]) {
      let p = players[socket.id];
      // Karakterin namlusundan (azıcık önünden) mermi çıksın
      let startX = p.x + Math.cos(angle) * 40;
      let startY = p.y + Math.sin(angle) * 40;
      
      bullets.push({
        id: bulletIdCounter++,
        owner: socket.id,
        x: startX,
        y: startY,
        vx: Math.cos(angle) * 15, // Mermi hızı
        vy: Math.sin(angle) * 15,
        radius: 8,
        life: 60 // Mermi 60 frame sonra kaybolsun (menzil)
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Biri arenadan ayrıldı: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// SUNUCU OYUN DÖNGÜSÜ (Mermiler ve Güncellemeler İçin - Saniyede 60 Kare)
setInterval(() => {
  let activeBullets = [];
  
  for (let b of bullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.life -= 1;

    // Duvara Çarpma veya Süre Dolma
    let hitWall = checkBulletCollision(b.x, b.y, b.radius);
    let hitPlayer = null;

    // Oyunculara Çarpma (Kendi hariç)
    for (let pid in players) {
      if (pid !== b.owner) {
        let target = players[pid];
        let dx = target.x - b.x;
        let dy = target.y - b.y;
        if ((dx*dx + dy*dy) < (PLAYER_RADIUS + b.radius) * (PLAYER_RADIUS + b.radius)) {
          hitPlayer = pid;
          break;
        }
      }
    }

    if (hitPlayer) {
      // Vuruldu logu (Can sistemi sonraki aşamalarda)
      console.log(`${hitPlayer} vuruldu!`);
      // Mermi yok olur, listeye eklenmez
    } else if (!hitWall && b.life > 0) {
      activeBullets.push(b);
    }
  }
  
  bullets = activeBullets;

  // Tüm oyunculara güncel konumları ve mermileri gönder
  io.emit('gameState', {
    players: players,
    bullets: bullets
  });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Brawly sunucusu ${PORT} portunda başarıyla başlatıldı! 🚀`);
});
