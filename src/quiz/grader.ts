import { Question } from '../types/game';

export interface ShuffledOptions {
  options: [string, string, string, string];
  perm: [number, number, number, number];
  correctShownIndex: number;
}

export function shuffleOptions(
  question: Question,
  rng: () => number = Math.random
): ShuffledOptions {
  const perm: [number, number, number, number] = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  const options: [string, string, string, string] = [
    question.options[perm[0]],
    question.options[perm[1]],
    question.options[perm[2]],
    question.options[perm[3]],
  ];
  const correctShownIndex = perm.indexOf(question.answer);
  return { options, perm, correctShownIndex };
}

export function reshuffleExistingOptions(
  currentOptions: [string, string, string, string],
  currentPerm: [number, number, number, number],
  currentHiddenIndices: number[],
  correctOrigIndex: number,
  rng: () => number = Math.random
): {
  options: [string, string, string, string];
  perm: [number, number, number, number];
  correctShownIndex: number;
  hiddenIndices: number[];
} {
  const indices: [number, number, number, number] = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  // Đảm bảo có sự thay đổi vị trí thực sự
  if (indices.every((v, i) => v === i)) {
    const tmp = indices[0];
    indices[0] = indices[1];
    indices[1] = tmp;
  }

  const nextOptions: [string, string, string, string] = [
    currentOptions[indices[0]],
    currentOptions[indices[1]],
    currentOptions[indices[2]],
    currentOptions[indices[3]],
  ];
  const nextPerm: [number, number, number, number] = [
    currentPerm[indices[0]],
    currentPerm[indices[1]],
    currentPerm[indices[2]],
    currentPerm[indices[3]],
  ];
  const hiddenSet = new Set(currentHiddenIndices);
  const nextHidden: number[] = [];
  indices.forEach((oldSlot, newSlot) => {
    if (hiddenSet.has(oldSlot)) nextHidden.push(newSlot);
  });

  return {
    options: nextOptions,
    perm: nextPerm,
    correctShownIndex: nextPerm.indexOf(correctOrigIndex),
    hiddenIndices: nextHidden,
  };
}

export function gradeAnswer(correctShownIndex: number, choice: number | null): boolean {
  if (choice === null || choice < 0 || choice > 3) return false;
  return choice === correctShownIndex;
}
