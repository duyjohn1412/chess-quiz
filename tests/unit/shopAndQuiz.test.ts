import { describe, expect, it } from 'vitest';
import { DEFAULT_BANK, GT1_40_BANK, SAMPLE_BANK, parseQuestionBank } from '../../src/quiz/bankLoader';
import { pickQuestion } from '../../src/quiz/picker';
import { gradeAnswer, reshuffleExistingOptions, shuffleOptions } from '../../src/quiz/grader';
import { getWeakestTopic, recordTopicAnswer } from '../../src/quiz/topicStats';
import { computeShopDiscount } from '../../src/shop/discount';
import { generateShopItems } from '../../src/shop/generator';

describe('Shop & Quiz', () => {
  it('nạp bank mặc định 40 câu Giải tích 1 cân bằng chủ đề, độ khó và đáp án', () => {
    expect(DEFAULT_BANK.bank).toBe(GT1_40_BANK.bank);
    expect(GT1_40_BANK.questions).toHaveLength(40);
    const diffs = new Set(GT1_40_BANK.questions.map((q) => q.difficulty));
    expect(diffs).toEqual(new Set([1, 2, 3]));
    const topics = new Set(GT1_40_BANK.questions.map((q) => q.topic));
    expect(topics.size).toBe(8);
    const ansCounts = [0, 1, 2, 3].map((idx) => GT1_40_BANK.questions.filter((q) => q.answer === idx).length);
    expect(ansCounts).toEqual([10, 10, 10, 10]);
  });

  it('nạp bank mẫu và kiểm tra parser bỏ câu draft', () => {
    expect(SAMPLE_BANK.questions.length).toBeGreaterThanOrEqual(8);
    const res = parseQuestionBank({
      bank: 't',
      title: 'T',
      version: 1,
      questions: [
        ...SAMPLE_BANK.questions,
        { ...SAMPLE_BANK.questions[0], id: 'draft_1', status: 'draft' },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.verifiedCount).toBe(SAMPLE_BANK.questions.length);
    expect(res.skippedCount).toBe(1);
  });

  it('picker không lặp câu khi còn câu mới', () => {
    const used = new Set<string>();
    for (let i = 0; i < SAMPLE_BANK.questions.length; i++) {
      const q = pickQuestion({ pool: SAMPLE_BANK.questions, usedIds: used });
      expect(q).not.toBeNull();
      expect(used.has(q!.id)).toBe(false);
      used.add(q!.id);
    }
  });

  it('xáo đáp án và đảo đáp án giữ đúng đáp án chuẩn', () => {
    const q = SAMPLE_BANK.questions[0];
    const sh = shuffleOptions(q);
    expect(sh.options[sh.correctShownIndex]).toBe(q.options[q.answer]);
    expect(gradeAnswer(sh.correctShownIndex, sh.correctShownIndex)).toBe(true);

    const re = reshuffleExistingOptions(sh.options, sh.perm, [0], q.answer);
    expect(re.options[re.correctShownIndex]).toBe(q.options[q.answer]);
  });

  it('topicStats cần >= 3 câu mới trả về chủ đề yếu nhất', () => {
    let stats = recordTopicAnswer({}, 'Giới hạn', false);
    stats = recordTopicAnswer(stats, 'Đạo hàm', true);
    expect(getWeakestTopic(stats, ['Giới hạn', 'Đạo hàm'])).toBeTruthy();

    stats = recordTopicAnswer(stats, 'Giới hạn', false);
    expect(getWeakestTopic(stats, ['Giới hạn', 'Đạo hàm'])).toBe('Giới hạn');
  });

  it('shop sinh 6 thẻ không trùng, >= 2 thẻ M1-M2 và bù nhóm còn thiếu', () => {
    const gen = generateShopItems({
      prevShopGroups: ['time', 'support'],
      usedCount: {},
      flashUsed: 0,
      discount: 0,
    });
    expect(gen.items).toHaveLength(6);
    expect(new Set(gen.items.map((i) => i.cardId)).size).toBe(6);
    expect(gen.items.filter((i) => i.level <= 2).length).toBeGreaterThanOrEqual(2);
    expect(gen.groupsPresent).toContain('peek');
    expect(gen.groupsPresent).toContain('quiz');
  });

  it('giảm giá shop không cộng dồn giữa tụt giờ và streak 3', () => {
    expect(computeShopDiscount(100_000, 300_000, false)).toBe(0.2);
    expect(computeShopDiscount(300_000, 300_000, true)).toBe(0.2);
    expect(computeShopDiscount(100_000, 300_000, true)).toBe(0.2);
    expect(computeShopDiscount(250_000, 300_000, false)).toBe(0);
  });
});
