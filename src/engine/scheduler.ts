import { CFG } from '../config/defaults';
import { Color } from '../types/game';

export function advanceMoveCounter(
  whiteSinceQuiz: number,
  blackSinceQuiz: number,
  moverColor: Color,
  isGameOver: boolean,
  movesPerQuiz: number = CFG.movesPerQuiz
): {
  triggerQuiz: boolean;
  whiteSinceQuiz: number;
  blackSinceQuiz: number;
} {
  const nextW = moverColor === 'w' ? whiteSinceQuiz + 1 : whiteSinceQuiz;
  const nextB = moverColor === 'b' ? blackSinceQuiz + 1 : blackSinceQuiz;

  if (!isGameOver && nextW >= movesPerQuiz && nextB >= movesPerQuiz) {
    return {
      triggerQuiz: true,
      whiteSinceQuiz: 0,
      blackSinceQuiz: 0,
    };
  }

  return {
    triggerQuiz: false,
    whiteSinceQuiz: nextW,
    blackSinceQuiz: nextB,
  };
}
