import React from 'react';
import { getCardDef, getCardLevel, GROUP_META } from '../../cards/registry';
import { ShopPayload } from '../../net/protocol';
import { FreeM2Choice, HeldCard, PlayerId } from '../../types/game';
import { NativeModal } from './NativeModal';

interface ShopModalProps {
  open: boolean;
  viewerId: PlayerId | 'spectator';
  shop: ShopPayload | null;
  coins: number;
  hand: HeldCard[];
  done: boolean;
  oppDone: boolean;
  freeM2Choice: FreeM2Choice | null;
  estimatedNowMs: number;
  onBuy: (slot: number) => void;
  onDrop: (uid: string) => void;
  onRefresh: () => void;
  onDone: () => void;
  onChooseFreeM2: (cardId: string) => void;
}

export const ShopModal: React.FC<ShopModalProps> = ({
  open,
  viewerId,
  shop,
  coins,
  hand,
  done,
  oppDone,
  freeM2Choice,
  estimatedNowMs,
  onBuy,
  onDrop,
  onRefresh,
  onDone,
  onChooseFreeM2,
}) => {
  const remainSec = shop ? Math.max(0, (shop.deadlineAt - estimatedNowMs) / 1000) : 0;

  return (
    <NativeModal open={open} titleId="shop-modal-title">
      <div className="between">
        <div className="row">
          <h3 id="shop-modal-title" style={{ margin: 0 }}>
            🛒 Cửa hàng thẻ bài
          </h3>
          {shop && shop.discount > 0 && (
            <span className="badge" style={{ borderColor: '#22c55e', color: '#86efac' }}>
              Giảm {Math.round(shop.discount * 100)}%
            </span>
          )}
        </div>
        <div className="row">
          {viewerId !== 'spectator' && <span className="badge">🪙 {coins} xu</span>}
          <span className="clock-pill">{remainSec.toFixed(1)}s</span>
        </div>
      </div>

      {viewerId === 'spectator' || !shop ? (
        <div className="panel muted">Hai kỳ thủ đang mua thẻ tại Cửa hàng…</div>
      ) : (
        <>
          {freeM2Choice && (
            <div className="panel col" style={{ borderColor: '#22c55e' }}>
              <strong>🎁 Thưởng Streak 5 đang chờ — chọn 1 thẻ ★2 miễn phí:</strong>
              <div className="hand-grid">
                {freeM2Choice.options.map((opt) => {
                  const def = getCardDef(opt.cardId);
                  const lvl = getCardLevel(opt.cardId, 2);
                  return (
                    <button
                      key={opt.cardId}
                      type="button"
                      className="card-slot"
                      data-group={def.group}
                      disabled={hand.length >= 3}
                      onClick={() => onChooseFreeM2(opt.cardId)}
                    >
                      <strong>
                        {def.icon} {def.name} ★2
                      </strong>
                      <span className="card-desc">{lvl.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="shop-grid">
            {shop.items.map((item) => {
              const def = getCardDef(item.cardId);
              const lvl = getCardLevel(item.cardId, item.level);
              const gm = GROUP_META[def.group];
              const canBuy = !item.bought && coins >= item.finalPrice && hand.length < 3;

              return (
                <div
                  key={item.slot}
                  className="card-slot"
                  data-group={def.group}
                  style={{ opacity: item.bought ? 0.5 : 1 }}
                >
                  <div className="between" style={{ inlineSize: '100%' }}>
                    <strong style={{ fontSize: '0.88rem' }}>
                      {def.icon} {def.name}
                    </strong>
                    <span className="card-stars">{'★'.repeat(item.level)}</span>
                  </div>
                  <div className="card-desc">{lvl.desc}</div>
                  <div className="between" style={{ inlineSize: '100%', marginTop: 'auto' }}>
                    <span style={{ fontSize: '0.74rem', color: gm.color }}>{gm.label}</span>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ minBlockSize: 34, padding: '0.25rem 0.65rem', fontSize: '0.8rem' }}
                      disabled={!canBuy || done}
                      onClick={() => onBuy(item.slot)}
                    >
                      {item.bought ? (
                        'Đã mua'
                      ) : (
                        <>
                          {item.finalPrice < item.basePrice && (
                            <s style={{ opacity: 0.6, marginRight: 4 }}>{item.basePrice}</s>
                          )}
                          {item.finalPrice} xu
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel col" style={{ gap: '0.4rem' }}>
            <div className="between">
              <strong style={{ fontSize: '0.85rem' }}>
                Kho thẻ hiện tại ({hand.length}/3) — Bấm &ldquo;Bỏ&rdquo; nếu cần chừa chỗ
              </strong>
              <button
                type="button"
                disabled={coins < shop.refreshCost || done}
                onClick={onRefresh}
              >
                🔄 Làm mới ({shop.refreshCost} xu)
              </button>
            </div>
            <div className="hand-grid">
              {[0, 1, 2].map((i) => {
                const c = hand[i];
                if (!c) {
                  return (
                    <div key={i} className="card-slot empty" style={{ minBlockSize: 64 }}>
                      Trống
                    </div>
                  );
                }
                const def = getCardDef(c.cardId);
                return (
                  <div key={c.uid} className="card-slot" data-group={def.group} style={{ minBlockSize: 64 }}>
                    <div className="between" style={{ inlineSize: '100%' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                        {def.icon} {def.name} ★{c.level}
                      </span>
                      <button
                        type="button"
                        className="btn-danger"
                        style={{ minBlockSize: 28, padding: '0.15rem 0.5rem', fontSize: '0.75rem' }}
                        disabled={done}
                        onClick={() => onDrop(c.uid)}
                      >
                        Bỏ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="between">
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              {oppDone ? '✅ Đối thủ đã mua xong' : '⏳ Đối thủ đang chọn thẻ…'}
            </span>
            <button type="button" className="btn-success" disabled={done} onClick={onDone}>
              {done ? 'Đã xong (chờ đối thủ)' : 'Xong, quay lại bàn cờ →'}
            </button>
          </div>
        </>
      )}
    </NativeModal>
  );
};
