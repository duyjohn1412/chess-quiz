import { Chess, PieceSymbol, Square } from 'chess.js';
import { PLAN_TEMPLATES_VI } from '../cards/planTemplates.vi';
import { Color } from '../types/game';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

function allSquares(): Square[] {
  const out: Square[] = [];
  for (const f of FILES) {
    for (const r of RANKS) {
      out.push(`${f}${r}` as Square);
    }
  }
  return out;
}

const ALL_SQUARES = allSquares();

/**
 * Radar: tô đỏ quân của `ownColor` đang bị đối thủ tấn công mà:
 * - không có quân bảo vệ, HOẶC
 * - bị quân có giá trị thấp hơn tấn công
 */
export function computeRadarSquares(fen: string, ownColor: Color): Square[] {
  const chess = new Chess(fen);
  const oppColor: Color = ownColor === 'w' ? 'b' : 'w';
  const result: Square[] = [];

  for (const sq of ALL_SQUARES) {
    const piece = chess.get(sq);
    if (!piece || piece.color !== ownColor || piece.type === 'k') continue;

    const oppAttackers = chess.attackers(sq, oppColor);
    if (oppAttackers.length === 0) continue;

    const ownDefenders = chess.attackers(sq, ownColor);
    if (ownDefenders.length === 0) {
      result.push(sq);
      continue;
    }

    const ownVal = PIECE_VALUE[piece.type];
    const hasLowerAttacker = oppAttackers.some((attSq) => {
      const att = chess.get(attSq);
      return att ? PIECE_VALUE[att.type] < ownVal : false;
    });
    if (hasLowerAttacker) {
      result.push(sq);
    }
  }

  return result;
}

/**
 * Quét ô: các ô đối thủ đang kiểm soát (tấn công)
 */
export function computeScanSquares(fen: string, oppColor: Color): Square[] {
  const chess = new Chess(fen);
  const result: Square[] = [];
  for (const sq of ALL_SQUARES) {
    if (chess.isAttacked(sq, oppColor)) {
      result.push(sq);
    }
  }
  return result;
}

/**
 * Đánh giá vật chất đơn giản (fallback nếu Stockfish chưa sẵn sàng) theo góc nhìn Trắng (pawn)
 */
export function computeStaticMaterialEval(fen: string): number {
  const chess = new Chess(fen);
  let score = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.type === 'k') continue;
      const v = PIECE_VALUE[cell.type];
      score += cell.color === 'w' ? v : -v;
    }
  }
  return score;
}

export interface PlanResult {
  hints: string[];
  keySquares: Square[];
}

export function computeStrategicPlan(
  fen: string,
  ownColor: Color,
  maxHints: number,
  includeKeySquares: boolean
): PlanResult {
  const chess = new Chess(fen);
  const hints: string[] = [];
  const keySquares: Square[] = [];

  const board = chess.board();
  const ownPawnsOnFile: Record<string, number> = {};
  const oppPawnsOnFile: Record<string, number> = {};
  const ownRooksOnFile: Record<string, number> = {};
  let ownKingSq: Square | null = null;
  let totalMaterial = 0;
  let unmovedMinors = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      const file = FILES[c];
      const rank = String(8 - r);
      const sq = `${file}${rank}` as Square;

      if (cell.type !== 'k' && cell.type !== 'p') {
        totalMaterial += PIECE_VALUE[cell.type];
      }
      if (cell.color === ownColor) {
        if (cell.type === 'p') ownPawnsOnFile[file] = (ownPawnsOnFile[file] ?? 0) + 1;
        if (cell.type === 'r') ownRooksOnFile[file] = (ownRooksOnFile[file] ?? 0) + 1;
        if (cell.type === 'k') ownKingSq = sq;
        if (
          (cell.type === 'n' || cell.type === 'b') &&
          ((ownColor === 'w' && rank === '1') || (ownColor === 'b' && rank === '8'))
        ) {
          unmovedMinors++;
        }
      } else {
        if (cell.type === 'p') oppPawnsOnFile[file] = (oppPawnsOnFile[file] ?? 0) + 1;
      }
    }
  }

  // 1. Vua chưa nhập thành ở khai/trung cuộc
  if (
    totalMaterial > 24 &&
    ownKingSq &&
    ((ownColor === 'w' && ownKingSq === 'e1') || (ownColor === 'b' && ownKingSq === 'e8'))
  ) {
    hints.push(PLAN_TEMPLATES_VI.uncastledKing);
    if (includeKeySquares) keySquares.push(ownColor === 'w' ? 'g1' : 'g8');
  }

  // 2. Quân nhẹ chưa phát triển
  if (unmovedMinors >= 2 && totalMaterial > 24) {
    hints.push(PLAN_TEMPLATES_VI.developMinors);
  }

  // 3. Quân đang yếu / bị đe dọa
  const threatened = computeRadarSquares(fen, ownColor);
  if (threatened.length > 0) {
    hints.push(PLAN_TEMPLATES_VI.hangingOrWeakPiece(threatened[0]));
    if (includeKeySquares) keySquares.push(threatened[0]);
  }

  // 4. Cột mở và cột nửa mở
  for (const file of ['d', 'e', 'c', 'f', 'a', 'b', 'g', 'h']) {
    const ownP = ownPawnsOnFile[file] ?? 0;
    const oppP = oppPawnsOnFile[file] ?? 0;
    const ownR = ownRooksOnFile[file] ?? 0;
    if (ownP === 0 && oppP === 0 && ownR === 0) {
      hints.push(PLAN_TEMPLATES_VI.openFile(file));
      if (includeKeySquares) keySquares.push(`${file}${ownColor === 'w' ? '1' : '8'}` as Square);
      break;
    }
  }
  for (const file of ['d', 'e', 'c', 'f']) {
    const ownP = ownPawnsOnFile[file] ?? 0;
    const oppP = oppPawnsOnFile[file] ?? 0;
    const ownR = ownRooksOnFile[file] ?? 0;
    if (ownP === 0 && oppP > 0 && ownR === 0) {
      hints.push(PLAN_TEMPLATES_VI.semiOpenFile(file));
      if (includeKeySquares) keySquares.push(`${file}${ownColor === 'w' ? '2' : '7'}` as Square);
      break;
    }
  }

  // 5. Tiền đồn cho Mã (ô hàng 5/6 của mình không bị tốt địch ở cột kề kiểm soát)
  const outpostRank = ownColor === 'w' ? '5' : '4';
  for (let i = 1; i < 7; i++) {
    const file = FILES[i];
    const sq = `${file}${outpostRank}` as Square;
    const leftOpp = oppPawnsOnFile[FILES[i - 1]] ?? 0;
    const rightOpp = oppPawnsOnFile[FILES[i + 1]] ?? 0;
    if (leftOpp === 0 && rightOpp === 0 && chess.get(sq)?.color !== ownColor) {
      hints.push(PLAN_TEMPLATES_VI.knightOutpost(sq));
      if (includeKeySquares) keySquares.push(sq);
      break;
    }
  }

  // 6. Tốt chồng / tốt cô lập
  for (let i = 0; i < 8; i++) {
    const file = FILES[i];
    if ((ownPawnsOnFile[file] ?? 0) >= 2) {
      hints.push(PLAN_TEMPLATES_VI.doubledPawn(file));
      break;
    }
  }

  // 7. Tàn cuộc hoặc trung tâm
  if (totalMaterial <= 16) {
    hints.push(PLAN_TEMPLATES_VI.endgameKingActive);
    if (includeKeySquares) keySquares.push('d4', 'e4', 'd5', 'e5');
  } else if (hints.length < maxHints) {
    hints.push(PLAN_TEMPLATES_VI.centerControl);
    if (includeKeySquares) keySquares.push('d4', 'e4', 'd5', 'e5');
  }

  return {
    hints: hints.slice(0, maxHints),
    keySquares: includeKeySquares ? Array.from(new Set(keySquares)).slice(0, 6) : [],
  };
}
