import type { VercelRequest, VercelResponse } from '@vercel/node';
import { genai, TRANSLATE_MODEL } from '../lib/gemini.js';
import { translationSystem } from '../lib/prompts.js';
import { guard, validateTexts } from '../lib/security.js';

// 문단 번역 엔드포인트 (비스트리밍, 배치).
// 입력: { texts: string[] }  → 출력: { translations: string[] }
// 뷰포트에 보이는 문단만 확장에서 모아 보내고, 여기서 병렬 번역한다.
// TODO(Phase 2): 공용 캐시 연동, 레이트리밋, 문서 맥락 전달.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return; // CORS·메서드·Origin 검증

  const texts = req.body?.texts;
  const invalid = validateTexts(texts);
  if (invalid) return res.status(400).json({ error: invalid.error });

  try {
    const translations = await Promise.all(
      (texts as string[]).map((text) => translateOne(text)),
    );
    return res.status(200).json({ translations });
  } catch (err) {
    console.error('translate error', err);
    return res.status(502).json({ error: 'upstream_error' });
  }
}

async function translateOne(text: string): Promise<string> {
  const response = await genai.models.generateContent({
    model: TRANSLATE_MODEL,
    contents: text,
    config: {
      systemInstruction: translationSystem(),
      thinkingConfig: { thinkingBudget: 0 }, // 번역엔 사고 불필요 — 비용/지연 절약
    },
  });
  return response.text ?? '';
}
