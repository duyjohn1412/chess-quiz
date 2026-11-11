import Peer, { DataConnection } from 'peerjs';
import { C2H, ClientRole, H2C, QuizPayload, ResultPayload, ShopPayload } from './protocol';
import { peerIdForRoom } from './roomCode';
import { GameEvent, GameOverInfo, PublicState } from '../types/game';

export interface GuestCallbacks {
  onWelcome: (playerId: string, role: ClientRole) => void;
  onState: (state: PublicState) => void;
  onQuiz: (quiz: QuizPayload | null) => void;
  onResult: (result: ResultPayload | null) => void;
  onShop: (shop: ShopPayload | null) => void;
  onEvent: (ev: GameEvent) => void;
  onReject: (reason: string) => void;
  onGameOver: (info: GameOverInfo) => void;
  onHostLeft: () => void;
  onError: (msg: string) => void;
}

export class GuestSession {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private code: string;
  private name: string;
  private role: ClientRole;
  private callbacks: GuestCallbacks;
  private lastSeq = -1;
  private pingTimer: number | null = null;

  constructor(
    code: string,
    name: string,
    role: ClientRole,
    callbacks: GuestCallbacks
  ) {
    this.code = code.toUpperCase();
    this.name = name;
    this.role = role;
    this.callbacks = callbacks;
  }

  connect(): void {
    const peer = new Peer({
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
    });
    this.peer = peer;

    peer.on('open', () => {
      const conn = peer.connect(peerIdForRoom(this.code), { reliable: true });
      this.conn = conn;

      conn.on('open', () => {
        const tokenKey = `cqToken:${this.code}:${this.role}`;
        const savedToken = sessionStorage.getItem(tokenKey) ?? undefined;
        this.send({ t: 'JOIN', name: this.name, token: savedToken, role: this.role });
        this.pingTimer = window.setInterval(() => {
          this.send({ t: 'PING', ts: Date.now() });
        }, 5000);
      });

      conn.on('data', (raw) => {
        const msg = raw as H2C;
        if (!msg || typeof msg !== 'object') return;
        switch (msg.t) {
          case 'WELCOME':
            sessionStorage.setItem(`cqToken:${this.code}:${this.role}`, msg.token);
            this.callbacks.onWelcome(msg.playerId, msg.role);
            break;
          case 'STATE':
            if (msg.seq <= this.lastSeq) return;
            this.lastSeq = msg.seq;
            this.callbacks.onState(msg.state);
            break;
          case 'QUIZ':
            this.callbacks.onQuiz(msg.quiz);
            break;
          case 'RESULT':
            this.callbacks.onResult(msg.result);
            break;
          case 'SHOP':
            this.callbacks.onShop(msg.shop);
            break;
          case 'EVENT':
            this.callbacks.onEvent(msg.ev);
            break;
          case 'REJECT':
            this.callbacks.onReject(msg.reason);
            break;
          case 'GAMEOVER':
            this.callbacks.onGameOver(msg.info);
            break;
          case 'HOST_LEFT':
            this.callbacks.onHostLeft();
            break;
        }
      });

      conn.on('close', () => {
        this.callbacks.onError('Mất kết nối tới chủ phòng.');
      });
      conn.on('error', (err) => {
        this.callbacks.onError(`Lỗi kênh kết nối: ${err.message}`);
      });
    });

    peer.on('error', (err) => {
      this.callbacks.onError(`Không tìm thấy phòng hoặc lỗi PeerJS: ${err.message}`);
    });
  }

  send(msg: C2H): void {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    }
  }

  destroy(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    try {
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      // ignore
    }
    this.conn = null;
    this.peer = null;
  }
}
