import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { NativeModal } from './NativeModal';

interface QrScannerModalProps {
  open: boolean;
  onDetected: (text: string) => void;
  onClose: () => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  open,
  onDetected,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let rafId = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const start = async () => {
      setError('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Trình duyệt không hỗ trợ camera hoặc trang chưa chạy qua HTTPS/localhost.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const scan = () => {
          if (stopped || !video || !ctx) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code?.data) {
              onDetected(code.data);
              return;
            }
          }
          rafId = requestAnimationFrame(scan);
        };
        rafId = requestAnimationFrame(scan);
      } catch {
        setError(
          'Không mở được camera (cần cấp quyền camera hoặc mở qua HTTPS/localhost). Bạn có thể nhập trực tiếp mã 6 ký tự hoặc mở link.'
        );
      }
    };

    void start();

    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [open, onDetected]);

  return (
    <NativeModal open={open} titleId="qr-scan-title" dismissible onClose={onClose}>
      <div className="between">
        <h3 id="qr-scan-title" style={{ margin: 0 }}>
          📷 Quét mã QR vào phòng
        </h3>
        <button type="button" onClick={onClose}>
          Đóng
        </button>
      </div>

      {error ? (
        <div className="effect-banner danger">{error}</div>
      ) : (
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            inlineSize: '100%',
            maxBlockSize: 320,
            borderRadius: 12,
            background: '#000',
            objectFit: 'cover',
          }}
        />
      )}
    </NativeModal>
  );
};
