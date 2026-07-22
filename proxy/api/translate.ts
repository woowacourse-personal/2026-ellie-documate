import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Type } from '@google/genai';
import { genai, TRANSLATE_MODEL } from '../lib/gemini.js';
import { translationSystem } from '../lib/prompts.js';
import { guard, validateTexts } from '../lib/security.js';
import { cacheEnabled, cacheGetMany, cacheSetMany } from '../lib/cache.js';
import { checkRateLimit } from '../lib/ratelimit.js';

// 문단 번역 엔드포인트 (비스트리밍, 배치).
// 입력: { texts: string[], source?: 'drag' | 'paragraph' } → 출력: { translations: string[] }
// 확장이 추출한 문단을 청크로 모아 보내면 여기서 배치 번역한다.
//
// 공용 캐시(사용자 간 공유)를 앞에 둔다: 키가 하나뿐이라 하루 쿼터가 전 사용자의 공유
// 자원이므로, 캐시가 없으면 같은 문서를 보는 사람 수만큼 쿼터가 마른다. lib/cache.ts 참고.
// 번역 생성. **모델 업그레이드 내성**의 핵심:
// 최적 설정(thinkingConfig·responseSchema)으로 먼저 시도하고, 모델이 그 설정을 거부하면
// (400 INVALID_ARGUMENT — gemini-flash-lite-**latest**가 조용히 바뀌며 파라미터 제약이
// 달라지는 경우) 최소 설정으로 자동 재시도한다. 그래야 모델이 바뀌어도 번역이 통째로 죽지
// 않는다. (실측 장애: 3.5-flash-lite가 thinkingBudget:0을 거부 → 이 폴백이면 자동 복구됐다.)
// 주의: 이건 '설정 거부' 같은 하드 에러만 막는다. 모델이 조용히 나쁘게 번역하는 품질 드리프트는
// 못 막으므로 모니터링이 별도로 필요하다.
async function generateTranslations(texts: string[]): Promise<string> {
  const contents = JSON.stringify(texts);
  const systemInstruction = translationSystem();
  try {
    const r = await genai.models.generateContent({
      model: TRANSLATE_MODEL,
      contents,
      config: {
        systemInstruction,
        // 번역은 창작이 아니다 → temperature:0 (같은 문장 동일 결과 + "식별자 원문 유지" 준수).
        temperature: 0,
        // 번역엔 사고 거의 불필요 → 최소값. (0은 3.5-flash-lite에서 거부됨.)
        thinkingConfig: { thinkingBudget: 512 },
        responseMimeType: 'application/json',
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    });
    return r.text ?? '[]';
  } catch (err) {
    if (!isConfigRejected(err)) throw err; // 429·503·네트워크 등 진짜 상류 에러는 그대로 올린다
    console.warn('[translate] 모델이 최적 설정 거부 → 최소 설정 폴백(모델 업그레이드 추정)', err);
    const r = await genai.models.generateContent({
      model: TRANSLATE_MODEL,
      contents,
      config: {
        systemInstruction,
        temperature: 0,
        // thinkingConfig·responseSchema는 뺀다(가장 잘 거부되는 신설 파라미터).
        // JSON 출력은 프롬프트가 이미 요구하므로 mimeType만 유지해 파싱 안정성을 지킨다.
        responseMimeType: 'application/json',
      },
    });
    return r.text ?? '[]';
  }
}

// 설정 파라미터 거부(400 INVALID_ARGUMENT)인가. 모델 업그레이드로 제약이 바뀌면 난다.
function isConfigRejected(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  return e?.status === 400 || /invalid[_\s-]?argument/i.test(e?.message ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return; // CORS·메서드·Origin 검증
  if (!(await checkRateLimit(req, res))) return; // IP 레이트리밋 (429)

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
    const rawText = await generateTranslations(missTexts);
    const geminiMs = Date.now() - g0;
    const fresh = JSON.parse(rawText);
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
