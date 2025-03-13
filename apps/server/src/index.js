import express from 'express'
import { WebSocketServer } from 'ws'
import http from 'http'

import { uuidV4, isJson, getRandomInt } from '@vfx/shared'

const port = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Servir arquivos estáticos
app.use(express.static('public'));

// Armazena todas as conexões de sockets
const sockets = {};
let serverTick = 0;

// Função para obter um peer disponível para conexão
const getAvailableConnection = (ws) => {
  const connectedPeers = Object.keys(sockets);

  // Se não há outros peers conectados, retorna null
  if (connectedPeers.length <= 1) {
    return null;
  }

  // Seleciona um peer aleatório diferente do atual
  let availablePeer;
  do {
    availablePeer = connectedPeers[getRandomInt(0, connectedPeers.length)];
  } while (availablePeer === ws.id);

  return availablePeer;
};

// Função para enviar para todos os peers conectados, exceto o remetente
const broadcastToOthers = (message, senderId) => {
  const data = typeof message === 'object' ? JSON.stringify(message) : message;
  Object.keys(sockets).forEach(id => {
    if (id !== senderId && sockets[id]) {
      try {
        sockets[id].send(data);
      } catch (error) {
        console.error(`Erro ao enviar para ${id}:`, error);
      }
    }
  });
};

// Função para lidar com uma nova conexão
function Connection(ws) {
  ws.id = uuidV4();
  sockets[ws.id] = ws;

  // Envia informações iniciais para o cliente
  ws.send(JSON.stringify({
    type: 'connected',
    id: ws.id,
    avaliableConnection: getAvailableConnection(ws),
    connectedPeers: Object.keys(sockets).length
  }));

  // Configura handler para mensagens
  ws.on("message", async (message) => {
    try {
      const data = isJson(message) ? JSON.parse(message) : message;
      console.log(`Mensagem recebida de ${ws.id}:`, data.type);

      // Processa diferentes tipos de mensagens
      if (data.type === 'connect') {
        const targetSocket = sockets[data.to];
        if (targetSocket) {
          targetSocket.send(JSON.stringify({
            type: 'offer',
            offer: data.offer,
            from: ws.id,
            to: data.to
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: `Peer ${data.to} não encontrado`
          }));
        }
      } else if (data.type === 'answer') {
        const targetSocket = sockets[data.to];
        if (targetSocket) {
          targetSocket.send(JSON.stringify({
            type: 'answer',
            answer: data.answer,
            from: ws.id,
            to: data.to
          }));
        }
      } else if (data.type === 'candidate') {
        const targetSocket = sockets[data.to];
        if (targetSocket) {
          targetSocket.send(JSON.stringify({
            type: 'candidate',
            candidate: data.candidate,
            from: ws.id,
            to: data.to
          }));
        }
      } else if (data.type === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: data.timestamp,
          serverTick
        }));
      } else if (data.type === 'broadcast') {
        // Envia mensagem para todos os outros peers
        broadcastToOthers({
          type: 'broadcast',
          from: ws.id,
          message: data.message
        }, ws.id);
      }
    } catch (error) {
      console.error(`Erro ao processar mensagem de ${ws.id}:`, error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Erro ao processar mensagem'
      }));
    }
  });

  // Configura handler para desconexão
  ws.on("close", () => {
    console.log(`Cliente desconectado: ${ws.id}`);
    delete sockets[ws.id];

    // Notifica outros peers sobre a desconexão
    broadcastToOthers({
      type: 'peer-disconnected',
      peerId: ws.id
    }, ws.id);
  });

  // Configura handler para erros
  ws.on("error", (error) => {
    console.error(`Erro na conexão ${ws.id}:`, error);
    delete sockets[ws.id];
  });

  return ws;
}

// Configura o servidor WebSocket
wss.on("connection", (ws) => {
  const socket = new Connection(ws);
  console.log(`Novo cliente conectado: ${socket.id}`);
  console.log(`Total de clientes conectados: ${Object.keys(sockets).length}`);
});

// Inicia o servidor
server.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
