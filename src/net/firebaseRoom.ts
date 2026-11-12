import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
} from 'firebase/firestore';
import { CFG } from '../config/defaults';
import { stockfishService } from '../analysis/stockfishWorker';
import { GameCoordinator } from '../engine/gameCoordinator';
import { AdminCommand, GameEvent, GameOverInfo, PublicState, QuestionBank } from '../types/game';
import { getFirebaseServices } from './firebaseClient';
import { HostCallbacks } from './host';
import { GuestCallbacks } from './guest';
import { C2H, ClientRole, QuizPayload, ResultPayload, ShopPayload } from './protocol';
import { generateRoomCode } from './roomCode';

export interface FirebaseRoomMeta {
  code: string;
  mode: 'private' | 'quick';
  isRanked: boolean;
  phase: PublicState['phase'];
  clockSeconds: 180 | 300 | 600;
  hostUid: string;
  hostName: string;
  hostElo: number;
  guestUid: string | null;
  guestName: string | null;
  guestElo: number | null;
  spectatorUids: string[];
  status: 'WAITING' | 'ACTIVE' | 'CLOSED' | 'ABANDONED';
  winner: 'w' | 'b' | 'draw' | null;
}

export interface FirebaseHostOptions {
  mode: 'private' | 'quick';
  existingCode?: string;
  hostUid: string;
  hostName: string;
  hostElo: number;
  guestUid?: string;
  guestName?: string;
  guestElo?: number;
  clockSeconds: 180 | 300 | 600;
  bank: QuestionBank;
  callbacks: HostCallbacks;
}

function buildStateSignature(s: PublicState): string {
  const lastEv = s.events.length > 0 ? s.events[s.events.length - 1].id : '';
  return JSON.stringify([
    s.phase,
    s.fen,
    s.turn,
    s.ply,
    s.lastMove?.from ?? '',
    s.lastMove?.to ?? '',
    s.phaseDeadlineAt ?? 0,
    s.preQuizPassed.p1,
    s.preQuizPassed.p2,
    s.preQuizGroup4Used.p1,
    s.preQuizGroup4Used.p2,
    s.shopDone.p1,
    s.shopDone.p2,
    s.pendingHarmful?.uid ?? '',
    s.pendingHarmful?.reflected ?? false,
    s.forceMove?.startedAt ?? 0,
    s.drawOfferBy ?? '',
    s.p1.name,
    s.p1.elo ?? 0,
    s.p1.connected,
    s.p1.ready,
    s.p1.coins,
    s.p1.streak,
    s.p1.handCount,
    s.p1.freezeRemainingMs > 0,
    s.p2.name,
    s.p2.elo ?? 0,
    s.p2.connected,
    s.p2.ready,
    s.p2.coins,
    s.p2.streak,
    s.p2.handCount,
    s.p2.freezeRemainingMs > 0,
    s.activeEffects.map((e) => `${e.uid}:${e.data ? '1' : '0'}`).join(','),
    lastEv,
    Boolean(s.freeM2Choice),
    s.weakTopicHint ?? '',
    s.analysisHint
      ? `${s.analysisHint.bestMove?.from ?? ''}${s.analysisHint.candidates?.length ?? 0}`
      : '',
    s.gameOver?.winner ?? '',
  ]);
}

export class FirebaseHostSession {
  readonly mode: 'private' | 'quick';
  readonly isRanked: boolean;
  readonly coordinator: GameCoordinator;
  readonly hostUid: string;
  code: string;

  private callbacks: HostCallbacks;
  private spectatorCount = 0;
  private guestAttached = false;
  private destroyed = false;
  private unsubRoom: Unsubscribe | null = null;
  private unsubActions: Unsubscribe | null = null;
  private unsubAdminCmds: Unsubscribe | null = null;
  private tickTimer: number | null = null;
  private quickFallbackTimer: number | null = null;

  private seq = 0;
  private adminSeq = 0;
  private lastProcessedActionSeq = 0;
  private processedAdminCmdIds = new Set<string>();
  private rejectSeq = 0;
  private lastSyncAtMs = 0;
  private lastAdminSyncAtMs = 0;
  private adminWatchUntilMs = 0;
  private lastP2Signature = '';
  private lastSpecSignature = '';
  private lastAdminSignature = '';
  private flushScheduled = false;
  private dirtyP2 = false;
  private dirtySpec = false;
  private dirtyAdmin = false;
  private lastKnownPhase: PublicState['phase'] = 'LOBBY';
  private rankedClosedSynced = false;
  private pageHideHandler: (() => void) | null = null;

  private channelPayloads: Record<
    'p2' | 'spectator',
    {
      quizJson: string;
      resultJson: string;
      shopJson: string;
      eventJson: string;
      rejectJson: string;
      gameOverJson: string;
    }
  > = {
    p2: {
      quizJson: '',
      resultJson: '',
      shopJson: '',
      eventJson: '',
      rejectJson: '',
      gameOverJson: '',
    },
    spectator: {
      quizJson: '',
      resultJson: '',
      shopJson: '',
      eventJson: '',
      rejectJson: '',
      gameOverJson: '',
    },
  };

  constructor(opts: FirebaseHostOptions) {
    this.mode = opts.mode;
    this.isRanked = opts.mode === 'quick';
    this.hostUid = opts.hostUid;
    this.code = opts.existingCode || generateRoomCode();
    this.callbacks = opts.callbacks;

    this.coordinator = new GameCoordinator({
      clockSeconds: opts.clockSeconds,
      bank: opts.bank,
      p1Name: opts.hostName,
      p2Name: opts.guestName ?? 'Đang chờ đối thủ…',
      p1Elo: opts.hostElo,
      p2Elo: opts.guestElo,
      hooks: {
        onStateChange: () => this.onCoordinatorStateChange(),
        onQuizStart: (target, quiz) => {
          if (target === 'p1') this.callbacks.onHostQuiz(quiz);
          else {
            const json = JSON.stringify(quiz);
            this.channelPayloads[target].quizJson = json;
            this.channelPayloads[target].resultJson = '';
            this.markDirty(target);
          }
        },
        onQuizUpdate: (target, quiz) => {
          if (target === 'p1') this.callbacks.onHostQuiz(quiz);
          else {
            this.channelPayloads.p2.quizJson = JSON.stringify(quiz);
            this.markDirty('p2');
          }
        },
        onResult: (target, result) => {
          if (target === 'p1') this.callbacks.onHostResult(result);
          else {
            this.channelPayloads.p2.resultJson = JSON.stringify(result);
            this.markDirty('p2');
          }
        },
        onShopStart: (target, shop) => {
          if (target === 'p1') this.callbacks.onHostShop(shop);
          else {
            this.channelPayloads.p2.shopJson = JSON.stringify(shop);
            this.markDirty('p2');
          }
        },
        onEvent: (target, ev) => {
          if (target === 'p1') this.callbacks.onHostEvent(ev);
          else {
            this.channelPayloads[target].eventJson = JSON.stringify(ev);
            this.markDirty(target);
          }
        },
        onReject: (target, reason) => {
          if (target === 'p1') this.callbacks.onHostReject(reason);
          else {
            this.channelPayloads.p2.rejectJson = JSON.stringify({
              id: ++this.rejectSeq,
              reason,
            });
            this.markDirty('p2');
          }
        },
        onGameOver: (info) => {
          const json = JSON.stringify(info);
          this.channelPayloads.p2.gameOverJson = json;
          this.channelPayloads.spectator.gameOverJson = json;
          this.markDirty('p2');
          this.markDirty('spectator');
          if (this.mode === 'quick') this.rankedClosedSynced = true;
          void this.syncRoomLifecycle('GAME_OVER', 'CLOSED', info.winner);
          this.callbacks.onHostGameOver(info);
        },
        requestAnalysis: (fen, owner, kind, param) => {
          void this.runAnalysis(fen, owner, kind, param);
        },
      },
    });

    if (opts.mode === 'quick') {
      this.coordinator.setPlayerConnected('p2', true);
    }
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

  async start(): Promise<void> {
    const { db } = getFirebaseServices();

    if (this.mode === 'private') {
      let created = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = attempt === 0 ? this.code : generateRoomCode();
        const ref = doc(db, 'rooms', candidate);
        const existing = await getDoc(ref);
        if (existing.exists()) continue;

        const snap = this.coordinator.getSnapshot();
        await setDoc(ref, {
          code: candidate,
          mode: 'private',
          isRanked: false,
          phase: 'LOBBY',
          clockSeconds: snap.clockSeconds,
          hostUid: this.hostUid,
          hostName: snap.p1.name,
          hostElo: snap.p1.elo ?? 1000,
          guestUid: null,
          guestName: null,
          guestElo: null,
          spectatorUids: [],
          status: 'WAITING',
          winner: null,
          actionSeqAck: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        this.code = candidate;
        created = true;
        break;
      }
      if (!created) {
        throw new Error('Không thể tạo mã phòng duy nhất lúc này.');
      }
    }

    if (this.destroyed) return;

    this.callbacks.onRoomReady(this.code);
    this.callbacks.onHostState(this.coordinator.getViewFor('p1'));
    await this.flushViewDoc('p2');

    // Lắng nghe người chơi 2 và khán giả vào/rời phòng
    this.unsubRoom = onSnapshot(doc(db, 'rooms', this.code), (snap) => {
      if (this.destroyed || !snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      const specs = Array.isArray(data.spectatorUids) ? data.spectatorUids.length : 0;
      const specChanged = specs !== this.spectatorCount;
      this.spectatorCount = specs;

      const hasGuest = typeof data.guestUid === 'string' && data.guestUid.length > 0;
      if (hasGuest && !this.guestAttached) {
        this.guestAttached = true;
        const gName = typeof data.guestName === 'string' ? data.guestName : 'Khách';
        const gElo = typeof data.guestElo === 'number' ? data.guestElo : undefined;
        this.coordinator.setPlayerName('p2', gName);
        this.coordinator.setPlayerElo('p2', gElo);
        this.coordinator.setPlayerConnected('p2', true);
        this.callbacks.onGuestConnectionChange(true, gName, this.spectatorCount);
        this.markDirty('p2');
      } else if (specChanged) {
        const p2 = this.coordinator.getSnapshot().p2;
        this.callbacks.onGuestConnectionChange(p2.connected, p2.name, this.spectatorCount);
        if (this.spectatorCount > 0) this.markDirty('spectator');
      }
    });

    // Lắng nghe hàng đợi hành động từ Người chơi 2
    const actionsQ = query(
      collection(db, 'rooms', this.code, 'actions'),
      orderBy('seq', 'asc')
    );
    this.unsubActions = onSnapshot(actionsQ, (snap) => {
      if (this.destroyed) return;
      for (const d of snap.docs) {
        const raw = d.data() as Record<string, unknown>;
        const seq = Number(raw.seq ?? 0);
        if (seq <= this.lastProcessedActionSeq) continue;
        this.lastProcessedActionSeq = seq;
        try {
          const msg = JSON.parse(String(raw.payloadJson ?? '{}')) as C2H;
          this.dispatchGuestAction(msg);
        } catch {
          // ignore malformed action payload
        }
        void deleteDoc(d.ref).catch(() => {});
      }
    });

    // Lắng nghe lệnh quản trị (chỉ Admin được phép ghi theo firestore.rules)
    this.unsubAdminCmds = onSnapshot(collection(db, 'rooms', this.code, 'admin_commands'), (snap) => {
      if (this.destroyed) return;
      for (const d of snap.docs) {
        if (this.processedAdminCmdIds.has(d.id)) continue;
        this.processedAdminCmdIds.add(d.id);
        const cmd = d.data() as AdminCommand & { untilMs?: number };
        void deleteDoc(d.ref).catch(() => {});

        if (!cmd || typeof cmd.type !== 'string') continue;
        if (cmd.type === 'WATCH_PING') {
          this.adminWatchUntilMs = Math.max(
            this.adminWatchUntilMs,
            Number(cmd.untilMs || Date.now() + 30000)
          );
          this.markDirty('admin');
          continue;
        }
        const applied = this.coordinator.applyAdminCommand(cmd);
        if (applied) {
          this.adminWatchUntilMs = Math.max(this.adminWatchUntilMs, Date.now() + 30000);
          this.markDirty('p2');
          if (this.spectatorCount > 0) this.markDirty('spectator');
          this.markDirty('admin');
        }
      }
    });

    // Vòng tick engine cục bộ 100ms
    this.tickTimer = window.setInterval(() => {
      if (!this.destroyed) this.coordinator.tick();
    }, 100);

    this.pageHideHandler = () => {
      if (this.mode === 'quick' && this.rankedClosedSynced) return;
      const ph = this.coordinator.getPhase();
      const win = this.coordinator.getSnapshot().gameOver?.winner ?? null;
      if (this.mode === 'quick' && ph === 'GAME_OVER') this.rankedClosedSynced = true;
      void this.syncRoomLifecycle(ph, 'CLOSED', win);
    };
    window.addEventListener('pagehide', this.pageHideHandler);

    // Ở Ghép trận nhanh: tự bắt đầu ngay khi Guest READY hoặc chậm nhất sau 2.5s
    if (this.mode === 'quick') {
      this.quickFallbackTimer = window.setTimeout(() => {
        if (!this.destroyed && this.coordinator.getPhase() === 'LOBBY') {
          this.coordinator.startGame();
        }
      }, 2500);
    }
  }

  private dispatchGuestAction(msg: C2H): void {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'READY':
        this.coordinator.setPlayerReady('p2', true);
        if (this.mode === 'quick' && this.coordinator.getPhase() === 'LOBBY') {
          if (this.quickFallbackTimer !== null) {
            clearTimeout(this.quickFallbackTimer);
            this.quickFallbackTimer = null;
          }
          this.coordinator.startGame();
        }
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

  private onCoordinatorStateChange(): void {
    if (this.destroyed) return;
    const p1View = this.coordinator.getViewFor('p1');
    this.callbacks.onHostState(p1View);

    const p2View = this.coordinator.getViewFor('p2');
    const now = Date.now();
    const sig = buildStateSignature(p2View);

    if (this.lastKnownPhase === 'GAME_OVER' && p2View.phase === 'PLAYING' && !this.isRanked) {
      this.channelPayloads.p2.gameOverJson = '';
      this.channelPayloads.spectator.gameOverJson = '';
      void this.syncRoomLifecycle('PLAYING', 'ACTIVE', null);
    } else if (this.lastKnownPhase === 'LOBBY' && p2View.phase === 'PLAYING' && this.mode === 'private') {
      void this.syncRoomLifecycle('PLAYING', 'ACTIVE', null);
    }
    this.lastKnownPhase = p2View.phase;

    if (p2View.phase === 'PLAYING') {
      // Xóa payload phase cũ để view p2 luôn gọn nhẹ
      if (this.channelPayloads.p2.quizJson || this.channelPayloads.p2.resultJson || this.channelPayloads.p2.shopJson) {
        this.channelPayloads.p2.quizJson = '';
        this.channelPayloads.p2.resultJson = '';
        this.channelPayloads.p2.shopJson = '';
        this.channelPayloads.p2.gameOverJson = '';
        this.channelPayloads.spectator.quizJson = '';
        this.channelPayloads.spectator.gameOverJson = '';
      }
    }

    const heartbeatDue =
      p2View.phase === 'PLAYING' && now - this.lastSyncAtMs >= 6000;

    if (sig !== this.lastP2Signature || heartbeatDue) {
      this.lastP2Signature = sig;
      this.markDirty('p2');
    }

    if (this.spectatorCount > 0) {
      const specView = this.coordinator.getViewFor('spectator');
      const specSig = buildStateSignature(specView);
      if (specSig !== this.lastSpecSignature || heartbeatDue) {
        this.lastSpecSignature = specSig;
        this.markDirty('spectator');
      }
    }

    if (now < this.adminWatchUntilMs) {
      const adminSnap = this.coordinator.getAdminSnapshot();
      const adminSig = JSON.stringify([
        sig,
        adminSnap.p1.hand.map((h) => `${h.uid}:${h.cardId}:${h.level}`),
        adminSnap.p2.hand.map((h) => `${h.uid}:${h.cardId}:${h.level}`),
        adminSnap.p1.coins,
        adminSnap.p2.coins,
        adminSnap.p1.streak,
        adminSnap.p2.streak,
        adminSnap.quizInfo?.p1?.choice ?? null,
        adminSnap.quizInfo?.p2?.choice ?? null,
      ]);
      const adminHeartbeatDue = now - this.lastAdminSyncAtMs >= 1500;
      if (adminSig !== this.lastAdminSignature || adminHeartbeatDue) {
        this.lastAdminSignature = adminSig;
        this.markDirty('admin');
      }
    }
  }

  private markDirty(channel: 'p2' | 'spectator' | 'admin'): void {
    if (channel === 'p2') this.dirtyP2 = true;
    else if (channel === 'admin') this.dirtyAdmin = true;
    else if (this.spectatorCount > 0) this.dirtySpec = true;

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        if (this.destroyed) return;
        if (this.dirtyP2) {
          this.dirtyP2 = false;
          void this.flushViewDoc('p2');
        }
        if (this.dirtySpec) {
          this.dirtySpec = false;
          if (this.spectatorCount > 0) {
            void this.flushViewDoc('spectator');
          }
        }
        if (this.dirtyAdmin) {
          this.dirtyAdmin = false;
          void this.flushAdminViewDoc();
        }
      });
    }
  }

  private async flushAdminViewDoc(): Promise<void> {
    if (this.destroyed) return;
    const { db } = getFirebaseServices();
    const adminSnap = this.coordinator.getAdminSnapshot();
    this.lastAdminSyncAtMs = Date.now();
    try {
      await setDoc(doc(db, 'rooms', this.code, 'views', 'admin'), {
        seq: ++this.adminSeq,
        adminJson: JSON.stringify(adminSnap),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // non-fatal if admin watch write fails
    }
  }

  private async flushViewDoc(channel: 'p2' | 'spectator'): Promise<void> {
    if (this.destroyed) return;
    const { db } = getFirebaseServices();
    const state = this.coordinator.getViewFor(channel);
    const extra = this.channelPayloads[channel];
    this.lastSyncAtMs = Date.now();

    try {
      await setDoc(doc(db, 'rooms', this.code, 'views', channel), {
        seq: ++this.seq,
        stateJson: JSON.stringify(state),
        quizJson: extra.quizJson,
        resultJson: extra.resultJson,
        shopJson: extra.shopJson,
        eventJson: extra.eventJson,
        rejectJson: extra.rejectJson,
        gameOverJson: extra.gameOverJson,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      this.callbacks.onPeerError(
        `Lỗi đồng bộ trực tuyến: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async syncRoomLifecycle(
    phase: PublicState['phase'],
    status: FirebaseRoomMeta['status'],
    winner: 'w' | 'b' | 'draw' | null
  ): Promise<void> {
    try {
      const { db } = getFirebaseServices();
      await updateDoc(doc(db, 'rooms', this.code), {
        phase,
        status,
        winner,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // ignore if closing/offline
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    if (this.quickFallbackTimer !== null) clearTimeout(this.quickFallbackTimer);
    this.unsubRoom?.();
    this.unsubActions?.();
    this.unsubAdminCmds?.();
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }

    if (this.mode === 'quick' && this.rankedClosedSynced) return;
    const phase = this.coordinator.getPhase();
    const winner = this.coordinator.getSnapshot().gameOver?.winner ?? null;
    if (this.mode === 'quick' && phase === 'GAME_OVER') this.rankedClosedSynced = true;
    void this.syncRoomLifecycle(phase, 'CLOSED', winner);
  }
}

export class FirebaseGuestSession {
  readonly code: string;
  readonly isRanked: boolean = false;
  private uid: string;
  private name: string;
  private elo: number;
  private role: ClientRole;
  private isQuick: boolean;
  private callbacks: GuestCallbacks;

  private destroyed = false;
  private unsubRoom: Unsubscribe | null = null;
  private unsubView: Unsubscribe | null = null;
  private lastSeq = -1;
  private actionSeq = 0;
  private lastQuizJson = '';
  private lastResultJson = '';
  private lastShopJson = '';
  private lastEventId = '';
  private lastRejectId = 0;
  private lastPhase: PublicState['phase'] = 'LOBBY';
  private gameOverEmitted = false;
  private hostLeftEmitted = false;
  private detectedRanked = false;

  constructor(opts: {
    code: string;
    uid: string;
    name: string;
    elo: number;
    role: ClientRole;
    isQuick?: boolean;
    callbacks: GuestCallbacks;
  }) {
    this.code = opts.code.toUpperCase();
    this.uid = opts.uid;
    this.name = opts.name;
    this.elo = opts.elo;
    this.role = opts.role;
    this.isQuick = Boolean(opts.isQuick);
    this.callbacks = opts.callbacks;
  }

  getRankedFlag(): boolean {
    return this.detectedRanked || this.isQuick;
  }

  async connect(): Promise<'connected' | 'not_found'> {
    const { db } = getFirebaseServices();
    const roomRef = doc(db, 'rooms', this.code);
    const snap = await getDoc(roomRef);
    if (!snap.exists()) {
      return 'not_found';
    }
    const meta = snap.data() as Record<string, unknown>;
    this.detectedRanked = Boolean(meta.isRanked);

    if (meta.status === 'CLOSED' && meta.phase !== 'GAME_OVER') {
      this.callbacks.onError('Phòng này đã đóng.');
      return 'connected';
    }

    if (this.isQuick) {
      if (meta.guestUid !== this.uid) {
        this.callbacks.onError('Bạn không thuộc trận ghép nhanh này.');
        return 'connected';
      }
      this.callbacks.onWelcome('p2', 'player');
      this.send({ t: 'READY' });
    } else if (this.role === 'spectator') {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(roomRef);
        if (!s.exists()) throw new Error('Phòng không tồn tại');
        const d = s.data() as Record<string, unknown>;
        if (d.status === 'CLOSED') throw new Error('Phòng đã đóng');
        const specs = Array.isArray(d.spectatorUids) ? [...(d.spectatorUids as string[])] : [];
        if (!specs.includes(this.uid) && d.hostUid !== this.uid && d.guestUid !== this.uid) {
          if (specs.length >= CFG.maxSpectators) {
            throw new Error('Phòng khán giả đã đầy (tối đa 5)');
          }
          specs.push(this.uid);
          tx.update(roomRef, { spectatorUids: specs, updatedAt: serverTimestamp() });
        }
      });
      this.callbacks.onWelcome(this.uid, 'spectator');
    } else {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(roomRef);
        if (!s.exists()) throw new Error('Phòng không tồn tại');
        const d = s.data() as Record<string, unknown>;
        if (d.status === 'CLOSED') throw new Error('Phòng đã đóng');
        const isReconnect = d.guestUid === this.uid;
        if (!isReconnect) {
          if (d.hostUid === this.uid) {
            throw new Error('Bạn đang là Chủ phòng của phòng này.');
          }
          if (d.guestUid !== null) {
            throw new Error('Phòng đã đủ 2 người chơi');
          }
          if (d.phase !== 'LOBBY') {
            throw new Error('Ván đấu đang diễn ra');
          }
          tx.update(roomRef, {
            guestUid: this.uid,
            guestName: this.name,
            guestElo: this.elo,
            updatedAt: serverTimestamp(),
          });
        }
      });
      this.callbacks.onWelcome('p2', 'player');
    }

    if (this.destroyed) return 'connected';

    const channel = this.role === 'spectator' ? 'spectator' : 'p2';
    this.unsubRoom = onSnapshot(roomRef, (rSnap) => {
      if (this.destroyed || !rSnap.exists()) return;
      const d = rSnap.data() as Record<string, unknown>;
      if (
        d.status === 'CLOSED' &&
        d.phase !== 'GAME_OVER' &&
        this.lastPhase !== 'GAME_OVER' &&
        !this.hostLeftEmitted
      ) {
        this.hostLeftEmitted = true;
        this.callbacks.onHostLeft();
      }
    });

    this.unsubView = onSnapshot(doc(db, 'rooms', this.code, 'views', channel), (vSnap) => {
      if (this.destroyed || !vSnap.exists()) return;
      const d = vSnap.data() as Record<string, unknown>;
      const seq = Number(d.seq ?? 0);
      if (seq <= this.lastSeq) return;
      this.lastSeq = seq;

      if (typeof d.stateJson === 'string' && d.stateJson) {
        try {
          const st = JSON.parse(d.stateJson) as PublicState;
          this.lastPhase = st.phase;
          this.callbacks.onState(st);
        } catch {
          // ignore
        }
      }

      const quizJson = typeof d.quizJson === 'string' ? d.quizJson : '';
      if (quizJson !== this.lastQuizJson) {
        this.lastQuizJson = quizJson;
        this.callbacks.onQuiz(quizJson ? (JSON.parse(quizJson) as QuizPayload) : null);
      }

      const resultJson = typeof d.resultJson === 'string' ? d.resultJson : '';
      if (resultJson !== this.lastResultJson) {
        this.lastResultJson = resultJson;
        this.callbacks.onResult(resultJson ? (JSON.parse(resultJson) as ResultPayload) : null);
      }

      const shopJson = typeof d.shopJson === 'string' ? d.shopJson : '';
      if (shopJson !== this.lastShopJson) {
        this.lastShopJson = shopJson;
        this.callbacks.onShop(shopJson ? (JSON.parse(shopJson) as ShopPayload) : null);
      }

      if (typeof d.eventJson === 'string' && d.eventJson) {
        try {
          const ev = JSON.parse(d.eventJson) as GameEvent;
          if (ev.id && ev.id !== this.lastEventId) {
            this.lastEventId = ev.id;
            this.callbacks.onEvent(ev);
          }
        } catch {
          // ignore
        }
      }

      if (typeof d.rejectJson === 'string' && d.rejectJson) {
        try {
          const rej = JSON.parse(d.rejectJson) as { id: number; reason: string };
          if (rej.id && rej.id !== this.lastRejectId) {
            this.lastRejectId = rej.id;
            this.callbacks.onReject(rej.reason);
          }
        } catch {
          // ignore
        }
      }

      if (!this.gameOverEmitted && typeof d.gameOverJson === 'string' && d.gameOverJson) {
        try {
          const info = JSON.parse(d.gameOverJson) as GameOverInfo;
          this.gameOverEmitted = true;
          this.callbacks.onGameOver(info);
        } catch {
          // ignore
        }
      }
    });

    return 'connected';
  }

  send(msg: C2H): void {
    if (this.destroyed || this.role === 'spectator') return;
    const seq = Math.max(this.actionSeq + 1, Date.now() * 100);
    this.actionSeq = seq;
    const { db } = getFirebaseServices();
    const actionRef = doc(db, 'rooms', this.code, 'actions', String(seq));
    void setDoc(actionRef, {
      uid: this.uid,
      seq,
      payloadJson: JSON.stringify(msg),
      createdAt: serverTimestamp(),
    }).catch((err) => {
      if (!this.destroyed) {
        this.callbacks.onError(
          `Không gửi được thao tác: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubRoom?.();
    this.unsubView?.();
    this.unsubRoom = null;
    this.unsubView = null;
  }
}
