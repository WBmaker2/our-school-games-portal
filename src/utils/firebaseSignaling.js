// Serverless P2P Architecture - Legacy Firebase Signaling Disabled
// All multi-games now operate on 100% Client-Side WebRTC Peer Connection (Zero External Backend Servers).

export class FirebaseSignaling {
  constructor(gameId = '') {
    this.gameId = gameId;
  }
  async createRoom() { throw new Error('Firebase signaling is deprecated. Pure P2P is used.'); }
  async checkRoom() { throw new Error('Firebase signaling is deprecated. Pure P2P is used.'); }
  listenForGuests() {}
  stopHeartbeat() {}
  destroy() {}
}
