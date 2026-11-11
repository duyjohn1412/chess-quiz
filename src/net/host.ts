import Peer, { DataConnection } from 'peerjs';
import { CFG } from '../config/defaults';
import { GameCoordinator } from '../engine/gameCoordinator';
import { stockfishService } from '../analysis/stockfishWorker';
import { C2H, H2C, QuizPayload, ResultPayload, ShopPayload } from './protocol';
import { generateRoomCode, peerIdForRoom } from './roomCode';
import { GameEvent, GameOverInfo, PublicState, QuestionBank } from '../types/game';

export interface HostCallbacks {
  onRoomReady: (code: string) => void;
  onPeerError: (msg: string) => void;
  onHostState: (state: PublicState) => void;
  onHostQuiz: (quiz: QuizPayload | null) => void;
  onHostResult: (res: ResultPayload | null) => void;
  onHostShop: (shop: ShopPayload | null) => void;
  onHostEvent: (ev: GameEvent) => void;
  onHostReject: (reason: string) => void;
  onHostGameOver: (info: GameOverInfo) => void;
  onGuestConnectionChange: (connected: boolean, name: string, spectators: number) => void;
}

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  const turnUser = import.meta.env.VITE_TURN_USER as string | undefined;
  const turnPass = import.meta.env.VITE_TURN_PASS as string | undefined;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: turnUser,
      credential: turnPass,
    });
  }
  return servers;
}

export class HostSession {
  readonly code: string;
  readonly coordinator: GameCoordinator;
  private peer: Peer | null = null;
  private guestConn: DataConnection | null = null;
  private guestToken: string = '';
  private spectators = new Map<string, { conn: DataConnection; token: string }>();
  private callbacks: HostCallbacks;
  private seq = 0;
  private tickTimer: number | null = null;
  private syncTimer: number | null = null;
  private lastSpecQuiz: QuizPayload | null = null;

  constructor(
    hostName: string,
    clockSeconds: 180 | 300 | 600,
    bank: QuestionBank,
    callbacks: HostCallbacks
  ) {
    this.code = generateRoomCode();
    this.callbacks = callbacks;
    this.guestToken = `tok_${Math.random().toString(36).slice(2, 12)}`;

    this.coordinator = new GameCoordinator({
      clockSeconds,
      bank,
      p1Name: hostName,
      p2Name: 'Đang chờ đối thủ…',
      hooks: {
        onStateChange: () => this.broadcastState(),
        onQuizStart: (target, quiz) => {
          if (target === 'p1') this.callbacks.onHostQuiz(quiz);
          else if (target === 'p2') this.sendToGuest({ t: 'QUIZ', quiz });
          else {
            this.lastSpecQuiz = quiz;
            this.broadcastToSpectators({ t: 'QUIZ', quiz });
          }
        },
        onQuizUpdate: (target, quiz) => {
          if (target === 'p1') this.callbacks.onHostQuiz(quiz);
          else this.sendToGuest({ t: 'QUIZ', quiz });
        },
        onResult: (target, result) => {
          if (target === 'p1') this.callbacks.onHostResult(result);
          else this.sendToGuest({ t: 'RESULT', result });
        },
        onShopStart: (target, shop) => {
          if (target === 'p1') this.callbacks.onHostShop(shop);
          else this.sendToGuest({ t: 'SHOP', shop });
        },
        onEvent: (target, ev) => {
          if (target === 'p1') this.callbacks.onHostEvent(ev);
          else if (target === 'p2') this.sendToGuest({ t: 'EVENT', ev });
          else this.broadcastToSpectators({ t: 'EVENT', ev });
        },
        onReject: (target, reason) => {
          if (target === 'p1') this.callbacks.onHostReject(reason);
          else this.sendToGuest({ t: 'REJECT', reason });
        },
        onGameOver: (info) => {
          this.callbacks.onHostGameOver(info);
          this.sendToGuest({ t: 'GAMEOVER', info });
          this.broadcastToSpectators({ t: 'GAMEOVER', info });
        },
        requestAnalysis: (fen, owner, kind, param) => {
          void this.runAnalysis(fen, owner, kind, param);
        },
      },
    });
  }

  private async runAnalysis(
    fen: string,
    owner: 'p1' | 'p2',
    kind: 'hint' | 'cand' | 'eval',
    param: number
  ): Promise<void> {
    if (kind === 'hint') {
      const res = await stockfishService.analyze(fen, param, 1, 1500);
      const top = res.lines[0];
      if (top) {
        this.coordinator.setAnalysisResult(owner, 'hint', {
          bestMove: { from: top.from, to: top.to },
        });
      }
    } else if (kind === 'cand') {
      const res = await stockfishService.analyze(fen, 12, param, 1500);
      const shuffled = [...res.lines].sort(() => Math.random() - 0.5);
      this.coordinator.setAnalysisResult(owner, 'cand', {
        candidates: shuffled.map((l) => ({ from: l.from, to: l.to })),
      });
    } else if (kind === 'eval') {
      const res = await stockfishService.analyze(fen, param, 1, 900);
      this.coordinator.setAnalysisResult(owner, 'eval', {
        evalPawns: res.evalPawns,
      });
    }
  }

  startPeer(): void {
    const peer = new Peer(peerIdForRoom(this.code), {
      config: { iceServers: getIceServers() },
    });
    this.peer = peer;

    peer.on('open', () => {
      this.callbacks.onRoomReady(this.code);
      this.callbacks.onHostState(this.coordinator.getViewFor('p1'));
    });

    peer.on('connection', (conn) => {
      conn.on('data', (raw) => this.handleIncoming(conn, raw as C2H));
      conn.on('close', () => this.handleDisconnect(conn));
    });

    peer.on('error', (err) => {
      this.callbacks.onPeerError(`Lỗi kết nối PeerJS: ${err.message}`);
    });

    this.tickTimer = window.setInterval(() => {
      this.coordinator.tick();
    }, 100);

    this.syncTimer = window.setInterval(() => {
      if (this.coordinator.getPhase() === 'PLAYING') {
        this.broadcastState();
      }
    }, 1000);
  }

  private handleIncoming(conn: DataConnection, msg: C2H): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'PING') {
      conn.send({ t: 'PONG', ts: msg.ts } satisfies H2C);
      return;
    }

    if (msg.t === 'JOIN') {
      if (msg.role === 'spectator') {
        // Kiểm tra reconnect spectator hoặc slot mới
        const existingSpec = Array.from(this.spectators.entries()).find(
          ([, s]) => msg.token && s.token === msg.token
        );
        if (existingSpec) {
          existingSpec[1].conn = conn;
          conn.send({
            t: 'WELCOME',
            token: existingSpec[1].token,
            playerId: existingSpec[0],
            role: 'spectator',
            clockSeconds: this.coordinator.getSnapshot().clockSeconds,
          } satisfies H2C);
          conn.send({
            t: 'STATE',
            seq: ++this.seq,
            state: this.coordinator.getViewFor('spectator'),
          } satisfies H2C);
          if (this.coordinator.getPhase() === 'QUIZ' && this.lastSpecQuiz) {
            conn.send({ t: 'QUIZ', quiz: this.lastSpecQuiz } satisfies H2C);
          }
          return;
        }
        if (this.spectators.size >= CFG.maxSpectators) {
          conn.send({ t: 'REJECT', reason: 'Phòng khán giả đã đầy (tối đa 5)' } satisfies H2C);
          setTimeout(() => conn.close(), 200);
          return;
        }
        const sid = `spec_${Math.random().toString(36).slice(2, 8)}`;
        const tok = `stok_${Math.random().toString(36).slice(2, 12)}`;
        this.spectators.set(sid, { conn, token: tok });
        conn.send({
          t: 'WELCOME',
          token: tok,
          playerId: sid,
          role: 'spectator',
          clockSeconds: this.coordinator.getSnapshot().clockSeconds,
        } satisfies H2C);
        conn.send({
          t: 'STATE',
          seq: ++this.seq,
          state: this.coordinator.getViewFor('spectator'),
        } satisfies H2C);
        this.notifyLobbyConn();
        return;
      }

      // Role player (p2)
      const isReconnect = Boolean(msg.token && msg.token === this.guestToken);
      if (this.guestConn && this.guestConn.open && !isReconnect) {
        conn.send({ t: 'REJECT', reason: 'Phòng đã đủ 2 người chơi' } satisfies H2C);
        setTimeout(() => conn.close(), 200);
        return;
      }
      if (this.coordinator.getPhase() !== 'LOBBY' && !isReconnect) {
        conn.send({ t: 'REJECT', reason: 'Ván đấu đang diễn ra' } satisfies H2C);
        setTimeout(() => conn.close(), 200);
        return;
      }

      this.guestConn = conn;
      this.coordinator.setPlayerConnected('p2', true);
      if (!isReconnect) {
        this.coordinator.setPlayerName('p2', msg.name || 'Khách');
      }
      const p2Snap = this.coordinator.getSnapshot().p2;
      conn.send({
        t: 'WELCOME',
        token: this.guestToken,
        playerId: 'p2',
        role: 'player',
        color: p2Snap.color,
        clockSeconds: this.coordinator.getSnapshot().clockSeconds,
      } satisfies H2C);
      this.broadcastState();
      if (isReconnect) {
        if (this.coordinator.getPhase() === 'QUIZ') {
          const q = this.coordinator.getQuizFor('p2');
          if (q) conn.send({ t: 'QUIZ', quiz: q } satisfies H2C);
        } else if (this.coordinator.getPhase() === 'SHOP') {
          const s = this.coordinator.getShopFor('p2');
          if (s) conn.send({ t: 'SHOP', shop: s } satisfies H2C);
        }
      }
      this.notifyLobbyConn();
      return;
    }

    // Mọi tin khác chỉ chấp nhận từ guest player (bỏ qua từ khán giả)
    if (conn !== this.guestConn) return;

    switch (msg.t) {
      case 'READY':
        this.coordinator.setPlayerReady('p2', true);
        break;
      case 'MOVE':
        this.coordinator.handleMove('p2', msg.from, msg.to, msg.promo);
        break;
      case 'ANSWER':
        this.coordinator.handleQuizAnswer('p2', msg.qid, msg.choice);
        break;
      case 'REROLL':
        this.coordinator.handleReroll('p2');
        break;
      case 'BUY':
        this.coordinator.handleBuyCard('p2', msg.slot);
        break;
      case 'SHOP_REFRESH':
        this.coordinator.handleShopRefresh('p2');
        break;
      case 'SHOP_DONE':
        this.coordinator.handleShopDone('p2');
        break;
      case 'DROP':
        this.coordinator.handleDropCard('p2', msg.uid);
        break;
      case 'PRE_QUIZ_PASS':
        this.coordinator.handlePreQuizPass('p2');
        break;
      case 'USE':
        this.coordinator.handleUseCard('p2', msg.uid);
        break;
      case 'SHIELD':
        this.coordinator.handleShield('p2', msg.uid);
        break;
      case 'CHOOSE_FREE_M2':
        this.coordinator.handleChooseFreeM2('p2', msg.cardId);
        break;
      case 'RESIGN':
        this.coordinator.handleResign('p2');
        break;
      case 'DRAW_OFFER':
        this.coordinator.handleDrawOffer('p2');
        break;
      case 'DRAW_REPLY':
        this.coordinator.handleDrawReply('p2', msg.accept);
        break;
    }
  }

  private handleDisconnect(conn: DataConnection): void {
    if (conn === this.guestConn) {
      this.coordinator.setPlayerConnected('p2', false);
      this.notifyLobbyConn();
      return;
    }
    for (const [sid, spec] of this.spectators.entries()) {
      if (spec.conn === conn) {
        this.spectators.delete(sid);
        this.notifyLobbyConn();
        break;
      }
    }
  }

  private notifyLobbyConn(): void {
    const p2 = this.coordinator.getSnapshot().p2;
    this.callbacks.onGuestConnectionChange(p2.connected, p2.name, this.spectators.size);
  }

  private sendToGuest(msg: H2C): void {
    if (this.guestConn && this.guestConn.open) {
      this.guestConn.send(msg);
    }
  }

  private broadcastToSpectators(msg: H2C): void {
    for (const s of this.spectators.values()) {
      if (s.conn.open) s.conn.send(msg);
    }
  }

  private broadcastState(): void {
    const seq = ++this.seq;
    this.callbacks.onHostState(this.coordinator.getViewFor('p1'));
    this.sendToGuest({ t: 'STATE', seq, state: this.coordinator.getViewFor('p2') });
    this.broadcastToSpectators({
      t: 'STATE',
      seq,
      state: this.coordinator.getViewFor('spectator'),
    });
  }

  destroy(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    if (this.syncTimer !== null) clearInterval(this.syncTimer);
    this.sendToGuest({ t: 'HOST_LEFT' });
    this.broadcastToSpectators({ t: 'HOST_LEFT' });
    try {
      this.peer?.destroy();
    } catch {
      // ignore
    }
    this.peer = null;
  }
}
