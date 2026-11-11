import { z } from 'zod';
import rawGt1Curated40 from '../../data/questions.gt1_40.json';
import rawSample from '../../data/questions.sample.json';
import { Question, QuestionBank } from '../types/game';

export const QuestionSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  question: z.string().min(1),
  options: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
  answer: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  explain: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(['verified', 'draft', 'needs_review']),
});

export const QuestionBankSchema = z.object({
  bank: z.string().min(1),
  title: z.string().min(1),
  version: z.number().int().positive(),
  questions: z.array(z.unknown()),
});

export interface ParseBankResult {
  ok: boolean;
  bank?: QuestionBank;
  verifiedCount: number;
  skippedCount: number;
  errors: string[];
}

export function parseQuestionBank(raw: unknown): ParseBankResult {
  const header = QuestionBankSchema.safeParse(raw);
  if (!header.success) {
    return {
      ok: false,
      verifiedCount: 0,
      skippedCount: 0,
      errors: [`Cấu trúc file không hợp lệ: ${header.error.issues[0]?.message ?? 'sai định dạng'}`],
    };
  }

  const verified: Question[] = [];
  const errors: string[] = [];
  let skippedCount = 0;

  header.data.questions.forEach((item, idx) => {
    const parsed = QuestionSchema.safeParse(item);
    if (!parsed.success) {
      errors.push(`Câu #${idx + 1}: ${parsed.error.issues[0]?.message ?? 'lỗi schema'}`);
      return;
    }
    if (parsed.data.status !== 'verified') {
      skippedCount += 1;
      return;
    }
    verified.push(parsed.data);
  });

  if (verified.length === 0) {
    return {
      ok: false,
      verifiedCount: 0,
      skippedCount,
      errors: errors.length ? errors : ['Không có câu hỏi nào ở trạng thái verified'],
    };
  }

  return {
    ok: true,
    bank: {
      bank: header.data.bank,
      title: header.data.title,
      version: header.data.version,
      questions: verified,
    },
    verifiedCount: verified.length,
    skippedCount,
    errors,
  };
}

export const GT1_40_BANK: QuestionBank = (() => {
  const res = parseQuestionBank(rawGt1Curated40);
  if (!res.ok || !res.bank) {
    throw new Error('questions.gt1_40.json không hợp lệ');
  }
  return res.bank;
})();

export const SAMPLE_BANK: QuestionBank = (() => {
  const res = parseQuestionBank(rawSample);
  if (!res.ok || !res.bank) {
    throw new Error('questions.sample.json không hợp lệ');
  }
  return res.bank;
})();

export const BUILTIN_BANKS: QuestionBank[] = [GT1_40_BANK, SAMPLE_BANK];
export const DEFAULT_BANK: QuestionBank = GT1_40_BANK;

const DB_NAME = 'chess-quiz-banks';
const STORE_NAME = 'banks';

function openBankDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'bank' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBankToIdb(bank: QuestionBank): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(bank);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listBanksFromIdb(): Promise<QuestionBank[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openBankDb();
    return await new Promise<QuestionBank[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as QuestionBank[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function deleteBankFromIdb(bankId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openBankDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(bankId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
