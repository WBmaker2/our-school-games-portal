// Our School Games Portal - Pirate Coin Heist WebRTC P2P Network Manager (Zero-Cost PeerJS)
// 4-Digit Numeric Room Code (e.g. '1234', '7788') to 'school-pirate-XXXX' Peer ID
// Zero external backend server dependencies - 100% Client-Side WebRTC Peer Connection

import { Peer } from 'peerjs';

export const PIRATE_PEER_PREFIX = 'school-pirate-';

// Robust Multi-tier ICE Servers: High-availability STUN + Port 80/443 TURN Relays
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: 'e8dd65b92f3b1e1ae3a37c20',
    credential: 'gVNgSOl87pwvCYLu'
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: 'e8dd65b92f3b1e1ae3a37c20',
    credential: 'gVNgSOl87pwvCYLu'
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: 'e8dd65b92f3b1e1ae3a37c20',
    credential: 'gVNgSOl87pwvCYLu'
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: 'e8dd65b92f3b1e1ae3a37c20',
    credential: 'gVNgSOl87pwvCYLu'
  },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

const CONNECTION_TIMEOUT_MS = 18000;
const HANDSHAKE_INTERVAL_MS = 400;
const MAX_HANDSHAKE_ATTEMPTS = 10;

export class PirateCoinNetworkManager {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.roomCode = '';
    this.myPeerId = '';
    this.myName = '';
    this.myShipClass = 'caravel';
    this.myTeamId = 0; // 0: Red (Host), 1: Blue, 2: Green, 3: Yellow
    this.connectionMode = 'p2p';

    // Host: peerId -> conn
    this.connections = new Map();
    // Guest: conn to host
    this.hostConnection = null;

    this.lobbyPlayers = []; // [{ id, name, shipClass, teamId, isHost, isReady }]

    // Event Callbacks
    this.onLobbyUpdate = null;
    this.onGameStart = null;
    this.onSnapshot = null;
    this.onClientInput = null;
    this.onEventPacket = null;
    this.onGameOver = null;
    this.onError = null;
    this.onDisconnect = null;
    this.onConnectionStatus = null;
    this.onRoomCodeChanged = null;

    this._handshakeInterval = null;
    this._keepAliveTimer = null;
  }

  static generateRandomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  static cleanCode(code) {
    const digits = String(code || '').replace(/[^0-9]/g, '');
    if (!digits) return '0000';
    return digits.padStart(4, '0').slice(0, 4);
  }

  emitStatus(msg) {
    if (this.onConnectionStatus) this.onConnectionStatus(msg);
  }

  _clearHandshakeTimer() {
    if (this._handshakeInterval) {
      clearInterval(this._handshakeInterval);
      this._handshakeInterval = null;
    }
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this._keepAliveTimer = setInterval(() => {
      if (this.peer && !this.peer.destroyed) {
        if (this.peer.disconnected) {
          try {
            this.peer.reconnect();
          } catch (e) {}
        } else if (
          this.peer.socket &&
          this.peer.socket._ws &&
          this.peer.socket._ws.readyState === 1
        ) {
          try {
            this.peer.socket._ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
          } catch (e) {}
        }
      }
    }, 12000);
  }

  _stopKeepAlive() {
    if (this._keepAliveTimer) {
      clearInterval(this._keepAliveTimer);
      this._keepAliveTimer = null;
    }
  }

  // --- HOST: Create Room via PeerJS ---
  async createHostRoom(numericCode, hostName, shipClass = 'caravel') {
    this.destroy();
    this.isHost = true;
    this.myName = (hostName || '방장 선장').trim();
    this.myShipClass = shipClass;
    this.myTeamId = 0;
    this.connectionMode = 'p2p';

    let cleanCode = PirateCoinNetworkManager.cleanCode(numericCode);
    if (!cleanCode || cleanCode.length !== 4) {
      cleanCode = PirateCoinNetworkManager.generateRandomCode();
    }

    return new Promise((resolve, reject) => {
      let timeoutId = null;
      let attempts = 0;

      const tryCreate = (codeToTry) => {
        attempts++;
        if (attempts > 5) {
          reject(new Error('방 생성에 반복 실패했습니다. 네트워크 상태를 확인해 주세요.'));
          return;
        }

        const fullPeerId = `${PIRATE_PEER_PREFIX}${codeToTry}`;
        this.emitStatus(`P2P 네트워크 방 등록 중... (코드: ${codeToTry})`);

        this.peer = new Peer(fullPeerId, {
          config: {
            iceServers: ICE_SERVERS,
            iceCandidatePoolSize: 2
          },
          debug: 0
        });

        timeoutId = setTimeout(() => {
          if (this.peer && !this.peer.open) {
            this.peer.destroy();
            reject(new Error('P2P 시그널링 서버 연결 시간이 초과되었습니다.'));
          }
        }, CONNECTION_TIMEOUT_MS);

        this.peer.on('open', (id) => {
          clearTimeout(timeoutId);
          this.roomCode = codeToTry;
          this.myPeerId = id;
          this._startKeepAlive();

          this.lobbyPlayers = [
            {
              id: this.myPeerId,
              name: this.myName,
              shipClass: this.myShipClass,
              teamId: 0,
              isHost: true,
              isReady: true,
              isRelay: false
            }
          ];

          this._notifyLobby();
          this.emitStatus(`방 [${codeToTry}] 생성 완료! 친구 접속 대기 중...`);
          resolve(codeToTry);
        });

        this.peer.on('connection', (conn) => {
          this._handleHostIncomingConnection(conn);
        });

        this.peer.on('error', (err) => {
          clearTimeout(timeoutId);
          if (err.type === 'unavailable-id') {
            const nextCode = PirateCoinNetworkManager.generateRandomCode();
            this.emitStatus(`방 코드 [${codeToTry}]가 사용 중입니다. [${nextCode}]로 재생성 중...`);
            if (this.onRoomCodeChanged) this.onRoomCodeChanged(nextCode);
            tryCreate(nextCode);
          } else {
            const errorMsg = `P2P 네트워크 오류: ${err.type || '알 수 없음'}`;
            this.emitStatus(`❌ ${errorMsg}`);
            if (this.onError) this.onError(errorMsg);
            reject(err);
          }
        });

        this.peer.on('disconnected', () => {
          if (this.peer && !this.peer.destroyed) {
            try {
              this.peer.reconnect();
            } catch (e) {}
          }
        });
      };

      tryCreate(cleanCode);
    });
  }

  _handleHostIncomingConnection(conn) {
    if (this.connections.size >= 3) {
      conn.on('open', () => {
        conn.send({ type: 'JOIN_ACK', accepted: false, message: '방이 가득 찼습니다. (최대 4명)' });
        setTimeout(() => conn.close(), 500);
      });
      return;
    }

    conn.on('data', (data) => {
      this._handleHostReceiveData(conn.peer, data, conn);
    });

    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
      this.emitStatus(`친구 P2P 연결 수립 완료! 핸드셰이크 대기 중...`);
    });

    conn.on('close', () => {
      this._handlePeerLeave(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('Peer connection error:', conn.peer, err);
      this._handlePeerLeave(conn.peer);
    });
  }

  _handleHostReceiveData(peerId, data, conn) {
    if (!data || !data.type) return;

    if (data.type === 'JOIN_LOBBY' || data.type === 'JOIN') {
      const existing = this.lobbyPlayers.find((p) => p.id === peerId);
      if (existing) {
        if (conn && conn.open) {
          conn.send({
            type: 'JOIN_ACK',
            accepted: true,
            players: this.lobbyPlayers,
            assignedTeam: existing.teamId
          });
        }
        return;
      }

      if (this.lobbyPlayers.length >= 4) {
        if (conn && conn.open) {
          conn.send({ type: 'JOIN_ACK', accepted: false, message: '방이 가득 찼습니다. (최대 4명)' });
        }
        return;
      }

      // Assign team slot 1, 2, or 3
      const usedTeams = new Set(this.lobbyPlayers.map((p) => p.teamId));
      let assignedTeam = 1;
      for (let t = 1; t < 4; t++) {
        if (!usedTeams.has(t)) {
          assignedTeam = t;
          break;
        }
      }

      const newPlayer = {
        id: peerId,
        name: (data.name || `해적-${this.lobbyPlayers.length + 1}`).trim(),
        shipClass: data.shipClass || 'cutter',
        teamId: assignedTeam,
        isHost: false,
        isReady: true,
        isRelay: false
      };

      this.lobbyPlayers.push(newPlayer);

      if (conn && conn.open) {
        conn.send({
          type: 'JOIN_ACK',
          accepted: true,
          players: this.lobbyPlayers,
          assignedTeam: newPlayer.teamId
        });
      }

      this.emitStatus(`🎉 ${newPlayer.name}님이 합류했습니다!`);
      this.broadcastLobbyState();
    } else if (data.type === 'INPUT') {
      if (this.onClientInput) {
        this.onClientInput(peerId, data.inputs);
      }
    } else if (data.type === 'EVENT') {
      if (this.onEventPacket) {
        this.onEventPacket(peerId, data);
      }
    }
  }

  _handlePeerLeave(peerId) {
    const leaving = this.lobbyPlayers.find((p) => p.id === peerId);
    this.connections.delete(peerId);
    this.lobbyPlayers = this.lobbyPlayers.filter((p) => p.id !== peerId);

    if (leaving) {
      this.emitStatus(`👋 ${leaving.name}님이 방을 나갔습니다.`);
      this.broadcastLobbyState();
    }
  }

  // --- GUEST: Join Room via PeerJS ---
  async joinGuestRoom(numericCode, guestName, shipClass = 'caravel') {
    this.destroy();
    this.isHost = false;
    this.myName = (guestName || '우리 학교 학생').trim();
    this.myShipClass = shipClass;
    this.connectionMode = 'p2p';

    const cleanCode = PirateCoinNetworkManager.cleanCode(numericCode);
    this.roomCode = cleanCode;
    const targetHostPeerId = `${PIRATE_PEER_PREFIX}${cleanCode}`;

    return new Promise((resolve, reject) => {
      this.emitStatus(`P2P 네트워크 연결 중... (방 코드: ${cleanCode})`);

      this.peer = new Peer({
        config: {
          iceServers: ICE_SERVERS,
          iceCandidatePoolSize: 2
        },
        debug: 0
      });

      const overallTimeout = setTimeout(() => {
        this._clearHandshakeTimer();
        if (this.peer) this.peer.destroy();
        const err = new Error(`방 [${cleanCode}] 연결 시간이 초과되었습니다. 방 번호를 확인해 주세요.`);
        this.emitStatus(`❌ ${err.message}`);
        if (this.onError) this.onError(err);
        reject(err);
      }, CONNECTION_TIMEOUT_MS);

      this.peer.on('open', (myId) => {
        this.myPeerId = myId;
        this.emitStatus(`방 [${cleanCode}] 호스트 검색 및 터널 연결 중...`);

        const conn = this.peer.connect(targetHostPeerId, {
          reliable: true
        });

        this.hostConnection = conn;

        conn.on('open', () => {
          this.emitStatus(`P2P 터널 수립 완료! 방 입장 확인 중...`);

          let handshakeCount = 0;
          this._handshakeInterval = setInterval(() => {
            if (!conn.open) return;
            handshakeCount++;

            conn.send({
              type: 'JOIN_LOBBY',
              name: this.myName,
              shipClass: this.myShipClass
            });

            if (handshakeCount >= MAX_HANDSHAKE_ATTEMPTS) {
              this._clearHandshakeTimer();
            }
          }, HANDSHAKE_INTERVAL_MS);
        });

        conn.on('data', (data) => {
          if (!data || !data.type) return;

          if (data.type === 'JOIN_ACK') {
            this._clearHandshakeTimer();
            clearTimeout(overallTimeout);

            if (data.accepted) {
              this.myTeamId = data.assignedTeam || 1;
              this.lobbyPlayers = data.players || [];
              this._notifyLobby();
              this.emitStatus(`🎉 방에 성공적으로 입장했습니다! (팀: ${this.myTeamId})`);
              resolve(cleanCode);
            } else {
              const msg = data.message || '입장이 거절되었습니다.';
              this.emitStatus(`❌ ${msg}`);
              if (this.onError) this.onError(msg);
              reject(new Error(msg));
            }
          } else if (data.type === 'LOBBY_UPDATE') {
            this.lobbyPlayers = data.players || [];
            this._notifyLobby();
          } else if (data.type === 'GAME_START') {
            if (this.onGameStart) this.onGameStart(data.config);
          } else if (data.type === 'SNAPSHOT') {
            if (this.onSnapshot) this.onSnapshot(data.snapshot);
          } else if (data.type === 'GAME_OVER') {
            if (this.onGameOver) this.onGameOver(data.results);
          }
        });

        conn.on('close', () => {
          this._clearHandshakeTimer();
          clearTimeout(overallTimeout);
          this.emitStatus('방장과의 P2P 연결이 종료되었습니다.');
          if (this.onDisconnect) this.onDisconnect();
        });

        conn.on('error', (err) => {
          this._clearHandshakeTimer();
          clearTimeout(overallTimeout);
          console.error('Guest connection error:', err);
          const msg = `방 [${cleanCode}] 연결에 실패했습니다.`;
          this.emitStatus(`❌ ${msg}`);
          if (this.onError) this.onError(msg);
          reject(new Error(msg));
        });
      });

      this.peer.on('error', (err) => {
        this._clearHandshakeTimer();
        clearTimeout(overallTimeout);
        if (err.type === 'peer-unavailable') {
          const msg = `방 [${cleanCode}]을 찾을 수 없습니다. 방장이 방을 열었는지 확인해 주세요.`;
          this.emitStatus(`❌ ${msg}`);
          if (this.onError) this.onError(msg);
          reject(new Error(msg));
        } else {
          const msg = `P2P 네트워크 오류: ${err.type || '알 수 없음'}`;
          this.emitStatus(`❌ ${msg}`);
          if (this.onError) this.onError(msg);
          reject(err);
        }
      });
    });
  }

  // --- Broadcasts (Host -> All Guests) ---
  broadcastLobbyState() {
    this._notifyLobby();
    const packet = { type: 'LOBBY_UPDATE', players: this.lobbyPlayers };
    this._broadcast(packet);
  }

  broadcastGameStart(config) {
    const packet = { type: 'GAME_START', config };
    this._broadcast(packet);
  }

  broadcastSnapshot(snapshot) {
    const packet = { type: 'SNAPSHOT', snapshot };
    this._broadcast(packet);
  }

  broadcastGameOver(results) {
    const packet = { type: 'GAME_OVER', results };
    this._broadcast(packet);
  }

  _broadcast(packet) {
    this.connections.forEach((conn) => {
      if (conn && conn.open) {
        try {
          conn.send(packet);
        } catch (e) {}
      }
    });
  }

  // --- Client -> Host ---
  sendClientInputs(inputs) {
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send({ type: 'INPUT', inputs });
      } catch (e) {}
    }
  }

  _notifyLobby() {
    if (this.onLobbyUpdate) this.onLobbyUpdate(this.lobbyPlayers);
  }

  destroy() {
    this._clearHandshakeTimer();
    this._stopKeepAlive();

    this.connections.forEach((conn) => {
      try {
        conn.close();
      } catch (e) {}
    });
    this.connections.clear();

    if (this.hostConnection) {
      try {
        this.hostConnection.close();
      } catch (e) {}
      this.hostConnection = null;
    }

    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {}
      this.peer = null;
    }

    this.isHost = false;
    this.roomCode = '';
    this.myPeerId = '';
    this.lobbyPlayers = [];
  }
}

export const pirateNet = new PirateCoinNetworkManager();
