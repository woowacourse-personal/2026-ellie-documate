import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
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
    // 문단마다 1요청 대신 배치 전체를 1요청으로 묶는다 → 비용·요청 한도 절약.
    const g0 = Date.now();
    const response = await genai.models.generateContent({
      model: TRANSLATE_MODEL,
      contents: JSON.stringify(texts),
      config: {
        systemInstruction: translationSystem(),
        thinkingConfig: { thinkingBudget: 0 }, // 번역엔 사고 불필요 — 비용/지연 절약
        responseMimeType: 'application/json',
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    });
    const geminiMs = Date.now() - g0;
    const translations = JSON.parse(response.text ?? '[]');
    if (
      !Array.isArray(translations) ||
      translations.length !== (texts as string[]).length
    ) {
      console.error('translate length mismatch');
      return res.status(502).json({ error: 'upstream_error' });
    }
    res.setHeader('X-Gemini-Ms', String(geminiMs)); // 진단: 순수 생성시간
    res.setHeader('Access-Control-Expose-Headers', 'X-Gemini-Ms');
    return res.status(200).json({ translations });
  } catch (err) {
    console.error('translate error', err);
    // 업스트림 상세는 노출하지 않되, 진단에 유용한 상태코드(429·503)는 그대로 넘긴다.
    const status = (err as { status?: number })?.status;
    const passthrough = status === 429 || status === 503 ? status : 502;
    return res.status(passthrough).json({ error: 'upstream_error' });
  }
}
