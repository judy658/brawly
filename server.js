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
const PLAYER_RADIUS = 30;
const OBSTACLE_SIZE = 100;
const OBSTACLE_HIT_SIZE = 70;
const OBSTACLE_OFFSET = 15;
const BULLET_DAMAGE = 20; // Her mermi 20 hasar verir
const MAX_HP = 100;
const RESPAWN_DELAY = 3000; // 3 saniye bekleme

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
      x: x, y: y,
      width: OBSTACLE_SIZE, height: OBSTACLE_SIZE,
      hitX: x + OBSTACLE_OFFSET, hitY: y + OBSTACLE_OFFSET,
      hitW: OBSTACLE_HIT_SIZE, hitH: OBSTACLE_HIT_SIZE
    });
  }
}

const players = {};
let bullets = [];
let bulletIdCounter = 0;
let killFeed = []; // Son öldürme bildirimleri

// Güvenli doğma noktası bul (engellerden uzak)
function findSafeSpawn() {
  let x, y, safe;
  let attempts = 0;
  do {
    safe = true;
    x = 100 + Math.floor(Math.random() * (MAP_WIDTH - 200));
    y = 100 + Math.floor(Math.random() * (MAP_HEIGHT - 200));
    
    for (let obs of obstacles) {
      let dx = x - Math.max(obs.hitX, Math.min(x, obs.hitX + obs.hitW));
      let dy = y - Math.max(obs.hitY, Math.min(y, obs.hitY + obs.hitH));
      if ((dx*dx + dy*dy) < (80*80)) { safe = false; break; }
    }
    attempts++;
  } while (!safe && attempts < 50);
  return { x, y };
}

// Çarpışma Kontrolü (Oyuncu hareketi)
function checkCollision(px, py, radius) {
  if (px < radius || py < radius || px > MAP_WIDTH - radius || py > MAP_HEIGHT - radius) return true;
  for (let obs of obstacles) {
    let closestX = Math.max(obs.hitX, Math.min(px, obs.hitX + obs.hitW));
    let closestY = Math.max(obs.hitY, Math.min(py, obs.hitY + obs.hitH));
    let dx = px - closestX, dy = py - closestY;
    if ((dx*dx + dy*dy) < (radius*radius)) return true;
  }
  return false;
}

// Mermi Çarpışma Kontrolü
function checkBulletCollision(bx, by, bradius) {
  if (bx < bradius || by < bradius || bx > MAP_WIDTH - bradius || by > MAP_HEIGHT - bradius) return true;
  for (let obs of obstacles) {
    let closestX = Math.max(obs.hitX, Math.min(bx, obs.hitX + obs.hitW));
    let closestY = Math.max(obs.hitY, Math.min(by, obs.hitY + obs.hitH));
    let dx = bx - closestX, dy = by - closestY;
    if ((dx*dx + dy*dy) < (bradius*bradius)) return true;
  }
  return false;
}

// Oyuncuyu öldür ve belirli süre sonra yeniden doğur
function killPlayer(victimId, killerId) {
  if (!players[victimId]) return;
  
  let killerName = players[killerId] ? players[killerId].email : '???';
  let victimName = players[victimId].email;
  
  players[victimId].alive = false;
  
  // Kill Feed'e ekle
  let feedItem = { killer: killerName, victim: victimName, time: Date.now() };
  killFeed.push(feedItem);
  if (killFeed.length > 5) killFeed.shift(); // Son 5 bildirimi tut
  
  io.emit('killEvent', feedItem);
  
  // Belirli süre sonra yeniden doğur
  setTimeout(() => {
    if (players[victimId]) {
      let spawn = findSafeSpawn();
      players[victimId].x = spawn.x;
      players[victimId].y = spawn.y;
      players[victimId].hp = MAX_HP;
      players[victimId].alive = true;
      io.emit('playerRespawned', { id: victimId, x: spawn.x, y: spawn.y });
    }
  }, RESPAWN_DELAY);
}

io.on('connection', (socket) => {
  console.log(`Biri arenaya katıldı: ${socket.id}`);

  let spawn = findSafeSpawn();
  players[socket.id] = {
    id: socket.id,
    x: spawn.x,
    y: spawn.y,
    email: 'misafir',
    charId: 'Acemi',
    hp: MAX_HP,
    maxHp: MAX_HP,
    alive: true
  };

  socket.emit('initGame', { 
    players: players, 
    obstacles: obstacles,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    killFeed: killFeed
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
    if (players[socket.id] && players[socket.id].alive) {
      if (!checkCollision(movementData.x, movementData.y, PLAYER_RADIUS)) {
        players[socket.id].x = movementData.x;
        players[socket.id].y = movementData.y;
      } else {
        socket.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
      }
    }
  });

  socket.on('shoot', (angle) => {
    if (players[socket.id] && players[socket.id].alive) {
      let p = players[socket.id];
      let startX = p.x + Math.cos(angle) * 40;
      let startY = p.y + Math.sin(angle) * 40;
      
      bullets.push({
        id: bulletIdCounter++,
        owner: socket.id,
        x: startX, y: startY,
        vx: Math.cos(angle) * 15,
        vy: Math.sin(angle) * 15,
        radius: 8,
        life: 60
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Biri arenadan ayrıldı: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// SUNUCU OYUN DÖNGÜSÜ (60 FPS)
setInterval(() => {
  let activeBullets = [];
  
  for (let b of bullets) {
    b.x += b.vx;
    b.y += b.vy;
    b.life -= 1;

    let hitWall = checkBulletCollision(b.x, b.y, b.radius);
    let hitPlayer = null;

    for (let pid in players) {
      if (pid !== b.owner && players[pid].alive) {
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
      // Hasar ver
      players[hitPlayer].hp -= BULLET_DAMAGE;
      
      if (players[hitPlayer].hp <= 0) {
        players[hitPlayer].hp = 0;
        killPlayer(hitPlayer, b.owner);
      }
      // Mermi yok olur
    } else if (!hitWall && b.life > 0) {
      activeBullets.push(b);
    }
  }
  
  bullets = activeBullets;

  io.emit('gameState', {
    players: players,
    bullets: bullets
  });

}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Brawly sunucusu ${PORT} portunda başarıyla başlatıldı! 🚀`);
});
