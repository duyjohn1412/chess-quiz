import { describe, expect, it } from 'vitest';
import { CARDS, CARDS_BY_GROUP } from '../../src/cards/registry';
import { applyDiscount, calcRawPrice, getCardPrice } from '../../src/cards/pricing';

describe('Cards registry & pricing', () => {
  it('có đủ 23 thẻ và mỗi thẻ đủ 4 mức', () => {
    expect(CARDS).toHaveLength(23);
    expect(CARDS_BY_GROUP.time).toHaveLength(4);
    expect(CARDS_BY_GROUP.support).toHaveLength(6);
    expect(CARDS_BY_GROUP.peek).toHaveLength(5);
    expect(CARDS_BY_GROUP.quiz).toHaveLength(8);
    for (const c of CARDS) {
      expect(c.levels.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    }
  });

  it('khớp chính xác bảng giá 12 ô theo hệ số 0.8 / 1.0 / 1.2', () => {
    expect([1, 2, 3, 4].map((l) => calcRawPrice(0.8, l as 1 | 2 | 3 | 4))).toEqual([10, 15, 35, 55]);
    expect([1, 2, 3, 4].map((l) => calcRawPrice(1.0, l as 1 | 2 | 3 | 4))).toEqual([10, 20, 45, 70]);
    expect([1, 2, 3, 4].map((l) => calcRawPrice(1.2, l as 1 | 2 | 3 | 4))).toEqual([10, 25, 55, 85]);
    expect(getCardPrice('time_minus', 3)).toBe(55);
    expect(getCardPrice('time_force', 2)).toBe(15);
    expect(getCardPrice('q_flash', 4)).toBe(70);
  });

  it('áp dụng giảm giá 20% làm tròn lên bội số 5, tối thiểu 5', () => {
    expect(applyDiscount(10, 0.2)).toBe(10);
    expect(applyDiscount(25, 0.2)).toBe(20);
    expect(applyDiscount(45, 0.2)).toBe(40);
    expect(applyDiscount(70, 0.2)).toBe(60);
    expect(applyDiscount(5, 0.5)).toBe(5);
  });
});
