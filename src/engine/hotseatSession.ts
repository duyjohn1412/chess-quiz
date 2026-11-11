import { stockfishService } from '../analysis/stockfishWorker';
import { GameCoordinator } from './gameCoordinator';
import { QuizPayload, ResultPayload, ShopPayload } from '../net/protocol';
import { GameEvent, GameOverInfo, PlayerId, PublicState, QuestionBank } from '../types/game';

export interface HotseatCallbacks {
  onState: (state: PublicState, suggestedActor: PlayerId, activeViewer: PlayerId) => void;
  onQuiz: (playerId: PlayerId, quiz: QuizPayload | null) => void;
  onResult: (playerId: PlayerId, res: ResultPayload | null) => void;
  onShop: (playerId: PlayerId, shop: ShopPayload | null) => void;
  onEvent: (playerId: PlayerId, ev: GameEvent) => void;
  onReject: (reason: string) => void;
  onGameOver: (info: GameOverInfo) => void;
}

export class HotseatSession {
  readonly coordinator: GameCoordinator;
  private callbacks: HotseatCallbacks;
  private tickTimer: number | null = null;
  private paused = false;
  private activeViewer: PlayerId = 'p1';

  constructor(
    p1Name: string,
    p2Name: string,
    clockSeconds: 180 | 300 | 600,
    bank: QuestionBank,
    callbacks: HotseatCallbacks
  ) {
    this.callbacks = callbacks;
    this.coordinator = new GameCoordinator({
      clockSeconds,
      bank,
      p1Name,
      p2Name,
      hooks: {
        onStateChange: () => {
          this.emitViewerState();
        },
        onQuizStart: (target, quiz) => {
          if (target === 'p1' || target === 'p2') this.callbacks.onQuiz(target, quiz);
        },
        onQuizUpdate: (target, quiz) => {
          this.callbacks.onQuiz(target, quiz);
        },
        onResult: (target, res) => {
          this.callbacks.onResult(target, res);
        },
        onShopStart: (target, shop) => {
          this.callbacks.onShop(target, shop);
        },
        onEvent: (target, ev) => {
          if (target === 'p1' || target === 'p2') this.callbacks.onEvent(target, ev);
        },
        onReject: (_target, reason) => {
          this.callbacks.onReject(reason);
        },
        onGameOver: (info) => {
          this.callbacks.onGameOver(info);
        },
        requestAnalysis: (fen, owner, kind, param) => {
          void this.runAnalysis(fen, owner, kind, param);
        },
      },
    });
  }

  getActiveViewer(): PlayerId {
    return this.activeViewer;
  }

  setActiveViewer(pid: PlayerId): void {
    this.activeViewer = pid;
    this.emitViewerState();
  }

  setPaused(paused: boolean, unlockFor?: PlayerId): void {
    this.paused = paused;
    if (!paused && unlockFor) {
      this.activeViewer = unlockFor;
      this.coordinator.reanchorHotseatTurn(unlockFor, Date.now());
    }
  }

  private emitViewerState(): void {
    const suggested = this.coordinator.getHotseatNextActor();
    this.callbacks.onState(
      this.coordinator.getViewFor(this.activeViewer),
      suggested,
      this.activeViewer
    );
  }

  private async runAnalysis(
    fen: string,
    owner: PlayerId,
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

  start(): void {
    this.coordinator.startGame();
    this.activeViewer = this.coordinator.getHotseatNextActor();
    this.emitViewerState();
    this.tickTimer = window.setInterval(() => {
      if (!this.paused) {
        this.coordinator.tick();
      }
    }, 100);
  }

  destroy(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }
}
