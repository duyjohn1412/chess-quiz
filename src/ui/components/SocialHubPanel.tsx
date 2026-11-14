import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Globe,
  MessageCircle,
  Send,
  Swords,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { formatFriendId, uidToFriendId } from '../../net/firebaseClient';
import {
  acceptFriendRequest,
  DirectMessageItem,
  FriendshipItem,
  GlobalChatItem,
  removeFriendship,
  searchPlayers,
  sendDirectMessage,
  sendFriendRequest,
  sendGlobalChatMessage,
  SocialProfileItem,
  subscribeDirectMessages,
  subscribeFriendships,
  subscribeGlobalChat,
} from '../../net/socialSystem';
import { getRankTier, RankProfile } from '../../rank/rankSystem';

interface SocialHubPanelProps {
  firebaseReady: boolean;
  myUid: string | null;
  myName: string;
  myElo: number;
  focusPair?: { pairId: string; seq: number } | null;
  onFriendshipsChange?: (items: FriendshipItem[]) => void;
  onJoinRoomCode: (code: string, role: 'player' | 'spectator') => void;
  onChallengeFriend: (friend: FriendshipItem) => void;
  onNotify: (msg: string) => void;
}

export const SocialHubPanel: React.FC<SocialHubPanelProps> = ({
  firebaseReady,
  myUid,
  myName,
  myElo,
  focusPair,
  onFriendshipsChange,
  onJoinRoomCode,
  onChallengeFriend,
  onNotify,
}) => {
  const [friendships, setFriendships] = useState<FriendshipItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SocialProfileItem[] | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Chat 1-1
  const [activePairId, setActivePairId] = useState<string | null>(null);
  const [dmMessages, setDmMessages] = useState<DirectMessageItem[]>([]);
  const [dmInput, setDmInput] = useState('');
  const [readStampMap, setReadStampMap] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('cq_dm_read_stamps');
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });
  const dmBottomRef = useRef<HTMLDivElement>(null);

  // Chat Thế Giới
  const [globalMsgs, setGlobalMsgs] = useState<GlobalChatItem[]>([]);
  const [globalInput, setGlobalInput] = useState('');
  const globalBottomRef = useRef<HTMLDivElement>(null);

  const myFriendId = myUid ? uidToFriendId(myUid) : '';

  useEffect(() => {
    if (!firebaseReady || !myUid) return;
    const unsub = subscribeFriendships(myUid, (items) => {
      setFriendships(items);
      onFriendshipsChange?.(items);
    });
    return () => unsub();
  }, [firebaseReady, myUid, onFriendshipsChange]);

  useEffect(() => {
    if (focusPair?.pairId) {
      setActivePairId(focusPair.pairId);
    }
  }, [focusPair]);

  useEffect(() => {
    if (!firebaseReady) return;
    const unsub = subscribeGlobalChat(setGlobalMsgs);
    return () => unsub();
  }, [firebaseReady]);

  useEffect(() => {
    if (!firebaseReady || !activePairId) {
      setDmMessages([]);
      return;
    }
    const unsub = subscribeDirectMessages(activePairId, (msgs) => {
      setDmMessages(msgs);
      const latestMs = msgs.length > 0 ? msgs[msgs.length - 1].createdAtMs : Date.now();
      setReadStampMap((prev) => {
        const next = { ...prev, [activePairId]: Math.max(prev[activePairId] ?? 0, latestMs) };
        localStorage.setItem('cq_dm_read_stamps', JSON.stringify(next));
        return next;
      });
    });
    return () => unsub();
  }, [firebaseReady, activePairId]);

  useEffect(() => {
    dmBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [dmMessages.length, activePairId]);

  useEffect(() => {
    globalBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [globalMsgs.length]);

  const friendshipByPeer = useMemo(() => {
    const map = new Map<string, FriendshipItem>();
    for (const f of friendships) map.set(f.peerUid, f);
    return map;
  }, [friendships]);

  const incomingRequests = useMemo(
    () => friendships.filter((f) => f.status === 'PENDING' && f.requesterUid !== myUid),
    [friendships, myUid]
  );

  const acceptedFriends = useMemo(
    () => friendships.filter((f) => f.status === 'ACCEPTED'),
    [friendships]
  );

  const unreadDmCount = useMemo(() => {
    let cnt = 0;
    for (const f of acceptedFriends) {
      if (
        f.lastMsgText &&
        f.lastMsgSenderUid !== myUid &&
        f.updatedAtMs > (readStampMap[f.pairId] ?? 0) &&
        f.pairId !== activePairId
      ) {
        cnt++;
      }
    }
    return cnt;
  }, [acceptedFriends, myUid, readStampMap, activePairId]);

  const activeFriend = useMemo(
    () => friendships.find((f) => f.pairId === activePairId) ?? null,
    [friendships, activePairId]
  );

  const handleCopyMyId = () => {
    if (!myFriendId) return;
    void navigator.clipboard?.writeText(myFriendId).catch(() => {});
    setCopiedId(true);
    onNotify(`Đã sao chép Mã ID kết bạn: ${formatFriendId(myFriendId)}`);
    window.setTimeout(() => setCopiedId(false), 1800);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myUid || !searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const list = await searchPlayers(searchQuery, myUid);
      setSearchResults(list);
    } catch {
      onNotify('Không thể tìm kiếm lúc này.');
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = async (target: { uid: string; name: string; elo: number }) => {
    if (!myUid) return;
    if (friendshipByPeer.has(target.uid)) {
      onNotify('Đã gửi lời mời hoặc đã là bạn bè.');
      return;
    }
    try {
      await sendFriendRequest({ uid: myUid, name: myName, elo: myElo }, target);
      onNotify(`Đã gửi lời mời kết bạn tới ${target.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể gửi lời mời kết bạn.');
    }
  };

  const handleSendDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myUid || !activeFriend || !dmInput.trim()) return;
    const text = dmInput;
    setDmInput('');
    try {
      await sendDirectMessage({
        pairId: activeFriend.pairId,
        fromUid: myUid,
        fromName: myName,
        toUid: activeFriend.peerUid,
        text,
      });
    } catch {
      onNotify('Gửi tin nhắn thất bại.');
    }
  };

  const handleSendGlobal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myUid || !globalInput.trim()) return;
    const text = globalInput;
    setGlobalInput('');
    try {
      await sendGlobalChatMessage({
        senderUid: myUid,
        senderName: myName,
        senderElo: myElo,
        text,
      });
    } catch {
      onNotify('Không gửi được tin nhắn lên Kênh Thế Giới.');
    }
  };

  const friendBadge = incomingRequests.length + unreadDmCount;

  return (
    <section className="community-showcase-grid" aria-label="Bạn bè và Kênh Thế Giới">
      {/* BẢNG LỚN 1: BẠN BÈ, TÌM ID 9 SỐ & NHẮN TIN 1-1 */}
      <div id="friends-panel" className="panel col social-card friends-card">
        <div className="between" style={{ gap: '0.5rem' }}>
          <div className="row" style={{ gap: '0.55rem' }}>
            <Users size={22} color="#d4a359" aria-hidden="true" />
            <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.22rem' }}>
              Bạn bè &amp; Tin nhắn (ID 9 số)
            </h2>
          </div>
          <div className="row" style={{ gap: '0.4rem' }}>
            <span className="badge festive-badge">{acceptedFriends.length} bạn</span>
            {friendBadge > 0 && <span className="unread-pill">{friendBadge} mới</span>}
          </div>
        </div>

        {myFriendId && (
          <div className="id-banner">
            <div className="row" style={{ gap: '0.5rem' }}>
              <span className="muted" style={{ fontSize: '0.88rem' }}>
                Mã ID của bạn:
              </span>
              <strong style={{ color: 'var(--gold)', fontSize: '1.12rem', letterSpacing: '0.06em' }}>
                {formatFriendId(myFriendId)}
              </strong>
            </div>
            <button type="button" className="btn-mini" onClick={handleCopyMyId}>
              {copiedId ? (
                <span className="row" style={{ gap: '0.3rem' }}>
                  <Check size={14} /> Đã chép ID
                </span>
              ) : (
                <span className="row" style={{ gap: '0.3rem' }}>
                  <Copy size={14} /> Sao chép ID
                </span>
              )}
            </button>
          </div>
        )}

        {activeFriend ? (
          <div className="col dm-box" style={{ gap: '0.55rem', flex: 1 }}>
            <div className="between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              <div className="row" style={{ gap: '0.55rem' }}>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => setActivePairId(null)}
                >
                  ← Danh sách
                </button>
                <div className="col" style={{ gap: 0 }}>
                  <strong style={{ fontSize: '1rem' }}>{activeFriend.peerName}</strong>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    {activeFriend.peerElo} Elo • ID: {formatFriendId(activeFriend.peerFriendId)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn-primary btn-mini"
                onClick={() => onChallengeFriend(activeFriend)}
              >
                <span className="row" style={{ gap: '0.3rem' }}>
                  <Swords size={14} /> Thách đấu phòng riêng
                </span>
              </button>
            </div>

            <div className="chat-feed" style={{ blockSize: 255, fontSize: '0.92rem' }}>
              {dmMessages.length === 0 ? (
                <div className="muted" style={{ textAlign: 'center', margin: 'auto', fontSize: '0.9rem' }}>
                  Hãy gửi lời chào hoặc mời {activeFriend.peerName} làm một ván cờ!
                </div>
              ) : (
                dmMessages.map((m) => {
                  const isMe = m.fromUid === myUid;
                  return (
                    <div key={m.id} className={`chat-bubble ${isMe ? 'mine' : 'theirs'}`}>
                      <div style={{ fontSize: '0.92rem' }}>{m.text}</div>
                      {m.inviteRoomCode && (
                        <div style={{ marginTop: '0.35rem' }}>
                          <button
                            type="button"
                            className="btn-success btn-mini"
                            onClick={() => onJoinRoomCode(m.inviteRoomCode!, 'player')}
                          >
                            Vào phòng {m.inviteRoomCode} ngay
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={dmBottomRef} />
            </div>

            <form className="row" style={{ gap: '0.45rem' }} onSubmit={(e) => void handleSendDm(e)}>
              <input
                type="text"
                className="input-field"
                style={{ flex: 1, minBlockSize: 44, fontSize: '0.95rem' }}
                maxLength={300}
                value={dmInput}
                onChange={(e) => setDmInput(e.target.value)}
                placeholder={`Nhắn tin cho ${activeFriend.peerName}…`}
              />
              <button type="submit" className="btn-primary" style={{ minBlockSize: 44 }}>
                <span className="row" style={{ gap: '0.35rem' }}>
                  <Send size={16} /> Gửi
                </span>
              </button>
            </form>
          </div>
        ) : (
          <div className="col" style={{ gap: '0.6rem', flex: 1 }}>
            <form className="row" style={{ gap: '0.45rem' }} onSubmit={(e) => void handleSearch(e)}>
              <input
                type="text"
                aria-label="Tìm bạn theo Mã ID 9 số hoặc Tên"
                className="input-field"
                style={{ flex: 1, minBlockSize: 44, fontSize: '0.95rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nhập Mã ID 9 số hoặc Tên kỳ thủ…"
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={!firebaseReady || searching}
                style={{ minBlockSize: 44 }}
              >
                <span className="row" style={{ gap: '0.35rem' }}>
                  <UserPlus size={16} /> {searching ? 'Đang tìm…' : 'Tìm bạn'}
                </span>
              </button>
            </form>

            {searchResults !== null && (
              <div className="panel col" style={{ background: 'var(--panel-2)', padding: '0.7rem', gap: '0.45rem' }}>
                <div className="between">
                  <strong style={{ fontSize: '0.9rem' }}>
                    Kết quả tìm kiếm ({searchResults.length})
                  </strong>
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={() => {
                      setSearchResults(null);
                      setSearchQuery('');
                    }}
                  >
                    Đóng
                  </button>
                </div>
                {searchResults.length === 0 ? (
                  <span className="muted" style={{ fontSize: '0.88rem' }}>
                    Không tìm thấy kỳ thủ nào khớp từ khóa.
                  </span>
                ) : (
                  searchResults.slice(0, 6).map((p) => {
                    const rel = friendshipByPeer.get(p.uid);
                    return (
                      <div key={p.uid} className="between" style={{ fontSize: '0.9rem' }}>
                        <div>
                          <strong>{p.name}</strong>{' '}
                          <span className="muted">({p.elo} Elo)</span>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>
                            ID: {formatFriendId(p.friendId)}
                          </div>
                        </div>
                        {rel?.status === 'ACCEPTED' ? (
                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => setActivePairId(rel.pairId)}
                          >
                            Nhắn tin
                          </button>
                        ) : rel?.status === 'PENDING' ? (
                          <span className="muted" style={{ fontSize: '0.82rem' }}>
                            Đang chờ
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-primary btn-mini"
                            onClick={() => void handleAddFriend(p)}
                          >
                            + Kết bạn
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {incomingRequests.length > 0 && (
              <div className="col" style={{ gap: '0.4rem' }}>
                <strong style={{ fontSize: '0.9rem', color: 'var(--gold)' }}>
                  Lời mời kết bạn ({incomingRequests.length})
                </strong>
                {incomingRequests.map((req) => (
                  <div key={req.pairId} className="between panel" style={{ padding: '0.55rem 0.75rem', background: 'var(--panel-2)' }}>
                    <div style={{ fontSize: '0.9rem' }}>
                      <strong>{req.peerName}</strong>{' '}
                      <span className="muted">({req.peerElo} Elo)</span>
                    </div>
                    <div className="row" style={{ gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn-success btn-mini"
                        onClick={() => void acceptFriendRequest(req.pairId)}
                      >
                        Đồng ý
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-mini"
                        onClick={() => void removeFriendship(req.pairId)}
                      >
                        Từ chối
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="friends-list" style={{ maxBlockSize: 270, flex: 1 }}>
              {acceptedFriends.length === 0 ? (
                <div className="muted" style={{ textAlign: 'center', padding: '2rem 1rem', fontSize: '0.92rem', lineHeight: 1.6 }}>
                  Chưa có bạn bè nào. Hãy nhập <strong>Mã ID 9 số</strong> hoặc <strong>Tên kỳ thủ</strong> ở ô trên (hoặc bấm <strong>+ Kết bạn</strong> ngay ở Kênh Thế Giới / Bảng Xếp Hạng) để kết bạn và nhắn tin!
                </div>
              ) : (
                acceptedFriends.map((f) => {
                  const isUnread =
                    Boolean(f.lastMsgText) &&
                    f.lastMsgSenderUid !== myUid &&
                    f.updatedAtMs > (readStampMap[f.pairId] ?? 0);
                  return (
                    <div key={f.pairId} className="friend-row">
                      <div className="col" style={{ gap: '0.1rem', minInlineSize: 0, flex: 1 }}>
                        <div className="row" style={{ gap: '0.4rem' }}>
                          <strong style={{ fontSize: '0.95rem' }}>{f.peerName}</strong>
                          <span className="muted" style={{ fontSize: '0.8rem' }}>
                            {f.peerElo} Elo
                          </span>
                          {isUnread && <span className="unread-pill">Mới</span>}
                        </div>
                        <span
                          className="muted"
                          style={{
                            fontSize: '0.82rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {f.lastMsgText
                            ? `${f.lastMsgSenderUid === myUid ? 'Bạn: ' : ''}${f.lastMsgText}`
                            : `ID: ${formatFriendId(f.peerFriendId)}`}
                        </span>
                      </div>
                      <div className="row" style={{ gap: '0.35rem' }}>
                        <button
                          type="button"
                          className="btn-mini"
                          onClick={() => setActivePairId(f.pairId)}
                        >
                          <span className="row" style={{ gap: '0.25rem' }}>
                            <MessageCircle size={14} /> Nhắn
                          </span>
                        </button>
                        <button
                          type="button"
                          className="btn-primary btn-mini"
                          onClick={() => onChallengeFriend(f)}
                        >
                          <span className="row" style={{ gap: '0.25rem' }}>
                            <Swords size={14} /> Thách đấu
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* BẢNG LỚN 2: KÊNH CHAT THẾ GIỚI */}
      <div id="world-chat-panel" className="panel col social-card world-chat-card">
        <div className="between" style={{ gap: '0.5rem' }}>
          <div className="row" style={{ gap: '0.55rem' }}>
            <Globe size={22} color="#2fb375" aria-hidden="true" />
            <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.22rem' }}>
              Kênh Thế Giới (Trò chuyện chung)
            </h2>
          </div>
          <span
            className="badge"
            style={{
              borderColor: firebaseReady ? 'var(--support)' : 'var(--border)',
              color: firebaseReady ? 'var(--support)' : 'var(--muted)',
            }}
          >
            {firebaseReady ? 'Đang hoạt động' : 'Đang kết nối'}
          </span>
        </div>

        <div className="chat-feed" style={{ blockSize: 320, flex: 1 }}>
          {globalMsgs.length === 0 ? (
            <div className="muted" style={{ textAlign: 'center', margin: 'auto', fontSize: '0.92rem' }}>
              Chưa có tin nhắn nào trên Kênh Thế Giới. Hãy mở lời chào các kỳ thủ khác!
            </div>
          ) : (
            globalMsgs.map((m) => {
              const isMe = m.senderUid === myUid;
              const rel = friendshipByPeer.get(m.senderUid);
              return (
                <div key={m.id} className={`global-msg ${isMe ? 'me' : ''}`}>
                  <div className="between" style={{ gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.84rem' }}>
                      <strong style={{ color: isMe ? 'var(--gold)' : 'var(--text)' }}>
                        {m.senderName}
                      </strong>{' '}
                      <span className="muted">({m.senderElo} Elo)</span>
                    </span>
                    {!isMe && !rel && firebaseReady && (
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: '0.8rem' }}
                        onClick={() =>
                          void handleAddFriend({
                            uid: m.senderUid,
                            name: m.senderName,
                            elo: m.senderElo,
                          })
                        }
                      >
                        + Kết bạn
                      </button>
                    )}
                    {rel?.status === 'ACCEPTED' && (
                      <button
                        type="button"
                        className="btn-link"
                        style={{ fontSize: '0.8rem' }}
                        onClick={() => setActivePairId(rel.pairId)}
                      >
                        Nhắn riêng
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '0.94rem', marginTop: '0.18rem', lineHeight: 1.45 }}>{m.text}</div>
                  {m.inviteRoomCode && (
                    <button
                      type="button"
                      className="btn-success btn-mini"
                      style={{ marginTop: '0.3rem', alignSelf: 'flex-start' }}
                      onClick={() => onJoinRoomCode(m.inviteRoomCode!, 'player')}
                    >
                      Vào phòng {m.inviteRoomCode}
                    </button>
                  )}
                </div>
              );
            })
          )}
          <div ref={globalBottomRef} />
        </div>

        <form className="row" style={{ gap: '0.45rem' }} onSubmit={(e) => void handleSendGlobal(e)}>
          <input
            type="text"
            aria-label="Nhắn lên Kênh Thế Giới"
            className="input-field"
            style={{ flex: 1, minBlockSize: 44, fontSize: '0.95rem' }}
            maxLength={240}
            disabled={!firebaseReady}
            value={globalInput}
            onChange={(e) => setGlobalInput(e.target.value)}
            placeholder={firebaseReady ? 'Nhập tin nhắn giao lưu trên Kênh Thế Giới…' : 'Đang kết nối máy chủ…'}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={!firebaseReady}
            style={{ minBlockSize: 44 }}
          >
            <span className="row" style={{ gap: '0.35rem' }}>
              <Send size={16} /> Gửi tin
            </span>
          </button>
        </form>
      </div>
    </section>
  );
};

interface LeaderboardPanelProps {
  firebaseReady: boolean;
  myUid: string | null;
  myName: string;
  myElo: number;
  friendships: FriendshipItem[];
  leaderboard: RankProfile[];
  leaderboardLoading: boolean;
  onRefreshLeaderboard: () => void;
  onOpenChatPair: (pairId: string) => void;
  onNotify: (msg: string) => void;
}

export const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({
  firebaseReady,
  myUid,
  myName,
  myElo,
  friendships,
  leaderboard,
  leaderboardLoading,
  onRefreshLeaderboard,
  onOpenChatPair,
  onNotify,
}) => {
  const friendshipByPeer = useMemo(() => {
    const map = new Map<string, FriendshipItem>();
    for (const f of friendships) map.set(f.peerUid, f);
    return map;
  }, [friendships]);

  const handleAddFriend = async (target: { uid: string; name: string; elo: number }) => {
    if (!myUid) return;
    if (friendshipByPeer.has(target.uid)) {
      onNotify('Đã gửi lời mời hoặc đã là bạn bè.');
      return;
    }
    try {
      await sendFriendRequest({ uid: myUid, name: myName, elo: myElo }, target);
      onNotify(`Đã gửi lời mời kết bạn tới ${target.name}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Không thể gửi lời mời kết bạn.');
    }
  };

  return (
    <section className="panel col">
      <div className="between">
        <div className="row" style={{ gap: '0.45rem' }}>
          <Trophy size={20} color="#d4a359" aria-hidden="true" />
          <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.14rem' }}>
            Bảng Xếp Hạng Kỳ Thủ
          </h2>
        </div>
        <button
          type="button"
          className="btn-mini"
          disabled={leaderboardLoading || !firebaseReady}
          onClick={onRefreshLeaderboard}
        >
          {leaderboardLoading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      <div className="leaderboard-wrap" style={{ maxBlockSize: 270 }}>
        {leaderboard.length === 0 ? (
          <div className="muted" style={{ padding: '1rem', fontSize: '0.88rem', textAlign: 'center' }}>
            {leaderboardLoading
              ? 'Đang tải bảng xếp hạng…'
              : 'Chưa có trận Ranked nào hoàn tất. Hãy đấu Ghép trận nhanh để ghi tên lên bảng vàng!'}
          </div>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Kỳ thủ</th>
                <th>Hạng</th>
                <th>Elo</th>
                <th>T/H/B</th>
                <th aria-label="Kết bạn" />
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, idx) => {
                const rowTier = getRankTier(row.elo);
                const isSelf = myUid === row.uid;
                const relation = friendshipByPeer.get(row.uid);
                return (
                  <tr key={row.uid} className={isSelf ? 'self-row' : undefined}>
                    <td>{idx + 1}</td>
                    <td>
                      <strong>{row.name}</strong>
                      {isSelf && <span className="muted"> (Bạn)</span>}
                      <div className="muted" style={{ fontSize: '0.74rem' }}>
                        ID: {formatFriendId(uidToFriendId(row.uid))}
                      </div>
                    </td>
                    <td style={{ color: rowTier.color, whiteSpace: 'nowrap' }}>
                      {rowTier.icon} {rowTier.label}
                    </td>
                    <td>
                      <strong>{row.elo}</strong>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.wins}/{row.draws}/{row.losses}
                    </td>
                    <td>
                      {!isSelf && firebaseReady && !relation && (
                        <button
                          type="button"
                          className="btn-mini"
                          onClick={() =>
                            void handleAddFriend({ uid: row.uid, name: row.name, elo: row.elo })
                          }
                        >
                          + Bạn
                        </button>
                      )}
                      {relation?.status === 'ACCEPTED' && (
                        <button
                          type="button"
                          className="btn-mini"
                          onClick={() => onOpenChatPair(relation.pairId)}
                        >
                          <span className="row" style={{ gap: '0.2rem' }}>
                            <UserCheck size={13} /> Nhắn
                          </span>
                        </button>
                      )}
                      {relation?.status === 'PENDING' && (
                        <span className="muted" style={{ fontSize: '0.76rem' }}>
                          Đang chờ
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        Mốc hạng: Đồng (&lt;1050) • Bạc (1050+) • Vàng (1200+) • Bạch Kim (1400+) • Kim Cương (1600+)
      </span>
    </section>
  );
};
