import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { clampElo, normalizePlayerDisplayName, RankProfile } from '../rank/rankSystem';
import {
  AccountInfo,
  getFirebaseServices,
  timestampToMs,
  uidToFriendId,
} from './firebaseClient';

export interface SocialProfileItem {
  uid: string;
  friendId: string;
  name: string;
  elo: number;
  provider: AccountInfo['provider'];
  lastSeenAtMs: number;
}

export interface FriendshipItem {
  pairId: string;
  uidA: string;
  uidB: string;
  peerUid: string;
  peerName: string;
  peerElo: number;
  peerFriendId: string;
  requesterUid: string;
  status: 'PENDING' | 'ACCEPTED';
  lastMsgText: string;
  lastMsgSenderUid: string;
  updatedAtMs: number;
}

export interface DirectMessageItem {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  text: string;
  inviteRoomCode: string | null;
  clockSeconds: number | null;
  createdAtMs: number;
}

export interface GlobalChatItem {
  id: string;
  senderUid: string;
  senderName: string;
  senderElo: number;
  senderFriendId: string;
  text: string;
  inviteRoomCode: string | null;
  clockSeconds: number | null;
  createdAtMs: number;
}

export interface RoomChatItem {
  id: string;
  senderUid: string;
  senderName: string;
  text: string;
  createdAtMs: number;
}

export function canonicalPairId(uid1: string, uid2: string): string {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

export async function syncSocialProfile(
  profile: RankProfile,
  account: AccountInfo | null
): Promise<void> {
  const { db } = getFirebaseServices();
  const cleanName = normalizePlayerDisplayName(profile.name);
  const friendId = uidToFriendId(profile.uid);
  try {
    await setDoc(
      doc(db, 'social_profiles', profile.uid),
      {
        uid: profile.uid,
        friendId,
        name: cleanName,
        nameLower: cleanName.toLowerCase(),
        elo: clampElo(profile.elo),
        provider: account?.provider ?? 'guest',
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // non-fatal background sync
  }
}

export async function searchPlayers(
  queryText: string,
  selfUid: string
): Promise<SocialProfileItem[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];
  const { db } = getFirebaseServices();
  const cleanDigits = trimmed.replace(/\s+/g, '');
  const lowerQuery = trimmed.toLowerCase();
  const results = new Map<string, SocialProfileItem>();

  if (/^\d{9}$/.test(cleanDigits)) {
    try {
      const qExact = query(
        collection(db, 'social_profiles'),
        where('friendId', '==', cleanDigits),
        limit(5)
      );
      const snapExact = await getDocs(qExact);
      for (const d of snapExact.docs) {
        const raw = d.data() as Record<string, unknown>;
        const uid = String(raw.uid ?? d.id);
        if (uid === selfUid) continue;
        results.set(uid, {
          uid,
          friendId: String(raw.friendId ?? uidToFriendId(uid)),
          name: normalizePlayerDisplayName(String(raw.name ?? 'Người chơi')),
          elo: clampElo(Number(raw.elo ?? 1000)),
          provider: (raw.provider as AccountInfo['provider']) ?? 'guest',
          lastSeenAtMs: timestampToMs(raw.lastSeenAt),
        });
      }
    } catch {
      // ignore query failure and fall back to scan
    }
  }

  try {
    const qRecentSocial = query(
      collection(db, 'social_profiles'),
      orderBy('updatedAt', 'desc'),
      limit(60)
    );
    const snapSocial = await getDocs(qRecentSocial);
    for (const d of snapSocial.docs) {
      const raw = d.data() as Record<string, unknown>;
      const uid = String(raw.uid ?? d.id);
      if (uid === selfUid || results.has(uid)) continue;
      const name = normalizePlayerDisplayName(String(raw.name ?? 'Người chơi'));
      const fId = String(raw.friendId ?? uidToFriendId(uid));
      if (
        name.toLowerCase().includes(lowerQuery) ||
        (cleanDigits.length >= 3 && fId.includes(cleanDigits))
      ) {
        results.set(uid, {
          uid,
          friendId: fId,
          name,
          elo: clampElo(Number(raw.elo ?? 1000)),
          provider: (raw.provider as AccountInfo['provider']) ?? 'guest',
          lastSeenAtMs: timestampToMs(raw.lastSeenAt),
        });
      }
    }
  } catch {
    // non-fatal
  }

  // Fallback sang collection players để tìm được cả người chơi cũ trước bản cập nhật
  if (results.size < 10) {
    try {
      const qPlayers = query(
        collection(db, 'players'),
        orderBy('updatedAt', 'desc'),
        limit(60)
      );
      const snapPlayers = await getDocs(qPlayers);
      for (const d of snapPlayers.docs) {
        const raw = d.data() as Record<string, unknown>;
        const uid = String(raw.uid ?? d.id);
        if (uid === selfUid || results.has(uid)) continue;
        const name = normalizePlayerDisplayName(String(raw.name ?? 'Người chơi'));
        const fId = uidToFriendId(uid);
        if (
          (/^\d{9}$/.test(cleanDigits) && fId === cleanDigits) ||
          name.toLowerCase().includes(lowerQuery) ||
          (cleanDigits.length >= 4 && fId.includes(cleanDigits))
        ) {
          results.set(uid, {
            uid,
            friendId: fId,
            name,
            elo: clampElo(Number(raw.elo ?? 1000)),
            provider: 'guest',
            lastSeenAtMs: timestampToMs(raw.updatedAt),
          });
        }
      }
    } catch {
      // ignore fallback errors
    }
  }

  return Array.from(results.values()).sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs);
}

export async function sendFriendRequest(
  self: { uid: string; name: string; elo: number },
  target: { uid: string; name: string; elo: number }
): Promise<string> {
  if (self.uid === target.uid) {
    throw new Error('Không thể tự kết bạn với chính mình.');
  }
  const { db } = getFirebaseServices();
  const [uidA, uidB] = self.uid < target.uid ? [self.uid, target.uid] : [target.uid, self.uid];
  const pairId = `${uidA}_${uidB}`;
  const isSelfA = self.uid === uidA;

  await setDoc(doc(db, 'friendships', pairId), {
    pairId,
    uidA,
    uidB,
    users: [uidA, uidB],
    requesterUid: self.uid,
    status: 'PENDING',
    names: {
      [self.uid]: normalizePlayerDisplayName(self.name),
      [target.uid]: normalizePlayerDisplayName(target.name),
    },
    elos: {
      [self.uid]: clampElo(self.elo),
      [target.uid]: clampElo(target.elo),
    },
    friendIds: {
      [self.uid]: uidToFriendId(self.uid),
      [target.uid]: uidToFriendId(target.uid),
    },
    lastMsgText: '',
    lastMsgSenderUid: '',
    isSelfA,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return pairId;
}

export async function acceptFriendRequest(pairId: string): Promise<void> {
  const { db } = getFirebaseServices();
  await updateDoc(doc(db, 'friendships', pairId), {
    status: 'ACCEPTED',
    updatedAt: serverTimestamp(),
  });
}

export async function removeFriendship(pairId: string): Promise<void> {
  const { db } = getFirebaseServices();
  await deleteDoc(doc(db, 'friendships', pairId));
}

export function subscribeFriendships(
  myUid: string,
  onUpdate: (items: FriendshipItem[]) => void
): Unsubscribe {
  const { db } = getFirebaseServices();
  const q = query(collection(db, 'friendships'), where('users', 'array-contains', myUid));
  return onSnapshot(
    q,
    (snap) => {
      const items: FriendshipItem[] = snap.docs
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          const uidA = String(raw.uidA ?? '');
          const uidB = String(raw.uidB ?? '');
          const peerUid = uidA === myUid ? uidB : uidA;
          if (!peerUid) return null;
          const names = (raw.names as Record<string, unknown>) ?? {};
          const elos = (raw.elos as Record<string, unknown>) ?? {};
          const fIds = (raw.friendIds as Record<string, unknown>) ?? {};
          return {
            pairId: String(raw.pairId ?? d.id),
            uidA,
            uidB,
            peerUid,
            peerName: normalizePlayerDisplayName(String(names[peerUid] ?? 'Người chơi')),
            peerElo: clampElo(Number(elos[peerUid] ?? 1000)),
            peerFriendId: String(fIds[peerUid] ?? uidToFriendId(peerUid)),
            requesterUid: String(raw.requesterUid ?? ''),
            status: raw.status === 'ACCEPTED' ? 'ACCEPTED' : 'PENDING',
            lastMsgText: String(raw.lastMsgText ?? ''),
            lastMsgSenderUid: String(raw.lastMsgSenderUid ?? ''),
            updatedAtMs: timestampToMs(raw.updatedAt, 0),
          } satisfies FriendshipItem;
        })
        .filter((x): x is FriendshipItem => Boolean(x))
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onUpdate(items);
    },
    () => {
      onUpdate([]);
    }
  );
}

export async function sendDirectMessage(opts: {
  pairId: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  text: string;
  inviteRoomCode?: string;
  clockSeconds?: number;
}): Promise<void> {
  const cleanText = opts.text.trim().slice(0, 300);
  if (!cleanText) return;
  const { db } = getFirebaseServices();
  await addDoc(collection(db, 'conversations', opts.pairId, 'messages'), {
    fromUid: opts.fromUid,
    fromName: normalizePlayerDisplayName(opts.fromName),
    toUid: opts.toUid,
    text: cleanText,
    inviteRoomCode: opts.inviteRoomCode ?? null,
    clockSeconds: opts.clockSeconds ?? null,
    createdAt: serverTimestamp(),
  });
  try {
    await updateDoc(doc(db, 'friendships', opts.pairId), {
      lastMsgText: cleanText,
      lastMsgSenderUid: opts.fromUid,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // ignore metadata update if friendship deleted concurrently
  }
}

export function subscribeDirectMessages(
  pairId: string,
  onUpdate: (msgs: DirectMessageItem[]) => void
): Unsubscribe {
  const { db } = getFirebaseServices();
  const q = query(
    collection(db, 'conversations', pairId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs: DirectMessageItem[] = snap.docs
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            fromUid: String(raw.fromUid ?? ''),
            fromName: normalizePlayerDisplayName(String(raw.fromName ?? 'Người chơi')),
            toUid: String(raw.toUid ?? ''),
            text: String(raw.text ?? ''),
            inviteRoomCode: typeof raw.inviteRoomCode === 'string' ? raw.inviteRoomCode : null,
            clockSeconds: typeof raw.clockSeconds === 'number' ? raw.clockSeconds : null,
            createdAtMs: timestampToMs(raw.createdAt, Date.now()),
          };
        })
        .reverse();
      onUpdate(msgs);
    },
    () => {
      onUpdate([]);
    }
  );
}

export async function sendGlobalChatMessage(opts: {
  senderUid: string;
  senderName: string;
  senderElo: number;
  text: string;
  inviteRoomCode?: string;
  clockSeconds?: number;
}): Promise<void> {
  const cleanText = opts.text.trim().slice(0, 240);
  if (!cleanText) return;
  const { db } = getFirebaseServices();
  await addDoc(collection(db, 'global_chat'), {
    senderUid: opts.senderUid,
    senderName: normalizePlayerDisplayName(opts.senderName),
    senderElo: clampElo(opts.senderElo),
    senderFriendId: uidToFriendId(opts.senderUid),
    text: cleanText,
    inviteRoomCode: opts.inviteRoomCode ?? null,
    clockSeconds: opts.clockSeconds ?? null,
    createdAt: serverTimestamp(),
  });
}

export function subscribeGlobalChat(
  onUpdate: (msgs: GlobalChatItem[]) => void
): Unsubscribe {
  const { db } = getFirebaseServices();
  const q = query(collection(db, 'global_chat'), orderBy('createdAt', 'desc'), limit(40));
  return onSnapshot(
    q,
    (snap) => {
      const msgs: GlobalChatItem[] = snap.docs
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          const uid = String(raw.senderUid ?? '');
          return {
            id: d.id,
            senderUid: uid,
            senderName: normalizePlayerDisplayName(String(raw.senderName ?? 'Người chơi')),
            senderElo: clampElo(Number(raw.senderElo ?? 1000)),
            senderFriendId: String(raw.senderFriendId ?? (uid ? uidToFriendId(uid) : '')),
            text: String(raw.text ?? ''),
            inviteRoomCode: typeof raw.inviteRoomCode === 'string' ? raw.inviteRoomCode : null,
            clockSeconds: typeof raw.clockSeconds === 'number' ? raw.clockSeconds : null,
            createdAtMs: timestampToMs(raw.createdAt, Date.now()),
          };
        })
        .reverse();
      onUpdate(msgs);
    },
    () => {
      onUpdate([]);
    }
  );
}

export async function sendRoomChatMessage(
  roomCode: string,
  opts: { senderUid: string; senderName: string; text: string }
): Promise<void> {
  const cleanText = opts.text.trim().slice(0, 240);
  if (!cleanText || !roomCode) return;
  const { db } = getFirebaseServices();
  await addDoc(collection(db, 'rooms', roomCode, 'messages'), {
    senderUid: opts.senderUid,
    senderName: normalizePlayerDisplayName(opts.senderName),
    text: cleanText,
    createdAt: serverTimestamp(),
  });
}

export function subscribeRoomChat(
  roomCode: string,
  onUpdate: (msgs: RoomChatItem[]) => void
): Unsubscribe {
  const { db } = getFirebaseServices();
  const q = query(
    collection(db, 'rooms', roomCode, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(40)
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs: RoomChatItem[] = snap.docs
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            senderUid: String(raw.senderUid ?? ''),
            senderName: normalizePlayerDisplayName(String(raw.senderName ?? 'Người chơi')),
            text: String(raw.text ?? ''),
            createdAtMs: timestampToMs(raw.createdAt, Date.now()),
          };
        })
        .reverse();
      onUpdate(msgs);
    },
    () => {
      onUpdate([]);
    }
  );
}
