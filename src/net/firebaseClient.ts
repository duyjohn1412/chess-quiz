import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  FacebookAuthProvider,
  getAuth,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  setPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  Unsubscribe as AuthUnsubscribe,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  Firestore,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  descending,
  equal,
  execute,
  field,
  Pipeline,
  PipelineSource,
} from 'firebase/firestore/pipelines';
import {
  FIREBASE_CONFIG,
  FIREBASE_DATABASE_ID,
  FIREBASE_EDITION,
  hasFirebaseConfig,
} from './firebaseConfig';
import {
  applyMatchOutcomeToProfile,
  clampElo,
  createDefaultRankProfile,
  EloUpdateResult,
  MatchOutcome,
  normalizePlayerDisplayName,
  RankProfile,
  saveCachedRankProfile,
} from '../rank/rankSystem';

type FirestoreWithPipeline = Firestore & {
  pipeline(): PipelineSource<Pipeline>;
};

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let cachedServices: FirebaseServices | null = null;
let authInFlight: Promise<User> | null = null;

export function timestampToMs(ts: unknown, fallback: number = Date.now()): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts && typeof ts === 'object' && 'toMillis' in ts && typeof (ts as { toMillis: unknown }).toMillis === 'function') {
    return (ts as { toMillis(): number }).toMillis();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  return fallback;
}

export function getFirebaseServices(): FirebaseServices {
  if (!hasFirebaseConfig()) {
    throw new Error('Thiếu cấu hình máy chủ.');
  }
  if (cachedServices) return cachedServices;

  const app = getApps().length > 0 ? getApp() : initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence).catch(() => {});

  const db =
    FIREBASE_DATABASE_ID && FIREBASE_DATABASE_ID !== '(default)'
      ? getFirestore(app, FIREBASE_DATABASE_ID)
      : getFirestore(app);

  cachedServices = { app, auth, db };
  return cachedServices;
}

export async function ensureAnonymousAuth(): Promise<User> {
  const { auth } = getFirebaseServices();
  if (auth.currentUser) return auth.currentUser;
  if (authInFlight) return authInFlight;

  authInFlight = (async () => {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch {
      // ignore if restricted browser mode; signInAnonymously still works per-session
    }
    const authWithReady = auth as Auth & { authStateReady?: () => Promise<void> };
    if (typeof authWithReady.authStateReady === 'function') {
      await authWithReady.authStateReady();
    }
    if (auth.currentUser) return auth.currentUser;
    const cred = await signInAnonymously(auth);
    return cred.user;
  })();

  try {
    return await authInFlight;
  } finally {
    authInFlight = null;
  }
}

export interface AccountInfo {
  uid: string;
  isAnonymous: boolean;
  provider: 'guest' | 'google' | 'password' | 'facebook';
  accountLabel: string;
  friendId: string;
}

const USERNAME_EMAIL_DOMAIN = 'account.chessquiz.vn';

export function uidToFriendId(uid: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const num = 100_000_000 + (h % 900_000_000);
  return String(num);
}

export function formatFriendId(id: string): string {
  const clean = id.replace(/\D/g, '').slice(0, 9);
  if (clean.length !== 9) return id;
  return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
}

export function identifierToAuthEmail(identifier: string): string {
  const clean = identifier.trim().toLowerCase();
  if (!clean) {
    throw new Error('Vui lòng nhập Tên tài khoản hoặc Email.');
  }
  if (clean.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      throw new Error('Địa chỉ Email không hợp lệ.');
    }
    return clean;
  }
  if (!/^[a-z0-9_.-]{3,24}$/.test(clean)) {
    throw new Error('Tên tài khoản gồm 3–24 ký tự chữ không dấu, số hoặc _ . -');
  }
  return `${clean}@${USERNAME_EMAIL_DOMAIN}`;
}

export function extractAccountInfo(user: User | null): AccountInfo | null {
  if (!user) return null;
  const pid = user.providerData[0]?.providerId ?? '';
  let provider: AccountInfo['provider'] = 'guest';
  if (!user.isAnonymous) {
    if (pid === 'google.com') provider = 'google';
    else if (pid === 'facebook.com') provider = 'facebook';
    else provider = 'password';
  }

  let accountLabel = 'Khách (chỉ lưu máy này)';
  if (provider === 'password' && user.email) {
    accountLabel = user.email.endsWith(`@${USERNAME_EMAIL_DOMAIN}`)
      ? user.email.slice(0, -(`@${USERNAME_EMAIL_DOMAIN}`.length))
      : user.email;
  } else if (provider === 'google' || provider === 'facebook') {
    accountLabel = user.email || user.displayName || (provider === 'google' ? 'Google' : 'Facebook');
  }

  return {
    uid: user.uid,
    isAnonymous: user.isAnonymous,
    provider,
    accountLabel,
    friendId: uidToFriendId(user.uid),
  };
}

export function translateAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Sai tên tài khoản/Email hoặc mật khẩu.';
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return 'Tài khoản hoặc Email này đã tồn tại. Hãy chuyển sang tab Đăng nhập.';
    case 'auth/weak-password':
      return 'Mật khẩu cần tối thiểu 6 ký tự.';
    case 'auth/invalid-email':
      return 'Định dạng Email hoặc Tên tài khoản không hợp lệ.';
    case 'auth/popup-closed-by-user':
      return 'Bạn đã đóng cửa sổ đăng nhập trước khi hoàn tất.';
    case 'auth/popup-blocked':
      return 'Trình duyệt đã chặn cửa sổ bật lên (Pop-up). Hãy cho phép Pop-up rồi thử lại.';
    case 'auth/operation-not-allowed':
      return 'Phương thức đăng nhập này chưa được bật trên máy chủ.';
    case 'auth/network-request-failed':
      return 'Lỗi kết nối mạng, vui lòng thử lại.';
    default:
      return err instanceof Error ? err.message : 'Đăng nhập không thành công.';
  }
}

export function subscribeAuthState(cb: (user: User | null) => void): AuthUnsubscribe {
  const { auth } = getFirebaseServices();
  return onAuthStateChanged(auth, cb);
}

export function docToRankProfile(uid: string, data: Record<string, unknown>): RankProfile {
  return {
    uid,
    name: normalizePlayerDisplayName(String(data.name ?? 'Người chơi')),
    elo: clampElo(Number(data.elo ?? 1000)),
    wins: Math.max(0, Math.floor(Number(data.wins ?? 0))),
    losses: Math.max(0, Math.floor(Number(data.losses ?? 0))),
    draws: Math.max(0, Math.floor(Number(data.draws ?? 0))),
    streak: Math.max(0, Math.floor(Number(data.streak ?? 0))),
    bestElo: clampElo(Number(data.bestElo ?? data.elo ?? 1000)),
    gamesPlayed: Math.max(0, Math.floor(Number(data.gamesPlayed ?? 0))),
    ranked: Boolean(data.ranked),
    lastMatchId: typeof data.lastMatchId === 'string' ? data.lastMatchId : '',
    updatedAt: timestampToMs(data.updatedAt),
  };
}

export async function loadOrCreateRankProfile(
  uid: string,
  displayName: string,
  preserveExistingName: boolean = false
): Promise<RankProfile> {
  const { db } = getFirebaseServices();
  const cleanName = normalizePlayerDisplayName(displayName || 'Người chơi');
  const playerRef = doc(db, 'players', uid);
  const snap = await getDoc(playerRef);

  if (!snap.exists()) {
    const initial = createDefaultRankProfile(uid, cleanName);
    await setDoc(playerRef, {
      uid: initial.uid,
      name: initial.name,
      elo: initial.elo,
      wins: initial.wins,
      losses: initial.losses,
      draws: initial.draws,
      streak: initial.streak,
      bestElo: initial.bestElo,
      gamesPlayed: initial.gamesPlayed,
      ranked: false,
      lastMatchId: '',
      updatedAt: serverTimestamp(),
    });
    saveCachedRankProfile(initial);
    return initial;
  }

  const profile = docToRankProfile(uid, snap.data() as Record<string, unknown>);
  if (!preserveExistingName && cleanName && cleanName !== profile.name) {
    profile.name = cleanName;
    try {
      await updateDoc(playerRef, {
        name: cleanName,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // non-fatal rename failure
    }
  }
  saveCachedRankProfile(profile);
  return profile;
}

export async function registerWithAccount(
  identifier: string,
  password: string,
  displayName: string
): Promise<{ user: User; profile: RankProfile; migratedFromGuest: boolean }> {
  const { auth } = getFirebaseServices();
  const email = identifierToAuthEmail(identifier);
  if (password.length < 6) {
    throw new Error('Mật khẩu cần tối thiểu 6 ký tự.');
  }
  const cleanDisplay = normalizePlayerDisplayName(displayName || identifier);

  try {
    let user: User;
    let migratedFromGuest = false;
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      const cred = EmailAuthProvider.credential(email, password);
      const linked = await linkWithCredential(auth.currentUser, cred);
      user = linked.user;
      migratedFromGuest = true;
    } else {
      const created = await createUserWithEmailAndPassword(auth, email, password);
      user = created.user;
    }
    try {
      await updateProfile(user, { displayName: cleanDisplay });
    } catch {
      // non-fatal
    }
    const profile = await loadOrCreateRankProfile(user.uid, cleanDisplay, false);
    return { user, profile, migratedFromGuest };
  } catch (err) {
    throw new Error(translateAuthError(err));
  }
}

export async function loginWithAccount(
  identifier: string,
  password: string
): Promise<{ user: User; profile: RankProfile }> {
  const { auth } = getFirebaseServices();
  const email = identifierToAuthEmail(identifier);
  if (!password) {
    throw new Error('Vui lòng nhập mật khẩu.');
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await loadOrCreateRankProfile(cred.user.uid, cred.user.displayName || 'Người chơi', true);
    return { user: cred.user, profile };
  } catch (err) {
    throw new Error(translateAuthError(err));
  }
}

export async function loginWithGoogle(
  currentDisplayName: string
): Promise<{ user: User; profile: RankProfile; migratedFromGuest: boolean }> {
  const { auth } = getFirebaseServices();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    let user: User;
    let migratedFromGuest = false;
    let existingAccount = false;

    if (auth.currentUser && auth.currentUser.isAnonymous) {
      try {
        const linked = await linkWithPopup(auth.currentUser, provider);
        user = linked.user;
        migratedFromGuest = true;
      } catch (linkErr) {
        const code = (linkErr as { code?: string } | null)?.code;
        if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          const signed = await signInWithPopup(auth, provider);
          user = signed.user;
          existingAccount = true;
        } else {
          throw linkErr;
        }
      }
    } else {
      const signed = await signInWithPopup(auth, provider);
      user = signed.user;
      existingAccount = true;
    }

    const fallbackName = normalizePlayerDisplayName(
      user.displayName || currentDisplayName || 'Người chơi'
    );
    const profile = await loadOrCreateRankProfile(user.uid, fallbackName, existingAccount);
    return { user, profile, migratedFromGuest };
  } catch (err) {
    throw new Error(translateAuthError(err));
  }
}

export async function loginWithFacebook(
  currentDisplayName: string
): Promise<{ user: User; profile: RankProfile; migratedFromGuest: boolean }> {
  const { auth } = getFirebaseServices();
  const provider = new FacebookAuthProvider();

  try {
    let user: User;
    let migratedFromGuest = false;
    let existingAccount = false;

    if (auth.currentUser && auth.currentUser.isAnonymous) {
      try {
        const linked = await linkWithPopup(auth.currentUser, provider);
        user = linked.user;
        migratedFromGuest = true;
      } catch (linkErr) {
        const code = (linkErr as { code?: string } | null)?.code;
        if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          const signed = await signInWithPopup(auth, provider);
          user = signed.user;
          existingAccount = true;
        } else {
          throw linkErr;
        }
      }
    } else {
      const signed = await signInWithPopup(auth, provider);
      user = signed.user;
      existingAccount = true;
    }

    const fallbackName = normalizePlayerDisplayName(
      user.displayName || currentDisplayName || 'Người chơi'
    );
    const profile = await loadOrCreateRankProfile(user.uid, fallbackName, existingAccount);
    return { user, profile, migratedFromGuest };
  } catch (err) {
    throw new Error(translateAuthError(err));
  }
}

export async function logoutToGuest(
  fallbackDisplayName: string = 'Người chơi'
): Promise<{ user: User; profile: RankProfile }> {
  const { auth } = getFirebaseServices();
  await signOut(auth);
  const cred = await signInAnonymously(auth);
  const profile = await loadOrCreateRankProfile(cred.user.uid, fallbackDisplayName, true);
  return { user: cred.user, profile };
}

export async function syncRankDisplayName(uid: string, displayName: string): Promise<void> {
  const cleanName = normalizePlayerDisplayName(displayName);
  const { db } = getFirebaseServices();
  const playerRef = doc(db, 'players', uid);
  try {
    await updateDoc(playerRef, {
      name: cleanName,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // ignore if profile does not exist yet
  }
}

export async function fetchLeaderboard(maxRows: number = 20): Promise<RankProfile[]> {
  const { db } = getFirebaseServices();

  if (FIREBASE_EDITION === 'enterprise') {
    const pipeDb = db as FirestoreWithPipeline;
    if (typeof pipeDb.pipeline === 'function') {
      const p = pipeDb
        .pipeline()
        .collection('players')
        .where(equal(field('ranked'), true))
        .sort(descending(field('elo')))
        .limit(maxRows);
      const snap = await execute(p);
      return snap.results
        .map((r) => {
          const data = r.data() as Record<string, unknown> | undefined;
          if (!data) return null;
          const uid = String(data.uid ?? r.id ?? '');
          return uid ? docToRankProfile(uid, data) : null;
        })
        .filter((x): x is RankProfile => Boolean(x));
    }
  }

  const q = query(
    collection(db, 'players'),
    where('ranked', '==', true),
    orderBy('elo', 'desc'),
    limit(maxRows)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToRankProfile(d.id, d.data() as Record<string, unknown>));
}

export async function commitRankedMatchResult(
  roomCode: string,
  uid: string,
  outcome: MatchOutcome,
  oppElo: number
): Promise<{ profile: RankProfile; diff: EloUpdateResult } | null> {
  const { db } = getFirebaseServices();
  const playerRef = doc(db, 'players', uid);
  const roomRef = doc(db, 'rooms', roomCode);

  const runOnce = async (): Promise<{ profile: RankProfile; diff: EloUpdateResult } | null> => {
    return runTransaction(db, async (tx) => {
      const [pSnap, rSnap] = await Promise.all([tx.get(playerRef), tx.get(roomRef)]);
      if (!rSnap.exists()) return null;
      const room = rSnap.data() as Record<string, unknown>;
      if (room.isRanked !== true || room.phase !== 'GAME_OVER') {
        throw new Error('ROOM_NOT_FINALIZED');
      }
      if (room.hostUid !== uid && room.guestUid !== uid) return null;

      let current: RankProfile;
      if (pSnap.exists()) {
        current = docToRankProfile(uid, pSnap.data() as Record<string, unknown>);
      } else {
        current = createDefaultRankProfile(uid, 'Người chơi');
      }

      if (current.lastMatchId === roomCode) {
        return null; // Đã cộng/trừ Elo cho trận này rồi
      }

      const { next, diff } = applyMatchOutcomeToProfile(current, oppElo, outcome, roomCode);
      if (pSnap.exists()) {
        tx.update(playerRef, {
          elo: next.elo,
          wins: next.wins,
          losses: next.losses,
          draws: next.draws,
          streak: next.streak,
          bestElo: next.bestElo,
          gamesPlayed: next.gamesPlayed,
          ranked: true,
          lastMatchId: roomCode,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(playerRef, {
          uid: next.uid,
          name: next.name,
          elo: next.elo,
          wins: next.wins,
          losses: next.losses,
          draws: next.draws,
          streak: next.streak,
          bestElo: next.bestElo,
          gamesPlayed: next.gamesPlayed,
          ranked: true,
          lastMatchId: roomCode,
          updatedAt: serverTimestamp(),
        });
      }
      saveCachedRankProfile(next);
      return { profile: next, diff };
    });
  };

  const delays = [400, 800, 1200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await runOnce();
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === 'ROOM_NOT_FINALIZED' &&
        attempt < delays.length
      ) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return null;
    }
  }
  return null;
}
