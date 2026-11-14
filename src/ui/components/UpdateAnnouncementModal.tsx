import React from 'react';
import { NativeModal } from './NativeModal';

interface UpdateAnnouncementModalProps {
  open: boolean;
  isAnonymous: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
}

export const UpdateAnnouncementModal: React.FC<UpdateAnnouncementModalProps> = ({
  open,
  isAnonymous,
  onClose,
  onOpenAuth,
}) => {
  return (
    <NativeModal open={open} titleId="update-modal-title" dismissible onClose={onClose}>
      <div className="update-modal-header">
        <span className="festive-tag">Phiên bản Giáng Sinh 2.0</span>
        <h2 id="update-modal-title" className="festive-heading" style={{ margin: '0.35rem 0 0' }}>
          Cập nhật Tài khoản, Bạn bè &amp; Giao diện Lễ hội
        </h2>
      </div>

      <div className="update-notice-box">
        <strong>Chơi ngay không cần đăng nhập</strong>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.88rem' }}>
          Bạn không bắt buộc phải tạo tài khoản mới chơi được. Việc đăng nhập hoặc liên kết tài khoản chỉ dùng để{' '}
          <strong>lưu giữ vĩnh viễn điểm Elo, chuỗi thắng và danh sách bạn bè</strong> khi đổi máy hoặc xóa dữ liệu trình duyệt.
        </p>
      </div>

      <ul className="update-list">
        <li>
          <strong>1. Đăng nhập Google hoặc Tài khoản cá nhân:</strong> Hỗ trợ đăng nhập nhanh bằng Google hoặc đăng ký Tên tài khoản + Mật khẩu. Toàn bộ điểm Elo hiện tại trên máy sẽ tự động được bảo toàn khi bạn liên kết.
        </li>
        <li>
          <strong>2. Mã ID 9 số &amp; Kết bạn trực tuyến:</strong> Mỗi kỳ thủ có một mã ID gồm 9 chữ số riêng biệt. Bạn có thể tìm theo ID hoặc Tên để kết bạn, nhắn tin 1-1 và gửi lời mời đấu phòng riêng chỉ với một chạm.
        </li>
        <li>
          <strong>3. Kênh Chat Thế Giới &amp; Chat trong trận:</strong> Trò chuyện giao lưu ngay tại sảnh chính và trao đổi nhanh cùng đối thủ trên bàn cờ.
        </li>
        <li>
          <strong>4. Không gian Giáng Sinh ấm áp:</strong> Bàn cờ gỗ cổ điển kết hợp bảng màu lễ hội dịu mắt và hiệu ứng tuyết rơi nhẹ (có thể bật/tắt ở thanh trên cùng).
        </li>
      </ul>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: '0.25rem' }}>
        <button type="button" onClick={onClose}>
          Chơi ngay (Không cần đăng nhập)
        </button>
        {isAnonymous && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onClose();
              onOpenAuth();
            }}
          >
            Đăng nhập / Lưu Elo
          </button>
        )}
      </div>
    </NativeModal>
  );
};
