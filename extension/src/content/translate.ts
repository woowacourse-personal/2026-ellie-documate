import type { Paragraph } from './extract';
import type { TranslateRequest, TranslateResponse } from '../shared/messages';
import { TRANSLATE_BATCH } from '../shared/config';
import {
  removeAllTranslations,
  showTranslation,
  showTranslationError,
  showTranslationLoading,
} from './ui/translation';

// 추출한 문단을 번역 요청한다. 짧게 디바운스해 모은 뒤 TRANSLATE_BATCH개씩
// 청크로 쪼개 각각 따로 요청·렌더한다 → 먼저 도착한 청크부터 화면이 채워진다
// (전체가 끝날 때까지 기다리지 않음).

export interface Translator {
  enqueue(p: Paragraph): void;
  destroy(): void;
}

const DEBOUNCE_MS = 150;

export function createTranslator(byId: Map<string, Paragraph>): Translator {
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

    // 청크별로 독립 요청 → 먼저 끝난 청크부터 렌더(병렬, 도착 순).
    for (let i = 0; i < batch.length; i += TRANSLATE_BATCH) {
      void sendChunk(batch.slice(i, i + TRANSLATE_BATCH));
    }
  }

  async function sendChunk(chunk: Paragraph[]): Promise<void> {
    const req: TranslateRequest = {
      type: 'DOCUMATE_TRANSLATE',
      items: chunk.map((p) => ({ id: p.id, text: p.text })),
    };

    const t0 = performance.now();
    try {
      const res = (await chrome.runtime.sendMessage(req)) as TranslateResponse;
      if (disposed) return;
      const ms = Math.round(performance.now() - t0);
      let ok = 0;
      for (const r of res.results) {
        const p = byId.get(r.id);
        if (!p) continue;
        if (r.error || !r.translation) {
          console.warn(
            `[Documate] 문단 ${r.id} 번역 실패 · 원인: ${r.reason ?? '알 수 없음'} · 원문: "${p.text.slice(0, 50)}…"`,
          );
          showTranslationError(p);
        } else {
          ok++;
          showTranslation(p, r.translation);
        }
      }
      console.log(
        `[Documate] 번역 청크 ${chunk.length}개 · ${ms}ms · 성공 ${ok}/${chunk.length}`,
      );
    } catch (e) {
      if (disposed) return;
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[Documate] 번역 청크 요청 실패 · 원인: ${reason}`, e);
      for (const p of chunk) showTranslationError(p);
    }
  }

  function destroy(): void {
    disposed = true;
    if (timer) clearTimeout(timer);
    removeAllTranslations();
  }

  return { enqueue, destroy };
}
