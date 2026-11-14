import React, { useCallback, useState } from 'react';
import { Check, Copy, LogIn, ShieldCheck, Snowflake, Sparkles, UserPlus } from 'lucide-react';
import {
  BUILTIN_BANKS,
  DEFAULT_BANK,
  deleteBankFromIdb,
  parseQuestionBank,
  saveBankToIdb,
} from '../../quiz/bankLoader';
import { AccountInfo, formatFriendId } from '../../net/firebaseClient';
import { FriendshipItem } from '../../net/socialSystem';
import { extractCodeFromInput } from '../../net/roomCode';
import { getRankTier, RankProfile } from '../../rank/rankSystem';
import { QuestionBank } from '../../types/game';
import { QrScannerModal } from '../components/QrScannerModal';
import { LeaderboardPanel, SocialHubPanel } from '../components/SocialHubPanel';

export interface QuickMatchUiState {
  searching: boolean;
  elapsedSec: number;
  queueCount: number;
  clockSeconds: 180 | 300 | 600;
}

interface HomePageProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  account: AccountInfo | null;
  snowEnabled: boolean;
  onToggleSnow: () => void;
  onOpenAuth: (mode?: 'login' | 'register') => void;
  onOpenUpdates: () => void;
  banks: QuestionBank[];
  selectedBankId: string;
  onSelectBankId: (id: string) => void;
  onBanksChanged: () => void;
  rankProfile: RankProfile | null;
  leaderboard: RankProfile[];
  leaderboardLoading: boolean;
  firebaseReady: boolean;
  firebaseUid: string | null;
  firebaseStatusText?: string;
  toastMsg?: string | null;
  onShowToast: (msg: string) => void;
  quickMatch: QuickMatchUiState;
  onStartQuickMatch: (clockSeconds: 180 | 300 | 600) => void;
  onCancelQuickMatch: () => void;
  onRefreshLeaderboard: () => void;
  onCreateOnlineRoom: (clockSeconds: 180 | 300 | 600) => void;
  onJoinOnlineRoom: (code: string, role: 'player' | 'spectator') => void;
  onChallengeFriend: (friend: FriendshipItem) => void;
  onStartHotseat: (
    p1Name: string,
    p2Name: string,
    clockSeconds: 180 | 300 | 600,
    privacyCurtain: boolean
  ) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  playerName,
  onPlayerNameChange,
  account,
  snowEnabled,
  onToggleSnow,
  onOpenAuth,
  onOpenUpdates,
  banks,
  selectedBankId,
  onSelectBankId,
  onBanksChanged,
  rankProfile,
  leaderboard,
  leaderboardLoading,
  firebaseReady,
  firebaseUid,
  firebaseStatusText,
  toastMsg,
  onShowToast,
  quickMatch,
  onStartQuickMatch,
  onCancelQuickMatch,
  onRefreshLeaderboard,
  onCreateOnlineRoom,
  onJoinOnlineRoom,
  onChallengeFriend,
  onStartHotseat,
}) => {
  const [clockSec, setClockSec] = useState<180 | 300 | 600>(300);
  const [joinInput, setJoinInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [hotP1, setHotP1] = useState(playerName || 'Người chơi 1');
  const [hotP2, setHotP2] = useState('Người chơi 2');
  const [privacyCurtain, setPrivacyCurtain] = useState(true);

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [friendships, setFriendships] = useState<FriendshipItem[]>([]);
  const [focusPair, setFocusPair] = useState<{ pairId: string; seq: number } | null>(null);

  const handleOpenChatPair = useCallback((pairId: string) => {
    setFocusPair({ pairId, seq: Date.now() });
    document.getElementById('friends-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const tier = getRankTier(rankProfile?.elo ?? 1000);
  const isLoggedInAccount = Boolean(account && !account.isAnonymous);

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = parseQuestionBank(json);
      if (!res.ok || !res.bank) {
        setUploadStatus({
          ok: false,
          msg: `Nạp thất bại: ${res.errors[0] ?? 'Không có câu verified nào'}`,
        });
        return;
      }
      await saveBankToIdb(res.bank);
      onBanksChanged();
      onSelectBankId(res.bank.bank);
      setUploadStatus({
        ok: true,
        msg: `Đã nạp "${res.bank.title}": ${res.verifiedCount} câu hợp lệ${
          res.skippedCount > 0 ? `, bỏ qua ${res.skippedCount} câu chưa duyệt` : ''
        }.`,
      });
    } catch {
      setUploadStatus({ ok: false, msg: 'File JSON không hợp lệ hoặc bị lỗi cú pháp.' });
    }
  };

  const handleJoin = (role: 'player' | 'spectator') => {
    const parsed = extractCodeFromInput(joinInput);
    if (!parsed) {
      setUploadStatus({ ok: false, msg: 'Hãy nhập mã phòng 6 ký tự hoặc link hợp lệ.' });
      return;
    }
    onJoinOnlineRoom(parsed.code, role);
  };

  const builtinIds = new Set(BUILTIN_BANKS.map((b) => b.bank));
  const allBanks = [...BUILTIN_BANKS, ...banks.filter((b) => !builtinIds.has(b.bank))];

  return (
    <main className="app-shell">
      <header className="topbar christmas-topbar">
        <div className="brand">
          <span className="festive-title" style={{ fontSize: '1.22rem' }}>
            ♟ Cờ Vua × Trắc Nghiệm
          </span>
          <span className="badge festive-badge" style={{ borderColor: firebaseReady ? 'var(--support)' : undefined }}>
            {firebaseReady ? 'Trực tuyến & Rank' : 'Online & P2P'}
          </span>
        </div>

        <div className="row" style={{ gap: '0.5rem' }}>
          <span
            className="badge"
            style={{ color: tier.color, borderColor: tier.color, fontSize: '0.88rem' }}
            title="Hạng hiện tại"
          >
            {tier.icon} {tier.label} • {rankProfile?.elo ?? 1000} Elo
          </span>

          <button
            type="button"
            className="btn-mini"
            onClick={onOpenUpdates}
            title="Xem bảng thông báo cập nhật mới"
          >
            <span className="row" style={{ gap: '0.3rem' }}>
              <Sparkles size={14} /> Bản cập nhật
            </span>
          </button>

          <button
            type="button"
            className={snowEnabled ? 'btn-mini active-snow' : 'btn-mini'}
            onClick={onToggleSnow}
            title="Bật hoặc tắt hiệu ứng tuyết rơi Giáng Sinh"
          >
            <span className="row" style={{ gap: '0.3rem' }}>
              <Snowflake size={14} /> {snowEnabled ? 'Tuyết: Bật' : 'Tuyết: Tắt'}
            </span>
          </button>
        </div>
      </header>

      {toastMsg && (
        <div className="effect-banner force" role="status">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* KHU VỰC TÀI KHOẢN, ĐĂNG NHẬP / ĐĂNG KÝ & MÃ ID 9 SỐ NỔI BẬT */}
      <section className="panel account-hero-banner" aria-label="Tài khoản và Đăng nhập">
        <div className="hero-profile-col col" style={{ gap: '0.65rem' }}>
          <div className="col" style={{ gap: '0.28rem' }}>
            <label htmlFor="player-name-input" style={{ fontSize: '0.88rem', color: 'var(--muted)', fontWeight: 600 }}>
              Tên hiển thị của bạn trên bàn cờ &amp; Kênh Thế Giới
            </label>
            <div className="row" style={{ gap: '0.5rem' }}>
              <input
                id="player-name-input"
                name="playerName"
                aria-label="Tên hiển thị của bạn"
                className="input-field"
                style={{ flex: 1, minBlockSize: 44, fontSize: '1rem', fontWeight: 600 }}
                value={playerName}
                maxLength={24}
                onChange={(e) => onPlayerNameChange(e.target.value)}
                placeholder="Nhập tên của bạn…"
              />
            </div>
          </div>

          {account?.friendId && (
            <div className="id-highlight-box">
              <div className="col" style={{ gap: '0.1rem' }}>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Mã ID Kết Bạn 9 Số của bạn
                </span>
                <strong style={{ color: 'var(--gold)', fontSize: '1.22rem', letterSpacing: '0.08em' }}>
                  {formatFriendId(account.friendId)}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(account.friendId).catch(() => {});
                  setCopiedId(true);
                  onShowToast(`Đã sao chép Mã ID: ${formatFriendId(account.friendId)}`);
                  window.setTimeout(() => setCopiedId(false), 1800);
                }}
              >
                <span className="row" style={{ gap: '0.35rem' }}>
                  {copiedId ? <Check size={16} /> : <Copy size={16} />}
                  {copiedId ? 'Đã chép' : 'Sao chép ID'}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="hero-auth-col col" style={{ gap: '0.65rem' }}>
          {isLoggedInAccount && account ? (
            <>
              <div className="row" style={{ gap: '0.55rem' }}>
                <ShieldCheck size={24} color="#2fb375" aria-hidden="true" />
                <div className="col" style={{ gap: '0.1rem' }}>
                  <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.18rem' }}>
                    Đã liên kết: {account.accountLabel}
                  </h2>
                  <span className="muted" style={{ fontSize: '0.88rem' }}>
                    Phương thức:{' '}
                    <strong>
                      {account.provider === 'google'
                        ? 'Google'
                        : account.provider === 'facebook'
                          ? 'Facebook'
                          : 'Tài khoản cá nhân'}
                    </strong>{' '}
                    • Elo &amp; bạn bè đang được đồng bộ an toàn.
                  </span>
                </div>
              </div>
              <div className="row" style={{ marginTop: 'auto' }}>
                <button
                  type="button"
                  className="btn-auth-large"
                  onClick={() => onOpenAuth('login')}
                >
                  Quản lý tài khoản / Đăng xuất
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="col" style={{ gap: '0.22rem' }}>
                <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.24rem' }}>
                  Đăng nhập / Đăng ký Tài khoản
                </h2>
                <p className="muted" style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5 }}>
                  Chơi ngay không cần đăng nhập. Nhưng khi <strong>đăng nhập hoặc tạo tài khoản</strong> (Google, Facebook hoặc Tên tài khoản), điểm <strong>{rankProfile?.elo ?? 1000} Elo</strong> và danh sách bạn bè sẽ được lưu vĩnh viễn.
                </p>
              </div>

              <div className="auth-cta-group">
                <button
                  type="button"
                  className="btn-primary btn-auth-large"
                  onClick={() => onOpenAuth('login')}
                >
                  <span className="row" style={{ gap: '0.45rem' }}>
                    <LogIn size={18} /> Đăng nhập ngay
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-success btn-auth-large"
                  onClick={() => onOpenAuth('register')}
                >
                  <span className="row" style={{ gap: '0.45rem' }}>
                    <UserPlus size={18} /> Đăng ký tài khoản
                  </span>
                </button>

                <button
                  type="button"
                  className="btn-google btn-auth-mini-social"
                  onClick={() => onOpenAuth('login')}
                  title="Đăng nhập bằng Google"
                >
                  Google
                </button>

                <button
                  type="button"
                  className="btn-facebook btn-auth-mini-social"
                  onClick={() => onOpenAuth('login')}
                  title="Đăng nhập bằng Facebook"
                >
                  Facebook
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* HÀNG NỔI BẬT: BẠN BÈ & TIN NHẮN (ID 9 SỐ) + KÊNH THẾ GIỚI HIỂN THỊ SONG SONG CỠ LỚN */}
      <SocialHubPanel
        firebaseReady={firebaseReady}
        myUid={firebaseUid}
        myName={playerName || rankProfile?.name || 'Người chơi'}
        myElo={rankProfile?.elo ?? 1000}
        focusPair={focusPair}
        onFriendshipsChange={setFriendships}
        onJoinRoomCode={onJoinOnlineRoom}
        onChallengeFriend={onChallengeFriend}
        onNotify={onShowToast}
      />

      {/* Hàng 2: Ghép trận nhanh (Ranked) + Bảng Xếp Hạng Kỳ Thủ */}
      <div className="qr-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <section className="panel col rank-hero">
          <div className="between">
            <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.14rem' }}>
              Ghép trận nhanh (Xếp hạng)
            </h2>
            <span className="badge" style={{ color: tier.color, borderColor: tier.color }}>
              {tier.icon} {tier.label}
            </span>
          </div>

          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            Ghép cặp trực tiếp và tính điểm Rank chính thức bằng bộ đề chuẩn{' '}
            <strong>40 câu Giải tích 1</strong>. Chơi ngay không cần đăng nhập.
          </p>

          <div className="panel row" style={{ justifyContent: 'space-between', background: 'var(--panel-2)', padding: '0.65rem 0.85rem' }}>
            <div className="col" style={{ gap: '0.15rem' }}>
              <span style={{ fontSize: '0.8rem' }} className="muted">
                Điểm Rank của bạn
              </span>
              <strong style={{ fontSize: '1.2rem', color: tier.color }}>
                {rankProfile?.elo ?? 1000} Elo
              </strong>
            </div>
            <div className="col" style={{ gap: '0.15rem', textAlign: 'end', fontSize: '0.82rem' }}>
              <span>
                Thắng / Hòa / Bại:{' '}
                <strong>
                  {rankProfile?.wins ?? 0}/{rankProfile?.draws ?? 0}/{rankProfile?.losses ?? 0}
                </strong>
              </span>
              <span className="muted">
                Đỉnh: {rankProfile?.bestElo ?? 1000} • Chuỗi: {rankProfile?.streak ?? 0}
              </span>
            </div>
          </div>

          <div className="row">
            {([180, 300, 600] as const).map((sec) => (
              <button
                key={sec}
                type="button"
                disabled={quickMatch.searching}
                className={clockSec === sec ? 'btn-primary' : ''}
                onClick={() => setClockSec(sec)}
              >
                {sec / 60} phút
              </button>
            ))}
          </div>

          {quickMatch.searching ? (
            <div className="effect-banner force" role="status">
              <div className="col" style={{ gap: '0.1rem' }}>
                <strong className="quick-pulse">
                  Đang tìm đối thủ ({quickMatch.clockSeconds / 60} phút) — {quickMatch.elapsedSec}s
                </strong>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Đối thủ khác đang chờ cùng mức: {Math.max(0, quickMatch.queueCount - 1)}
                </span>
              </div>
              <button type="button" className="btn-danger" onClick={onCancelQuickMatch}>
                Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={!firebaseReady}
              style={{ marginTop: 'auto', minBlockSize: 44, fontSize: '0.98rem' }}
              onClick={() => onStartQuickMatch(clockSec)}
            >
              {firebaseReady ? 'Tìm trận Ranked ngay' : 'Đang kết nối máy chủ…'}
            </button>
          )}

          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {firebaseStatusText
              ? firebaseStatusText
              : isLoggedInAccount
                ? `Đã đồng bộ tài khoản (${account?.accountLabel}) — Elo được bảo toàn trên mọi thiết bị.`
                : 'Đang chơi chế độ Khách — bấm nút Đăng nhập / Đăng ký ở trên để lưu Elo vĩnh viễn.'}
          </div>
        </section>

        <LeaderboardPanel
          firebaseReady={firebaseReady}
          myUid={firebaseUid}
          myName={playerName || rankProfile?.name || 'Người chơi'}
          myElo={rankProfile?.elo ?? 1000}
          friendships={friendships}
          leaderboard={leaderboard}
          leaderboardLoading={leaderboardLoading}
          onRefreshLeaderboard={onRefreshLeaderboard}
          onOpenChatPair={handleOpenChatPair}
          onNotify={onShowToast}
        />
      </div>

      {/* Hàng 2: 3 chế độ cổ điển (1 máy + Phòng riêng mã/QR + Vào mã/QR) */}
      <div className="qr-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))' }}>
        {/* Chế độ 1 máy */}
        <section className="panel col">
          <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.08rem' }}>
            Chơi trên 1 máy (Hot-seat)
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            Đấu 1v1 trực tiếp tại chỗ hoặc tự thử nghiệm đầy đủ 23 thẻ, Flash, Quiz, Shop.
          </p>

          <label htmlFor="hotseat-p1-input" className="col" style={{ gap: '0.25rem', fontSize: '0.86rem' }}>
            <span>Người chơi 1:</span>
            <input
              id="hotseat-p1-input"
              name="hotseatP1"
              className="input-field"
              value={hotP1}
              maxLength={24}
              onChange={(e) => setHotP1(e.target.value)}
            />
          </label>

          <label htmlFor="hotseat-p2-input" className="col" style={{ gap: '0.25rem', fontSize: '0.86rem' }}>
            <span>Người chơi 2:</span>
            <input
              id="hotseat-p2-input"
              name="hotseatP2"
              className="input-field"
              value={hotP2}
              maxLength={24}
              onChange={(e) => setHotP2(e.target.value)}
            />
          </label>

          <label htmlFor="privacy-curtain-checkbox" className="row" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              id="privacy-curtain-checkbox"
              name="privacyCurtain"
              type="checkbox"
              checked={privacyCurtain}
              onChange={(e) => setPrivacyCurtain(e.target.checked)}
            />
            <span>Che màn hình ẩn thẻ &amp; quiz khi chuyển lượt</span>
          </label>

          <div className="row">
            {([180, 300, 600] as const).map((sec) => (
              <button
                key={sec}
                type="button"
                className={clockSec === sec ? 'btn-primary' : ''}
                onClick={() => setClockSec(sec)}
              >
                {sec / 60} phút
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn-success"
            style={{ marginTop: 'auto' }}
            onClick={() =>
              onStartHotseat(
                hotP1.trim() || 'Người chơi 1',
                hotP2.trim() || 'Người chơi 2',
                clockSec,
                privacyCurtain
              )
            }
          >
            Bắt đầu ván 1 máy
          </button>
        </section>

        {/* Tạo phòng riêng Online (Firebase + dự phòng P2P) */}
        <section className="panel col">
          <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.1rem' }}>Tạo phòng riêng (Mã &amp; QR)</h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            Tạo phòng giao hữu với bạn bè qua mã 6 ký tự &amp; QR Code (tối đa 5 khán giả, đồng bộ trực tuyến — tự chuyển P2P nếu cần).
          </p>

          <div className="col" style={{ gap: '0.35rem' }}>
            <span style={{ fontSize: '0.86rem' }}>Chọn đồng hồ ván đấu:</span>
            <div className="row">
              {([180, 300, 600] as const).map((sec) => (
                <button
                  key={sec}
                  type="button"
                  className={clockSec === sec ? 'btn-primary' : ''}
                  onClick={() => setClockSec(sec)}
                >
                  {sec / 60} phút
                </button>
              ))}
            </div>
          </div>

          <div className="muted" style={{ fontSize: '0.82rem' }}>
            • Phòng riêng không tính Rank Elo (tránh cày điểm).<br />
            • Dùng bộ câu hỏi đang chọn bên dưới (hỗ trợ upload file JSON riêng).<br />
            • Lưu ý: Chủ phòng điều phối ván — đừng đóng tab khi đang đấu.
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 'auto' }}
            onClick={() => onCreateOnlineRoom(clockSec)}
          >
            Tạo phòng riêng
          </button>
        </section>

        {/* Tham gia phòng */}
        <section className="panel col">
          <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.1rem' }}>Tham gia / Xem phòng riêng</h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            Nhập mã phòng 6 ký tự, dán đường dẫn hoặc quét mã QR từ máy Chủ phòng.
          </p>

          <input
            id="join-room-input"
            name="joinRoomInput"
            className="input-field"
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            placeholder="Ví dụ: A7K9M2 hoặc link #/join/..."
            aria-label="Mã phòng hoặc đường dẫn"
          />

          <div className="row">
            <button type="button" onClick={() => setScannerOpen(true)}>
              Quét QR
            </button>
            <button type="button" className="btn-primary" onClick={() => handleJoin('player')}>
              Vào chơi
            </button>
            <button type="button" onClick={() => handleJoin('spectator')}>
              Vào xem
            </button>
          </div>
        </section>
      </div>

      {/* Ngân hàng câu hỏi */}
      <section className="panel col">
        <div className="between">
          <div>
            <h2 className="festive-heading" style={{ margin: 0, fontSize: '1.05rem' }}>Bộ đề câu hỏi (Phòng riêng &amp; Chơi 1 máy)</h2>
            <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
              Tích hợp sẵn <strong>40 câu Giải tích 1</strong> đã xóa nét bút &amp; kiểm chứng công thức, hoặc chọn file <code>questions.json</code> riêng.
            </p>
          </div>
          <label
            htmlFor="upload-bank-input"
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.45rem 0.85rem',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            Chọn file questions.json
            <input
              id="upload-bank-input"
              name="uploadBankFile"
              type="file"
              accept=".json,application/json"
              onChange={handleUploadFile}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {uploadStatus && (
          <div className={`effect-banner ${uploadStatus.ok ? '' : 'danger'}`} role="status">
            <span>{uploadStatus.msg}</span>
          </div>
        )}

        <div className="col" style={{ gap: '0.4rem' }}>
          {allBanks.map((b) => {
            const isSelected = b.bank === selectedBankId;
            const isBuiltin = builtinIds.has(b.bank);
            return (
              <div
                key={b.bank}
                className="between panel"
                style={{
                  padding: '0.6rem 0.85rem',
                  borderColor: isSelected ? 'var(--gold)' : undefined,
                  background: isSelected ? 'rgba(212, 163, 89, 0.14)' : undefined,
                }}
              >
                <div className="row">
                  <button
                    type="button"
                    className={isSelected ? 'btn-primary' : ''}
                    onClick={() => onSelectBankId(b.bank)}
                  >
                    {isSelected ? '✓ Đang chọn' : 'Chọn bộ này'}
                  </button>
                  <div className="col" style={{ gap: '0.1rem' }}>
                    <strong>{b.title}</strong>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {b.questions.length} câu hỏi verified • Mã: {b.bank}
                    </span>
                  </div>
                </div>
                {!isBuiltin && (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={async () => {
                      await deleteBankFromIdb(b.bank);
                      onBanksChanged();
                      if (selectedBankId === b.bank) onSelectBankId(DEFAULT_BANK.bank);
                    }}
                  >
                    Xóa
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(raw) => {
          setScannerOpen(false);
          const parsed = extractCodeFromInput(raw);
          if (parsed) {
            onJoinOnlineRoom(parsed.code, parsed.role ?? 'player');
          } else {
            setJoinInput(raw);
          }
        }}
      />
    </main>
  );
};
