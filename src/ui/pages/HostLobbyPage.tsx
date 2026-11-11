import React from 'react';
import { QrCodeBox } from '../components/QrCode';
import { PublicState, QuestionBank } from '../../types/game';
import { parseQuestionBank, saveBankToIdb } from '../../quiz/bankLoader';

interface HostLobbyPageProps {
  code: string;
  transport?: 'firebase' | 'peerjs';
  state: PublicState;
  spectatorCount: number;
  selectedBank: QuestionBank;
  onClockChange: (sec: 180 | 300 | 600) => void;
  onBankUpload: (bank: QuestionBank) => void;
  onStartGame: () => void;
  onCancelRoom: () => void;
}

export const HostLobbyPage: React.FC<HostLobbyPageProps> = ({
  code,
  transport = 'firebase',
  state,
  spectatorCount,
  selectedBank,
  onClockChange,
  onBankUpload,
  onStartGame,
  onCancelRoom,
}) => {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const joinUrl = `${baseUrl}#/join/${code}`;
  const watchUrl = `${baseUrl}#/watch/${code}`;

  const handleQuickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      const parsed = parseQuestionBank(json);
      if (parsed.ok && parsed.bank) {
        await saveBankToIdb(parsed.bank);
        onBankUpload(parsed.bank);
      }
    } catch {
      // ignore invalid
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>♟️ Phòng chờ Online ({transport === 'firebase' ? 'Online' : 'P2P'})</span>
          <span className="badge" style={{ fontSize: '1rem', letterSpacing: '0.12em', color: '#fbbf24' }}>
            {code}
          </span>
        </div>
        <button type="button" className="btn-danger" onClick={onCancelRoom}>
          ✖ Hủy phòng
        </button>
      </header>

      <section className="panel col">
        <div className="between">
          <div className="col" style={{ gap: '0.2rem' }}>
            <strong>Cấu hình trận đấu</strong>
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              Bộ đề đang nạp: <strong>{selectedBank.title}</strong> ({selectedBank.questions.length} câu verified)
            </span>
          </div>
          <div className="row">
            {([180, 300, 600] as const).map((sec) => (
              <button
                key={sec}
                type="button"
                className={state.clockSeconds === sec ? 'btn-primary' : ''}
                onClick={() => onClockChange(sec)}
              >
                {sec / 60} phút
              </button>
            ))}
            <label htmlFor="lobby-upload-bank" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', padding: '0.45rem 0.75rem', borderRadius: 10, cursor: 'pointer' }}>
              📤 Đổi file đề
              <input id="lobby-upload-bank" name="lobbyUploadBank" type="file" accept=".json,application/json" onChange={handleQuickFile} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        <div className="between panel" style={{ background: 'var(--panel-2)' }}>
          <div className="col" style={{ gap: '0.2rem' }}>
            <span>
              Chủ phòng (P1): <strong>{state.p1.name}</strong>
              {typeof state.p1.elo === 'number' ? ` (${state.p1.elo} Elo)` : ''} ✅
            </span>
            <span>
              Đối thủ (P2):{' '}
              {state.p2.connected ? (
                <>
                  <strong>{state.p2.name}</strong>
                  {typeof state.p2.elo === 'number' ? ` (${state.p2.elo} Elo)` : ''} ✅{' '}
                  <span className="badge">{state.p2.ready ? 'Đã nhấn Sẵn sàng' : 'Chưa nhấn Sẵn sàng'}</span>
                </>
              ) : (
                <span className="muted">Đang chờ đối thủ quét QR hoặc nhập mã {code}…</span>
              )}
            </span>
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              👀 Khán giả đang xem: {spectatorCount}/5
            </span>
          </div>

          <button
            type="button"
            className="btn-success"
            disabled={!state.p2.connected}
            onClick={onStartGame}
          >
            🚀 Bắt đầu ván đấu
          </button>
        </div>
      </section>

      <div className="qr-grid">
        <QrCodeBox label="🎮 Link / QR cho Đối thủ (Người chơi 2)" value={joinUrl} />
        <QrCodeBox label="👀 Link / QR cho Khán giả (tối đa 5)" value={watchUrl} />
      </div>
    </main>
  );
};
