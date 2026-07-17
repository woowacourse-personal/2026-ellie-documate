import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
import { genai, TRANSLATE_MODEL } from '../lib/gemini.js';
import { translationSystem } from '../lib/prompts.js';
import { guard, validateTexts } from '../lib/security.js';
import { cacheEnabled, cacheGetMany, cacheSetMany } from '../lib/cache.js';

// 문단 번역 엔드포인트 (비스트리밍, 배치).
// 입력: { texts: string[], source?: 'drag' | 'paragraph' } → 출력: { translations: string[] }
// 확장이 추출한 문단을 청크로 모아 보내면 여기서 배치 번역한다.
//
// 공용 캐시(사용자 간 공유)를 앞에 둔다: 키가 하나뿐이라 하루 쿼터가 전 사용자의 공유
// 자원이므로, 캐시가 없으면 같은 문서를 보는 사람 수만큼 쿼터가 마른다. lib/cache.ts 참고.
// TODO: 레이트리밋(같은 Upstash로 @upstash/ratelimit).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return; // CORS·메서드·Origin 검증

  const texts = req.body?.texts as string[] | undefined;
  const invalid = validateTexts(texts);
  if (invalid) return res.status(400).json({ error: invalid.error });

  // 드래그 선택은 공용 캐시에 **저장하지 않는다**(사내 문서일 수 있다). 조회는 해도 된다.
  const store = req.body?.source !== 'drag';

  const all = texts as string[];

  try {
    // 1) 공용 캐시 조회(MGET 1회). 적중분은 Gemini를 아예 안 부른다.
    const cached = await cacheGetMany(all);
    const missIdx: number[] = [];
    for (let i = 0; i < all.length; i++) {
      if (cached[i] === undefined) missIdx.push(i);
    }
    const hits = all.length - missIdx.length;

    // 전부 적중 → 쿼터 소모 0
    if (missIdx.length === 0) {
      console.log(`translate ${all.length}개 · 캐시 전부 적중 · Gemini 호출 없음`);
      res.setHeader('X-Gemini-Ms', '0');
      res.setHeader('X-Cache-Hits', String(hits));
      res.setHeader('Access-Control-Expose-Headers', 'X-Gemini-Ms, X-Cache-Hits');
      return res.status(200).json({ translations: cached as string[] });
    }

    // 2) 미적중만 번역한다. 문단마다 1요청 대신 배치 전체를 1요청으로 묶는다.
    const missTexts = missIdx.map((i) => all[i]);
    const g0 = Date.now();
    const response = await genai.models.generateContent({
      model: TRANSLATE_MODEL,
      contents: JSON.stringify(missTexts),
      config: {
        systemInstruction: translationSystem(),
        // 번역은 창작이 아니다. 기본값(1.0)이면 같은 문장이 매번 다르게 나오고
        // (실측: 5번 요청 → 5가지 결과) 식별자까지 번역돼 "API 이름은 원문 유지" 규칙이
        // 깨진다(Modifier → 수식어/수정자). 0이면 5번 모두 동일 + 규칙 준수.
        // 청크가 병렬로 나가므로 페이지 안에서 용어가 갈리는 것도 이걸로 줄인다.
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }, // 번역엔 사고 불필요 — 비용/지연 절약
        responseMimeType: 'application/json',
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    });
    const geminiMs = Date.now() - g0;
    const fresh = JSON.parse(response.text ?? '[]');
    if (!Array.isArray(fresh) || fresh.length !== missTexts.length) {
      console.error('translate length mismatch');
      return res.status(502).json({ error: 'upstream_error' });
    }

    // 3) 캐시 적중분과 새로 번역한 것을 원래 순서로 합친다.
    const translations = [...cached] as string[];
    missIdx.forEach((idx, k) => {
      translations[idx] = fresh[k];
    });

    // 4) 새로 번역한 것만 저장. 드래그 선택은 저장하지 않는다(사내 문서일 수 있다).
    if (store) {
      await cacheSetMany(
        missIdx.map((idx, k) => ({ text: all[idx], translation: fresh[k] })),
      );
    }
    console.log(
      `translate ${all.length}개 · 캐시적중 ${hits} · 신규 ${missIdx.length} · Gemini ${geminiMs}ms · 저장 ${store ? 'O' : 'X(드래그)'} · 캐시 ${cacheEnabled() ? 'on' : 'off'}`,
    );

    res.setHeader('X-Gemini-Ms', String(geminiMs)); // 진단: 순수 생성시간
    res.setHeader('X-Cache-Hits', String(hits));
    res.setHeader('Access-Control-Expose-Headers', 'X-Gemini-Ms, X-Cache-Hits');
    return res.status(200).json({ translations });
  } catch (err) {
    console.error('translate error', err);
    // 업스트림 상세는 노출하지 않되, 진단에 유용한 상태코드(429·503)는 그대로 넘긴다.
    const status = (err as { status?: number })?.status;
    const passthrough = status === 429 || status === 503 ? status : 502;
    return res.status(passthrough).json({ error: 'upstream_error' });
  }
}
