import React, { useState } from 'react';
import {
  AccountInfo,
  formatFriendId,
  loginWithAccount,
  loginWithGoogle,
  logoutToGuest,
  registerWithAccount,
} from '../../net/firebaseClient';
import { RankProfile } from '../../rank/rankSystem';
import { NativeModal } from './NativeModal';

interface AuthModalProps {
  open: boolean;
  account: AccountInfo | null;
  currentDisplayName: string;
  currentElo: number;
  onClose: () => void;
  onAuthSuccess: (res: { profile: RankProfile; message: string }) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  account,
  currentDisplayName,
  currentElo,
  onClose,
  onAuthSuccess,
}) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [displayName, setDisplayName] = useState(currentDisplayName || 'Người chơi');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isLinkedAccount = Boolean(account && !account.isAnonymous);

  const handleGoogle = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await loginWithGoogle(currentDisplayName);
      onAuthSuccess({
        profile: res.profile,
        message: res.migratedFromGuest
          ? `Đã liên kết Google và lưu giữ ${res.profile.elo} Elo của bạn!`
          : `Chào mừng ${res.profile.name} quay lại (${res.profile.elo} Elo)!`,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Đăng nhập Google thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (tab === 'register' && password !== confirmPw) {
      setErrorMsg('Mật khẩu nhập lại chưa khớp.');
      return;
    }

    setBusy(true);
    try {
      if (tab === 'login') {
        const res = await loginWithAccount(identifier, password);
        onAuthSuccess({
          profile: res.profile,
          message: `Đăng nhập thành công! Xin chào ${res.profile.name} (${res.profile.elo} Elo).`,
        });
      } else {
        const res = await registerWithAccount(identifier, password, displayName || currentDisplayName);
        onAuthSuccess({
          profile: res.profile,
          message: res.migratedFromGuest
            ? `Tạo tài khoản thành công và giữ nguyên ${res.profile.elo} Elo hiện tại!`
            : `Tạo tài khoản thành công! Chào mừng ${res.profile.name}.`,
        });
      }
      setPassword('');
      setConfirmPw('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await logoutToGuest('Người chơi');
      onAuthSuccess({
        profile: res.profile,
        message: 'Đã đăng xuất về chế độ Khách.',
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể đăng xuất lúc này.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <NativeModal open={open} titleId="auth-modal-title" dismissible onClose={onClose}>
      <div className="between">
        <h2 id="auth-modal-title" className="festive-heading" style={{ margin: 0 }}>
          {isLinkedAccount ? 'Tài khoản của bạn' : 'Đăng nhập / Lưu Elo vĩnh viễn'}
        </h2>
        <button type="button" onClick={onClose} style={{ minBlockSize: 34, padding: '0.25rem 0.65rem' }}>
          Đóng
        </button>
      </div>

      {isLinkedAccount && account ? (
        <div className="col" style={{ gap: '0.75rem' }}>
          <div className="panel col" style={{ background: 'var(--panel-2)', gap: '0.45rem' }}>
            <div className="between">
              <span className="muted">Phương thức</span>
              <strong>
                {account.provider === 'google'
                  ? 'Tài khoản Google'
                  : account.provider === 'facebook'
                    ? 'Tài khoản Facebook'
                    : 'Tài khoản & Mật khẩu'}
              </strong>
            </div>
            <div className="between">
              <span className="muted">Định danh</span>
              <strong>{account.accountLabel}</strong>
            </div>
            <div className="between">
              <span className="muted">Mã ID kết bạn</span>
              <strong style={{ color: 'var(--gold)' }}>{formatFriendId(account.friendId)}</strong>
            </div>
            <div className="between">
              <span className="muted">Điểm Rank hiện tại</span>
              <strong>{currentElo} Elo</strong>
            </div>
          </div>

          <p className="muted" style={{ margin: 0, fontSize: '0.84rem' }}>
            Elo, chuỗi thắng và danh sách bạn bè của bạn đang được đồng bộ trên máy chủ. Bạn có thể đăng nhập tài khoản này trên bất kỳ thiết bị nào.
          </p>

          {errorMsg && (
            <div className="effect-banner danger" role="alert">
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn-danger" disabled={busy} onClick={() => void handleLogout()}>
              {busy ? 'Đang xử lý…' : 'Đăng xuất'}
            </button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: '0.75rem' }}>
          <div className="update-notice-box" style={{ fontSize: '0.84rem' }}>
            Không bắt buộc đăng nhập để chơi. Nhưng khi <strong>liên kết Google hoặc tạo tài khoản mới</strong> ngay lúc này, điểm <strong>{currentElo} Elo</strong> hiện tại trên máy bạn sẽ được giữ nguyên hoàn toàn.
          </div>

          <button
            type="button"
            className="btn-google"
            disabled={busy}
            onClick={() => void handleGoogle()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z" />
              <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z" />
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z" />
            </svg>
            <span>Tiếp tục với Google</span>
          </button>

          <div className="divider-label">
            <span>hoặc dùng Tài khoản riêng</span>
          </div>

          <div className="tab-strip">
            <button
              type="button"
              className={tab === 'login' ? 'tab-btn active' : 'tab-btn'}
              onClick={() => {
                setTab('login');
                setErrorMsg(null);
              }}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              className={tab === 'register' ? 'tab-btn active' : 'tab-btn'}
              onClick={() => {
                setTab('register');
                setErrorMsg(null);
              }}
            >
              Tạo tài khoản mới
            </button>
          </div>

          <form className="col" style={{ gap: '0.6rem' }} onSubmit={(e) => void handleSubmitForm(e)}>
            <label htmlFor="auth-identifier" className="col" style={{ gap: '0.2rem', fontSize: '0.85rem' }}>
              <span>Tên tài khoản hoặc Email</span>
              <input
                id="auth-identifier"
                name="identifier"
                type="text"
                className="input-field"
                autoComplete="username"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="VD: minhquan123 hoặc ten@gmail.com"
              />
            </label>

            {tab === 'register' && (
              <label htmlFor="auth-displayname" className="col" style={{ gap: '0.2rem', fontSize: '0.85rem' }}>
                <span>Tên hiển thị trong game</span>
                <input
                  id="auth-displayname"
                  name="displayName"
                  type="text"
                  className="input-field"
                  maxLength={24}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Tên hiện trên bàn cờ & BXH"
                />
              </label>
            )}

            <label htmlFor="auth-password" className="col" style={{ gap: '0.2rem', fontSize: '0.85rem' }}>
              <span>Mật khẩu (tối thiểu 6 ký tự)</span>
              <input
                id="auth-password"
                name="password"
                type="password"
                className="input-field"
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
              />
            </label>

            {tab === 'register' && (
              <label htmlFor="auth-confirm-pw" className="col" style={{ gap: '0.2rem', fontSize: '0.85rem' }}>
                <span>Nhập lại mật khẩu</span>
                <input
                  id="auth-confirm-pw"
                  name="confirmPassword"
                  type="password"
                  className="input-field"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••"
                />
              </label>
            )}

            {errorMsg && (
              <div className="effect-banner danger" role="alert">
                <span>{errorMsg}</span>
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={busy}>
              {busy
                ? 'Đang xử lý…'
                : tab === 'login'
                  ? 'Đăng nhập ngay'
                  : 'Đăng ký & Lưu Elo hiện tại'}
            </button>
          </form>
        </div>
      )}
    </NativeModal>
  );
};
