import { CFG } from '../config/defaults';
import { getCardDef, getCardLevel } from '../cards/registry';
import { canUseCard, canUseExtraShieldCharge } from '../cards/rules';
import {
  buildCardEffect,
  tickEffectsAfterOwnerMove,
  tickEffectsAfterQuiz,
  tickEffectsAfterShop,
  upsertEffect,
} from '../cards/effects';
import { ChessGame } from './chessGame';
import {
  applyForceMovePenalty,
  applyTimeBonus,
  applyTimePenalty,
  tickClock,
} from './clock';
import { calcQuizCoins } from './economy';
import { advanceMoveCounter } from './scheduler';
import { updateStreak } from './streak';
import { pickQuestion } from '../quiz/picker';
import { gradeAnswer, reshuffleExistingOptions, shuffleOptions } from '../quiz/grader';
import { getWeakestTopic, recordTopicAnswer } from '../quiz/topicStats';
import { computeShopDiscount } from '../shop/discount';
import { generateShopItems } from '../shop/generator';
import { FullGameSnapshot, viewFor } from '../net/viewFor';
import { QuizPayload, ResultPayload, ShopPayload } from '../net/protocol';
import {
  ActiveEffect,
  Color,
  ForceMoveState,
  FreeM2Choice,
  GameEvent,
  GameOverInfo,
  GamePhase,
  HeldCard,
  PendingHarmful,
  PlayerId,
  PlayerQuizSlot,
  PlayerShopState,
  PlayerState,
  PublicState,
  Question,
  QuestionBank,
  QuizOutcome,
} from '../types/game';

export interface CoordinatorHooks {
  onStateChange?: () => void;
  onQuizStart?: (target: PlayerId | 'spectator', quiz: QuizPayload) => void;
  onQuizUpdate?: (target: PlayerId, quiz: QuizPayload) => void;
  onResult?: (target: PlayerId, result: ResultPayload) => void;
  onShopStart?: (target: PlayerId, shop: ShopPayload) => void;
  onEvent?: (target: PlayerId | 'spectator', ev: GameEvent) => void;
  onReject?: (target: PlayerId, reason: string) => void;
  onGameOver?: (info: GameOverInfo) => void;
  requestAnalysis?: (
    fen: string,
    owner: PlayerId,
    kind: 'hint' | 'cand' | 'eval',
    param: number
  ) => void;
}

export interface CoordinatorOptions {
  clockSeconds: 180 | 300 | 600;
  bank: QuestionBank;
  p1Name?: string;
  p2Name?: string;
  p1Elo?: number;
  p2Elo?: number;
  rng?: () => number;
  now?: () => number;
  hooks?: CoordinatorHooks;
}

export class GameCoordinator {
  private chess = new ChessGame();
  private bank: QuestionBank;
  private clockSeconds: number;
  private rng: () => number;
  private nowFn: () => number;
  private hooks: CoordinatorHooks;

  private phase: GamePhase = 'LOBBY';
  private lastTickAt: number;
  private phaseDeadlineAt: number | null = null;
  private ply = 0;
  private lastMove: { from: string; to: string } | null = null;

  private p1: PlayerState;
  private p2: PlayerState;

  private usedQuestionIds = new Set<string>();
  private topicSeenCounts: Record<string, number> = {};
  private totalQuizzes = 0;
  private quizCorrectCount: Record<PlayerId, number> = { p1: 0, p2: 0 };
  private totalCoinsEarned: Record<PlayerId, number> = { p1: 0, p2: 0 };
  private totalCardsUsed: Record<PlayerId, number> = { p1: 0, p2: 0 };

  private preQuizPassed: Record<PlayerId, boolean> = { p1: false, p2: false };
  private preQuizGroup4Used: Record<PlayerId, boolean> = { p1: false, p2: false };
  private pendingFlashForQuiz: Record<PlayerId, number> = { p1: 0, p2: 0 };

  private quizSlots: Record<PlayerId, PlayerQuizSlot | null> = { p1: null, p2: null };
  private quizQuestionMeta: Record<PlayerId, Question | null> = { p1: null, p2: null };

  private shops: Record<PlayerId, PlayerShopState | null> = { p1: null, p2: null };
  private prevShopGroups: Record<PlayerId, ('time' | 'support' | 'peek' | 'quiz')[]> = {
    p1: [],
    p2: [],
  };

  private activeEffects: ActiveEffect[] = [];
  private pendingHarmful: PendingHarmful | null = null;
  private shieldExtraCharges: Record<PlayerId, number> = { p1: 0, p2: 0 };
  private forceMove: ForceMoveState | null = null;
  private drawOfferBy: PlayerId | null = null;
  private freeM2Choices: Record<PlayerId, FreeM2Choice | null> = { p1: null, p2: null };
  private weakTopicHints: Record<PlayerId, string | null> = { p1: null, p2: null };
  private analysisHints: Record<
    PlayerId,
    { bestMove?: { from: string; to: string }; candidates?: { from: string; to: string }[] } | null
  > = { p1: null, p2: null };

  private events: GameEvent[] = [];
  private gameOverInfo: GameOverInfo | null = null;
  private uidCounter = 1;

  constructor(opts: CoordinatorOptions) {
    this.clockSeconds = opts.clockSeconds;
    this.bank = opts.bank;
    this.rng = opts.rng ?? Math.random;
    this.nowFn = opts.now ?? (() => Date.now());
    this.hooks = opts.hooks ?? {};
    this.lastTickAt = this.nowFn();

    const ms = opts.clockSeconds * 1000;
    this.p1 = this.createPlayer('p1', opts.p1Name ?? 'Người chơi 1', 'w', ms, opts.p1Elo);
    this.p2 = this.createPlayer('p2', opts.p2Name ?? 'Người chơi 2', 'b', ms, opts.p2Elo);
    this.p1.connected = true;
    this.p2.connected = false;
  }

  private createPlayer(
    id: PlayerId,
    name: string,
    color: Color,
    clockMs: number,
    elo?: number
  ): PlayerState {
    return {
      id,
      name,
      elo,
      color,
      clockMs,
      freezeRemainingMs: 0,
      coins: 0,
      streak: 0,
      streak5Granted: false,
      pendingShopDiscount: 0,
      hand: [],
      usedCount: {},
      history: [],
      rerollsLeft: 1,
      flashUsed: 0,
      moveCount: 0,
      sinceQuiz: 0,
      harmfulCooldown: 0,
      cardsUsedThisTurn: 0,
      bonusTimeGivenMs: 0,
      drawOfferCooldownUntilMove: 0,
      topicStats: {},
      connected: true,
      disconnectedAt: null,
      ready: false,
    };
  }

  private nextUid(prefix: string): string {
    return `${prefix}_${this.uidCounter++}`;
  }

  private getPlayer(id: PlayerId): PlayerState {
    return id === 'p1' ? this.p1 : this.p2;
  }

  private getOpponent(id: PlayerId): PlayerState {
    return id === 'p1' ? this.p2 : this.p1;
  }

  private getPlayerByColor(color: Color): PlayerState {
    return this.p1.color === color ? this.p1 : this.p2;
  }

  setHooks(hooks: CoordinatorHooks): void {
    this.hooks = hooks;
  }

  setBank(bank: QuestionBank): void {
    this.bank = bank;
  }

  setClockSeconds(sec: 180 | 300 | 600): void {
    if (this.phase !== 'LOBBY') return;
    this.clockSeconds = sec;
    this.p1.clockMs = sec * 1000;
    this.p2.clockMs = sec * 1000;
    this.hooks.onStateChange?.();
  }

  setPlayerName(id: PlayerId, name: string): void {
    const clean = name.trim().slice(0, 24) || (id === 'p1' ? 'Chủ phòng' : 'Khách');
    this.getPlayer(id).name = clean;
    this.hooks.onStateChange?.();
  }

  setPlayerElo(id: PlayerId, elo?: number): void {
    this.getPlayer(id).elo = elo;
    this.hooks.onStateChange?.();
  }

  setPlayerConnected(id: PlayerId, connected: boolean): void {
    const p = this.getPlayer(id);
    p.connected = connected;
    p.disconnectedAt = connected ? null : this.nowFn();
    this.hooks.onStateChange?.();
  }

  setPlayerReady(id: PlayerId, ready: boolean): void {
    this.getPlayer(id).ready = ready;
    this.hooks.onStateChange?.();
  }

  startGame(forcedColors?: { p1: Color; p2: Color }): void {
    const now = this.nowFn();
    this.chess = new ChessGame();
    const p1IsWhite = forcedColors ? forcedColors.p1 === 'w' : this.rng() < 0.5;
    const ms = this.clockSeconds * 1000;

    this.p1 = this.createPlayer('p1', this.p1.name, p1IsWhite ? 'w' : 'b', ms, this.p1.elo);
    this.p2 = this.createPlayer('p2', this.p2.name, p1IsWhite ? 'b' : 'w', ms, this.p2.elo);
    this.p1.connected = true;
    this.p2.connected = true;

    this.phase = 'PLAYING';
    this.lastTickAt = now;
    this.phaseDeadlineAt = null;
    this.ply = 0;
    this.lastMove = null;
    this.usedQuestionIds.clear();
    this.topicSeenCounts = {};
    this.totalQuizzes = 0;
    this.quizCorrectCount = { p1: 0, p2: 0 };
    this.totalCoinsEarned = { p1: 0, p2: 0 };
    this.totalCardsUsed = { p1: 0, p2: 0 };
    this.activeEffects = [];
    this.pendingHarmful = null;
    this.shieldExtraCharges = { p1: 0, p2: 0 };
    this.forceMove = null;
    this.drawOfferBy = null;
    this.freeM2Choices = { p1: null, p2: null };
    this.weakTopicHints = { p1: null, p2: null };
    this.analysisHints = { p1: null, p2: null };
    this.events = [];
    this.gameOverInfo = null;
    this.shops = { p1: null, p2: null };
    this.prevShopGroups = { p1: [], p2: [] };
    this.quizSlots = { p1: null, p2: null };
    this.pendingFlashForQuiz = { p1: 0, p2: 0 };

    this.pushPublicEvent('info', `Ván đấu bắt đầu! ${this.getPlayerByColor('w').name} cầm Trắng.`);
    this.hooks.onStateChange?.();
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getHotseatNextActor(): PlayerId {
    if (this.pendingHarmful) return this.pendingHarmful.target;
    if (this.phase === 'PRE_QUIZ') {
      return !this.preQuizPassed.p1 ? 'p1' : 'p2';
    }
    if (this.phase === 'QUIZ') {
      return this.quizSlots.p1?.isCorrect === null ? 'p1' : 'p2';
    }
    if (this.phase === 'SHOP') {
      return !this.shops.p1?.done ? 'p1' : 'p2';
    }
    return this.p1.color === this.chess.getTurn() ? 'p1' : 'p2';
  }

  /** Dành cho chế độ Hot-seat 1 máy: căn lại mốc thời gian khi chuyển máy cho người chơi tiếp theo */
  reanchorHotseatTurn(playerId: PlayerId, now: number = this.nowFn()): void {
    this.lastTickAt = now;
    if (this.pendingHarmful && this.pendingHarmful.target === playerId) {
      const rem = CFG.harmfulPendingSeconds * 1000;
      this.pendingHarmful.startedAt = now;
      this.pendingHarmful.resolveAt = now + rem;
    }
    if (this.phase === 'PRE_QUIZ') {
      this.phaseDeadlineAt = now + CFG.preQuizSeconds * 1000;
    } else if (this.phase === 'QUIZ') {
      const slot = this.quizSlots[playerId];
      if (slot && slot.isCorrect === null) {
        slot.startedAt = now;
        slot.deadlineAt = now + slot.durationMs;
        const qp = this.getQuizFor(playerId);
        if (qp) this.hooks.onQuizUpdate?.(playerId, qp);
      }
    } else if (this.phase === 'SHOP') {
      this.phaseDeadlineAt = now + CFG.shopSeconds * 1000;
      const sp = this.getShopFor(playerId);
      if (sp) this.hooks.onShopStart?.(playerId, sp);
    }
    this.hooks.onStateChange?.();
  }

  getSnapshot(): FullGameSnapshot {
    return {
      phase: this.phase,
      hostNow: this.nowFn(),
      clockSeconds: this.clockSeconds,
      fen: this.chess.getFen(),
      turn: this.chess.getTurn(),
      lastMove: this.lastMove,
      ply: this.ply,
      phaseDeadlineAt: this.phaseDeadlineAt,
      preQuizPassed: { ...this.preQuizPassed },
      preQuizGroup4Used: { ...this.preQuizGroup4Used },
      activeEffects: this.activeEffects,
      pendingHarmful: this.pendingHarmful,
      forceMove: this.forceMove,
      drawOfferBy: this.drawOfferBy,
      p1: this.p1,
      p2: this.p2,
      shops: this.shops,
      freeM2Choices: this.freeM2Choices,
      events: this.events,
      gameOver: this.gameOverInfo,
      weakTopicHints: this.weakTopicHints,
      analysisHints: this.analysisHints,
    };
  }

  getViewFor(viewer: PlayerId | 'spectator'): PublicState {
    return viewFor(viewer, this.getSnapshot());
  }

  getShopFor(playerId: PlayerId): ShopPayload | null {
    const s = this.shops[playerId];
    if (!s || !this.phaseDeadlineAt) return null;
    return {
      items: s.items,
      deadlineAt: this.phaseDeadlineAt,
      discount: s.discount,
      refreshCost: CFG.shopRefreshCost,
    };
  }

  getQuizFor(playerId: PlayerId): QuizPayload | null {
    const slot = this.quizSlots[playerId];
    if (!slot) return null;
    const oppId = this.getOpponent(playerId).id;
    return {
      qid: slot.qid,
      prompt: slot.prompt,
      options: slot.options,
      hiddenIndices: slot.hiddenIndices,
      deadlineAt: slot.deadlineAt,
      totalQuizMs: slot.durationMs,
      rerollDeadlineAt: slot.startedAt + CFG.rerollWindowSeconds * 1000,
      rerollAllowed:
        this.getPlayer(playerId).rerollsLeft > 0 && !slot.rerollLocked,
      difficultyShown: slot.difficultyShown,
      opponentUsedGroup4: this.preQuizGroup4Used[oppId],
    };
  }

  private pushPublicEvent(
    kind: GameEvent['kind'],
    message: string,
    extra?: Partial<GameEvent>
  ): void {
    const ev: GameEvent = {
      id: this.nextUid('ev'),
      at: this.nowFn(),
      kind,
      message,
      ...extra,
    };
    this.events.push(ev);
    if (this.events.length > 40) this.events.shift();
    this.hooks.onEvent?.('p1', ev);
    this.hooks.onEvent?.('p2', ev);
    this.hooks.onEvent?.('spectator', ev);
  }

  private reject(playerId: PlayerId, reason: string): boolean {
    this.hooks.onReject?.(playerId, reason);
    return false;
  }

  tick(nowMs: number = this.nowFn()): void {
    const delta = Math.max(0, nowMs - this.lastTickAt);
    this.lastTickAt = nowMs;

    if (this.phase === 'LOBBY' || this.phase === 'GAME_OVER') return;

    // Kiểm tra mất kết nối quá 60s
    for (const p of [this.p1, this.p2]) {
      if (!p.connected && p.disconnectedAt !== null) {
        if (nowMs - p.disconnectedAt >= CFG.reconnectGraceSeconds * 1000) {
          const opp = this.getOpponent(p.id);
          this.finishGame(opp.color, 'disconnect');
          return;
        }
      }
    }

    if (this.phase === 'PLAYING') {
      if (this.pendingHarmful && nowMs >= this.pendingHarmful.resolveAt) {
        this.resolvePendingHarmful(nowMs);
      }

      const activePlayer = this.getPlayerByColor(this.chess.getTurn());

      // Kiểm tra hết giờ thẻ Ép đi nhanh
      if (
        this.forceMove &&
        this.forceMove.target === activePlayer.id &&
        nowMs >= this.forceMove.deadlineAt
      ) {
        const res = applyForceMovePenalty(activePlayer.clockMs);
        activePlayer.clockMs = res.clockMs;
        this.forceMove = null;
        this.activeEffects = this.activeEffects.filter(
          (e) => !(e.cardId === 'time_force' && e.target === activePlayer.id)
        );
        this.pushPublicEvent(
          'force_timeout',
          `${activePlayer.name} quá hạn Ép đi nhanh (−${Math.round(res.deductedMs / 1000)}s)!`,
          { target: activePlayer.id }
        );
      }

      const ticked = tickClock(activePlayer.clockMs, delta, activePlayer.freezeRemainingMs);
      activePlayer.clockMs = ticked.clockMs;
      activePlayer.freezeRemainingMs = ticked.freezeRemainingMs;

      if (ticked.timedOut) {
        const winner = this.chess.resolveTimeoutWinner(activePlayer.color);
        this.finishGame(winner, 'timeout');
        return;
      }
      this.hooks.onStateChange?.();
      return;
    }

    if (this.phase === 'PRE_QUIZ') {
      if (this.pendingHarmful && nowMs >= this.pendingHarmful.resolveAt) {
        this.resolvePendingHarmful(nowMs);
      }
      if (
        !this.pendingHarmful &&
        ((this.phaseDeadlineAt !== null && nowMs >= this.phaseDeadlineAt) ||
          (this.preQuizPassed.p1 && this.preQuizPassed.p2))
      ) {
        this.enterQuizPhase(nowMs);
      }
      return;
    }

    if (this.phase === 'QUIZ') {
      let changed = false;
      for (const pid of ['p1', 'p2'] as PlayerId[]) {
        const slot = this.quizSlots[pid];
        if (!slot || slot.isCorrect !== null) continue;

        // Xử lý Đảo đáp án theo thời gian
        const elapsed = nowMs - slot.startedAt;
        if (
          slot.shufflesDone < slot.shuffleAtOffsetsMs.length &&
          elapsed >= slot.shuffleAtOffsetsMs[slot.shufflesDone] &&
          slot.choice === null
        ) {
          const meta = this.quizQuestionMeta[pid];
          if (meta) {
            const reshuffled = reshuffleExistingOptions(
              slot.options,
              slot.perm,
              slot.hiddenIndices,
              meta.answer,
              this.rng
            );
            slot.options = reshuffled.options;
            slot.perm = reshuffled.perm;
            slot.correctShownIndex = reshuffled.correctShownIndex;
            slot.hiddenIndices = reshuffled.hiddenIndices;
            slot.shufflesDone += 1;
            const qp = this.getQuizFor(pid);
            if (qp) this.hooks.onQuizUpdate?.(pid, qp);
            changed = true;
          }
        }

        if (nowMs >= slot.deadlineAt) {
          slot.choice = -1;
          slot.answeredAt = slot.deadlineAt;
          slot.isCorrect = false;
          changed = true;
        }
      }

      if (
        this.quizSlots.p1?.isCorrect !== null &&
        this.quizSlots.p2?.isCorrect !== null
      ) {
        this.enterResultPhase(nowMs);
      } else if (changed) {
        this.hooks.onStateChange?.();
      }
      return;
    }

    if (this.phase === 'RESULT') {
      if (this.phaseDeadlineAt !== null && nowMs >= this.phaseDeadlineAt) {
        this.enterShopPhase(nowMs);
      }
      return;
    }

    if (this.phase === 'SHOP') {
      const doneBoth = Boolean(this.shops.p1?.done && this.shops.p2?.done);
      if (doneBoth || (this.phaseDeadlineAt !== null && nowMs >= this.phaseDeadlineAt)) {
        this.exitShopToPlaying(nowMs);
      }
    }
  }

  handleMove(
    playerId: PlayerId,
    from: string,
    to: string,
    promo?: 'q' | 'r' | 'b' | 'n'
  ): boolean {
    if (this.phase !== 'PLAYING') {
      return this.reject(playerId, 'Hiện không ở trạng thái đi cờ');
    }
    if (this.pendingHarmful) {
      return this.reject(playerId, 'Chờ cửa sổ Lá chắn kết thúc');
    }

    const player = this.getPlayer(playerId);
    if (player.color !== this.chess.getTurn()) {
      return this.reject(playerId, 'Chưa tới lượt của bạn');
    }

    const res = this.chess.tryMove(from, to, promo);
    if (!res.ok) {
      return this.reject(playerId, res.error ?? 'Nước đi không hợp lệ');
    }

    const now = this.nowFn();
    this.ply += 1;
    this.lastMove = { from: res.from!, to: res.to! };
    player.moveCount += 1;
    player.cardsUsedThisTurn = 0;
    player.freezeRemainingMs = 0;
    if (player.harmfulCooldown > 0) player.harmfulCooldown -= 1;
    this.drawOfferBy = null;

    // Xóa khiên extra của đối thủ khi lượt này kết thúc
    const opp = this.getOpponent(playerId);
    this.shieldExtraCharges[opp.id] = 0;

    // Nếu người vừa đi đang chịu Ép đi nhanh thì hoàn thành đúng hạn
    if (this.forceMove && this.forceMove.target === playerId) {
      this.forceMove = null;
    }

    // Giảm TTL các hiệu ứng theo lượt của chính người đi
    this.activeEffects = tickEffectsAfterOwnerMove(this.activeEffects, playerId);
    this.analysisHints[playerId] = null;

    if (res.isGameOver) {
      this.finishGame(res.winner ?? 'draw', res.reason ?? 'checkmate');
      return true;
    }

    // Kích hoạt Ép đi nhanh cho đối thủ (lượt kế tiếp) nếu có hiệu ứng chờ
    this.activateForceMoveForCurrentTurn(now);

    // Cập nhật Stockfish analysis cho bên sắp đi nếu có sup_eval đang hiệu lực
    this.refreshSupportAnalysisForTurn();

    // Kiểm tra bộ đếm 3 nước
    const wPlayer = this.getPlayerByColor('w');
    const bPlayer = this.getPlayerByColor('b');
    const sched = advanceMoveCounter(
      wPlayer.sinceQuiz,
      bPlayer.sinceQuiz,
      player.color,
      false
    );
    wPlayer.sinceQuiz = sched.whiteSinceQuiz;
    bPlayer.sinceQuiz = sched.blackSinceQuiz;

    if (sched.triggerQuiz) {
      this.enterPreQuizPhase(now);
    } else {
      this.hooks.onStateChange?.();
    }
    return true;
  }

  private activateForceMoveForCurrentTurn(now: number): void {
    const turnPlayer = this.getPlayerByColor(this.chess.getTurn());
    const eff = this.activeEffects.find(
      (e) => e.cardId === 'time_force' && e.target === turnPlayer.id
    );
    if (!eff) return;

    const limitSec = Number(eff.data?.limitSec ?? 15);
    const limitMs = limitSec * 1000;
    if (turnPlayer.clockMs <= limitMs) {
      // Spec 4.2: Nếu đồng hồ đối thủ lúc đó <= X giây, thẻ vô hiệu
      this.activeEffects = this.activeEffects.filter((e) => e.uid !== eff.uid);
      this.pushPublicEvent(
        'info',
        `Ép đi nhanh vô hiệu vì đồng hồ ${turnPlayer.name} còn ít hơn ${limitSec}s.`
      );
      return;
    }

    this.forceMove = {
      target: turnPlayer.id,
      limitMs,
      startedAt: now,
      deadlineAt: now + limitMs,
    };
  }

  private refreshSupportAnalysisForTurn(): void {
    const fen = this.chess.getFen();
    for (const eff of this.activeEffects) {
      if (eff.cardId === 'sup_eval') {
        this.hooks.requestAnalysis?.(fen, eff.owner, 'eval', 12);
      }
    }
  }

  setAnalysisResult(
    owner: PlayerId,
    kind: 'hint' | 'cand' | 'eval',
    data: {
      bestMove?: { from: string; to: string };
      candidates?: { from: string; to: string }[];
      evalPawns?: number;
    }
  ): void {
    if (kind === 'eval' && typeof data.evalPawns === 'number') {
      const eff = this.activeEffects.find((e) => e.owner === owner && e.cardId === 'sup_eval');
      if (eff) {
        eff.data = { ...eff.data, evalPawns: data.evalPawns };
      }
    } else if (kind === 'hint' && data.bestMove) {
      this.analysisHints[owner] = {
        ...this.analysisHints[owner],
        bestMove: data.bestMove,
      };
    } else if (kind === 'cand' && data.candidates) {
      this.analysisHints[owner] = {
        ...this.analysisHints[owner],
        candidates: data.candidates,
      };
    }
    this.hooks.onStateChange?.();
  }

  private enterPreQuizPhase(now: number): void {
    this.phase = 'PRE_QUIZ';
    this.phaseDeadlineAt = now + CFG.preQuizSeconds * 1000;
    this.preQuizPassed = { p1: false, p2: false };
    this.preQuizGroup4Used = { p1: false, p2: false };
    this.weakTopicHints = { p1: null, p2: null };
    this.forceMove = null;
    this.pushPublicEvent('info', 'Đủ 3 nước mỗi bên! Chuẩn bị vào câu hỏi trắc nghiệm.');
    this.hooks.onStateChange?.();
  }

  handlePreQuizPass(playerId: PlayerId): boolean {
    if (this.phase !== 'PRE_QUIZ') return this.reject(playerId, 'Không ở giai đoạn Trước Quiz');
    this.preQuizPassed[playerId] = true;
    if (!this.pendingHarmful && this.preQuizPassed.p1 && this.preQuizPassed.p2) {
      this.enterQuizPhase(this.nowFn());
    } else {
      this.hooks.onStateChange?.();
    }
    return true;
  }

  private enterQuizPhase(now: number): void {
    this.phase = 'QUIZ';
    this.phaseDeadlineAt = null;
    this.totalQuizzes += 1;

    const allTopics = Array.from(new Set(this.bank.questions.map((q) => q.topic)));
    const baseQuestion = pickQuestion({
      pool: this.bank.questions,
      usedIds: this.usedQuestionIds,
      topicSeenCounts: this.topicSeenCounts,
      rng: this.rng,
    });
    if (!baseQuestion) {
      this.finishGame('draw', 'insufficient');
      return;
    }

    this.usedQuestionIds.add(baseQuestion.id);
    this.topicSeenCounts[baseQuestion.topic] =
      (this.topicSeenCounts[baseQuestion.topic] ?? 0) + 1;

    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const player = this.getPlayer(pid);
      const effs = this.activeEffects.filter((e) => e.target === pid);

      // Xác định câu hỏi riêng nếu bị Nâng độ khó / Ép chủ đề yếu
      const harderEff = effs.find((e) => e.cardId === 'q_harder');
      const weakEff = effs.find((e) => e.cardId === 'q_weak');
      let playerQuestion = baseQuestion;

      if (harderEff || weakEff) {
        const forcedTopic = weakEff
          ? getWeakestTopic(player.topicStats, allTopics, this.rng) ?? undefined
          : undefined;
        let forcedDifficulty: 1 | 2 | 3 | undefined;
        let minDifficultyBump = false;
        let bumpByOne = false;

        if (weakEff && weakEff.level >= 3) forcedDifficulty = 3;
        if (harderEff) {
          if (harderEff.level === 1) minDifficultyBump = true;
          else if (harderEff.level === 2) bumpByOne = true;
          else forcedDifficulty = 3;
        }

        const customQ = pickQuestion({
          pool: this.bank.questions,
          usedIds: this.usedQuestionIds,
          topicSeenCounts: this.topicSeenCounts,
          baseDifficulty: baseQuestion.difficulty,
          forcedDifficulty,
          minDifficultyBump,
          bumpByOne,
          forcedTopic,
          rng: this.rng,
        });
        if (customQ) {
          playerQuestion = customQ;
          this.usedQuestionIds.add(customQ.id);
        }
      }

      this.quizQuestionMeta[pid] = playerQuestion;
      const shuffled = shuffleOptions(playerQuestion, this.rng);

      // Giảm giờ hoặc tăng giờ (q_timecut vs q_hide M3/M4)
      const timecutEff = effs.find((e) => e.cardId === 'q_timecut');
      const hideEff = effs.find((e) => e.owner === pid && e.cardId === 'q_hide');

      let durationSec: number = timecutEff
        ? getCardLevel('q_timecut', timecutEff.level).value
        : CFG.quizSeconds;
      if (hideEff && hideEff.level >= 3) {
        durationSec += 5;
      }

      // Ẩn đáp án sai
      const hiddenIndices: number[] = [];
      if (hideEff) {
        const hideCount = hideEff.level === 1 ? 1 : 2;
        const wrongIndices = [0, 1, 2, 3].filter((i) => i !== shuffled.correctShownIndex);
        for (let k = 0; k < hideCount && wrongIndices.length > 0; k++) {
          const pickIdx = Math.floor(this.rng() * wrongIndices.length);
          hiddenIndices.push(wrongIndices.splice(pickIdx, 1)[0]);
        }
      }

      // Đảo đáp án
      const shuffleEff = effs.find((e) => e.cardId === 'q_shuffle');
      let shuffleAtOffsetsMs: number[] = [];
      if (shuffleEff) {
        if (shuffleEff.level === 1) shuffleAtOffsetsMs = [8000];
        else if (shuffleEff.level === 2) shuffleAtOffsetsMs = [5000];
        else if (shuffleEff.level === 3) shuffleAtOffsetsMs = [3000];
        else shuffleAtOffsetsMs = [3000, 8000];
      }

      const lockRerollEff = effs.find((e) => e.cardId === 'q_lockreroll');
      const durationMs = durationSec * 1000;

      this.quizSlots[pid] = {
        qid: playerQuestion.id,
        prompt: playerQuestion.question,
        topic: playerQuestion.topic,
        difficulty: playerQuestion.difficulty,
        options: shuffled.options,
        perm: shuffled.perm,
        correctShownIndex: shuffled.correctShownIndex,
        hiddenIndices,
        durationMs,
        startedAt: now,
        deadlineAt: now + durationMs,
        shuffleAtOffsetsMs,
        shufflesDone: 0,
        rerollLocked: Boolean(lockRerollEff),
        difficultyShown: hideEff && hideEff.level >= 4 ? playerQuestion.difficulty : undefined,
        choice: null,
        answeredAt: null,
        isCorrect: null,
      };

      const payload = this.getQuizFor(pid);
      if (payload) this.hooks.onQuizStart?.(pid, payload);
    }

    // Khán giả nhận câu hỏi gốc (không đáp án)
    const specSlot = this.quizSlots.p1;
    if (specSlot) {
      this.hooks.onQuizStart?.('spectator', {
        qid: baseQuestion.id,
        prompt: baseQuestion.question,
        options: baseQuestion.options,
        hiddenIndices: [],
        deadlineAt: now + CFG.quizSeconds * 1000,
        totalQuizMs: CFG.quizSeconds * 1000,
        rerollDeadlineAt: now,
        rerollAllowed: false,
      });
    }

    // Kích hoạt Flash đã đặt từ PRE_QUIZ
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const cnt = this.pendingFlashForQuiz[pid];
      if (cnt > 0) {
        this.pendingFlashForQuiz[pid] = 0;
        const flashEv: GameEvent = {
          id: this.nextUid('ev'),
          at: now,
          kind: 'flash',
          message: `💥 ${this.getOpponent(pid).name} tung Flash (${cnt} lần)!`,
          target: pid,
          by: this.getOpponent(pid).id,
          flashCount: cnt,
        };
        this.events.push(flashEv);
        this.hooks.onEvent?.(pid, flashEv);
        this.hooks.onEvent?.(this.getOpponent(pid).id, flashEv);
      }
    }

    this.hooks.onStateChange?.();
  }

  handleQuizAnswer(playerId: PlayerId, qid: string, choice: number): boolean {
    if (this.phase !== 'QUIZ') return this.reject(playerId, 'Không trong thời gian trả lời');
    const slot = this.quizSlots[playerId];
    if (!slot || slot.qid !== qid) return this.reject(playerId, 'Câu hỏi không khớp');
    if (slot.isCorrect !== null) return this.reject(playerId, 'Bạn đã trả lời câu này rồi');
    if (slot.hiddenIndices.includes(choice)) return this.reject(playerId, 'Đáp án này đã bị ẩn');

    const now = this.nowFn();
    if (now > slot.deadlineAt) {
      slot.choice = -1;
      slot.answeredAt = slot.deadlineAt;
      slot.isCorrect = false;
    } else {
      slot.choice = choice;
      slot.answeredAt = now;
      slot.isCorrect = gradeAnswer(slot.correctShownIndex, choice);
    }

    if (
      this.quizSlots.p1?.isCorrect !== null &&
      this.quizSlots.p2?.isCorrect !== null
    ) {
      this.enterResultPhase(now);
    } else {
      this.hooks.onStateChange?.();
    }
    return true;
  }

  handleReroll(playerId: PlayerId): boolean {
    if (this.phase !== 'QUIZ') return this.reject(playerId, 'Không thể đổi câu lúc này');
    const player = this.getPlayer(playerId);
    const slot = this.quizSlots[playerId];
    if (!slot) return false;
    if (slot.isCorrect !== null) return this.reject(playerId, 'Bạn đã trả lời rồi');
    if (player.rerollsLeft <= 0) return this.reject(playerId, 'Bạn đã hết lượt Đổi câu trong ván');
    if (slot.rerollLocked) return this.reject(playerId, 'Đổi câu đã bị khóa bởi thẻ đối thủ');

    const now = this.nowFn();
    if (now > slot.startedAt + CFG.rerollWindowSeconds * 1000) {
      return this.reject(playerId, 'Đã quá 3 giây đầu để đổi câu');
    }

    const alt = pickQuestion({
      pool: this.bank.questions,
      usedIds: this.usedQuestionIds,
      topicSeenCounts: this.topicSeenCounts,
      forcedDifficulty: slot.difficulty,
      rng: this.rng,
    });
    if (!alt) return this.reject(playerId, 'Không còn câu dự phòng cùng độ khó');

    player.rerollsLeft -= 1;
    this.usedQuestionIds.add(alt.id);
    this.quizQuestionMeta[playerId] = alt;

    const shuffled = shuffleOptions(alt, this.rng);
    const hideEff = this.activeEffects.find(
      (e) => e.owner === playerId && e.cardId === 'q_hide'
    );
    const hiddenIndices: number[] = [];
    if (hideEff) {
      const hideCount = hideEff.level === 1 ? 1 : 2;
      const wrongIndices = [0, 1, 2, 3].filter((i) => i !== shuffled.correctShownIndex);
      for (let k = 0; k < hideCount && wrongIndices.length > 0; k++) {
        const pickIdx = Math.floor(this.rng() * wrongIndices.length);
        hiddenIndices.push(wrongIndices.splice(pickIdx, 1)[0]);
      }
    }

    slot.qid = alt.id;
    slot.prompt = alt.question;
    slot.topic = alt.topic;
    slot.difficulty = alt.difficulty;
    slot.options = shuffled.options;
    slot.perm = shuffled.perm;
    slot.correctShownIndex = shuffled.correctShownIndex;
    slot.hiddenIndices = hiddenIndices;
    // Đồng hồ trả lời KHÔNG reset theo spec 3.4

    const qp = this.getQuizFor(playerId);
    if (qp) this.hooks.onQuizUpdate?.(playerId, qp);
    this.hooks.onStateChange?.();
    return true;
  }

  private enterResultPhase(now: number): void {
    this.phase = 'RESULT';
    this.phaseDeadlineAt = now + CFG.resultSeconds * 1000;

    const s1 = this.quizSlots.p1!;
    const s2 = this.quizSlots.p2!;
    const p1Correct = Boolean(s1.isCorrect);
    const p2Correct = Boolean(s2.isCorrect);

    const outcomes: Record<PlayerId, QuizOutcome> = {
      p1: this.scorePlayerQuiz(this.p1, s1, p1Correct && !p2Correct ? false : !p1Correct && p2Correct),
      p2: this.scorePlayerQuiz(this.p2, s2, p2Correct && !p1Correct ? false : !p2Correct && p1Correct),
    };

    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const slot = this.quizSlots[pid]!;
      const meta = this.quizQuestionMeta[pid];
      const you = outcomes[pid];
      const oppPid = this.getOpponent(pid).id;
      const oppOut = outcomes[oppPid];

      this.hooks.onResult?.(pid, {
        correctIndex: slot.correctShownIndex,
        explain: meta?.explain,
        you,
        opp: {
          isCorrect: oppOut.isCorrect,
          answeredInMs: oppOut.answeredInMs,
          timePenaltySec: oppOut.timePenaltySec,
        },
      });
    }

    this.activeEffects = tickEffectsAfterQuiz(this.activeEffects);
    this.hooks.onStateChange?.();
  }

  private scorePlayerQuiz(
    player: PlayerState,
    slot: PlayerQuizSlot,
    sufferWrongPenalty: boolean
  ): QuizOutcome {
    const isCorrect = Boolean(slot.isCorrect);
    const answeredInMs =
      slot.answeredAt !== null ? Math.max(0, slot.answeredAt - slot.startedAt) : null;

    player.topicStats = recordTopicAnswer(player.topicStats, slot.topic, isCorrect);
    if (isCorrect) this.quizCorrectCount[player.id] += 1;

    const baseEarned = calcQuizCoins(
      slot.difficulty,
      answeredInMs ?? slot.durationMs,
      slot.durationMs,
      isCorrect
    );
    const st = updateStreak(player.streak, player.streak5Granted, isCorrect);
    player.streak = st.streak;
    player.streak5Granted = st.streak5Granted;
    if (st.grantShopDiscount) {
      player.pendingShopDiscount = Math.max(player.pendingShopDiscount, CFG.streak3Discount);
    }

    const totalEarned = baseEarned + st.bonusCoins;
    player.coins += totalEarned;
    this.totalCoinsEarned[player.id] += totalEarned;

    let timePenaltySec = 0;
    if (sufferWrongPenalty) {
      const pen = applyTimePenalty(player.clockMs, CFG.wrongPenaltySeconds, 1);
      player.clockMs = pen.clockMs;
      timePenaltySec = Math.round(pen.deductedMs / 1000);
    }

    if (st.grantFreeM2Choice) {
      // Chọn 3 thẻ ngẫu nhiên cho phần thưởng streak 5
      const allIds = Object.keys(this.getAllCardIdsMap());
      const picks: string[] = [];
      const pool = [...allIds];
      while (picks.length < 3 && pool.length > 0) {
        const idx = Math.floor(this.rng() * pool.length);
        picks.push(pool.splice(idx, 1)[0]);
      }
      this.freeM2Choices[player.id] = {
        options: picks.map((cardId) => ({ cardId, level: 2 })),
      };
    }

    return {
      isCorrect,
      coinsEarned: baseEarned,
      streakBonusCoins: st.bonusCoins,
      newStreak: player.streak,
      timePenaltySec,
      answeredInMs,
      grantedFreeM2: st.grantFreeM2Choice,
    };
  }

  private getAllCardIdsMap(): Record<string, true> {
    return {
      time_plus: true, time_minus: true, time_force: true, time_freeze: true,
      sup_radar: true, sup_hint: true, sup_cand: true, sup_scan: true, sup_eval: true, sup_plan: true,
      peek_vault: true, peek_track: true, peek_history: true, peek_coins: true, peek_shop: true,
      q_timecut: true, q_harder: true, q_weak: true, q_lockreroll: true, q_shuffle: true, q_hide: true, q_flash: true, q_shield: true,
    };
  }

  handleChooseFreeM2(playerId: PlayerId, cardId: string): boolean {
    const choice = this.freeM2Choices[playerId];
    if (!choice) return this.reject(playerId, 'Không có thẻ miễn phí đang chờ');
    if (!choice.options.some((o) => o.cardId === cardId)) {
      return this.reject(playerId, 'Thẻ không nằm trong lựa chọn');
    }
    const player = this.getPlayer(playerId);
    if (player.hand.length >= CFG.handMax) {
      return this.reject(playerId, 'Kho thẻ đang đầy (hãy bỏ 1 thẻ trước)');
    }
    player.hand.push({ uid: this.nextUid('card'), cardId, level: 2 });
    this.freeM2Choices[playerId] = null;
    this.hooks.onStateChange?.();
    return true;
  }

  private enterShopPhase(now: number): void {
    this.phase = 'SHOP';
    this.phaseDeadlineAt = now + CFG.shopSeconds * 1000;

    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const player = this.getPlayer(pid);
      const opp = this.getOpponent(pid);
      const discount = computeShopDiscount(
        player.clockMs,
        opp.clockMs,
        player.pendingShopDiscount > 0
      );
      const gen = generateShopItems({
        prevShopGroups: this.prevShopGroups[pid],
        usedCount: player.usedCount,
        flashUsed: player.flashUsed,
        discount,
        rng: this.rng,
      });
      this.prevShopGroups[pid] = gen.groupsPresent;
      this.shops[pid] = {
        items: gen.items,
        discount,
        done: false,
        boughtNames: [],
      };
      const payload = this.getShopFor(pid);
      if (payload) this.hooks.onShopStart?.(pid, payload);
    }
    this.hooks.onStateChange?.();
  }

  handleBuyCard(playerId: PlayerId, slotIdx: number): boolean {
    if (this.phase !== 'SHOP') return this.reject(playerId, 'Shop hiện đang đóng');
    const shop = this.shops[playerId];
    const player = this.getPlayer(playerId);
    if (!shop) return false;
    const item = shop.items.find((i) => i.slot === slotIdx);
    if (!item || item.bought) return this.reject(playerId, 'Thẻ này đã được mua hoặc không tồn tại');
    if (player.coins < item.finalPrice) return this.reject(playerId, 'Không đủ xu');
    if (player.hand.length >= CFG.handMax) {
      return this.reject(playerId, 'Kho thẻ đầy (tối đa 3 thẻ) — hãy bấm bỏ 1 thẻ trước');
    }
    if ((player.usedCount[item.cardId] ?? 0) >= CFG.maxCardsPerTypePerGame) {
      return this.reject(playerId, 'Đã đạt giới hạn thẻ này trong ván');
    }

    player.coins -= item.finalPrice;
    item.bought = true;
    const def = getCardDef(item.cardId);
    shop.boughtNames.push(`${def.name} ★${item.level}`);
    player.hand.push({
      uid: this.nextUid('card'),
      cardId: item.cardId,
      level: item.level,
    });

    const payload = this.getShopFor(playerId);
    if (payload) this.hooks.onShopStart?.(playerId, payload);
    this.hooks.onStateChange?.();
    return true;
  }

  handleDropCard(playerId: PlayerId, uid: string): boolean {
    const player = this.getPlayer(playerId);
    const idx = player.hand.findIndex((c) => c.uid === uid);
    if (idx === -1) return this.reject(playerId, 'Không tìm thấy thẻ trong kho');
    player.hand.splice(idx, 1);
    this.hooks.onStateChange?.();
    return true;
  }

  handleShopRefresh(playerId: PlayerId): boolean {
    if (this.phase !== 'SHOP') return this.reject(playerId, 'Shop hiện đang đóng');
    const shop = this.shops[playerId];
    const player = this.getPlayer(playerId);
    if (!shop) return false;
    if (player.coins < CFG.shopRefreshCost) {
      return this.reject(playerId, `Cần ${CFG.shopRefreshCost} xu để làm mới`);
    }

    player.coins -= CFG.shopRefreshCost;
    const gen = generateShopItems({
      prevShopGroups: this.prevShopGroups[playerId],
      usedCount: player.usedCount,
      flashUsed: player.flashUsed,
      discount: shop.discount,
      rng: this.rng,
    });
    this.prevShopGroups[playerId] = gen.groupsPresent;
    shop.items = gen.items;

    const payload = this.getShopFor(playerId);
    if (payload) this.hooks.onShopStart?.(playerId, payload);
    this.hooks.onStateChange?.();
    return true;
  }

  handleShopDone(playerId: PlayerId): boolean {
    if (this.phase !== 'SHOP') return this.reject(playerId, 'Shop hiện đang đóng');
    const shop = this.shops[playerId];
    if (!shop) return false;
    shop.done = true;
    if (this.shops.p1?.done && this.shops.p2?.done) {
      this.exitShopToPlaying(this.nowFn());
    } else {
      this.hooks.onStateChange?.();
    }
    return true;
  }

  private exitShopToPlaying(now: number): void {
    this.p1.pendingShopDiscount = 0;
    this.p2.pendingShopDiscount = 0;
    this.activeEffects = tickEffectsAfterShop(this.activeEffects);
    this.phase = 'PLAYING';
    this.phaseDeadlineAt = null;
    this.lastTickAt = now;
    this.activateForceMoveForCurrentTurn(now);
    this.refreshSupportAnalysisForTurn();
    this.hooks.onStateChange?.();
  }

  handleUseCard(playerId: PlayerId, uid: string): boolean {
    const player = this.getPlayer(playerId);
    const opp = this.getOpponent(playerId);
    const cardIdx = player.hand.findIndex((c) => c.uid === uid);
    if (cardIdx === -1) return this.reject(playerId, 'Không có thẻ này trong kho');
    const card = player.hand[cardIdx];
    const def = getCardDef(card.cardId);

    if (def.id === 'q_shield') {
      return this.handleShield(playerId, uid);
    }

    const check = canUseCard({
      phase: this.phase,
      currentTurnColor: this.chess.getTurn(),
      player,
      card,
      pendingHarmful: this.pendingHarmful,
      preQuizGroup4Used: this.preQuizGroup4Used[playerId],
      hasActiveShieldCharge: this.shieldExtraCharges[playerId] > 0,
    });
    if (!check.ok) {
      return this.reject(playerId, check.reason ?? 'Không thể dùng thẻ');
    }

    // Tiêu hao thẻ khỏi kho và ghi nhận lịch sử
    player.hand.splice(cardIdx, 1);
    player.usedCount[def.id] = (player.usedCount[def.id] ?? 0) + 1;
    this.totalCardsUsed[playerId] += 1;
    player.history.push({
      cardId: def.id,
      level: card.level,
      name: def.name,
      group: def.group,
      atPly: this.ply,
      atClockMs: player.clockMs,
    });

    if (this.phase === 'PRE_QUIZ' && def.group === 'quiz') {
      this.preQuizGroup4Used[playerId] = true;
    } else if (this.phase === 'PLAYING') {
      player.cardsUsedThisTurn += 1;
    }

    if (def.id === 'q_flash') {
      player.flashUsed += 1;
    }

    // Kiểm tra xem đối thủ có đang bật Theo dõi (peek_track) không
    const oppTrack = this.activeEffects.find(
      (e) => e.owner === opp.id && e.cardId === 'peek_track'
    );
    const groupLabel =
      def.group === 'time'
        ? 'Thời gian'
        : def.group === 'support'
          ? 'Hỗ trợ'
          : def.group === 'peek'
            ? 'Xem thẻ'
            : 'Tác động quiz';

    const isCardHarmful = def.harmful && !(def.id === 'q_weak' && card.level === 1);

    if (isCardHarmful) {
      player.harmfulCooldown = CFG.harmfulCooldownPlies;
      const now = this.nowFn();
      this.pendingHarmful = {
        uid: this.nextUid('pend'),
        cardId: def.id,
        level: card.level,
        caster: playerId,
        target: opp.id,
        group: def.group,
        startedAt: now,
        resolveAt: now + CFG.harmfulPendingSeconds * 1000,
      };
      this.pushPublicEvent(
        'card_pending',
        oppTrack
          ? `${player.name} tung ${def.name}${oppTrack.level === 4 ? ` ★${card.level}` : ''}! (${CFG.harmfulPendingSeconds}s để dùng Lá chắn)`
          : `${player.name} vừa dùng 1 thẻ [${groupLabel}]… (${CFG.harmfulPendingSeconds}s chờ Lá chắn)`,
        { by: playerId, target: opp.id, group: def.group }
      );
      this.hooks.onStateChange?.();
      return true;
    }

    // Thẻ không gây hại: áp dụng ngay
    this.applyNonHarmfulCard(player, opp, card);
    this.pushPublicEvent(
      'card_applied',
      oppTrack
        ? `${player.name} đã dùng ${def.name}${oppTrack.level === 4 ? ` ★${card.level}` : ''}.`
        : `${player.name} đã dùng 1 thẻ [${groupLabel}].`,
      { by: playerId, group: def.group }
    );
    this.hooks.onStateChange?.();
    return true;
  }

  handleShield(playerId: PlayerId, uid?: string): boolean {
    const pend = this.pendingHarmful;
    if (!pend || pend.target !== playerId) {
      return this.reject(playerId, 'Không có thẻ gây hại nào đang chờ chặn');
    }
    if (pend.reflected) {
      return this.reject(playerId, 'Không thể chặn thẻ đã bị phản lại');
    }

    const player = this.getPlayer(playerId);
    const caster = this.getPlayer(pend.caster);
    let shieldLevel: 1 | 2 | 3 | 4 = 1;

    if (uid) {
      const idx = player.hand.findIndex((c) => c.uid === uid && c.cardId === 'q_shield');
      if (idx === -1) return this.reject(playerId, 'Không có thẻ Lá chắn hợp lệ');
      const card = player.hand.splice(idx, 1)[0];
      shieldLevel = card.level;
      player.usedCount['q_shield'] = (player.usedCount['q_shield'] ?? 0) + 1;
      this.totalCardsUsed[playerId] += 1;
      player.history.push({
        cardId: 'q_shield',
        level: shieldLevel,
        name: 'Lá chắn',
        group: 'quiz',
        atPly: this.ply,
        atClockMs: player.clockMs,
      });
    } else if (canUseExtraShieldCharge(playerId, pend, this.shieldExtraCharges[playerId])) {
      this.shieldExtraCharges[playerId] -= 1;
      shieldLevel = 1;
    } else {
      const idx = player.hand.findIndex((c) => c.cardId === 'q_shield');
      if (idx === -1) return this.reject(playerId, 'Bạn không có thẻ Lá chắn');
      const card = player.hand.splice(idx, 1)[0];
      shieldLevel = card.level;
      player.usedCount['q_shield'] = (player.usedCount['q_shield'] ?? 0) + 1;
      this.totalCardsUsed[playerId] += 1;
    }

    const canceledCardId = pend.cardId;
    const canceledLevel = pend.level;
    this.pendingHarmful = null;

    if (shieldLevel === 2) {
      const pen = applyTimePenalty(caster.clockMs, 5, 1);
      caster.clockMs = pen.clockMs;
      this.pushPublicEvent(
        'card_blocked',
        `🛡️ ${player.name} dùng Lá chắn ★2 chặn thẻ và trừ ${caster.name} 5s!`
      );
    } else if (shieldLevel === 3) {
      this.shieldExtraCharges[playerId] += 1;
      this.pushPublicEvent(
        'card_blocked',
        `🛡️ ${player.name} dùng Lá chắn ★3 chặn thẻ và giữ thêm 1 lần khiên trong lượt!`
      );
    } else if (shieldLevel === 4) {
      this.pushPublicEvent(
        'card_reflected',
        `🛡️ ${player.name} dùng Lá chắn ★4 phản ngược thẻ về ${caster.name}!`
      );
      this.applyHarmfulCard(canceledCardId, canceledLevel, player, caster);
    } else {
      this.pushPublicEvent('card_blocked', `🛡️ ${player.name} đã dùng Lá chắn hủy thẻ đối phương!`);
    }

    this.hooks.onStateChange?.();
    return true;
  }

  private resolvePendingHarmful(now: number): void {
    const pend = this.pendingHarmful;
    if (!pend) return;
    this.pendingHarmful = null;
    const caster = this.getPlayer(pend.caster);
    const target = this.getPlayer(pend.target);
    this.applyHarmfulCard(pend.cardId, pend.level, caster, target, now);
    this.hooks.onStateChange?.();
  }

  private applyHarmfulCard(
    cardId: string,
    level: 1 | 2 | 3 | 4,
    caster: PlayerState,
    target: PlayerState,
    now: number = this.nowFn()
  ): void {
    const lvl = getCardLevel(cardId, level);
    if (cardId === 'time_minus') {
      const pen = applyTimePenalty(target.clockMs, lvl.value, CFG.clockFloorSeconds);
      target.clockMs = pen.clockMs;
      this.pushPublicEvent(
        'card_applied',
        `⌛ ${target.name} bị trừ ${Math.round(pen.deductedMs / 1000)}s đồng hồ!`
      );
      return;
    }

    if (cardId === 'q_flash') {
      if (this.phase === 'PRE_QUIZ') {
        this.pendingFlashForQuiz[target.id] = Math.max(
          this.pendingFlashForQuiz[target.id],
          lvl.value
        );
        this.pushPublicEvent(
          'card_applied',
          `💥 ${caster.name} đã cài Flash ★${level} cho câu hỏi sắp tới!`
        );
      } else {
        const flashEv: GameEvent = {
          id: this.nextUid('ev'),
          at: now,
          kind: 'flash',
          message: `💥 ${caster.name} tung Flash (${lvl.value} lần)!`,
          target: target.id,
          by: caster.id,
          flashCount: lvl.value,
        };
        this.events.push(flashEv);
        this.hooks.onEvent?.(target.id, flashEv);
        this.hooks.onEvent?.(caster.id, flashEv);
      }
      return;
    }

    const eff = buildCardEffect(
      this.nextUid('eff'),
      cardId,
      level,
      caster.id,
      target.id
    );
    if (eff) {
      this.activeEffects = upsertEffect(this.activeEffects, eff);
    }
    this.pushPublicEvent(
      'card_applied',
      `${getCardDef(cardId).icon} Thẻ tác động lên ${target.name} đã có hiệu lực.`
    );
  }

  private applyNonHarmfulCard(
    caster: PlayerState,
    opp: PlayerState,
    card: HeldCard
  ): void {
    const lvl = getCardLevel(card.cardId, card.level);

    if (card.cardId === 'time_plus') {
      const res = applyTimeBonus(
        caster.clockMs,
        lvl.value,
        caster.bonusTimeGivenMs,
        this.clockSeconds
      );
      caster.clockMs = res.clockMs;
      caster.bonusTimeGivenMs = res.bonusTimeGivenMs;
      return;
    }

    if (card.cardId === 'time_freeze') {
      caster.freezeRemainingMs += lvl.value * 1000;
      return;
    }

    if (card.cardId === 'q_weak' && card.level === 1) {
      const topics = Array.from(new Set(this.bank.questions.map((q) => q.topic)));
      this.weakTopicHints[caster.id] =
        getWeakestTopic(opp.topicStats, topics, this.rng) ?? 'Chưa rõ';
      return;
    }

    let extraData: Record<string, unknown> | undefined;

    if (card.cardId === 'peek_vault' && card.level <= 3) {
      const oppNames = opp.hand.map((h) => getCardDef(h.cardId).name);
      let sampled: string[] = [];
      if (card.level === 3) {
        sampled = oppNames;
      } else {
        const pool = [...oppNames];
        const take = Math.min(lvl.value, pool.length);
        for (let i = 0; i < take; i++) {
          const idx = Math.floor(this.rng() * pool.length);
          sampled.push(pool.splice(idx, 1)[0]);
        }
      }
      extraData = { snapshot: sampled.map((name) => ({ name })) };
    } else if (card.cardId === 'peek_history') {
      const recent = opp.history.slice(-lvl.value);
      extraData = { items: recent };
    }

    const eff = buildCardEffect(
      this.nextUid('eff'),
      card.cardId,
      card.level,
      caster.id,
      opp.id,
      extraData
    );
    if (eff) {
      this.activeEffects = upsertEffect(this.activeEffects, eff);
    }

    // Kích hoạt Stockfish bất đồng bộ nếu là Gợi ý / Ứng viên / Đánh giá
    if (card.cardId === 'sup_hint') {
      this.hooks.requestAnalysis?.(this.chess.getFen(), caster.id, 'hint', lvl.value);
    } else if (card.cardId === 'sup_cand') {
      this.hooks.requestAnalysis?.(this.chess.getFen(), caster.id, 'cand', lvl.value);
    } else if (card.cardId === 'sup_eval') {
      this.hooks.requestAnalysis?.(this.chess.getFen(), caster.id, 'eval', 12);
    }
  }

  handleResign(playerId: PlayerId): boolean {
    if (this.phase === 'LOBBY' || this.phase === 'GAME_OVER') return false;
    const opp = this.getOpponent(playerId);
    this.finishGame(opp.color, 'resign');
    return true;
  }

  handleDrawOffer(playerId: PlayerId): boolean {
    if (this.phase !== 'PLAYING') return this.reject(playerId, 'Chỉ cầu hòa khi đang chơi cờ');
    const player = this.getPlayer(playerId);
    if (player.moveCount < player.drawOfferCooldownUntilMove) {
      return this.reject(playerId, 'Mỗi 3 nước chỉ được cầu hòa 1 lần');
    }
    player.drawOfferCooldownUntilMove = player.moveCount + CFG.movesPerQuiz;
    this.drawOfferBy = playerId;
    this.pushPublicEvent('info', `${player.name} đề nghị hòa.`);
    this.hooks.onStateChange?.();
    return true;
  }

  handleDrawReply(playerId: PlayerId, accept: boolean): boolean {
    if (!this.drawOfferBy || this.drawOfferBy === playerId) return false;
    this.drawOfferBy = null;
    if (accept) {
      this.finishGame('draw', 'draw_agreement');
    } else {
      this.pushPublicEvent('info', `${this.getPlayer(playerId).name} từ chối cầu hòa.`);
      this.hooks.onStateChange?.();
    }
    return true;
  }

  private finishGame(winner: Color | 'draw', reason: GameOverInfo['reason']): void {
    this.phase = 'GAME_OVER';
    this.phaseDeadlineAt = null;
    this.pendingHarmful = null;
    this.forceMove = null;
    this.gameOverInfo = {
      winner,
      reason,
      stats: {
        p1: {
          name: this.p1.name,
          color: this.p1.color,
          quizCorrect: this.quizCorrectCount.p1,
          quizTotal: this.totalQuizzes,
          totalCoins: this.totalCoinsEarned.p1,
          cardsUsed: this.totalCardsUsed.p1,
        },
        p2: {
          name: this.p2.name,
          color: this.p2.color,
          quizCorrect: this.quizCorrectCount.p2,
          quizTotal: this.totalQuizzes,
          totalCoins: this.totalCoinsEarned.p2,
          cardsUsed: this.totalCardsUsed.p2,
        },
        totalQuizzes: this.totalQuizzes,
        totalPlies: this.ply,
      },
    };
    this.hooks.onGameOver?.(this.gameOverInfo);
    this.hooks.onStateChange?.();
  }
}
