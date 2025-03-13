import './style.css'

import { PeerManager } from './PeerManager.js';
import { SignalingChannel } from './SignalingChannel.js';
import './ViewManager.js';

// Inicialização
const config = {
  maxConnections: 5,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};
const wsServers = [
  "ws://localhost:3000/",
  "wss://west-adjoining-cartwheel.glitch.me/",
];
const peerManager = new PeerManager(config);
const signaling = new SignalingChannel(wsServers, peerManager);
peerManager.setSignaling(signaling);

window.signaling = signaling;
window.peerManager = peerManager;
