import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';

type BoardArrow = [Square, Square, string?];
type BoardSquareStyles = Partial<Record<Square, Record<string, string | number>>>;
import {
  computeRadarSquares,
  computeScanSquares,
  computeStrategicPlan,
} from '../../analysis/analyzers';
import { ActiveEffect, Color } from '../../types/game';
import { NativeModal } from './NativeModal';

interface BoardViewProps {
  fen: string;
  orientation: 'white' | 'black';
  canControl: boolean;
  viewerColor: Color;
  lastMove: { from: string; to: string } | null;
  activeEffects: ActiveEffect[];
  viewerId: 'p1' | 'p2' | 'spectator';
  analysisHint: {
    bestMove?: { from: string; to: string };
    candidates?: { from: string; to: string }[];
  } | null;
  onMove: (from: string, to: string, promo?: 'q' | 'r' | 'b' | 'n') => void;
}

export const BoardView: React.FC<BoardViewProps> = ({
  fen,
  orientation,
  canControl,
  viewerColor,
  lastMove,
  activeEffects,
  viewerId,
  analysisHint,
  onMove,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(440);
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    setSelectedSq(null);
    setPendingPromo(null);
  }, [fen]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 120) setBoardWidth(Math.min(w, 540));
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const chess = useMemo(() => new Chess(fen), [fen]);

  const legalTargets = useMemo(() => {
    if (!selectedSq || !canControl) return [];
    return chess.moves({ square: selectedSq, verbose: true });
  }, [chess, selectedSq, canControl]);

  const radarSquares = useMemo(() => {
    if (viewerId === 'spectator') return [];
    const hasRadar = activeEffects.some((e) => e.owner === viewerId && e.cardId === 'sup_radar');
    if (!hasRadar) return [];
    return computeRadarSquares(fen, viewerColor);
  }, [activeEffects, fen, viewerColor, viewerId]);

  const scanSquares = useMemo(() => {
    if (viewerId === 'spectator') return [];
    const hasScan = activeEffects.some((e) => e.owner === viewerId && e.cardId === 'sup_scan');
    if (!hasScan) return [];
    const oppColor: Color = viewerColor === 'w' ? 'b' : 'w';
    return computeScanSquares(fen, oppColor);
  }, [activeEffects, fen, viewerColor, viewerId]);

  const planSquares = useMemo(() => {
    if (viewerId === 'spectator') return [];
    const planEff = activeEffects.find((e) => e.owner === viewerId && e.cardId === 'sup_plan');
    if (!planEff || planEff.level < 4) return [];
    return computeStrategicPlan(fen, viewerColor, 4, true).keySquares;
  }, [activeEffects, fen, viewerColor, viewerId]);

  const customSquareStyles = useMemo(() => {
    const styles: BoardSquareStyles = {};

    if (lastMove) {
      styles[lastMove.from as Square] = { backgroundColor: 'rgba(245, 165, 36, 0.25)' };
      styles[lastMove.to as Square] = { backgroundColor: 'rgba(245, 165, 36, 0.32)' };
    }

    for (const sq of scanSquares) {
      styles[sq as Square] = {
        ...styles[sq as Square],
        boxShadow: 'inset 0 0 0 2px rgba(124, 92, 255, 0.65)',
        backgroundColor: 'rgba(124, 92, 255, 0.2)',
      };
    }

    for (const sq of planSquares) {
      styles[sq as Square] = {
        ...styles[sq as Square],
        boxShadow: 'inset 0 0 0 3px rgba(62, 207, 142, 0.85)',
      };
    }

    for (const sq of radarSquares) {
      styles[sq as Square] = {
        ...styles[sq as Square],
        backgroundColor: 'rgba(239, 68, 68, 0.5)',
        boxShadow: 'inset 0 0 0 3px #ef4444',
      };
    }

    if (chess.inCheck()) {
      const turn = chess.turn();
      const board = chess.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c];
          if (p && p.type === 'k' && p.color === turn) {
            const kSq = `${'abcdefgh'[c]}${8 - r}` as Square;
            styles[kSq] = {
              ...styles[kSq],
              background: 'radial-gradient(circle, rgba(239,68,68,0.85) 0%, rgba(127,29,29,0.5) 75%)',
            };
          }
        }
      }
    }

    if (selectedSq) {
      styles[selectedSq] = {
        ...styles[selectedSq],
        backgroundColor: 'rgba(56, 189, 248, 0.4)',
      };
    }

    for (const mv of legalTargets) {
      const isCapture = Boolean(mv.captured);
      styles[mv.to] = {
        ...styles[mv.to],
        background: isCapture
          ? 'radial-gradient(circle, transparent 58%, rgba(56, 189, 248, 0.72) 60%)'
          : 'radial-gradient(circle, rgba(56, 189, 248, 0.72) 22%, transparent 25%)',
      };
    }

    return styles;
  }, [lastMove, scanSquares, planSquares, radarSquares, chess, selectedSq, legalTargets]);

  const customArrows = useMemo((): BoardArrow[] => {
    const arr: BoardArrow[] = [];
    if (analysisHint?.candidates) {
      for (const c of analysisHint.candidates) {
        arr.push([c.from as Square, c.to as Square, 'rgba(245, 165, 36, 0.75)']);
      }
    }
    if (analysisHint?.bestMove) {
      arr.push([
        analysisHint.bestMove.from as Square,
        analysisHint.bestMove.to as Square,
        'rgba(34, 197, 94, 0.9)',
      ]);
    }
    return arr;
  }, [analysisHint]);

  const attemptMove = (from: string, to: string): boolean => {
    if (!canControl) return false;
    const moves = chess.moves({ square: from as Square, verbose: true });
    const matching = moves.filter((m) => m.to === to);
    if (matching.length === 0) return false;

    const hasPromo = matching.some((m) => Boolean(m.promotion));
    if (hasPromo) {
      setSelectedSq(null);
      setPendingPromo({ from, to });
      return false;
    }

    setSelectedSq(null);
    onMove(from, to);
    return true;
  };

  const handlePieceDrop = (source: Square, target: Square): boolean => {
    return attemptMove(source, target);
  };

  const handleSquareClick = (sq: Square) => {
    if (!canControl) return;
    if (selectedSq && selectedSq !== sq) {
      const moved = attemptMove(selectedSq, sq);
      if (moved || pendingPromo) return;
    }

    const piece = chess.get(sq);
    if (piece && piece.color === viewerColor && chess.turn() === viewerColor) {
      setSelectedSq(sq === selectedSq ? null : sq);
    } else {
      setSelectedSq(null);
    }
  };

  return (
    <div ref={containerRef} className="board-box" style={{ display: 'flex', justifyContent: 'center' }}>
      <Chessboard
        id="main-chess-board"
        position={fen}
        boardWidth={boardWidth}
        boardOrientation={orientation}
        arePiecesDraggable={canControl}
        onPieceDrop={handlePieceDrop}
        onSquareClick={handleSquareClick}
        customSquareStyles={customSquareStyles}
        customArrows={customArrows}
        customDarkSquareStyle={{ backgroundColor: '#9e6b43' }}
        customLightSquareStyle={{ backgroundColor: '#edd6b0' }}
        animationDuration={180}
      />

      <NativeModal
        open={Boolean(pendingPromo)}
        titleId="promo-modal-title"
        dismissible
        onClose={() => setPendingPromo(null)}
      >
        <h3 id="promo-modal-title" style={{ margin: 0 }}>
          Chọn quân phong cấp
        </h3>
        <div className="row" style={{ justifyContent: 'center' }}>
          {(
            [
              ['q', '♛ Hậu'],
              ['r', '♜ Xe'],
              ['b', '♝ Tượng'],
              ['n', '♞ Mã'],
            ] as const
          ).map(([code, label]) => (
            <button
              key={code}
              type="button"
              className="btn-primary"
              onClick={() => {
                if (pendingPromo) {
                  onMove(pendingPromo.from, pendingPromo.to, code);
                }
                setPendingPromo(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </NativeModal>
    </div>
  );
};
