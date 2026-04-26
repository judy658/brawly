const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Tüm sitelerden (arena.html dahil) erişime izin ver
    methods: ["GET", "POST"]
  }
});

// Oyuncuları hafızada tutacağımız obje
const players = {};

io.on('connection', (socket) => {
  console.log(`Biri arenaya katıldı: ${socket.id}`);

  // Yeni bağlanan oyuncuyu kaydet
  players[socket.id] = {
    x: 0,
    y: 0,
    email: 'misafir',
    charId: 'Acemi'
  };

  // Mevcut tüm oyuncuları, yeni bağlanan kişiye gönder
  socket.emit('currentPlayers', players);

  // Diğer tüm oyunculara, arenaya yeni birinin geldiğini haber ver
  socket.broadcast.emit('newPlayer', { id: socket.id, playerInfo: players[socket.id] });

  // Oyuncu oyuna giriş yaptığında bilgilerini günceller
  socket.on('playerJoined', (data) => {
    if (players[socket.id]) {
      players[socket.id].email = data.email;
      players[socket.id].charId = data.charId;
      players[socket.id].x = data.x || 0;
      players[socket.id].y = data.y || 0;
      
      // Bilgiler güncellenince herkese duyur
      io.emit('playerUpdated', { id: socket.id, playerInfo: players[socket.id] });
    }
  });

  // Oyuncu hareket ettiğinde
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      
      // Hareketi diğer tüm oyunculara yayınla
      socket.broadcast.emit('playerMoved', { id: socket.id, x: movementData.x, y: movementData.y });
    }
  });

  // Oyuncu koptuğunda / çıktığında
  socket.on('disconnect', () => {
    console.log(`Biri arenadan ayrıldı: ${socket.id}`);
    delete players[socket.id];
    // Koptuğunu herkese haber ver
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Brawly sunucusu ${PORT} portunda başarıyla başlatıldı! 🚀`);
});
