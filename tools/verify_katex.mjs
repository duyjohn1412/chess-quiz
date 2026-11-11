import fs from 'node:fs';
import path from 'node:path';
import katex from 'katex';

const argPath = process.argv[2];
const defaultPrivate = path.resolve(process.cwd(), 'private/questions.json');
const defaultCurated = path.resolve(process.cwd(), 'data/questions.gt1_40.json');
const bankPath = argPath
  ? path.resolve(process.cwd(), argPath)
  : fs.existsSync(defaultPrivate)
    ? defaultPrivate
    : defaultCurated;
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf-8'));

let mathSegments = 0;
const failures = [];

function checkText(qid, field, text) {
  let i = 0;
  let unclosedCheck = 0;
  while (i < text.length) {
    if (text[i] === '$') {
      const isDisplay = text[i + 1] === '$';
      const delim = isDisplay ? '$$' : '$';
      const start = i + delim.length;
      const end = text.indexOf(delim, start);
      if (end === -1) {
        failures.push(`${qid}.${field}: Unclosed ${delim} starting at index ${i}`);
        break;
      }
      const tex = text.slice(start, end);
      mathSegments += 1;
      try {
        katex.renderToString(tex, {
          displayMode: isDisplay,
          throwOnError: true,
          strict: 'warn',
        });
      } catch (err) {
        failures.push(`${qid}.${field}: KaTeX error in "${tex}" -> ${err.message}`);
      }
      unclosedCheck += 1;
      i = end + delim.length;
      continue;
    }
    i += 1;
  }
  return unclosedCheck;
}

for (const q of bank.questions) {
  checkText(q.id, 'question', q.question);
  q.options.forEach((opt, idx) => checkText(q.id, `options[${idx}]`, opt));
  if (q.explain) checkText(q.id, 'explain', q.explain);
}

if (failures.length > 0) {
  console.error('KaTeX validation FAILED:');
  for (const f of failures) console.error(' -', f);
  process.exit(1);
}

console.log(`KaTeX validation PASSED: ${bank.questions.length} questions, ${mathSegments} math expressions parsed with 0 errors!`);
