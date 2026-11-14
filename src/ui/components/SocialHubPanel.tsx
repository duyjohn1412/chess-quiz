import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  leaderboard: RankProfile[];
  leaderboardLoading: boolean;
  onRefreshLeaderboard: () => void;
  onJoinRoomCode: (code: string, role: 'player' | 'spectator') => void;
  onChallengeFriend: (friend: FriendshipItem) => void;
  onNotify: (msg: string) => void;
}

export const SocialHubPanel: React.FC<SocialHubPanelProps> = ({
  firebaseReady,
  myUid,
  myName,
  myElo,
  leaderboard,
  leaderboardLoading,
  onRefreshLeaderboard,
  onJoinRoomCode,
  onChallengeFriend,
  onNotify,
}) => {
  const [tab, setTab] = useState<'leaderboard' | 'friends' | 'global'>('leaderboard');

  // Bạn bè & tìm kiếm
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
    const unsub = subscribeFriendships(myUid, setFriendships);
    return () => unsub();
  }, [firebaseReady, myUid]);

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
    dmBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dmMessages.length, activePairId]);

  useEffect(() => {
    if (tab === 'global') {
      globalBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [globalMsgs.length, tab]);

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
      onNotify('Không gửi được tin nhắn lên kênh Thế Giới.');
    }
  };

  const friendBadge = incomingRequests.length + unreadDmCount;

  return (
    <section className="panel col social-hub">
      <div className="between" style={{ gap: '0.4rem' }}>
        <div className="tab-strip" style={{ flex: 1 }}>
          <button
            type="button"
            className={tab === 'leaderboard' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setTab('leaderboard')}
          >
            Bảng Xếp Hạng
          </button>
          <button
            type="button"
            className={tab === 'friends' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setTab('friends')}
          >
            Bạn bè &amp; Tin nhắn
            {friendBadge > 0 && <span className="notif-dot">{friendBadge}</span>}
          </button>
          <button
            type="button"
            className={tab === 'global' ? 'tab-btn active' : 'tab-btn'}
            onClick={() => setTab('global')}
          >
            Kênh Thế Giới
          </button>
        </div>

        {tab === 'leaderboard' && (
          <button
            type="button"
            disabled={leaderboardLoading || !firebaseReady}
            onClick={onRefreshLeaderboard}
            style={{ minBlockSize: 34, padding: '0.25rem 0.65rem', fontSize: '0.82rem' }}
          >
            {leaderboardLoading ? 'Đang tải…' : 'Làm mới'}
          </button>
        )}
      </div>

      {/* TAB 1: BẢNG XẾP HẠNG */}
      {tab === 'leaderboard' && (
        <div className="col" style={{ gap: '0.45rem' }}>
          <div className="leaderboard-wrap">
            {leaderboard.length === 0 ? (
              <div className="muted" style={{ padding: '1rem', fontSize: '0.84rem', textAlign: 'center' }}>
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
                          <div className="muted" style={{ fontSize: '0.7rem' }}>
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
                              onClick={() => {
                                setTab('friends');
                                setActivePairId(relation.pairId);
                              }}
                            >
                              Nhắn
                            </button>
                          )}
                          {relation?.status === 'PENDING' && (
                            <span className="muted" style={{ fontSize: '0.72rem' }}>
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
          <span className="muted" style={{ fontSize: '0.76rem' }}>
            Mốc hạng: Đồng (&lt;1050) • Bạc (1050+) • Vàng (1200+) • Bạch Kim (1400+) • Kim Cương (1600+)
          </span>
        </div>
      )}

      {/* TAB 2: BẠN BÈ & NHẮN TIN 1-1 */}
      {tab === 'friends' && (
        <div className="col" style={{ gap: '0.55rem' }}>
          {myFriendId && (
            <div className="id-banner">
              <div className="row" style={{ gap: '0.4rem' }}>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Mã ID của bạn:
                </span>
                <strong style={{ color: 'var(--gold)', letterSpacing: '0.04em' }}>
                  {formatFriendId(myFriendId)}
                </strong>
              </div>
              <button type="button" className="btn-mini" onClick={handleCopyMyId}>
                {copiedId ? 'Đã chép' : 'Sao chép ID'}
              </button>
            </div>
          )}

          {activeFriend ? (
            <div className="col dm-box" style={{ gap: '0.45rem' }}>
              <div className="between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.4rem' }}>
                <div className="row" style={{ gap: '0.45rem' }}>
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={() => setActivePairId(null)}
                  >
                    ← Danh sách
                  </button>
                  <div className="col" style={{ gap: 0 }}>
                    <strong style={{ fontSize: '0.9rem' }}>{activeFriend.peerName}</strong>
                    <span className="muted" style={{ fontSize: '0.72rem' }}>
                      {activeFriend.peerElo} Elo • ID: {formatFriendId(activeFriend.peerFriendId)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary btn-mini"
                  onClick={() => onChallengeFriend(activeFriend)}
                >
                  Thách đấu phòng riêng
                </button>
              </div>

              <div className="chat-feed" style={{ blockSize: 180 }}>
                {dmMessages.length === 0 ? (
                  <div className="muted" style={{ textAlign: 'center', margin: 'auto', fontSize: '0.82rem' }}>
                    Hãy gửi lời chào hoặc mời {activeFriend.peerName} làm một ván cờ!
                  </div>
                ) : (
                  dmMessages.map((m) => {
                    const isMe = m.fromUid === myUid;
                    return (
                      <div key={m.id} className={`chat-bubble ${isMe ? 'me' : 'them'}`}>
                        <div style={{ fontSize: '0.84rem' }}>{m.text}</div>
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

              <form className="row" style={{ gap: '0.4rem' }} onSubmit={(e) => void handleSendDm(e)}>
                <input
                  type="text"
                  className="input-field"
                  style={{ flex: 1, minBlockSize: 38, padding: '0.35rem 0.65rem' }}
                  maxLength={300}
                  value={dmInput}
                  onChange={(e) => setDmInput(e.target.value)}
                  placeholder={`Nhắn cho ${activeFriend.peerName}…`}
                />
                <button type="submit" className="btn-primary" style={{ minBlockSize: 38 }}>
                  Gửi
                </button>
              </form>
            </div>
          ) : (
            <>
              <form className="row" style={{ gap: '0.4rem' }} onSubmit={(e) => void handleSearch(e)}>
                <input
                  type="text"
                  className="input-field"
                  style={{ flex: 1, minBlockSize: 38, padding: '0.35rem 0.65rem' }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo Mã ID 9 số hoặc Tên…"
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={!firebaseReady || searching}
                  style={{ minBlockSize: 38 }}
                >
                  {searching ? 'Đang tìm…' : 'Tìm bạn'}
                </button>
              </form>

              {searchResults !== null && (
                <div className="panel col" style={{ background: 'var(--panel-2)', padding: '0.55rem', gap: '0.4rem' }}>
                  <div className="between">
                    <strong style={{ fontSize: '0.82rem' }}>
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
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      Không tìm thấy kỳ thủ nào khớp từ khóa.
                    </span>
                  ) : (
                    searchResults.slice(0, 6).map((p) => {
                      const rel = friendshipByPeer.get(p.uid);
                      return (
                        <div key={p.uid} className="between" style={{ fontSize: '0.82rem' }}>
                          <div>
                            <strong>{p.name}</strong>{' '}
                            <span className="muted">({p.elo} Elo)</span>
                            <div className="muted" style={{ fontSize: '0.72rem' }}>
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
                            <span className="muted" style={{ fontSize: '0.75rem' }}>
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
                <div className="col" style={{ gap: '0.35rem' }}>
                  <strong style={{ fontSize: '0.82rem', color: 'var(--gold)' }}>
                    Lời mời kết bạn ({incomingRequests.length})
                  </strong>
                  {incomingRequests.map((req) => (
                    <div key={req.pairId} className="between panel" style={{ padding: '0.45rem 0.65rem', background: 'var(--panel-2)' }}>
                      <div style={{ fontSize: '0.82rem' }}>
                        <strong>{req.peerName}</strong>{' '}
                        <span className="muted">({req.peerElo} Elo)</span>
                      </div>
                      <div className="row" style={{ gap: '0.3rem' }}>
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

              <div className="friends-list">
                {acceptedFriends.length === 0 ? (
                  <div className="muted" style={{ textAlign: 'center', padding: '1rem', fontSize: '0.82rem' }}>
                    Chưa có bạn bè. Hãy nhập Mã ID 9 số hoặc Tên ở trên để kết bạn và nhắn tin!
                  </div>
                ) : (
                  acceptedFriends.map((f) => {
                    const isUnread =
                      Boolean(f.lastMsgText) &&
                      f.lastMsgSenderUid !== myUid &&
                      f.updatedAtMs > (readStampMap[f.pairId] ?? 0);
                    return (
                      <div key={f.pairId} className="friend-row">
                        <div className="col" style={{ gap: '0.05rem', minInlineSize: 0, flex: 1 }}>
                          <div className="row" style={{ gap: '0.35rem' }}>
                            <strong style={{ fontSize: '0.86rem' }}>{f.peerName}</strong>
                            <span className="muted" style={{ fontSize: '0.75rem' }}>
                              {f.peerElo} Elo
                            </span>
                            {isUnread && <span className="unread-pill">Mới</span>}
                          </div>
                          <span
                            className="muted"
                            style={{
                              fontSize: '0.75rem',
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
                        <div className="row" style={{ gap: '0.3rem' }}>
                          <button
                            type="button"
                            className="btn-mini"
                            onClick={() => setActivePairId(f.pairId)}
                          >
                            Nhắn tin
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-mini"
                            onClick={() => onChallengeFriend(f)}
                          >
                            Thách đấu
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: KÊNH CHAT THẾ GIỚI */}
      {tab === 'global' && (
        <div className="col" style={{ gap: '0.45rem' }}>
          <div className="chat-feed" style={{ blockSize: 215 }}>
            {globalMsgs.length === 0 ? (
              <div className="muted" style={{ textAlign: 'center', margin: 'auto', fontSize: '0.82rem' }}>
                Chưa có tin nhắn trên Kênh Thế Giới. Hãy mở lời chào mọi người!
              </div>
            ) : (
              globalMsgs.map((m) => {
                const isMe = m.senderUid === myUid;
                const rel = friendshipByPeer.get(m.senderUid);
                return (
                  <div key={m.id} className={`global-msg ${isMe ? 'me' : ''}`}>
                    <div className="between" style={{ gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.76rem' }}>
                        <strong style={{ color: isMe ? 'var(--gold)' : 'var(--text)' }}>
                          {m.senderName}
                        </strong>{' '}
                        <span className="muted">({m.senderElo})</span>
                      </span>
                      {!isMe && !rel && firebaseReady && (
                        <button
                          type="button"
                          className="btn-link"
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
                    </div>
                    <div style={{ fontSize: '0.84rem', marginTop: '0.12rem' }}>{m.text}</div>
                    {m.inviteRoomCode && (
                      <button
                        type="button"
                        className="btn-success btn-mini"
                        style={{ marginTop: '0.25rem' }}
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

          <form className="row" style={{ gap: '0.4rem' }} onSubmit={(e) => void handleSendGlobal(e)}>
            <input
              type="text"
              className="input-field"
              style={{ flex: 1, minBlockSize: 38, padding: '0.35rem 0.65rem' }}
              maxLength={240}
              disabled={!firebaseReady}
              value={globalInput}
              onChange={(e) => setGlobalInput(e.target.value)}
              placeholder={firebaseReady ? 'Nhắn lên Kênh Thế Giới…' : 'Đang kết nối máy chủ…'}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={!firebaseReady}
              style={{ minBlockSize: 38 }}
            >
              Gửi
            </button>
          </form>
        </div>
      )}
    </section>
  );
};
