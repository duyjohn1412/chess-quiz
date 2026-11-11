import { CardGroup, CardLevel } from '../cards/registry';

export type Color = 'w' | 'b';
export type PlayerId = 'p1' | 'p2';
export type GamePhase =
  | 'LOBBY'
  | 'PLAYING'
  | 'PRE_QUIZ'
  | 'QUIZ'
  | 'RESULT'
  | 'SHOP'
  | 'GAME_OVER';

export interface HeldCard {
  uid: string;
  cardId: string;
  level: CardLevel;
}

export interface UsedCardLog {
  cardId: string;
  level: CardLevel;
  name: string;
  group: CardGroup;
  atPly: number;
  atClockMs: number;
}

export interface TopicStat {
  asked: number;
  wrong: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  elo?: number;
  color: Color;
  clockMs: number;
  freezeRemainingMs: number;
  coins: number;
  streak: number;
  streak5Granted: boolean;
  pendingShopDiscount: number; // e.g. 0.2 from streak-3
  hand: HeldCard[];
  usedCount: Record<string, number>;
  history: UsedCardLog[];
  rerollsLeft: number;
  flashUsed: number;
  moveCount: number;
  sinceQuiz: number;
  harmfulCooldown: number; // in plies of this player
  cardsUsedThisTurn: number;
  bonusTimeGivenMs: number;
  drawOfferCooldownUntilMove: number;
  topicStats: Record<string, TopicStat>;
  connected: boolean;
  disconnectedAt: number | null;
  ready: boolean;
}

export type EffectExpires =
  | { type: 'owner-plies'; n: number }
  | { type: 'shops'; n: number }
  | { type: 'quizzes'; n: number }
  | { type: 'next-turn-of'; playerId: PlayerId }
  | { type: 'until-end-turn'; playerId: PlayerId };

export interface ActiveEffect {
  uid: string;
  cardId: string;
  level: CardLevel;
  owner: PlayerId;
  target: PlayerId | null;
  kind: string;
  expires: EffectExpires;
  data?: Record<string, unknown>;
}

export interface PendingHarmful {
  uid: string;
  cardId: string;
  level: CardLevel;
  caster: PlayerId;
  target: PlayerId;
  group: CardGroup;
  startedAt: number;
  resolveAt: number;
  reflected?: boolean;
}

export interface Question {
  id: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  question: string;
  options: [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  explain?: string;
  source?: string;
  status: 'verified' | 'draft' | 'needs_review';
}

export interface QuestionBank {
  bank: string;
  title: string;
  version: number;
  questions: Question[];
}

export interface PlayerQuizSlot {
  qid: string;
  prompt: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  options: [string, string, string, string];
  /** perm[shownIndex] = originalIndex */
  perm: [number, number, number, number];
  correctShownIndex: number;
  hiddenIndices: number[];
  durationMs: number;
  startedAt: number;
  deadlineAt: number;
  shuffleAtOffsetsMs: number[];
  shufflesDone: number;
  rerollLocked: boolean;
  difficultyShown?: 1 | 2 | 3;
  choice: number | null;
  answeredAt: number | null;
  isCorrect: boolean | null;
}

export interface QuizOutcome {
  isCorrect: boolean;
  coinsEarned: number;
  streakBonusCoins: number;
  newStreak: number;
  timePenaltySec: number;
  answeredInMs: number | null;
  grantedFreeM2: boolean;
}

export interface ShopItem {
  slot: number;
  cardId: string;
  level: CardLevel;
  basePrice: number;
  finalPrice: number;
  bought: boolean;
}

export interface PlayerShopState {
  items: ShopItem[];
  discount: number;
  done: boolean;
  boughtNames: string[];
}

export interface ForceMoveState {
  target: PlayerId;
  limitMs: number;
  startedAt: number;
  deadlineAt: number;
}

export interface FreeM2Choice {
  options: { cardId: string; level: 2 }[];
}

export interface GameEvent {
  id: string;
  at: number;
  kind:
    | 'card_pending'
    | 'card_applied'
    | 'card_blocked'
    | 'card_reflected'
    | 'flash'
    | 'force_timeout'
    | 'info';
  message: string;
  group?: CardGroup;
  by?: PlayerId;
  target?: PlayerId;
  flashCount?: number;
}

export interface GameOverInfo {
  winner: Color | 'draw';
  reason:
    | 'checkmate'
    | 'timeout'
    | 'resign'
    | 'draw_agreement'
    | 'stalemate'
    | 'threefold'
    | 'insufficient'
    | 'fifty_move'
    | 'disconnect';
  stats: {
    p1: { name: string; color: Color; quizCorrect: number; quizTotal: number; totalCoins: number; cardsUsed: number };
    p2: { name: string; color: Color; quizCorrect: number; quizTotal: number; totalCoins: number; cardsUsed: number };
    totalQuizzes: number;
    totalPlies: number;
  };
}

export interface RevealedHistoryItem {
  name: string;
  group?: CardGroup;
  level?: CardLevel;
  atPly?: number;
  atClockMs?: number;
}

export interface PublicPlayerView {
  id: PlayerId;
  name: string;
  elo?: number;
  color: Color;
  clockMs: number;
  freezeRemainingMs: number;
  coins: number | null;
  streak: number | null;
  handCount: number;
  hand: HeldCard[] | null;
  revealedHand: { name: string; level?: CardLevel }[] | null;
  revealedHistory: RevealedHistoryItem[] | null;
  revealedShop: { items?: ShopItem[]; boughtNames: string[] } | null;
  sinceQuiz: number;
  harmfulCooldown: number;
  flashUsed: number;
  connected: boolean;
  ready: boolean;
}

export interface PublicState {
  phase: GamePhase;
  hostNow: number;
  clockSeconds: number;
  fen: string;
  turn: Color;
  lastMove: { from: string; to: string } | null;
  ply: number;
  phaseDeadlineAt: number | null;
  preQuizPassed: Record<PlayerId, boolean>;
  preQuizGroup4Used: Record<PlayerId, boolean>;
  shopDone: Record<PlayerId, boolean>;
  activeEffects: ActiveEffect[];
  pendingHarmful: PendingHarmful | null;
  forceMove: ForceMoveState | null;
  drawOfferBy: PlayerId | null;
  p1: PublicPlayerView;
  p2: PublicPlayerView;
  events: GameEvent[];
  gameOver: GameOverInfo | null;
  freeM2Choice: FreeM2Choice | null;
  weakTopicHint: string | null;
  analysisHint: { bestMove?: { from: string; to: string }; candidates?: { from: string; to: string }[] } | null;
}
