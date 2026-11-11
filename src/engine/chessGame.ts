import { Chess } from 'chess.js';
import { Color, GameOverInfo } from '../types/game';

export interface MoveResult {
  ok: boolean;
  error?: string;
  san?: string;
  from?: string;
  to?: string;
  fen?: string;
  turn?: Color;
  isGameOver?: boolean;
  winner?: Color | 'draw';
  reason?: GameOverInfo['reason'];
}

export class ChessGame {
  private chess: Chess;

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  getFen(): string {
    return this.chess.fen();
  }

  getTurn(): Color {
    return this.chess.turn();
  }

  hasOnlyBareKing(color: Color): boolean {
    const board = this.chess.board();
    let count = 0;
    for (const row of board) {
      for (const cell of row) {
        if (cell && cell.color === color) {
          count += 1;
          if (cell.type !== 'k' || count > 1) return false;
        }
      }
    }
    return count === 1;
  }

  tryMove(from: string, to: string, promo?: 'q' | 'r' | 'b' | 'n'): MoveResult {
    try {
      const move = this.chess.move({ from, to, promotion: promo || 'q' });
      if (!move) {
        return { ok: false, error: 'Nước đi không hợp lệ' };
      }
      const isGameOver = this.chess.isGameOver();
      let winner: Color | 'draw' | undefined;
      let reason: GameOverInfo['reason'] | undefined;

      if (isGameOver) {
        if (this.chess.isCheckmate()) {
          winner = move.color;
          reason = 'checkmate';
        } else if (this.chess.isStalemate()) {
          winner = 'draw';
          reason = 'stalemate';
        } else if (this.chess.isThreefoldRepetition()) {
          winner = 'draw';
          reason = 'threefold';
        } else if (this.chess.isInsufficientMaterial()) {
          winner = 'draw';
          reason = 'insufficient';
        } else {
          winner = 'draw';
          reason = 'fifty_move';
        }
      }

      return {
        ok: true,
        san: move.san,
        from: move.from,
        to: move.to,
        fen: this.chess.fen(),
        turn: this.chess.turn(),
        isGameOver,
        winner,
        reason,
      };
    } catch {
      return { ok: false, error: 'Nước đi không hợp lệ' };
    }
  }

  resolveTimeoutWinner(timedOutColor: Color): Color | 'draw' {
    const opp: Color = timedOutColor === 'w' ? 'b' : 'w';
    return this.hasOnlyBareKing(opp) ? 'draw' : opp;
  }
}
