import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { DEFAULT_BANK } from '../quiz/bankLoader';
import { getFirebaseServices, timestampToMs } from './firebaseClient';
import { generateQuickRoomCode } from './roomCode';

export interface QuickMatchTicket {
  uid: string;
  name: string;
  elo: number;
  clockSeconds: 180 | 300 | 600;
  status: 'WAITING' | 'MATCHED';
  roomCode: string;
  hostUid: string;
  peerUid: string;
  peerName: string;
  peerElo: number;
  bankId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface QuickMatchAssigned {
  roomCode: string;
  role: 'host' | 'guest';
  hostUid: string;
  hostName: string;
  hostElo: number;
  guestUid: string;
  guestName: string;
  guestElo: number;
  clockSeconds: 180 | 300 | 600;
}

export interface QuickMatchCallbacks {
  onWaiting: (onlineInQueue: number) => void;
  onMatched: (match: QuickMatchAssigned) => void;
  onError: (msg: string) => void;
}

const STALE_QUEUE_MS = 22_000;

export function selectBestMatchCandidate(
  selfUid: string,
  selfElo: number,
  candidates: QuickMatchTicket[],
  nowMs: number = Date.now()
): QuickMatchTicket | null {
  const valid = candidates.filter(
    (c) =>
      c.uid !== selfUid &&
      c.status === 'WAITING' &&
      nowMs - c.updatedAtMs <= STALE_QUEUE_MS
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    const da = Math.abs(a.elo - selfElo);
    const db = Math.abs(b.elo - selfElo);
    if (da !== db) return da - db;
    return a.createdAtMs - b.createdAtMs;
  });
  return valid[0];
}

export class QuickMatchController {
  private uid: string;
  private name: string;
  private elo: number;
  private clockSeconds: 180 | 300 | 600;
  private callbacks: QuickMatchCallbacks;

  private active = false;
  private matchedHandled = false;
  private searchStartedAt = 0;
  private unsubSelf: Unsubscribe | null = null;
  private pollTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private unloadHandler: (() => void) | null = null;

  constructor(opts: {
    uid: string;
    name: string;
    elo: number;
    clockSeconds: 180 | 300 | 600;
    callbacks: QuickMatchCallbacks;
  }) {
    this.uid = opts.uid;
    this.name = opts.name;
    this.elo = opts.elo;
    this.clockSeconds = opts.clockSeconds;
    this.callbacks = opts.callbacks;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.matchedHandled = false;
    this.searchStartedAt = Date.now();

    const { db } = getFirebaseServices();
    const myRef = doc(db, 'queue', this.uid);

    await setDoc(myRef, {
      uid: this.uid,
      name: this.name,
      elo: this.elo,
      clockSeconds: this.clockSeconds,
      status: 'WAITING',
      roomCode: '',
      hostUid: '',
      peerUid: '',
      peerName: '',
      peerElo: 0,
      bankId: DEFAULT_BANK.bank,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (!this.active) {
      void deleteDoc(myRef).catch(() => {});
      return;
    }

    this.callbacks.onWaiting(1);

    // Lắng nghe xem đối thủ khác đã ghép mình vào trận chưa
    this.unsubSelf = onSnapshot(myRef, (snap) => {
      if (!this.active || this.matchedHandled || !snap.exists()) return;
      const d = snap.data() as Record<string, unknown>;
      if (d.status === 'MATCHED' && typeof d.roomCode === 'string' && d.roomCode.length > 0) {
        this.matchedHandled = true;
        const hostUid = String(d.hostUid ?? '');
        const isHost = hostUid === this.uid;
        const peerUid = String(d.peerUid ?? '');
        const peerName = String(d.peerName ?? 'Đối thủ');
        const peerElo = Number(d.peerElo ?? 1000);
        const match: QuickMatchAssigned = isHost
          ? {
              roomCode: d.roomCode,
              role: 'host',
              hostUid: this.uid,
              hostName: this.name,
              hostElo: this.elo,
              guestUid: peerUid,
              guestName: peerName,
              guestElo: peerElo,
              clockSeconds: this.clockSeconds,
            }
          : {
              roomCode: d.roomCode,
              role: 'guest',
              hostUid,
              hostName: peerName,
              hostElo: peerElo,
              guestUid: this.uid,
              guestName: this.name,
              guestElo: this.elo,
              clockSeconds: this.clockSeconds,
            };

        this.cleanupInternal(true);
        this.callbacks.onMatched(match);
      }
    });

    this.unloadHandler = () => {
      void deleteDoc(myRef).catch(() => {});
    };
    window.addEventListener('pagehide', this.unloadHandler);

    // Thăm dò đối thủ ngay lập tức rồi mỗi 2.2s
    void this.scanAndPair();
    this.pollTimer = window.setInterval(() => {
      void this.scanAndPair();
    }, 2200);

    // Giữ heartbeat hàng đợi mỗi 7s
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.active || this.matchedHandled) return;
      void updateDoc(myRef, { updatedAt: serverTimestamp() }).catch(() => {});
    }, 7_000);
  }

  private async scanAndPair(): Promise<void> {
    if (!this.active || this.matchedHandled) return;
    const { db } = getFirebaseServices();
    try {
      const q = query(
        collection(db, 'queue'),
        where('status', '==', 'WAITING'),
        where('clockSeconds', '==', this.clockSeconds),
        orderBy('createdAt', 'asc'),
        limit(12)
      );
      const snap = await getDocs(q);
      const now = Date.now();
      const tickets: QuickMatchTicket[] = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        return {
          uid: String(raw.uid ?? d.id),
          name: String(raw.name ?? 'Người chơi'),
          elo: Number(raw.elo ?? 1000),
          clockSeconds: Number(raw.clockSeconds ?? this.clockSeconds) as 180 | 300 | 600,
          status: raw.status === 'MATCHED' ? 'MATCHED' : 'WAITING',
          roomCode: String(raw.roomCode ?? ''),
          hostUid: String(raw.hostUid ?? ''),
          peerUid: String(raw.peerUid ?? ''),
          peerName: String(raw.peerName ?? ''),
          peerElo: Number(raw.peerElo ?? 1000),
          bankId: String(raw.bankId ?? DEFAULT_BANK.bank),
          createdAtMs: timestampToMs(raw.createdAt, now),
          updatedAtMs: timestampToMs(raw.updatedAt, now),
        };
      });

      const aliveCount = tickets.filter((t) => now - t.updatedAtMs <= STALE_QUEUE_MS).length;
      if (!this.matchedHandled) {
        this.callbacks.onWaiting(Math.max(1, aliveCount));
      }

      const opp = selectBestMatchCandidate(this.uid, this.elo, tickets, now);
      if (!opp || !this.active || this.matchedHandled) return;

      // Tie-breaker tránh 2 bên đồng thời mở 2 phòng: uid nhỏ hơn chủ động tạo trước; người mở giao dịch làm Chủ phòng (hostUid)
      if (this.uid > opp.uid && now - this.searchStartedAt < 1600) {
        return;
      }

      const roomCode = generateQuickRoomCode();
      const myRef = doc(db, 'queue', this.uid);
      const oppRef = doc(db, 'queue', opp.uid);
      const roomRef = doc(db, 'rooms', roomCode);

      await runTransaction(db, async (tx) => {
        const [mySnap, oppSnap] = await Promise.all([tx.get(myRef), tx.get(oppRef)]);
        if (!mySnap.exists() || !oppSnap.exists()) throw new Error('TICKET_GONE');
        const m = mySnap.data() as Record<string, unknown>;
        const o = oppSnap.data() as Record<string, unknown>;
        if (m.status !== 'WAITING' || o.status !== 'WAITING') {
          throw new Error('ALREADY_MATCHED');
        }
        if (Number(o.clockSeconds) !== this.clockSeconds) {
          throw new Error('CLOCK_MISMATCH');
        }

        const hostUid = this.uid;
        const hostName = this.name;
        const hostElo = this.elo;
        const guestUid = opp.uid;
        const guestName = opp.name;
        const guestElo = opp.elo;

        tx.set(roomRef, {
          code: roomCode,
          mode: 'quick',
          isRanked: true,
          phase: 'LOBBY',
          clockSeconds: this.clockSeconds,
          hostUid,
          hostName,
          hostElo,
          guestUid,
          guestName,
          guestElo,
          spectatorUids: [],
          status: 'ACTIVE',
          winner: null,
          actionSeqAck: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        tx.update(myRef, {
          status: 'MATCHED',
          roomCode,
          hostUid,
          peerUid: opp.uid,
          peerName: opp.name,
          peerElo: opp.elo,
          updatedAt: serverTimestamp(),
        });

        tx.update(oppRef, {
          status: 'MATCHED',
          roomCode,
          hostUid,
          peerUid: this.uid,
          peerName: this.name,
          peerElo: this.elo,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg === 'TICKET_GONE' ||
        msg === 'ALREADY_MATCHED' ||
        msg === 'CLOCK_MISMATCH' ||
        msg.includes('aborted due to cross-transaction')
      ) {
        return; // bình thường khi đối thủ vừa khớp hoặc thoát hàng chờ
      }
      if (this.active && !this.matchedHandled) {
        this.callbacks.onError(`Lỗi ghép trận: ${msg}`);
      }
    }
  }

  private cleanupInternal(deleteOwnTicket: boolean): void {
    this.active = false;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.unsubSelf?.();
    this.unsubSelf = null;
    if (this.unloadHandler) {
      window.removeEventListener('pagehide', this.unloadHandler);
      this.unloadHandler = null;
    }
    if (deleteOwnTicket) {
      try {
        const { db } = getFirebaseServices();
        void deleteDoc(doc(db, 'queue', this.uid)).catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  async cancel(): Promise<void> {
    this.cleanupInternal(true);
  }
}
