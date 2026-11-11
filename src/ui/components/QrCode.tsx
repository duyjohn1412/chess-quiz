import React, { useEffect, useId, useState } from 'react';
import QRCode from 'qrcode';

export const QrCodeBox: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const inputId = useId();
  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: 180, margin: 1 })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="panel col" style={{ alignItems: 'center', textAlign: 'center' }}>
      <strong>{label}</strong>
      {dataUrl && (
        <img
          src={dataUrl}
          alt={`Mã QR ${label}`}
          width={160}
          height={160}
          style={{ borderRadius: 10, background: '#fff', padding: 6 }}
        />
      )}
      <div className="row" style={{ inlineSize: '100%' }}>
        <input
          id={inputId}
          name={`share-${inputId}`}
          className="input-field"
          value={value}
          readOnly
          aria-label={`Link ${label}`}
          style={{ flex: 1, fontSize: '0.8rem' }}
        />
        <button type="button" onClick={copyLink}>
          {copied ? 'Đã chép' : 'Chép link'}
        </button>
      </div>
    </div>
  );
};
