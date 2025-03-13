import { EventEmitter, isJson, getRandomInt } from '@vfx/shared'

export class DataChannel extends EventEmitter {
  constructor(dataChannel, pc) {
    super()
    this.dataChannel = dataChannel
    this.pc = pc

    this.handleEvents()
  }

  send(message) {
    try {
      console.log(`Send message "${this.dataChannel.label}"`, message);
      if (message instanceof Object) {
        message = JSON.stringify(message);
      }
      this.dataChannel.send(message)
      this.emit('send', message)
    } catch (error) {
      console.log(`Error to send message "${this.dataChannel.label}"`, error);
    }
  }

  handleEvents() {
    this.dataChannel.onopen = (event) => {
      console.log(`Data channel "${this.dataChannel.label}" aberto para conexão`);
      this.dataChannel.send("Olá!");
      this.emit('open', event)
    };
    this.dataChannel.onmessage = (event) => {
      const data = isJson(event.data) ? JSON.parse(event.data) : event.data;
      console.log(`Mensagem recebida do canal "${this.dataChannel.label}" para conexão:`, data);
      this.emit('message', data)
    };
    this.dataChannel.onclose = (event) => {
      console.log(`Fechado conexão canal "${this.dataChannel.label}"`);
      this.emit('close', event)
    };
  }
}

export class PeerConnection extends EventEmitter {
  constructor(peerId, isOfferer, signaling, config) {
    super()
    this.id = peerId;
    this.signaling = signaling;
    this.pc = new RTCPeerConnection(config);
    this.pc.id = peerId;
    this.dataChannels = {};
    this.isProxy = false;
    this.proxyTarget = null;

    // Configura os eventos comuns
    this.pc.onicecandidate = this.handleIceCandidate.bind(this);
    this.pc.oniceconnectionstatechange = this.handleIceConnectionStateChange.bind(this);
    this.pc.onconnectionstatechange = this.handleConnectionStateChange.bind(this);

    // Cria canais de dados conforme o papel (offerer/answerer)
    if (isOfferer) {
      this.setupOfferer();
    } else {
      this.pc.ondatachannel = this.handleDataChannel.bind(this);
    }
  }

  send(label, message) {
    if (this.dataChannels[label]) {
      this.dataChannels[label].send(message);
    } else {
      console.error(`Canal de dados "${label}" não encontrado`);
    }
  }

  // Frist channels to send with offerer
  setupOfferer() {
    // Canal de chat
    this.createDataChannel("chat");

    // Canal main
    this.createDataChannel("main");
  }

  createDataChannel(label) {
    const dataChannel = this.pc.createDataChannel(label);
    this.dataChannels[label] = new DataChannel(dataChannel, this.pc);
    return this.dataChannels[label];
  }

  handleDataChannel(event) {
    const dataChannel = event.channel;
    if (!this.dataChannels[dataChannel.label]) {
      this.dataChannels[dataChannel.label] = new DataChannel(dataChannel, this.pc);
    }
  }

  handleIceCandidate(event) {
    if (event.candidate) {
      if (this.isProxy && this.proxyTarget) {
        // Se este peer é um proxy, encaminha o candidato para o destino
        this.signaling.peerManager.sendProxyCandidate(this.proxyTarget, event.candidate);
      } else {
        // Envio normal via signaling
        this.signaling.send({
          type: 'candidate',
          candidate: event.candidate,
          to: this.id
        });
      }
    }
  }

  handleIceConnectionStateChange(event) {
    console.log(`Ice connection state change: ${this.pc.iceConnectionState}`, event);
    if (['disconnected', 'failed', 'closed'].includes(this.pc.iceConnectionState)) {
      this.cleanup();
    }
  }

  handleConnectionStateChange(event) {
    console.log(`Connection state change: ${this.pc.connectionState}`, event);
    if (['disconnected', 'failed', 'closed'].includes(this.pc.connectionState)) {
      this.cleanup();
    } else if (this.pc.connectionState === 'connected') {
      this.emit('connected', event)
      this.signaling.peerManager.emit('new-connection', this)
    }
  }

  cleanup() {
    if (this.cleanedUp) return;
    this.signaling.peerManager.removePeer(this.id);
    this.cleanedUp = true;
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async createAnswer() {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async setRemoteDescription(description) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(description));
  }

  async addIceCandidate(candidate) {
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

export class PeerManager extends EventEmitter {
  constructor(config) {
    super()
    this.peers = {};
    this.config = config;
    this.proxyConnections = new Map(); // Armazena relações de proxy {proxyId: {source: peerId, target: peerId}}

    this.on('new-connection', (peer) => {
      peer.send('chat', 'Olá do answerer!');
      peer.dataChannels.main.on('message', async (data) => {
        console.log('Mensagem recebida no canal main:', { data, from: peer.id });

        if (data.type === 'proxy-request') { // Peer proxy solicita nova conexão
          await this.handleConnectionRequest(peer, data);
        } else if (data.type === 'proxy-create') { // Recebe solicitação de conexão
          await this.handleCreateConnection(peer, data);
        } else if (data.type === 'proxy-offer') { // Proxy de offer
          await this.handleOfferConnection(peer, data);
        } else if (data.type === 'offer') { // Recebe offer
          await this.handleOffer(peer, data);
        } else if (data.type === 'proxy-answer') { // Proxy de answer
          await this.handleAnswerConnection(peer, data);
        } else if (data.type === 'answer') { // Recebe answer
          await this.handleAnswer(peer, data);
        } else if (data.type === 'proxy-candidate') { // Proxy de candidate
          await this.handleProxyCandidate(peer, data);
        } if (data.type === 'candidate') { // Recebe candidate
          await this.handleCandidate(peer, data);
        }
      });
    });
  }

  async handleConnectionRequest(peer, data) {
    // Encontra um peer não conectado para estabelecer conexão
    const notConnectedPeerKey = Object.keys(this.peers).find((peerKey) => {
      const notConnected = !data.connectedPeers.includes(peerKey);
      const isNotRequester = peerKey !== peer.id;
      return notConnected && isNotRequester;
    });

    console.log('Peer não conectado encontrado: ', notConnectedPeerKey);

    if (notConnectedPeerKey) {
      // Registra a relação de proxy
      this.registerProxyConnection(peer.id, peer.id, notConnectedPeerKey);

      // Solicita ao peer não conectado para criar uma conexão
      this.peers[notConnectedPeerKey].send('main', {
        type: 'proxy-create',
        requester: peer.id
      });
    } else {
      console.log('Nenhum peer não conectado disponível');
      // Informa ao peer solicitante que não há peers disponíveis
      peer.send('main', {
        type: 'no-peers-available'
      });
    }
  }

  async handleCreateConnection(peer, data) {
    // Cria um novo peer para se conectar ao solicitante
    const p = this.createPeer(data.requester, true);
    p.isProxy = true;
    p.proxyTarget = data.requester;

    // Registra a relação de proxy
    this.registerProxyConnection(peer.id, peer.id, data.requester);

    // Cria uma oferta e envia de volta ao proxy
    const offer = await p.createOffer();
    peer.send('main', {
      type: 'proxy-offer',
      to: data.requester,
      offer: offer
    });
  }

  async handleOfferConnection(peer, data) {
    // Repassa a oferta para o peer de destino
    this.peers[data.to].send('main', {
      type: 'offer',
      from: peer.id,
      offer: data.offer
    });
  }

  async handleOffer(peer, data) {
    // Cria um novo peer para responder à oferta
    const p = this.createPeer(data.from, false);
    p.isProxy = true;
    p.proxyTarget = data.from;

    // Registra a relação de proxy
    this.registerProxyConnection(peer.id, data.from, peer.id);

    // Configura a descrição remota e cria uma resposta
    await p.setRemoteDescription(data.offer);
    const answer = await p.createAnswer();

    // Envia a resposta de volta ao proxy
    peer.send('main', {
      type: 'proxy-answer',
      to: data.from,
      answer: answer
    });
  }

  async handleAnswerConnection(peer, data) {
    // Repassa a resposta para o peer de destino
    this.peers[data.to].send('main', {
      type: 'answer',
      from: peer.id,
      answer: data.answer
    });
  }

  async handleAnswer(peer, data) {
    // Configura a descrição remota no peer
    const p = this.getPeer(data.from);
    if (p) {
      await p.setRemoteDescription(data.answer);
    } else {
      console.error("Peer não encontrado:", data.from);
    }
  }

  async handleProxyCandidate(peer, data) {
    // Repassa a resposta para o peer de destino
    this.peers[data.to].send('main', {
      type: 'candidate',
      from: peer.id,
      candidate: data.candidate
    });
  }

  async handleCandidate(peer, data) {
    // Repassa o candidato ICE para o peer de destino
    const targetPeer = this.getPeer(data.from);
    if (targetPeer) {
      await targetPeer.addIceCandidate(data.candidate);
    } else {
      console.error("Peer de destino não encontrado:", data.from);
    }
  }

  // Registra uma relação de proxy
  registerProxyConnection(proxyId, sourceId, targetId) {
    if (!this.proxyConnections.has(proxyId)) {
      this.proxyConnections.set(proxyId, {});
    }

    const proxyInfo = this.proxyConnections.get(proxyId);
    proxyInfo[sourceId] = targetId;
    proxyInfo[targetId] = sourceId;

    console.log(`Proxy registrado: ${proxyId} conectando ${sourceId} com ${targetId}`);
  }

  // Envia um candidato ICE através do proxy
  sendProxyCandidate(to, candidate) {
    // Encontra o proxy correto para esta conexão
    console.log('this.proxyConnections.entries(): ', this.proxyConnections.entries());
    for (const [proxyId] of this.proxyConnections.entries()) {
      const proxyPeer = this.peers[proxyId];
      console.log('proxyPeer: ', proxyPeer);
      if (proxyPeer && proxyPeer.dataChannels.main) {
        console.log(`Enviando candidato ICE via proxy ${proxyId} de para ${to}`);
        proxyPeer.send('main', {
          type: 'proxy-candidate',
          to: to,
          candidate: candidate
        });
        return true;
      }
    }

    console.error(`Não foi possível encontrar um proxy para enviar candidato de para ${to}`);
    return false;
  }

  handleManager() {
    setInterval(() => {
      // Verifica se é necessário solicitar novas conexões
      const connectedPeers = Object.keys(this.peers);
      if (connectedPeers.length > 0 && connectedPeers.length < this.config.maxConnections) {
        // Solicita conexão através de um peer aleatório já conectado
        const randomIndex = getRandomInt(0, connectedPeers.length - 1);
        const randomPeer = this.peers[connectedPeers[randomIndex]];

        if (randomPeer && randomPeer.dataChannels && randomPeer.dataChannels.main) {
          console.log(`Solicitando novas conexões através do peer ${randomPeer.id}`);
          randomPeer.send('main', {
            type: 'proxy-request',
            connectedPeers: connectedPeers
          });
        }
      }
    }, 10000);
  }

  setSignaling(signaling) {
    this.signaling = signaling;
    this.handleManager();
  }

  createPeer(peerId, isOfferer = false) {
    const peer = new PeerConnection(peerId, isOfferer, this.signaling, { iceServers: this.config.iceServers });
    this.peers[peerId] = peer;
    return peer;
  }

  removePeer(peerId) {
    // Remove o peer e todas as suas conexões de proxy
    this.proxyConnections.delete(peerId);
    delete this.peers[peerId];
  }

  getPeer(peerId) {
    return this.peers[peerId];
  }
}