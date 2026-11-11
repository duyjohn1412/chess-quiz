import {
  Color,
  GameEvent,
  GameOverInfo,
  PublicState,
  QuestionBank,
  QuizOutcome,
  ShopItem,
} from '../types/game';

export type ClientRole = 'player' | 'spectator';

export type C2H =
  | { t: 'JOIN'; name: string; token?: string; role: ClientRole }
  | { t: 'READY' }
  | { t: 'MOVE'; from: string; to: string; promo?: 'q' | 'r' | 'b' | 'n' }
  | { t: 'ANSWER'; qid: string; choice: number }
  | { t: 'REROLL' }
  | { t: 'BUY'; slot: number }
  | { t: 'SHOP_REFRESH' }
  | { t: 'SHOP_DONE' }
  | { t: 'DROP'; uid: string }
  | { t: 'PRE_QUIZ_PASS' }
  | { t: 'USE'; uid: string }
  | { t: 'SHIELD'; uid?: string }
  | { t: 'CHOOSE_FREE_M2'; cardId: string }
  | { t: 'RESIGN' }
  | { t: 'DRAW_OFFER' }
  | { t: 'DRAW_REPLY'; accept: boolean }
  | { t: 'PING'; ts: number };

export interface QuizPayload {
  qid: string;
  prompt: string;
  options: [string, string, string, string];
  hiddenIndices: number[];
  deadlineAt: number;
  totalQuizMs: number;
  rerollDeadlineAt: number;
  rerollAllowed: boolean;
  difficultyShown?: 1 | 2 | 3;
  opponentUsedGroup4?: boolean;
}

export interface ResultPayload {
  correctIndex: number;
  explain?: string;
  you: QuizOutcome;
  opp: {
    isCorrect: boolean;
    answeredInMs: number | null;
    timePenaltySec: number;
  };
}

export interface ShopPayload {
  items: ShopItem[];
  deadlineAt: number;
  discount: number;
  refreshCost: number;
}

export type H2C =
  | { t: 'WELCOME'; token: string; playerId: string; role: ClientRole; color?: Color; clockSeconds: number }
  | { t: 'STATE'; seq: number; state: PublicState }
  | { t: 'QUIZ'; quiz: QuizPayload }
  | { t: 'RESULT'; result: ResultPayload }
  | { t: 'SHOP'; shop: ShopPayload }
  | { t: 'EVENT'; ev: GameEvent }
  | { t: 'REJECT'; reason: string }
  | { t: 'GAMEOVER'; info: GameOverInfo }
  | { t: 'PONG'; ts: number }
  | { t: 'HOST_LEFT' };

export interface RoomSettings {
  clockSeconds: 180 | 300 | 600;
  bank: QuestionBank;
}
