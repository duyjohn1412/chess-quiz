const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return code;
}

export function generateQuickRoomCode(rng: () => number = Math.random): string {
  let suffix = '';
  for (let i = 0; i < 7; i++) {
    suffix += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return `Q${suffix}`;
}

export function isQuickRoomCode(code: string): boolean {
  if (code.length !== 8 || !code.startsWith('Q')) return false;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function normalizeRoomCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== 6) return false;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function peerIdForRoom(code: string): string {
  return `cq-${normalizeRoomCode(code)}`;
}

export function extractCodeFromInput(
  raw: string
): { code: string; role?: 'player' | 'spectator' } | null {
  const s = raw.trim();
  const watchMatch = s.match(/#?\/watch\/([A-Za-z0-9]{6})/i);
  if (watchMatch) {
    const code = normalizeRoomCode(watchMatch[1]);
    return isValidRoomCode(code) ? { code, role: 'spectator' } : null;
  }
  const joinMatch = s.match(/#?\/join\/([A-Za-z0-9]{6})/i);
  if (joinMatch) {
    const code = normalizeRoomCode(joinMatch[1]);
    return isValidRoomCode(code) ? { code, role: 'player' } : null;
  }
  const code = normalizeRoomCode(s);
  return isValidRoomCode(code) ? { code } : null;
}
