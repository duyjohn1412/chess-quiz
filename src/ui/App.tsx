import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CFG } from '../config/defaults';
import { HostSession } from '../net/host';
import { GuestSession } from '../net/guest';
import {
  AccountInfo,
  commitRankedMatchResult,
  ensureAnonymousAuth,
  extractAccountInfo,
  fetchLeaderboard,
  getFirebaseServices,
  loadOrCreateRankProfile,
  subscribeAuthState,
  syncRankDisplayName,
} from '../net/firebaseClient';
import { hasFirebaseConfig } from '../net/firebaseConfig';
import { QuickMatchAssigned, QuickMatchController } from '../net/firebaseMatchmaking';
import { FirebaseGuestSession, FirebaseHostSession } from '../net/firebaseRoom';
import { C2H, QuizPayload, ResultPayload, ShopPayload } from '../net/protocol';
import { extractCodeFromInput, isQuickRoomCode } from '../net/roomCode';
import {
  FriendshipItem,
  RoomChatItem,
  sendDirectMessage,
  sendRoomChatMessage,
  subscribeRoomChat,
  syncSocialProfile,
} from '../net/socialSystem';
import { HotseatSession } from '../engine/hotseatSession';
import { BUILTIN_BANKS, DEFAULT_BANK, listBanksFromIdb } from '../quiz/bankLoader';
import {
  EloUpdateResult,
  loadCachedRankProfile,
  outcomeFromGameOver,
  RankProfile,
  saveCachedRankProfile,
} from '../rank/rankSystem';
import { GameEvent, GameOverInfo, PlayerId, PublicState, QuestionBank } from '../types/game';
import { soundFx } from '../utils/sound';
import { AuthModal } from './components/AuthModal';
import { SnowfallOverlay } from './components/SnowfallOverlay';
import { UpdateAnnouncementModal } from './components/UpdateAnnouncementModal';
import { HomePage, QuickMatchUiState } from './pages/HomePage';
import { HostLobbyPage } from './pages/HostLobbyPage';
import { GamePage } from './pages/GamePage';

type Screen =
  | { kind: 'home' }
  | { kind: 'host' }
  | { kind: 'guest' }
  | { kind: 'hotseat' };

export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
  const [playerName, setPlayerName] = useState<string>(
    () => localStorage.getItem('cqPlayerName') || 'Người chơi'
  );
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>(DEFAULT_BANK.bank);

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [firebaseStatusText, setFirebaseStatusText] = useState<string | undefined>(undefined);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialTab, setAuthInitialTab] = useState<'login' | 'register'>('login');
  const [updateOpen, setUpdateOpen] = useState<boolean>(
    () => !localStorage.getItem('cq_update_christmas_v2_seen')
  );
  const [snowEnabled, setSnowEnabled] = useState<boolean>(
    () => localStorage.getItem('cq_snow_enabled') !== '0'
  );
  const [roomChatMsgs, setRoomChatMsgs] = useState<RoomChatItem[]>([]);
  const [localBotChatMsgs, setLocalBotChatMsgs] = useState<RoomChatItem[]>([]);
  const [isBotMatch, setIsBotMatch] = useState(false);
  const [botOpponentName, setBotOpponentName] = useState('');
  const [rankProfile, setRankProfile] = useState<RankProfile | null>(() => loadCachedRankProfile());
  const [leaderboard, setLeaderboard] = useState<RankProfile[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [quickMatch, setQuickMatch] = useState<QuickMatchUiState>({
    searching: false,
    elapsedSec: 0,
    queueCount: 1,
    clockSeconds: 300,
  });

  const [transport, setTransport] = useState<'firebase' | 'peerjs' | 'hotseat'>('firebase');
  const [isRankedMatch, setIsRankedMatch] = useState(false);
  const [rankDiff, setRankDiff] = useState<EloUpdateResult | null>(null);

  const [state, setState] = useState<PublicState | null>(null);
  const [stateReceivedAtMs, setStateReceivedAtMs] = useState(Date.now());
  const [viewerId, setViewerId] = useState<PlayerId | 'spectator'>('p1');
  const [roomCode, setRoomCode] = useState<string>('');
  const [spectatorCount, setSpectatorCount] = useState(0);

  const [quiz, setQuiz] = useState<QuizPayload | null>(null);
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [shop, setShop] = useState<ShopPayload | null>(null);
  const [gameOver, setGameOver] = useState<GameOverInfo | null>(null);
  const [flashEvent, setFlashEvent] = useState<{ id: string; count: number } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // State riêng cho Hot-seat
  const [hotseatPrivacy, setHotseatPrivacy] = useState(true);
  const [hotseatCurtainLocked, setHotseatCurtainLocked] = useState(false);
  const [hotseatTargetActor, setHotseatTargetActor] = useState<PlayerId>('p1');
  const [hotseatCurtainReason, setHotseatCurtainReason] = useState('');
  const hotseatMapsRef = useRef<{
    quizzes: Record<PlayerId, QuizPayload | null>;
    results: Record<PlayerId, ResultPayload | null>;
    shops: Record<PlayerId, ShopPayload | null>;
    lastPhase?: string;
    lastViewer?: PlayerId;
  }>({
    quizzes: { p1: null, p2: null },
    results: { p1: null, p2: null },
    shops: { p1: null, p2: null },
  });

  const hostRef = useRef<HostSession | null>(null);
  const guestRef = useRef<GuestSession | null>(null);
  const fbHostRef = useRef<FirebaseHostSession | null>(null);
  const fbGuestRef = useRef<FirebaseGuestSession | null>(null);
  const quickCtrlRef = useRef<QuickMatchController | null>(null);
  const quickTimerRef = useRef<number | null>(null);
  const hotseatRef = useRef<HotseatSession | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const rankNameDebounceRef = useRef<number | null>(null);
  const pendingChallengeRef = useRef<{
    pairId: string;
    peerUid: string;
    peerName: string;
    clockSeconds: number;
  } | null>(null);

  const matchMetaRef = useRef<{
    isRanked: boolean;
    roomCode: string;
    viewerId: PlayerId | 'spectator';
    uid: string | null;
    p1Elo: number;
    p2Elo: number;
    committed: boolean;
  }>({
    isRanked: false,
    roomCode: '',
    viewerId: 'p1',
    uid: null,
    p1Elo: 1000,
    p2Elo: 1000,
    committed: false,
  });

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const selectedBank =
    BUILTIN_BANKS.find((b) => b.bank === selectedBankId) ??
    banks.find((b) => b.bank === selectedBankId) ??
    DEFAULT_BANK;

  const refreshBanks = useCallback(() => {
    void listBanksFromIdb().then(setBanks);
  }, []);

  useEffect(() => {
    refreshBanks();
  }, [refreshBanks]);

  const refreshLeaderboard = useCallback(async () => {
    if (!hasFirebaseConfig()) return;
    setLeaderboardLoading(true);
    try {
      const rows = await fetchLeaderboard(20);
      setLeaderboard(rows);
    } catch {
      // keep existing leaderboard
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  // Khởi tạo Firebase Auth (Guest hoặc Tài khoản đã đăng nhập) + nạp Rank Profile + BXH
  useEffect(() => {
    let mounted = true;
    if (!hasFirebaseConfig()) {
      setFirebaseStatusText('Chế độ trực tuyến tạm chưa bật — dùng P2P / 1 máy.');
      return;
    }

    const unsubAuth = subscribeAuthState((u) => {
      if (mounted) {
        setAccount(extractAccountInfo(u));
      }
    });

    (async () => {
      try {
        const user = await ensureAnonymousAuth();
        if (!mounted) return;
        const acc = extractAccountInfo(user);
        setAccount(acc);
        setFirebaseUid(user.uid);
        matchMetaRef.current.uid = user.uid;
        const prof = await loadOrCreateRankProfile(user.uid, playerName, !user.isAnonymous);
        if (!mounted) return;
        setRankProfile(prof);
        if (!user.isAnonymous && prof.name && prof.name !== 'Người chơi') {
          setPlayerName(prof.name);
          localStorage.setItem('cqPlayerName', prof.name);
        }
        setFirebaseReady(true);
        setFirebaseStatusText(undefined);
        void syncSocialProfile(prof, acc);
        void refreshLeaderboard();
      } catch (err) {
        if (!mounted) return;
        setFirebaseReady(false);
        setFirebaseStatusText(
          `Máy chủ tạm chưa kết nối (${err instanceof Error ? err.message : 'offline'}) — vẫn chơi P2P/1 máy bình thường.`
        );
      }
    })();

    return () => {
      mounted = false;
      unsubAuth();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopQuickSearch = useCallback(() => {
    if (quickTimerRef.current !== null) {
      clearInterval(quickTimerRef.current);
      quickTimerRef.current = null;
    }
    if (quickCtrlRef.current) {
      void quickCtrlRef.current.cancel();
      quickCtrlRef.current = null;
    }
    setQuickMatch((prev) => ({ ...prev, searching: false, elapsedSec: 0 }));
  }, []);

  const firebaseUidRef = useRef<string | null>(firebaseUid);
  firebaseUidRef.current = firebaseUid;
  const accountRef = useRef<AccountInfo | null>(account);
  accountRef.current = account;
  const rankEloRef = useRef<number>(rankProfile?.elo ?? 1000);
  rankEloRef.current = rankProfile?.elo ?? 1000;
  const playerNameRef = useRef<string>(playerName);
  playerNameRef.current = playerName;

  const cleanupSessions = useCallback(() => {
    stopQuickSearch();
    hostRef.current?.destroy();
    hostRef.current = null;
    guestRef.current?.destroy();
    guestRef.current = null;
    fbHostRef.current?.destroy();
    fbHostRef.current = null;
    fbGuestRef.current?.destroy();
    fbGuestRef.current = null;
    hotseatRef.current?.destroy();
    hotseatRef.current = null;
    setState(null);
    setQuiz(null);
    setResult(null);
    setShop(null);
    setGameOver(null);
    setRankDiff(null);
    setIsRankedMatch(false);
    setIsBotMatch(false);
    setBotOpponentName('');
    setRoomChatMsgs([]);
    setLocalBotChatMsgs([]);
    setFlashEvent(null);
    setRoomCode('');
    setSpectatorCount(0);
    setHotseatCurtainLocked(false);
    matchMetaRef.current = {
      isRanked: false,
      roomCode: '',
      viewerId: 'p1',
      uid: firebaseUidRef.current,
      p1Elo: rankEloRef.current,
      p2Elo: 1000,
      committed: false,
    };
  }, [stopQuickSearch]);

  const cleanupRef = useRef(cleanupSessions);
  cleanupRef.current = cleanupSessions;
  useEffect(() => {
    return () => {
      cleanupRef.current();
    };
  }, []);

  const handleEvent = useCallback((myId: PlayerId | 'spectator', ev: GameEvent) => {
    if (ev.kind === 'flash' && ev.target === myId) {
      setFlashEvent({ id: ev.id, count: ev.flashCount ?? 1 });
    } else if (ev.kind === 'card_blocked' || ev.kind === 'card_reflected') {
      soundFx.shield();
    }
  }, []);

  const finalizeRankedGameOver = useCallback(
    async (info: GameOverInfo) => {
      const m = matchMetaRef.current;
      if (!m.isRanked || m.committed || !m.uid || !m.roomCode) return;
      if (m.viewerId !== 'p1' && m.viewerId !== 'p2') return;
      m.committed = true;

      const myColor = m.viewerId === 'p1' ? info.stats.p1.color : info.stats.p2.color;
      const oppElo = m.viewerId === 'p1' ? m.p2Elo : m.p1Elo;
      const outcome = outcomeFromGameOver(info.winner, myColor);

      const res = await commitRankedMatchResult(m.roomCode, m.uid, outcome, oppElo);
      if (res) {
        setRankProfile(res.profile);
        setRankDiff(res.diff);
        void syncSocialProfile(res.profile, accountRef.current);
        void refreshLeaderboard();
      }
    },
    [refreshLeaderboard]
  );

  // Bảo đảm luôn có UID + Profile trước khi vào Firebase match
  const prepareFirebaseIdentity = useCallback(async () => {
    const user = await ensureAnonymousAuth();
    const acc = extractAccountInfo(user);
    setAccount(acc);
    setFirebaseUid(user.uid);
    const prof = await loadOrCreateRankProfile(user.uid, playerNameRef.current, !user.isAnonymous);
    setRankProfile(prof);
    setFirebaseReady(true);
    void syncSocialProfile(prof, acc);
    return { uid: user.uid, prof };
  }, []);

  // Mở Host PeerJS dự phòng
  const startPeerJsHost = useCallback(
    (clockSeconds: 180 | 300 | 600) => {
      cleanupSessions();
      setTransport('peerjs');
      setIsRankedMatch(false);
      const hs = new HostSession(playerName, clockSeconds, selectedBank, {
        onRoomReady: (code) => {
          setRoomCode(code);
        },
        onPeerError: (msg) => showToast(msg),
        onHostState: (st) => {
          setState(st);
          setStateReceivedAtMs(Date.now());
          if (st.phase === 'PLAYING') {
            setQuiz(null);
            setResult(null);
            setShop(null);
          }
        },
        onHostQuiz: (q) => setQuiz(q),
        onHostResult: (res) => {
          setResult(res);
          if (res?.you.isCorrect) soundFx.correct();
          else if (res) soundFx.wrong();
        },
        onHostShop: (s) => setShop(s),
        onHostEvent: (ev) => handleEvent('p1', ev),
        onHostReject: (reason) => showToast(reason),
        onHostGameOver: (info) => setGameOver(info),
        onGuestConnectionChange: (_conn, _name, specCnt) => {
          setSpectatorCount(specCnt);
        },
      });
      hostRef.current = hs;
      setViewerId('p1');
      setScreen({ kind: 'host' });
      hs.startPeer();
    },
    [cleanupSessions, handleEvent, playerName, selectedBank, showToast]
  );

  // Mở Guest/Spectator PeerJS dự phòng
  const startPeerJsGuest = useCallback(
    (code: string, role: 'player' | 'spectator') => {
      cleanupSessions();
      setTransport('peerjs');
      setIsRankedMatch(false);
      setRoomCode(code);
      setViewerId(role === 'spectator' ? 'spectator' : 'p2');
      setScreen({ kind: 'guest' });

      const gs = new GuestSession(code, playerName, role, {
        onWelcome: (pid, assignedRole) => {
          setViewerId(assignedRole === 'spectator' ? 'spectator' : (pid as PlayerId));
        },
        onState: (st) => {
          setState(st);
          setStateReceivedAtMs(Date.now());
          if (st.phase === 'PLAYING') {
            setQuiz(null);
            setResult(null);
            setShop(null);
          }
        },
        onQuiz: (q) => setQuiz(q),
        onResult: (res) => {
          setResult(res);
          if (res?.you.isCorrect) soundFx.correct();
          else if (res) soundFx.wrong();
        },
        onShop: (s) => setShop(s),
        onEvent: (ev) => handleEvent(role === 'spectator' ? 'spectator' : 'p2', ev),
        onReject: (reason) => showToast(reason),
        onGameOver: (info) => setGameOver(info),
        onHostLeft: () => {
          showToast('Chủ phòng đã đóng phòng.');
        },
        onError: (msg) => showToast(msg),
      });
      guestRef.current = gs;
      gs.connect();
    },
    [cleanupSessions, handleEvent, playerName, showToast]
  );

  // Mở phòng riêng Online (Firebase ưu tiên -> tự chuyển PeerJS nếu offline/lỗi)
  const startHostOnline = useCallback(
    async (clockSeconds: 180 | 300 | 600, challengeFriend?: FriendshipItem) => {
      pendingChallengeRef.current = challengeFriend
        ? {
            pairId: challengeFriend.pairId,
            peerUid: challengeFriend.peerUid,
            peerName: challengeFriend.peerName,
            clockSeconds,
          }
        : null;
      if (!hasFirebaseConfig()) {
        pendingChallengeRef.current = null;
        startPeerJsHost(clockSeconds);
        return;
      }
      cleanupSessions();
      try {
        const { uid, prof } = await prepareFirebaseIdentity();
        setTransport('firebase');
        setIsRankedMatch(false);
        matchMetaRef.current = {
          isRanked: false,
          roomCode: '',
          viewerId: 'p1',
          uid,
          p1Elo: prof.elo,
          p2Elo: 1000,
          committed: false,
        };

        const fh = new FirebaseHostSession({
          mode: 'private',
          hostUid: uid,
          hostName: prof.name,
          hostElo: prof.elo,
          clockSeconds,
          bank: selectedBank,
          callbacks: {
            onRoomReady: (code) => {
              setRoomCode(code);
              matchMetaRef.current.roomCode = code;
              const ch = pendingChallengeRef.current;
              if (ch && firebaseUidRef.current) {
                pendingChallengeRef.current = null;
                void sendDirectMessage({
                  pairId: ch.pairId,
                  fromUid: firebaseUidRef.current,
                  fromName: playerNameRef.current || prof.name,
                  toUid: ch.peerUid,
                  text: `Mời bạn vào phòng riêng ${code} (${clockSeconds / 60} phút) để so tài!`,
                  inviteRoomCode: code,
                  clockSeconds,
                })
                  .then(() => {
                    showToast(`Đã gửi lời mời phòng ${code} tới ${ch.peerName}!`);
                  })
                  .catch(() => {});
              }
            },
            onPeerError: (msg) => showToast(msg),
            onHostState: (st) => {
              setState(st);
              setStateReceivedAtMs(Date.now());
              if (st.phase === 'PLAYING') {
                setQuiz(null);
                setResult(null);
                setShop(null);
              }
            },
            onHostQuiz: (q) => setQuiz(q),
            onHostResult: (res) => {
              setResult(res);
              if (res?.you.isCorrect) soundFx.correct();
              else if (res) soundFx.wrong();
            },
            onHostShop: (s) => setShop(s),
            onHostEvent: (ev) => handleEvent('p1', ev),
            onHostReject: (reason) => showToast(reason),
            onHostGameOver: (info) => setGameOver(info),
            onGuestConnectionChange: (_conn, _name, specCnt) => {
              setSpectatorCount(specCnt);
            },
          },
        });
        fbHostRef.current = fh;
        setViewerId('p1');
        setScreen({ kind: 'host' });
        await fh.start();
      } catch (err) {
        showToast(
          `Không tạo được phòng trực tuyến (${err instanceof Error ? err.message : 'lỗi mạng'}) — chuyển sang P2P.`
        );
        startPeerJsHost(clockSeconds);
      }
    },
    [
      cleanupSessions,
      handleEvent,
      prepareFirebaseIdentity,
      selectedBank,
      showToast,
      startPeerJsHost,
    ]
  );

  // Tham gia phòng bằng mã 6 ký tự hoặc link (tự động thử Firebase rồi Fallback PeerJS)
  const joinOnlineRoom = useCallback(
    async (rawCode: string, role: 'player' | 'spectator') => {
      const code = rawCode.trim().toUpperCase();
      if (!hasFirebaseConfig()) {
        startPeerJsGuest(code, role);
        return;
      }

      cleanupSessions();
      setTransport('firebase');
      setRoomCode(code);
      setViewerId(role === 'spectator' ? 'spectator' : 'p2');
      setScreen({ kind: 'guest' });

      try {
        const { uid, prof } = await prepareFirebaseIdentity();
        const fg = new FirebaseGuestSession({
          code,
          uid,
          name: prof.name,
          elo: prof.elo,
          role,
          isQuick: isQuickRoomCode(code),
          callbacks: {
            onWelcome: (pid, assignedRole) => {
              const vid = assignedRole === 'spectator' ? 'spectator' : (pid as PlayerId);
              setViewerId(vid);
              matchMetaRef.current.viewerId = vid;
              matchMetaRef.current.roomCode = code;
              matchMetaRef.current.uid = uid;
            },
            onState: (st) => {
              setState(st);
              setStateReceivedAtMs(Date.now());
              matchMetaRef.current.p1Elo = st.p1.elo ?? 1000;
              matchMetaRef.current.p2Elo = st.p2.elo ?? 1000;
              if (st.phase === 'PLAYING') {
                setQuiz(null);
                setResult(null);
                setShop(null);
              }
            },
            onQuiz: (q) => setQuiz(q),
            onResult: (res) => {
              setResult(res);
              if (res?.you.isCorrect) soundFx.correct();
              else if (res) soundFx.wrong();
            },
            onShop: (s) => setShop(s),
            onEvent: (ev) => handleEvent(role === 'spectator' ? 'spectator' : 'p2', ev),
            onReject: (reason) => showToast(reason),
            onGameOver: (info) => {
              setGameOver(info);
              void finalizeRankedGameOver(info);
            },
            onHostLeft: () => {
              showToast('Chủ phòng đã đóng phòng.');
            },
            onError: (msg) => showToast(msg),
          },
        });
        fbGuestRef.current = fg;
        const status = await fg.connect();
        if (status === 'not_found') {
          fg.destroy();
          fbGuestRef.current = null;
          if (!isQuickRoomCode(code)) {
            startPeerJsGuest(code, role);
          } else {
            showToast(`Không tìm thấy phòng ${code}.`);
          }
          return;
        }
        const ranked = fg.getRankedFlag();
        setIsRankedMatch(ranked);
        matchMetaRef.current.isRanked = ranked;
      } catch (err) {
        if (!isQuickRoomCode(code)) {
          startPeerJsGuest(code, role);
        } else {
          showToast(
            `Không vào được phòng ${code}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    },
    [
      cleanupSessions,
      finalizeRankedGameOver,
      handleEvent,
      prepareFirebaseIdentity,
      showToast,
      startPeerJsGuest,
    ]
  );

  // Vào trận sau khi Ghép trận nhanh thành công
  const launchMatchedQuickGame = useCallback(
    async (match: QuickMatchAssigned) => {
      cleanupSessions();
      setTransport('firebase');
      setIsRankedMatch(true);
      setRoomCode(match.roomCode);

      if (match.role === 'host') {
        matchMetaRef.current = {
          isRanked: true,
          roomCode: match.roomCode,
          viewerId: 'p1',
          uid: match.hostUid,
          p1Elo: match.hostElo,
          p2Elo: match.guestElo,
          committed: false,
        };
        const isBot = match.guestUid.startsWith('bot_') || Boolean(match.isBot);
        setIsBotMatch(isBot);
        setBotOpponentName(isBot ? match.guestName : '');
        if (isBot) {
          showToast(`⚡ Ghép trận với ${match.guestName} (${match.guestElo} Elo)`);
        }
        const fh = new FirebaseHostSession({
          mode: 'quick',
          existingCode: match.roomCode,
          hostUid: match.hostUid,
          hostName: match.hostName,
          hostElo: match.hostElo,
          guestUid: match.guestUid,
          guestName: match.guestName,
          guestElo: match.guestElo,
          clockSeconds: match.clockSeconds,
          bank: DEFAULT_BANK,
          botOpponent: isBot
            ? {
                uid: match.guestUid,
                name: match.guestName,
                elo: match.guestElo,
              }
            : undefined,
          callbacks: {
            onRoomReady: (c) => setRoomCode(c),
            onPeerError: (msg) => showToast(msg),
            onHostState: (st) => {
              setState(st);
              setStateReceivedAtMs(Date.now());
              if (st.phase === 'PLAYING') {
                setQuiz(null);
                setResult(null);
                setShop(null);
              }
            },
            onHostQuiz: (q) => setQuiz(q),
            onHostResult: (res) => {
              setResult(res);
              if (res?.you.isCorrect) soundFx.correct();
              else if (res) soundFx.wrong();
            },
            onHostShop: (s) => setShop(s),
            onHostEvent: (ev) => handleEvent('p1', ev),
            onHostReject: (reason) => showToast(reason),
            onHostGameOver: (info) => {
              setGameOver(info);
              void finalizeRankedGameOver(info);
            },
            onGuestConnectionChange: (_c, _n, specCnt) => setSpectatorCount(specCnt),
          },
        });
        fbHostRef.current = fh;
        setViewerId('p1');
        setScreen({ kind: 'host' });
        await fh.start();
      } else {
        matchMetaRef.current = {
          isRanked: true,
          roomCode: match.roomCode,
          viewerId: 'p2',
          uid: match.guestUid,
          p1Elo: match.hostElo,
          p2Elo: match.guestElo,
          committed: false,
        };
        const fg = new FirebaseGuestSession({
          code: match.roomCode,
          uid: match.guestUid,
          name: match.guestName,
          elo: match.guestElo,
          role: 'player',
          isQuick: true,
          callbacks: {
            onWelcome: () => setViewerId('p2'),
            onState: (st) => {
              setState(st);
              setStateReceivedAtMs(Date.now());
              if (st.phase === 'PLAYING') {
                setQuiz(null);
                setResult(null);
                setShop(null);
              }
            },
            onQuiz: (q) => setQuiz(q),
            onResult: (res) => {
              setResult(res);
              if (res?.you.isCorrect) soundFx.correct();
              else if (res) soundFx.wrong();
            },
            onShop: (s) => setShop(s),
            onEvent: (ev) => handleEvent('p2', ev),
            onReject: (reason) => showToast(reason),
            onGameOver: (info) => {
              setGameOver(info);
              void finalizeRankedGameOver(info);
            },
            onHostLeft: () => showToast('Đối thủ đã thoát trận.'),
            onError: (msg) => showToast(msg),
          },
        });
        fbGuestRef.current = fg;
        setViewerId('p2');
        setScreen({ kind: 'guest' });
        await fg.connect();
      }
    },
    [cleanupSessions, finalizeRankedGameOver, handleEvent, showToast]
  );

  // Bắt đầu tìm trận nhanh (Ranked)
  const startQuickMatch = useCallback(
    async (clockSeconds: 180 | 300 | 600) => {
      cleanupSessions();
      try {
        const { uid, prof } = await prepareFirebaseIdentity();
        setQuickMatch({
          searching: true,
          elapsedSec: 0,
          queueCount: 1,
          clockSeconds,
        });
        quickTimerRef.current = window.setInterval(() => {
          setQuickMatch((prev) =>
            prev.searching ? { ...prev, elapsedSec: prev.elapsedSec + 1 } : prev
          );
        }, 1000);

        const ctrl = new QuickMatchController({
          uid,
          name: prof.name,
          elo: prof.elo,
          clockSeconds,
          callbacks: {
            onWaiting: (cnt) => {
              setQuickMatch((prev) => ({ ...prev, queueCount: cnt }));
            },
            onMatched: (match) => {
              if (quickTimerRef.current !== null) {
                clearInterval(quickTimerRef.current);
                quickTimerRef.current = null;
              }
              quickCtrlRef.current = null;
              setQuickMatch((prev) => ({ ...prev, searching: false }));
              void launchMatchedQuickGame(match);
            },
            onError: (msg) => {
              showToast(msg);
              stopQuickSearch();
            },
          },
        });
        quickCtrlRef.current = ctrl;
        await ctrl.start();
      } catch (err) {
        stopQuickSearch();
        showToast(
          `Không mở được hàng chờ Ranked: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    },
    [
      cleanupSessions,
      launchMatchedQuickGame,
      prepareFirebaseIdentity,
      showToast,
      stopQuickSearch,
    ]
  );

  // Tự động đọc hash #/join/CODE hoặc #/watch/CODE lúc mở trang hoặc khi dán link vào tab đang mở
  useEffect(() => {
    const checkHash = () => {
      const h = window.location.hash;
      if (!h) return;
      const parsed = extractCodeFromInput(h);
      if (parsed && parsed.role) {
        void joinOnlineRoom(parsed.code, parsed.role);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, [joinOnlineRoom]);

  // Khởi động chế độ 1 máy Hot-seat
  const startHotseat = useCallback(
    (p1Name: string, p2Name: string, clockSeconds: 180 | 300 | 600, privacy: boolean) => {
      cleanupSessions();
      setTransport('hotseat');
      setIsRankedMatch(false);
      setHotseatPrivacy(privacy);
      hotseatMapsRef.current = {
        quizzes: { p1: null, p2: null },
        results: { p1: null, p2: null },
        shops: { p1: null, p2: null },
        lastPhase: undefined,
        lastViewer: undefined,
      };

      const hs = new HotseatSession(p1Name, p2Name, clockSeconds, selectedBank, {
        onState: (st, suggestedActor, currentViewer) => {
          setState(st);
          setStateReceivedAtMs(Date.now());
          const maps = hotseatMapsRef.current;

          if (st.phase === 'PLAYING') {
            maps.quizzes = { p1: null, p2: null };
            maps.results = { p1: null, p2: null };
            maps.shops = { p1: null, p2: null };
            setQuiz(null);
            setResult(null);
            setShop(null);
          }

          if (suggestedActor !== currentViewer && st.phase !== 'GAME_OVER' && st.phase !== 'RESULT') {
            if (privacy) {
              hs.setPaused(true);
              setHotseatTargetActor(suggestedActor);
              const reason = st.pendingHarmful
                ? 'Có thẻ gây hại đang chờ quyết định Lá chắn (2s)!'
                : st.phase === 'PRE_QUIZ'
                  ? 'Chọn thẻ Nhóm 4 trước khi vào câu hỏi.'
                  : st.phase === 'QUIZ'
                    ? `Đến lượt trả lời câu hỏi trắc nghiệm (${CFG.quizSeconds}s).`
                    : st.phase === 'SHOP'
                      ? `Đến lượt mua thẻ tại Cửa hàng (${CFG.shopSeconds}s).`
                      : 'Đến lượt đi cờ của bạn.';
              setHotseatCurtainReason(reason);
              setHotseatCurtainLocked(true);
            } else {
              hs.setActiveViewer(suggestedActor);
              hs.setPaused(false, suggestedActor);
              setViewerId(suggestedActor);
              setQuiz(maps.quizzes[suggestedActor]);
              setResult(maps.results[suggestedActor]);
              setShop(maps.shops[suggestedActor]);
            }
          } else {
            setViewerId(currentViewer);
            setQuiz(maps.quizzes[currentViewer]);
            setResult(maps.results[currentViewer]);
            setShop(maps.shops[currentViewer]);
          }
        },
        onQuiz: (pid, q) => {
          hotseatMapsRef.current.quizzes[pid] = q;
          if (hs.getActiveViewer() === pid) setQuiz(q);
        },
        onResult: (pid, r) => {
          hotseatMapsRef.current.results[pid] = r;
          if (hs.getActiveViewer() === pid) setResult(r);
        },
        onShop: (pid, s) => {
          hotseatMapsRef.current.shops[pid] = s;
          if (hs.getActiveViewer() === pid) setShop(s);
        },
        onEvent: (pid, ev) => {
          if (hs.getActiveViewer() === pid || ev.kind === 'flash') {
            handleEvent(pid, ev);
          }
        },
        onReject: (reason) => showToast(reason),
        onGameOver: (info) => {
          setHotseatCurtainLocked(false);
          setGameOver(info);
        },
      });

      hotseatRef.current = hs;
      setScreen({ kind: 'hotseat' });
      hs.start();
    },
    [cleanupSessions, handleEvent, selectedBank, showToast]
  );

  const activeHostCoord = fbHostRef.current?.coordinator ?? hostRef.current?.coordinator ?? null;
  const sendToHost = (msg: C2H) => {
    if (fbGuestRef.current) fbGuestRef.current.send(msg);
    else if (guestRef.current) guestRef.current.send(msg);
  };

  // Action dispatcher thống nhất cho Firebase Host/Guest + PeerJS Host/Guest + Hotseat
  const act = {
    onReady: () => sendToHost({ t: 'READY' }),
    onMove: (from: string, to: string, promo?: 'q' | 'r' | 'b' | 'n') => {
      soundFx.move();
      if (activeHostCoord) activeHostCoord.handleMove('p1', from, to, promo);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'MOVE', from, to, promo });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleMove(viewerId as PlayerId, from, to, promo);
      }
    },
    onUseCard: (uid: string) => {
      if (activeHostCoord) activeHostCoord.handleUseCard('p1', uid);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'USE', uid });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleUseCard(viewerId as PlayerId, uid);
      }
    },
    onUseShield: (uid?: string) => {
      if (activeHostCoord) activeHostCoord.handleShield('p1', uid);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'SHIELD', uid });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleShield(viewerId as PlayerId, uid);
      }
    },
    onPreQuizPass: () => {
      if (activeHostCoord) activeHostCoord.handlePreQuizPass('p1');
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'PRE_QUIZ_PASS' });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handlePreQuizPass(viewerId as PlayerId);
      }
    },
    onAnswerQuiz: (qid: string, choice: number) => {
      if (activeHostCoord) activeHostCoord.handleQuizAnswer('p1', qid, choice);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'ANSWER', qid, choice });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleQuizAnswer(viewerId as PlayerId, qid, choice);
      }
    },
    onRerollQuiz: () => {
      if (activeHostCoord) activeHostCoord.handleReroll('p1');
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'REROLL' });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleReroll(viewerId as PlayerId);
      }
    },
    onBuyCard: (slot: number) => {
      soundFx.buy();
      if (activeHostCoord) activeHostCoord.handleBuyCard('p1', slot);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'BUY', slot });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleBuyCard(viewerId as PlayerId, slot);
      }
    },
    onDropCard: (uid: string) => {
      if (activeHostCoord) activeHostCoord.handleDropCard('p1', uid);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'DROP', uid });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleDropCard(viewerId as PlayerId, uid);
      }
    },
    onRefreshShop: () => {
      if (activeHostCoord) activeHostCoord.handleShopRefresh('p1');
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'SHOP_REFRESH' });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleShopRefresh(viewerId as PlayerId);
      }
    },
    onDoneShop: () => {
      if (activeHostCoord) activeHostCoord.handleShopDone('p1');
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'SHOP_DONE' });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleShopDone(viewerId as PlayerId);
      }
    },
    onChooseFreeM2: (cardId: string) => {
      soundFx.buy();
      if (activeHostCoord) activeHostCoord.handleChooseFreeM2('p1', cardId);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'CHOOSE_FREE_M2', cardId });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleChooseFreeM2(viewerId as PlayerId, cardId);
      }
    },
    onOfferDraw: () => {
      if (activeHostCoord) activeHostCoord.handleDrawOffer('p1');
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'DRAW_OFFER' });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleDrawOffer(viewerId as PlayerId);
      }
    },
    onReplyDraw: (accept: boolean) => {
      if (activeHostCoord) activeHostCoord.handleDrawReply('p1', accept);
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'DRAW_REPLY', accept });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleDrawReply(viewerId as PlayerId, accept);
      }
    },
    onResign: () => {
      if (activeHostCoord) activeHostCoord.handleResign('p1');
      else if (fbGuestRef.current || guestRef.current) sendToHost({ t: 'RESIGN' });
      else if (hotseatRef.current) {
        hotseatRef.current.coordinator.handleResign(viewerId as PlayerId);
      }
    },
    onRematch:
      !isRankedMatch && (activeHostCoord || hotseatRef.current)
        ? () => {
            setGameOver(null);
            if (activeHostCoord) activeHostCoord.startGame();
            else if (hotseatRef.current) {
              hotseatRef.current.coordinator.startGame();
            }
          }
        : undefined,
    onExit: () => {
      cleanupSessions();
      setScreen({ kind: 'home' });
      void refreshLeaderboard();
    },
  };

  // Đăng ký kênh chat trong phòng
  useEffect(() => {
    if (transport !== 'firebase' || !roomCode || screen.kind === 'home' || !firebaseReady) {
      setRoomChatMsgs([]);
      return;
    }
    return subscribeRoomChat(roomCode, setRoomChatMsgs);
  }, [firebaseReady, roomCode, screen.kind, transport]);

  const combinedChatMsgs = useMemo(
    () => [...roomChatMsgs, ...localBotChatMsgs].sort((a, b) => a.createdAtMs - b.createdAtMs),
    [localBotChatMsgs, roomChatMsgs]
  );

  const handleSendMatchChat = useCallback(
    async (text: string) => {
      const uid = firebaseUidRef.current || 'local-player';
      const senderName = rankProfile?.name || playerNameRef.current || 'Người chơi';
      if (transport === 'firebase' && roomCode && firebaseUidRef.current) {
        try {
          await sendRoomChatMessage(roomCode, {
            senderUid: firebaseUidRef.current,
            senderName,
            text,
          });
        } catch (err) {
          showToast(`Không gửi được tin nhắn: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      } else {
        setLocalBotChatMsgs((prev) => [
          ...prev,
          { id: `local-${Date.now()}`, senderUid: uid, senderName, text, createdAtMs: Date.now() },
        ]);
      }

      if (isBotMatch) {
        const lower = text.toLowerCase();
        let reply = 'Nước đi thú vị đấy! Chúc bạn chơi vui nhé.';
        if (lower.includes('chào') || lower.includes('hi') || lower.includes('chúc')) {
          reply = 'Chào bạn! Chúc bạn có một ván cờ thật hấp dẫn mùa Giáng Sinh!';
        } else if (lower.includes('hay') || lower.includes('đỉnh') || lower.includes('tốt')) {
          reply = 'Cảm ơn bạn nhé! Mình cũng đang tập trung tính nước tiếp theo đây.';
        } else if (lower.includes('đợi') || lower.includes('chờ')) {
          reply = 'Cứ thong thả suy nghĩ nhé, mình chờ bạn!';
        } else if (lower.includes('tái đấu') || lower.includes('rematch')) {
          reply = 'Sau ván này bạn nhấn Tìm trận nhanh là chúng ta có thể gặp lại nhau ngay!';
        }
        window.setTimeout(() => {
          setLocalBotChatMsgs((prev) => [
            ...prev,
            {
              id: `bot-reply-${Date.now()}`,
              senderUid: 'bot_opponent',
              senderName: botOpponentName || 'Đối thủ AI',
              text: reply,
              createdAtMs: Date.now(),
            },
          ]);
        }, 700);
      }
    },
    [botOpponentName, isBotMatch, rankProfile?.name, roomCode, showToast, transport]
  );

  const handleAuthSuccess = useCallback(
    (res: { profile: RankProfile; message: string }) => {
      const { auth } = getFirebaseServices();
      const user = auth.currentUser;
      const acc = extractAccountInfo(user);
      setAccount(acc);
      if (user) {
        setFirebaseUid(user.uid);
        matchMetaRef.current.uid = user.uid;
      }
      setRankProfile(res.profile);
      setPlayerName(res.profile.name);
      localStorage.setItem('cqPlayerName', res.profile.name);
      void syncSocialProfile(res.profile, acc);
      void refreshLeaderboard();
      showToast(res.message);
    },
    [refreshLeaderboard, showToast]
  );

  const handleToggleSnow = useCallback(() => {
    setSnowEnabled((prev) => {
      const next = !prev;
      localStorage.setItem('cq_snow_enabled', next ? '1' : '0');
      return next;
    });
  }, []);

  let content: React.ReactNode;

  if (screen.kind === 'home' || !state) {
    if (screen.kind === 'guest' && !state) {
      content = (
        <main className="app-shell">
          <div className="panel col" style={{ maxInlineSize: 460, marginInline: 'auto', textAlign: 'center' }}>
            <h2 style={{ margin: 0 }}>Đang kết nối vào phòng {roomCode}…</h2>
            {toastMsg && <div className="effect-banner danger">{toastMsg}</div>}
            <button type="button" onClick={act.onExit}>
              ← Quay lại
            </button>
          </div>
        </main>
      );
    } else {
      content = (
        <HomePage
          playerName={playerName}
          onPlayerNameChange={(v) => {
            setPlayerName(v);
            localStorage.setItem('cqPlayerName', v);
            const clean = v.trim().slice(0, 24) || 'Người chơi';
            if (rankProfile) {
              const updated = { ...rankProfile, name: clean };
              setRankProfile(updated);
              saveCachedRankProfile(updated);
            }
            if (firebaseUid) {
              if (rankNameDebounceRef.current) clearTimeout(rankNameDebounceRef.current);
              rankNameDebounceRef.current = window.setTimeout(() => {
                void syncRankDisplayName(firebaseUid, v);
                if (rankProfile) {
                  void syncSocialProfile({ ...rankProfile, name: clean }, accountRef.current);
                }
              }, 800);
            }
          }}
          account={account}
          snowEnabled={snowEnabled}
          onToggleSnow={handleToggleSnow}
          onOpenAuth={(mode) => {
            setAuthInitialTab(mode ?? 'login');
            setAuthOpen(true);
          }}
          onOpenUpdates={() => setUpdateOpen(true)}
          banks={banks}
          selectedBankId={selectedBankId}
          onSelectBankId={setSelectedBankId}
          onBanksChanged={refreshBanks}
          rankProfile={rankProfile}
          leaderboard={leaderboard}
          leaderboardLoading={leaderboardLoading}
          firebaseReady={firebaseReady}
          firebaseUid={firebaseUid}
          firebaseStatusText={firebaseStatusText}
          toastMsg={toastMsg}
          onShowToast={showToast}
          quickMatch={quickMatch}
          onStartQuickMatch={(sec) => {
            void startQuickMatch(sec);
          }}
          onCancelQuickMatch={stopQuickSearch}
          onRefreshLeaderboard={() => {
            void refreshLeaderboard();
          }}
          onCreateOnlineRoom={(sec) => {
            void startHostOnline(sec);
          }}
          onJoinOnlineRoom={(code, role) => {
            void joinOnlineRoom(code, role);
          }}
          onChallengeFriend={(friend) => {
            void startHostOnline(300, friend);
          }}
          onStartHotseat={startHotseat}
        />
      );
    }
  } else if (screen.kind === 'host' && state.phase === 'LOBBY' && !isRankedMatch) {
    content = (
      <HostLobbyPage
        code={roomCode}
        transport={transport === 'peerjs' ? 'peerjs' : 'firebase'}
        state={state}
        spectatorCount={spectatorCount}
        selectedBank={selectedBank}
        onClockChange={(sec) => activeHostCoord?.setClockSeconds(sec)}
        onBankUpload={(b) => {
          refreshBanks();
          setSelectedBankId(b.bank);
          activeHostCoord?.setBank(b);
        }}
        onStartGame={() => activeHostCoord?.startGame()}
        onCancelRoom={act.onExit}
      />
    );
  } else {
    content = (
      <GamePage
        mode={
          screen.kind === 'hotseat'
            ? 'hotseat'
            : viewerId === 'spectator'
              ? 'spectator'
              : screen.kind === 'host'
                ? 'host'
                : 'guest'
        }
        transport={transport}
        isRanked={isRankedMatch}
        rankDiff={rankDiff}
        roomCode={roomCode || undefined}
        viewerId={viewerId}
        state={state}
        stateReceivedAtMs={stateReceivedAtMs}
        quiz={quiz}
        result={result}
        shop={shop}
        gameOver={gameOver}
        flashEvent={flashEvent}
        toastMsg={toastMsg}
        hotseatCurtain={
          screen.kind === 'hotseat' && hotseatPrivacy
            ? {
                locked: hotseatCurtainLocked,
                targetPlayerId: hotseatTargetActor,
                reason: hotseatCurtainReason,
                onUnlock: () => {
                  setHotseatCurtainLocked(false);
                  const hs = hotseatRef.current;
                  if (hs) {
                    hs.setPaused(false, hotseatTargetActor);
                    setViewerId(hotseatTargetActor);
                    const maps = hotseatMapsRef.current;
                    setQuiz(maps.quizzes[hotseatTargetActor]);
                    setResult(maps.results[hotseatTargetActor]);
                    setShop(maps.shops[hotseatTargetActor]);
                  }
                },
              }
            : undefined
        }
        chatMessages={combinedChatMsgs}
        myUid={firebaseUid}
        onSendChat={transport === 'firebase' && roomCode ? handleSendMatchChat : undefined}
        {...act}
      />
    );
  }

  return (
    <>
      <SnowfallOverlay enabled={snowEnabled} />
      {content}
      <AuthModal
        open={authOpen}
        initialTab={authInitialTab}
        account={account}
        currentDisplayName={playerName}
        currentElo={rankProfile?.elo ?? 1000}
        onClose={() => setAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
      />
      <UpdateAnnouncementModal
        open={updateOpen}
        isAnonymous={account?.isAnonymous ?? true}
        onClose={() => {
          localStorage.setItem('cq_update_christmas_v2_seen', '1');
          setUpdateOpen(false);
        }}
        onOpenAuth={() => {
          localStorage.setItem('cq_update_christmas_v2_seen', '1');
          setUpdateOpen(false);
          setAuthInitialTab('login');
          setAuthOpen(true);
        }}
      />
    </>
  );
};
