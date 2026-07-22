import { PROXY_BASE_URL, TRANSLATE_BATCH } from '../shared/config';

// 프록시(/api/translate) 호출. 키는 프록시에만 있으므로 확장은 프록시만 부른다.
// 문단이 많으면 TRANSLATE_BATCH개씩 청크로 나눠 순차 호출한다(프록시 크기 상한 준수).
//
// 신뢰성 설계(에러 블록 최소화):
//  - 일시적 오류(429·5xx·네트워크·모델 응답 이상)는 백오프로 몇 번 재시도한다.
//  - 그래도 실패한 청크만 실패로 표시하고 나머지 청크 번역은 살린다.
//    → 한 청크 실패가 페이지 전체를 에러로 만들지 않고, 해당 문단만 에러 표시된다.
//  - 실패 원인(reason)과 소요 시간을 콘솔(서비스 워커)에 남겨 진단할 수 있게 한다.

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 800; // 재시도 간격: 0.8s → 1.6s → 3.2s

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 문단 1건의 번역 결과(입력 순서와 1:1로 정렬).
export type TranslateOutcome =
  | { ok: true; translation: string }
  | { ok: false; reason: string };

// geminiMs = 프록시가 알려준 순수 생성시간 합계(프록시/네트워크 오버헤드 제외).
export interface ProxyResult {
  outcomes: TranslateOutcome[];
  geminiMs: number;
}

export async function translateViaProxy(
  texts: string[],
  source: 'drag' | 'paragraph',
  context?: string,
  docTitle?: string,
): Promise<ProxyResult> {
  const out: TranslateOutcome[] = [];
  let geminiMs = 0;
  for (let i = 0; i < texts.length; i += TRANSLATE_BATCH) {
    const chunk = texts.slice(i, i + TRANSLATE_BATCH);
    const t0 = Date.now();
    try {
      const r = await translateChunk(chunk, source, context, docTitle);
      geminiMs += r.geminiMs;
      console.log(
        `[Documate BG] 청크 ${chunk.length}개 성공 · 프록시왕복 ${Date.now() - t0}ms · Gemini ${r.geminiMs}ms`,
      );
      for (const tr of r.translations) out.push({ ok: true, translation: tr });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(
        `[Documate BG] 청크 ${chunk.length}개 실패 · 프록시왕복 ${Date.now() - t0}ms · 원인: ${reason}`,
      );
      for (let k = 0; k < chunk.length; k++) out.push({ ok: false, reason });
    }
  }
  return { outcomes: out, geminiMs };
}

// 청크 하나를 재시도와 함께 번역. 일시적 오류만 재시도하고 4xx는 즉시 포기.
async function translateChunk(
  chunk: string[],
  source: 'drag' | 'paragraph',
  context?: string,
  docTitle?: string,
): Promise<{ translations: string[]; geminiMs: number }> {
  let lastErr: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${PROXY_BASE_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: chunk, source, context, docTitle }),
      });
    } catch (e) {
      lastErr = new Error('네트워크 오류 (프록시 미실행?)');
      console.warn(`[Documate BG] 재시도 ${attempt}/${MAX_ATTEMPTS} · ${lastErr.message}`, e);
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      continue;
    }

    if (res.ok) {
      const geminiMs = Number(res.headers.get('X-Gemini-Ms')) || 0;
      const data = (await res.json().catch(() => ({}))) as {
        translations?: unknown;
      };
      if (
        Array.isArray(data.translations) &&
        data.translations.length === chunk.length
      ) {
        return { translations: data.translations as string[], geminiMs };
      }
      lastErr = new Error('모델 응답 형식 이상 (배열 길이 불일치)'); // → 재시도
    } else if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(describe(res.status)); // 일시적 → 재시도
    } else {
      throw new Error(describe(res.status)); // 4xx 등 → 재시도 무의미
    }

    console.warn(`[Documate BG] 재시도 ${attempt}/${MAX_ATTEMPTS} · ${lastErr.message}`);
    if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw lastErr ?? new Error('알 수 없는 오류');
}

// HTTP 상태코드를 사람이 읽을 원인 문자열로. (Gemini 상세 메시지는 노출하지 않고 코드만)
function describe(status: number): string {
  if (status === 429) return '할당량/레이트리밋 초과 (429)';
  if (status === 503) return 'Gemini 과부하 (503)';
  if (status >= 500) return `프록시/업스트림 오류 (${status})`;
  return `요청 거부 (${status})`;
}
