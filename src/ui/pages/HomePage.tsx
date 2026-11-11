import React, { useState } from 'react';
import {
  BUILTIN_BANKS,
  DEFAULT_BANK,
  deleteBankFromIdb,
  parseQuestionBank,
  saveBankToIdb,
} from '../../quiz/bankLoader';
import { extractCodeFromInput } from '../../net/roomCode';
import { getRankTier, RankProfile } from '../../rank/rankSystem';
import { QuestionBank } from '../../types/game';
import { QrScannerModal } from '../components/QrScannerModal';

export interface QuickMatchUiState {
  searching: boolean;
  elapsedSec: number;
  queueCount: number;
  clockSeconds: 180 | 300 | 600;
}

interface HomePageProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  banks: QuestionBank[];
  selectedBankId: string;
  onSelectBankId: (id: string) => void;
  onBanksChanged: () => void;
  rankProfile: RankProfile | null;
  leaderboard: RankProfile[];
  leaderboardLoading: boolean;
  firebaseReady: boolean;
  firebaseStatusText?: string;
  toastMsg?: string | null;
  quickMatch: QuickMatchUiState;
  onStartQuickMatch: (clockSeconds: 180 | 300 | 600) => void;
  onCancelQuickMatch: () => void;
  onRefreshLeaderboard: () => void;
  onCreateOnlineRoom: (clockSeconds: 180 | 300 | 600) => void;
  onJoinOnlineRoom: (code: string, role: 'player' | 'spectator') => void;
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
  banks,
  selectedBankId,
  onSelectBankId,
  onBanksChanged,
  rankProfile,
  leaderboard,
  leaderboardLoading,
  firebaseReady,
  firebaseStatusText,
  toastMsg,
  quickMatch,
  onStartQuickMatch,
  onCancelQuickMatch,
  onRefreshLeaderboard,
  onCreateOnlineRoom,
  onJoinOnlineRoom,
  onStartHotseat,
}) => {
  const [clockSec, setClockSec] = useState<180 | 300 | 600>(300);
  const [joinInput, setJoinInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [hotP1, setHotP1] = useState(playerName || 'Người chơi 1');
  const [hotP2, setHotP2] = useState('Người chơi 2');
  const [privacyCurtain, setPrivacyCurtain] = useState(true);

  const [uploadStatus, setUploadStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const tier = getRankTier(rankProfile?.elo ?? 1000);

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
      <header className="topbar">
        <div className="brand">
          <span>♟️ Cờ Vua × Trắc Nghiệm</span>
          <span className="badge" style={{ borderColor: firebaseReady ? '#22c55e' : undefined }}>
            {firebaseReady ? '🟢 Trực tuyến & Rank' : 'Online & P2P'}
          </span>
        </div>
        <div className="row">
          <span
            className="badge"
            style={{ color: tier.color, borderColor: tier.color }}
            title="Hạng hiện tại (lưu theo trình duyệt — không xóa cache để giữ Rank)"
          >
            {tier.icon} {tier.label} • {rankProfile?.elo ?? 1000} Elo
          </span>
          <label htmlFor="player-name-input" className="muted" style={{ fontSize: '0.86rem' }}>
            Tên của bạn:
          </label>
          <input
            id="player-name-input"
            name="playerName"
            className="input-field"
            style={{ inlineSize: 170 }}
            value={playerName}
            maxLength={24}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            placeholder="Nhập tên…"
          />
        </div>
      </header>

      {toastMsg && (
        <div className="effect-banner danger" role="alert">
          <span>⚠️ {toastMsg}</span>
        </div>
      )}

      {/* Hàng 1: Ghép trận nhanh (Ranked) + Bảng xếp hạng Top 20 */}
      <div className="qr-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))' }}>
        <section className="panel col rank-hero">
          <div className="between">
            <h2 style={{ margin: 0, fontSize: '1.12rem' }}>⚡ Ghép trận nhanh (Xếp hạng)</h2>
            <span className="badge" style={{ color: tier.color, borderColor: tier.color }}>
              {tier.icon} {tier.label}
            </span>
          </div>

          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            Tự động ghép cặp trực tiếp với người chơi online, không cần mã phòng hay QR. Dùng bộ chuẩn{' '}
            <strong>40 câu Giải tích 1</strong> để đảm bảo công bằng Rank.
          </p>

          <div className="panel row" style={{ justifyContent: 'space-between', background: 'var(--panel-2)', padding: '0.65rem 0.85rem' }}>
            <div className="col" style={{ gap: '0.15rem' }}>
              <span style={{ fontSize: '0.82rem' }} className="muted">
                Điểm Rank của bạn
              </span>
              <strong style={{ fontSize: '1.15rem', color: tier.color }}>
                {rankProfile?.elo ?? 1000} Elo
              </strong>
            </div>
            <div className="col" style={{ gap: '0.15rem', textAlign: 'end', fontSize: '0.82rem' }}>
              <span>
                T/H/B:{' '}
                <strong>
                  {rankProfile?.wins ?? 0}/{rankProfile?.draws ?? 0}/{rankProfile?.losses ?? 0}
                </strong>
              </span>
              <span className="muted">
                Đỉnh: {rankProfile?.bestElo ?? 1000} • Chuỗi thắng: {rankProfile?.streak ?? 0}
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
                  🔍 Đang tìm đối thủ ({quickMatch.clockSeconds / 60} phút) — {quickMatch.elapsedSec}s
                </strong>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Người chơi đang chờ cùng mức giờ: {quickMatch.queueCount}
                </span>
              </div>
              <button type="button" className="btn-danger" onClick={onCancelQuickMatch}>
                ✖ Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={!firebaseReady}
              style={{ marginTop: 'auto' }}
              onClick={() => onStartQuickMatch(clockSec)}
            >
              {firebaseReady ? '⚡ Tìm trận Ranked ngay' : '⏳ Đang kết nối máy chủ…'}
            </button>
          )}

          <div className="muted" style={{ fontSize: '0.77rem' }}>
            {firebaseStatusText
              ? firebaseStatusText
              : '💾 Rank gắn với trình duyệt hiện tại — đừng xóa cache/dữ liệu web để giữ thứ hạng.'}
          </div>
        </section>

        <section className="panel col">
          <div className="between">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🏆 Bảng xếp hạng Top 20</h2>
            <button
              type="button"
              disabled={leaderboardLoading || !firebaseReady}
              onClick={onRefreshLeaderboard}
            >
              {leaderboardLoading ? 'Đang tải…' : '🔄 Làm mới'}
            </button>
          </div>

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
                    <th>Người chơi</th>
                    <th>Hạng</th>
                    <th>Elo</th>
                    <th>T/H/B</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, idx) => {
                    const rowTier = getRankTier(row.elo);
                    const isSelf = rankProfile && row.uid === rankProfile.uid;
                    return (
                      <tr key={row.uid} className={isSelf ? 'self-row' : undefined}>
                        <td>{idx + 1}</td>
                        <td>
                          <strong>{row.name}</strong>
                          {isSelf && <span className="muted"> (Bạn)</span>}
                        </td>
                        <td style={{ color: rowTier.color }}>
                          {rowTier.icon} {rowTier.label}
                        </td>
                        <td>
                          <strong>{row.elo}</strong>
                        </td>
                        <td>
                          {row.wins}/{row.draws}/{row.losses}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Mốc hạng: 🥉 Đồng (&lt;1050) • 🥈 Bạc (1050+) • 🥇 Vàng (1200+) • 💎 Bạch Kim (1400+) • 👑 Kim Cương (1600+)
          </span>
        </section>
      </div>

      {/* Hàng 2: 3 chế độ cổ điển (1 máy + Phòng riêng mã/QR + Vào mã/QR) */}
      <div className="qr-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))' }}>
        {/* Chế độ 1 máy */}
        <section className="panel col">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🖥️ Chơi ngay trên 1 máy (Hot-seat)</h2>
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
            ▶️ Bắt đầu ván 1 máy
          </button>
        </section>

        {/* Tạo phòng riêng Online (Firebase + dự phòng P2P) */}
        <section className="panel col">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🔑 Tạo phòng riêng (Mã &amp; QR)</h2>
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
            ➕ Tạo phòng riêng
          </button>
        </section>

        {/* Tham gia phòng */}
        <section className="panel col">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>🔗 Tham gia / Xem phòng riêng</h2>
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
              📷 Quét QR
            </button>
            <button type="button" className="btn-primary" onClick={() => handleJoin('player')}>
              🎮 Vào chơi
            </button>
            <button type="button" onClick={() => handleJoin('spectator')}>
              👀 Vào xem
            </button>
          </div>
        </section>
      </div>

      {/* Ngân hàng câu hỏi */}
      <section className="panel col">
        <div className="between">
          <div>
            <h2 style={{ margin: 0, fontSize: '1.05rem' }}>📚 Bộ đề câu hỏi (cho Phòng riêng &amp; Chơi 1 máy)</h2>
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
            📤 Chọn file questions.json
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
                  borderColor: isSelected ? '#6366f1' : undefined,
                  background: isSelected ? 'rgba(79, 70, 229, 0.14)' : undefined,
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
