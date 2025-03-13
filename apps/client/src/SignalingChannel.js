import { EventEmitter, isJson } from '@vfx/shared'

export class SignalingChannel extends EventEmitter {
  constructor(servers, peerManager) {
    super();
    // Aceita um único servidor como string ou uma lista de servidores
    this.servers = Array.isArray(servers) ? servers : [servers];
    this.currentServerIndex = 0;
    this.peerManager = peerManager;
    this.myId = null;
    this.connectionState = 'disconnected';
    this.pendingCandidates = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 0;
    this.reconnectDelay = 1000; // Delay inicial em ms
    this.socket = null;
    this.hasTriedAllServers = false;
    
    // Iniciar a conexão com o primeiro servidor
    this.connect();
  }

  connect() {
    // Se já tiver uma conexão ativa, feche-a primeiro
    if (this.socket) {
      this.socket.onclose = null; // Removemos o handler para evitar reconexão automática neste ponto
      this.socket.close();
    }

    const serverUrl = this.servers[this.currentServerIndex];
    console.log(`Tentando conectar ao servidor de sinalização: ${serverUrl} (${this.currentServerIndex + 1}/${this.servers.length})`);
    
    this.socket = new WebSocket(serverUrl);
    this.socket.onmessage = this.handleMessage.bind(this);
    
    this.socket.onopen = () => {
      this.connectionState = 'connected';
      console.log(`Conexão websocket aberta com o servidor ${serverUrl}`);
      this.reconnectAttempts = 0; // Resetamos as tentativas após conexão bem-sucedida
      this.hasTriedAllServers = false; // Resetamos o flag de tentativa com todos os servidores
      this.emit('open');
    };
    
    this.socket.onclose = () => {
      this.connectionState = 'disconnected';
      console.log(`Conexão websocket fechada com o servidor ${serverUrl}`);
      this.emit('close');
      this.scheduleReconnect();
    };
    
    this.socket.onerror = (error) => {
      console.error(`Erro na conexão websocket com ${serverUrl}:`, error);
      this.emit('error', error);
      // Não tentamos reconectar aqui, deixamos o onclose lidar com isso
    };
  }

  scheduleReconnect() {
    // Incrementamos a tentativa de reconexão
    this.reconnectAttempts++;
    
    // Se excedemos o número máximo de tentativas no servidor atual, tentamos o próximo
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      this.reconnectAttempts = 0;
      this.currentServerIndex = (this.currentServerIndex + 1) % this.servers.length;
      
      // Verificamos se voltamos ao início da lista
      if (this.currentServerIndex === 0) {
        this.hasTriedAllServers = true;
        console.log("Todos os servidores foram tentados, reiniciando do primeiro servidor");
      }
      
      console.log(`Alterando para o próximo servidor: ${this.servers[this.currentServerIndex]}`);
    }
    
    // Calculamos o delay com backoff exponencial limitado
    // Se já tentamos todos os servidores, usamos um delay maior
    let delay;
    if (this.hasTriedAllServers) {
      // Delay maior após tentar todos os servidores (entre 10s e 60s)
      delay = Math.min(60000, 10000 * Math.pow(1.5, this.reconnectAttempts - 1));
    } else {
      // Delay normal durante a primeira rodada de tentativas (entre 1s e 30s)
      delay = Math.min(30000, this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1));
    }
    
    console.log(`Tentando reconectar em ${delay/1000}s (tentativa ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.connectionState !== 'connected') {
        this.connect();
      }
    }, delay);
  }

  async handleMessage(event) {
    const data = isJson(event.data) ? JSON.parse(event.data) : event.data;
    console.log('Mensagem recebida do servidor:', data);

    if (data.type === 'connected') {
      this.myId = data.id;
      console.log('ID recebido do servidor:', this.myId);

      // Se existir uma conexão disponível, inicia o processo de conexão
      if (data.avaliableConnection) {
        console.log("Iniciando conexão com peer disponível:", data.avaliableConnection);
        await this.initiateConnection(data.avaliableConnection);
      }
    } else if (data.type === "offer") {
      await this.handleOffer(data);
    } else if (data.type === "answer") {
      await this.handleAnswer(data);
    } else if (data.type === "candidate") {
      await this.handleCandidate(data);
    } else if (data.type === "pong") {
      console.log("Pong recebido do servidor, latência:", Date.now() - data.timestamp);
    }

    this.emit('message', data);
  }

  async initiateConnection(targetId) {
    try {
      const peer = this.peerManager.createPeer(targetId, true);
      const offer = await peer.createOffer();
      await this.send({
        type: 'connect',
        to: targetId,
        offer: offer
      });
      console.log(`Offer enviada para peer ${targetId}`);
    } catch (error) {
      console.error("Erro ao iniciar conexão:", error);
    }
  }

  async handleOffer(data) {
    try {
      const peer = this.peerManager.createPeer(data.from, false);
      await peer.setRemoteDescription(data.offer);
      const answer = await peer.createAnswer();
      await this.send({
        type: 'answer',
        to: data.from,
        answer: answer
      });
      console.log(`Answer enviada para peer ${data.from}`);

      // Processa candidatos pendentes, se houver
      if (this.pendingCandidates[data.from]) {
        for (const candidate of this.pendingCandidates[data.from]) {
          await peer.addIceCandidate(candidate);
          console.log(`Candidato pendente adicionado para peer ${data.from}`);
        }
        delete this.pendingCandidates[data.from];
      }
    } catch (error) {
      console.error("Erro ao processar offer:", error);
    }
  }

  async handleAnswer(data) {
    try {
      const peer = this.peerManager.getPeer(data.from);
      if (peer) {
        await peer.setRemoteDescription(data.answer);
        console.log(`Answer processada para peer ${data.from}`);
      } else {
        console.error("Peer não encontrado para answer:", data.from);
      }
    } catch (error) {
      console.error("Erro ao processar answer:", error);
    }
  }

  async handleCandidate(data) {
    try {
      const peer = this.peerManager.getPeer(data.from);
      if (peer) {
        await peer.addIceCandidate(data.candidate);
        console.log(`Candidato adicionado para peer ${data.from}`);
      } else {
        // Armazena candidatos pendentes para processamento posterior
        if (!this.pendingCandidates[data.from]) {
          this.pendingCandidates[data.from] = [];
        }
        this.pendingCandidates[data.from].push(data.candidate);
        console.log(`Candidato armazenado para peer ${data.from} (pendente)`);
      }
    } catch (error) {
      console.error("Erro ao processar candidate:", error);
    }
  }

  async send(data) {
    if (this.connectionState !== 'connected') {
      console.warn('Tentativa de envio com conexão fechada, colocando na fila');
      return new Promise((resolve, reject) => {
        const checkAndSend = setInterval(() => {
          if (this.connectionState === 'connected') {
            clearInterval(checkAndSend);
            this.doSend(data)
              .then(resolve)
              .catch(reject);
          }
        }, 100);

        // Timeout após 5 segundos
        setTimeout(() => {
          clearInterval(checkAndSend);
          reject(new Error('Timeout ao tentar enviar mensagem'));
        }, 5000);
      });
    }

    return this.doSend(data);
  }

  async doSend(data) {
    try {
      if (data instanceof Object) {
        data = JSON.stringify(data);
      }
      this.socket.send(data);
      return true;
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      throw error;
    }
  }

  close() {
    if (this.socket) {
      // Desativamos a reconexão automática antes de fechar
      this.socket.onclose = null;
      this.socket.close();
      this.connectionState = 'disconnected';
    }
  }
}