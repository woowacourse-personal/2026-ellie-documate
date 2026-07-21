import type { Paragraph } from './extract';
import type { TranslateRequest, TranslateResponse } from '../shared/messages';
import { TRANSLATE_BATCH } from '../shared/config';
import {
  removeAllParagraphUI,
  showTranslation,
  showTranslationError,
  showTranslationLoading,
} from './ui/translation';
import { mountExplain } from './ui/explain';

// 해설(F2)에 넘길 문서 맥락. 문서 제목 + 각 문단의 앞 문단 텍스트.
export interface DocContext {
  title: string;
  precedingOf(id: string): string | undefined;
}

// 추출한 문단을 번역 요청한다. 짧게 디바운스해 모은 뒤 TRANSLATE_BATCH개씩
// 청크로 쪼개 각각 따로 요청·렌더한다 → 먼저 도착한 청크부터 화면이 채워진다
// (전체가 끝날 때까지 기다리지 않음).

export interface Translator {
  enqueue(p: Paragraph): void;
  destroy(): void;
}

const DEBOUNCE_MS = 150;

// 단발 번역(F4 드래그 폴백용). 문단 파이프라인과 달리 배치·디바운스 없이 1건만 보낸다.
// SW를 거치므로 로컬 캐시·프록시 경로는 문단 번역과 똑같이 탄다.
export async function translateOnce(text: string): Promise<string> {
  const req: TranslateRequest = {
    type: 'DOCUMATE_TRANSLATE',
    items: [{ id: 'drag', text }],
    source: 'drag', // 공용 캐시에 저장하지 않는다(사내 문서일 수 있다)
  };
  const res = (await chrome.runtime.sendMessage(req)) as TranslateResponse;
  const r = res.results[0];
  if (!r || r.error || !r.translation) {
    throw new Error(r?.reason ?? '결과 없음');
  }
  return r.translation;
}

export function createTranslator(doc: DocContext): Translator {
  const pending = new Map<string, Paragraph>();
  const requested = new Set<string>(); // 이미 처리(요청)한 문단
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function enqueue(p: Paragraph): void {
    if (disposed || requested.has(p.id) || pending.has(p.id)) return;
    pending.set(p.id, p);
    showTranslationLoading(p); // 즉시 "번역 중…"
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  }

  function flush(): void {
    const batch = [...pending.values()];
    pending.clear();
    for (const p of batch) requested.add(p.id);

    // 함정 ③: 같은 텍스트는 한 번만 요청하고 결과를 모두에게 적용한다. 표는 동일 셀이
    // 대량 반복되는데(예: "Scope: Any" 223회), 청크가 병렬로 나가 공용 캐시가 못 막는다.
    // 텍스트로 묶어 유니크만 보낸다.
    const byText = new Map<string, Paragraph[]>();
    for (const p of batch) {
      const arr = byText.get(p.text);
      if (arr) arr.push(p);
      else byText.set(p.text, [p]);
    }
    const texts = [...byText.keys()];

    // 청크별로 독립 요청 → 먼저 끝난 청크부터 렌더(병렬, 도착 순).
    for (let i = 0; i < texts.length; i += TRANSLATE_BATCH) {
      void sendChunk(texts.slice(i, i + TRANSLATE_BATCH), byText);
    }
  }

  async function sendChunk(
    texts: string[],
    byText: Map<string, Paragraph[]>,
  ): Promise<void> {
    const req: TranslateRequest = {
      type: 'DOCUMATE_TRANSLATE',
      items: texts.map((text, i) => ({ id: `u${i}`, text })),
      source: 'paragraph',
    };

    const tSend = performance.now();
    try {
      const res = (await chrome.runtime.sendMessage(req)) as TranslateResponse;
      if (disposed) return;
      const roundtripMs = Math.round(performance.now() - tSend);

      const tRender = performance.now();
      let ok = 0;
      for (const r of res.results) {
        const text = texts[Number(r.id.slice(1))];
        const ps = byText.get(text);
        if (!ps) continue;
        if (r.error || !r.translation) {
          console.warn(
            `[Documate] 번역 실패 · 원인: ${r.reason ?? '알 수 없음'} · 원문: "${text.slice(0, 50)}…"`,
          );
          for (const p of ps) showTranslationError(p);
        } else {
          ok += ps.length;
          for (const p of ps) {
            showTranslation(p, r.translation);
            // 번역이 뜬 모든 문단에 "해설 보기" 버튼(F2)을 붙인다(제목·짧은 라벨·표 셀 포함).
            // (코드 블록은 index.ts에서 코드 해설로 따로 처리되므로 여기 오지 않는다.)
            mountExplain(p, {
              docTitle: doc.title,
              precedingText: doc.precedingOf(p.id),
            });
          }
        }
      }
      const renderMs = Math.round(performance.now() - tRender);

      // 단계별 breakdown: 어디서 시간이 가는지 한 줄로.
      const t = res.timing;
      const detail = t
        ? ` | Gemini ${t.geminiMs}ms · 프록시overhead ${t.proxyMs - t.geminiMs}ms · 캐시 ${t.cacheMs}ms · 메시지 ${roundtripMs - t.cacheMs - t.proxyMs}ms · 렌더 ${renderMs}ms`
        : '';
      console.log(
        `[Documate] 청크 유니크 ${texts.length}개 · 왕복 ${roundtripMs}ms · 성공(문단) ${ok}${detail}`,
      );
    } catch (e) {
      if (disposed) return;
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[Documate] 번역 청크 요청 실패 · 원인: ${reason}`, e);
      for (const text of texts) for (const p of byText.get(text) ?? []) showTranslationError(p);
    }
  }

  function destroy(): void {
    disposed = true;
    if (timer) clearTimeout(timer);
    removeAllParagraphUI();
  }

  return { enqueue, destroy };
}
