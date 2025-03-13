// Estado da aplicação
const state = {
  myId: null,
  peers: {},
  selectedPeerId: null,
  contextMenuPeerId: null,
};

// Referências aos elementos DOM
const graphSvg = document.getElementById('graph-svg');
const nodesGroup = document.getElementById('nodes');
const linksGroup = document.getElementById('links');
const contextMenu = document.getElementById('context-menu');
const infoContainer = document.getElementById('info-container');
const myIdElement = document.getElementById('my-id');
const connectionCountElement = document.getElementById('connection-count');
const channelCountElement = document.getElementById('channel-count');
const peerListElement = document.getElementById('peer-list');
const selectedPeerSection = document.getElementById('selected-peer-section');
const selectedPeerId = document.getElementById('selected-peer-id');
const selectedPeerState = document.getElementById('selected-peer-state');
const selectedPeerIceState = document.getElementById('selected-peer-ice-state');
const selectedPeerChannels = document.getElementById('selected-peer-channels');
const channelSelect = document.getElementById('channel-select');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const communicationLogs = document.getElementById('communication-logs');
const connectionStatus = document.getElementById('connection-status').querySelector('span');

// Dimensões do grafo
let width, height, centerX, centerY;

// Atualiza dimensões
function updateDimensions() {
  const rect = graphSvg.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  centerX = width / 2;
  centerY = height / 2;
}

// Inicialização
function init() {
  updateDimensions();
  window.addEventListener('resize', updateDimensions);

  // Esconde o menu de contexto ao clicar em qualquer lugar
  document.addEventListener('click', () => {
    contextMenu.style.display = 'none';
  });

  // Previne o comportamento padrão do botão direito no grafo
  graphSvg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Evento para desconectar peer
  const disconnect = document.createElement('div');
  disconnect.textContent = 'Desconectar Peer';
  disconnect.classList.add("context-menu-item");
  disconnect.id = "disconnect-peer"
  contextMenu.appendChild(disconnect);
  disconnect.addEventListener('click', () => {
    if (state.contextMenuPeerId) {
      disconnectPeer(state.contextMenuPeerId);
    }
  });

  // Evento para enviar mensagem
  sendButton.addEventListener('click', () => {
    const message = messageInput.value.trim();
    const channel = channelSelect.value;

    if (message && state.selectedPeerId) {
      sendMessage(state.selectedPeerId, channel, message);
      messageInput.value = '';
    }
  });

  // Inicializa acesso à API WebRTC
  initializeWebRTC();
}

// Inicializa WebRTC
function initializeWebRTC() {
  // Aguarda a inicialização do objeto no escopo global
  setupWebRTC();
}

// Configura eventos WebRTC
function setupWebRTC() {
  const signaling = window.signaling;
  const peerManager = window.peerManager;

  // Evento quando o WebSocket é aberto
  signaling.on('open', () => {
    addLog('Conexão WebSocket estabelecida');
    updateConnectionStatus('connecting');
  });

  // Evento quando o ID é atribuído
  signaling.on('message', (data) => {
    if (data.type === 'connected') {
      state.myId = data.id;

      myIdElement.textContent = data.id;
      addLog(`ID local atribuído: ${data.id.substring(0, 8)}...`);
      updateConnectionStatus('connected');

      // Renderiza o nó central
      renderGraph();
    }
  });

  signaling.on('close', () => {
    addLog('Conexão WebSocket fechada');
    updateConnectionStatus('disconnected');
  });

  // Evento quando um novo peer é conectado
  peerManager.on('new-connection', (peer) => {
    const peerId = peer.id;
    addLog(`Nova conexão estabelecida com peer: ${peerId.substring(0, 8)}...`);

    // Adiciona eventos para cada canal de dados
    Object.entries(peer.dataChannels).forEach(([label, channel]) => {
      channel.on('message', (message) => {
        addLog(`Mensagem recebida de ${peerId.substring(0, 8)}... no canal ${label}: ${message.type}`);
      });

      channel.on('open', () => {
        addLog(`Canal ${label} aberto com peer ${peerId.substring(0, 8)}...`);
      });

      channel.on('close', () => {
        addLog(`Canal ${label} fechado com peer ${peerId.substring(0, 8)}...`);
      });
    });

    updatePeerList();
    renderGraph();
  });

  // Monitora mudanças nos peers
  setInterval(() => {
    const currentPeers = peerManager.peers;
    const peersChanged = currentPeers;

    if (peersChanged) {
      state.peers = { ...currentPeers };
      updatePeerList();
      renderGraph();
      updateSelectedPeerInfo();
    }
  }, 1000);
}

// Renderiza o grafo
function renderGraph() {
  // Limpa o grafo
  nodesGroup.innerHTML = '';
  linksGroup.innerHTML = '';

  // Adiciona o nó central (usuário local)
  const meNode = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  meNode.setAttribute('cx', centerX);
  meNode.setAttribute('cy', centerY);
  meNode.setAttribute('r', 25);
  meNode.setAttribute('class', 'node me');
  meNode.setAttribute('data-id', state.myId);
  nodesGroup.appendChild(meNode);

  // Adiciona texto do nó central
  const meText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  meText.setAttribute('x', centerX);
  meText.setAttribute('y', centerY + 5);
  meText.setAttribute('class', 'node-text');
  meText.textContent = 'Você';
  nodesGroup.appendChild(meText);

  // Calcula o ângulo e posição para cada peer
  const peers = Object.entries(state.peers);
  const angleIncrement = (2 * Math.PI) / Math.max(peers.length, 1);

  peers.forEach(([peerId, peer], index) => {
    const angle = index * angleIncrement;
    const nodeRadius = 20;
    const orbitRadius = 150;

    const x = centerX + orbitRadius * Math.cos(angle);
    const y = centerY + orbitRadius * Math.sin(angle);

    // Adiciona link
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    link.setAttribute('x1', centerX);
    link.setAttribute('y1', centerY);
    link.setAttribute('x2', x);
    link.setAttribute('y2', y);
    link.setAttribute('class', 'link');
    link.setAttribute('data-peer-id', peerId);
    linksGroup.appendChild(link);

    // Adiciona interação no link
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPeer(peerId);

      // Remove classe selecionada de todos os links
      document.querySelectorAll('.link').forEach(l => l.classList.remove('selected'));
      // Adiciona classe selecionada a este link
      link.classList.add('selected');
    });

    link.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, peerId);
    });

    // Adiciona nó do peer
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    node.setAttribute('cx', x);
    node.setAttribute('cy', y);
    node.setAttribute('r', nodeRadius);
    node.setAttribute('class', state.selectedPeerId === peerId ? 'node selected' : 'node');
    node.setAttribute('data-id', peerId);
    nodesGroup.appendChild(node);

    // Adiciona interação no nó
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPeer(peerId);

      // Remove classe selecionada de todos os nós
      document.querySelectorAll('.node:not(.me)').forEach(n => n.classList.remove('selected'));
      // Adiciona classe selecionada a este nó
      node.classList.add('selected');
    });

    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, peerId);
    });

    // Adiciona texto do nó
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y + 5);
    text.setAttribute('class', 'node-text');
    text.textContent = peerId.substring(0, 5) + '...';
    nodesGroup.appendChild(text);
  });

  // Define evento de clique no fundo para mostrar visão geral
  graphSvg.addEventListener('click', () => {
    deselectPeer();
    document.querySelectorAll('.link').forEach(l => l.classList.remove('selected'));
    document.querySelectorAll('.node:not(.me)').forEach(n => n.classList.remove('selected'));
  });
}

// Mostra o menu de contexto
function showContextMenu(x, y, peerId) {
  state.contextMenuPeerId = peerId;
  contextMenu.style.position = 'fixed';
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
}

// Seleciona um peer
function selectPeer(peerId) {
  state.selectedPeerId = peerId;
  updateSelectedPeerInfo();
}

// Deseleciona o peer
function deselectPeer() {
  state.selectedPeerId = null;
  selectedPeerSection.style.display = 'none';
}

// Atualiza a lista de peers
function updatePeerList() {
  const peers = Object.keys(state.peers);
  connectionCountElement.textContent = peers.length;

  let totalChannels = 0;
  peers.forEach(peerId => {
    const peer = state.peers[peerId];
    totalChannels += Object.keys(peer.dataChannels).length;
  });
  channelCountElement.textContent = totalChannels;

  if (peers.length === 0) {
    peerListElement.innerHTML = '<li class="peer-item">Nenhum peer conectado</li>';
    return;
  }

  peerListElement.innerHTML = '';
  peers.forEach(peerId => {
    const peer = state.peers[peerId];
    const connectionState = peer.pc.connectionState;
    const iceState = peer.pc.iceConnectionState;

    const peerItem = document.createElement('li');
    peerItem.className = 'peer-item';
    peerItem.innerHTML = `
      <div class="peer-info">
        <span class="status-badge status-${connectionState}">
          ${connectionState}
        </span>
        <strong>${peerId.substring(0, 8)}...</strong> - 
        ${Object.keys(peer.dataChannels).length} canais
      </div>
    `;

    peerItem.addEventListener('click', () => {
      selectPeer(peerId);
    });

    peerListElement.appendChild(peerItem);
  });
}

// Atualiza as informações do peer selecionado
function updateSelectedPeerInfo() {
  if (!state.selectedPeerId) {
    selectedPeerSection.style.display = 'none';
    return;
  }

  const peer = state.peers[state.selectedPeerId];
  if (!peer) {
    selectedPeerSection.style.display = 'none';
    return;
  }

  selectedPeerSection.style.display = 'block';
  selectedPeerId.textContent = state.selectedPeerId;
  selectedPeerState.textContent = peer.pc.connectionState;
  selectedPeerIceState.textContent = peer.pc.iceConnectionState;

  // Atualiza a lista de canais
  selectedPeerChannels.innerHTML = '';
  channelSelect.innerHTML = '';

  Object.entries(peer.dataChannels).forEach(([label, channel]) => {
    const state = channel.dataChannel.readyState;

    const channelItem = document.createElement('li');
    channelItem.className = 'channel-item';
    channelItem.innerHTML = `
      <div class="channel-info">
        <strong>${label}</strong>
        <span class="status-badge status-${state === 'open' ? 'connected' : 'connecting'}">
          ${state}
        </span>
      </div>
    `;

    selectedPeerChannels.appendChild(channelItem);

    // Adiciona canal ao select
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    channelSelect.appendChild(option);
  });
}

// Envia mensagem para um peer
function sendMessage(peerId, channelLabel, message) {
  const peer = state.peers[peerId];
  if (!peer || !peer.dataChannels[channelLabel]) {
    addLog(`Erro: Canal ${channelLabel} não encontrado para peer ${peerId.substring(0, 8)}...`);
    return;
  }

  try {
    peer.dataChannels[channelLabel].send(message);
    addLog(`Mensagem enviada para ${peerId.substring(0, 8)}... no canal ${channelLabel}: ${message}`);
  } catch (error) {
    addLog(`Erro ao enviar mensagem: ${error.message}`);
  }
}

// Desconecta um peer
function disconnectPeer(peerId) {
  const peer = state.peers[peerId];
  if (!peer) return;

  try {
    peer.cleanup();
    addLog(`Peer ${peerId.substring(0, 8)}... desconectado manualmente`);
  } catch (error) {
    addLog(`Erro ao desconectar peer: ${error.message}`);
  }
}

// Adiciona entrada no log
function addLog(message) {
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';

  const timestamp = new Date().toLocaleTimeString();
  logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> ${message}`;

  communicationLogs.appendChild(logEntry);
  communicationLogs.scrollTop = communicationLogs.scrollHeight;
}

// Atualiza o status da conexão
function updateConnectionStatus(status) {
  connectionStatus.className = `status-badge status-${status}`;
  connectionStatus.textContent = status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Conectando...' : 'Desconectado';
}

// Compara dois objetos para verificar se são iguais
function objectsEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

// Inicializa a aplicação
window.addEventListener('load', init);
