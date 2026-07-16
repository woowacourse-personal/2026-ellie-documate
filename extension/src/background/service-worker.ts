// Service Worker.
//  - 아이콘 클릭 → content에 토글 메시지
//  - content의 번역 요청 중계: 캐시 확인 → 미적중만 프록시 호출 → 캐시 저장

import { isMessage } from '../shared/messages';
import type {
  ToggleMessage,
  TranslateItem,
  TranslateResponse,
} from '../shared/messages';
import { cacheGet, cacheSetMany } from './cache';
import { translateViaProxy } from './proxy-client';

chrome.action.onClicked.addListener((tab) => {
  console.log('[Documate BG] 아이콘 클릭됨 · tab', tab.id, tab.url);
  if (tab.id === undefined) return;

  const message: ToggleMessage = { type: 'DOCUMATE_TOGGLE' };
  chrome.tabs
    .sendMessage(tab.id, message)
    .then(() => console.log('[Documate BG] content로 메시지 전달 성공'))
    .catch((e) =>
      // content script가 없으면 여기로 온다(대개 확장 로드 전에 열려있던 페이지 → 새로고침 필요).
      console.warn('[Documate BG] content 없음 → 페이지 새로고침 필요?', e.message),
    );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isMessage(message) && message.type === 'DOCUMATE_TRANSLATE') {
    handleTranslate(message.items)
      .then(sendResponse)
      .catch((e) => {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[Documate BG] 번역 처리 실패', reason);
        // 전부 에러로 응답 (content가 로딩을 에러 상태로 바꾸도록)
        sendResponse({
          results: message.items.map((it) => ({
            id: it.id,
            translation: '',
            error: true,
            reason,
          })),
        } satisfies TranslateResponse);
      });
    return true; // 비동기 응답
  }
  return undefined;
});

async function handleTranslate(
  items: TranslateItem[],
): Promise<TranslateResponse> {
  const results: TranslateResponse['results'] = [];
  const uncached: TranslateItem[] = [];

  // 1) 캐시 확인
  const tCache = Date.now();
  for (const it of items) {
    const hit = await cacheGet(it.text);
    if (hit !== undefined) results.push({ id: it.id, translation: hit });
    else uncached.push(it);
  }
  const cacheMs = Date.now() - tCache;
  console.log(
    `[Documate BG] 번역 요청 ${items.length}개 · 캐시적중 ${items.length - uncached.length} · 신규 ${uncached.length} · 캐시확인 ${cacheMs}ms`,
  );

  // 2) 미적중만 프록시 호출 후 캐시 저장
  let proxyMs = 0;
  let geminiMs = 0;
  if (uncached.length > 0) {
    const t0 = Date.now();
    const { outcomes, geminiMs: gm } = await translateViaProxy(
      uncached.map((i) => i.text),
    );
    proxyMs = Date.now() - t0;
    geminiMs = gm;
    const toCache: { text: string; translation: string }[] = [];
    let failed = 0;
    uncached.forEach((it, i) => {
      const o = outcomes[i];
      if (o?.ok && o.translation) {
        results.push({ id: it.id, translation: o.translation });
        toCache.push({ text: it.text, translation: o.translation });
      } else {
        failed++;
        results.push({
          id: it.id,
          translation: '',
          error: true,
          reason: o && !o.ok ? o.reason : '결과 없음',
        });
      }
    });
    await cacheSetMany(toCache);
    console.log(
      `[Documate BG] 신규 ${uncached.length}개 처리 · 프록시왕복 ${proxyMs}ms (Gemini ${geminiMs}ms + 오버헤드 ${proxyMs - geminiMs}ms) · 실패 ${failed}`,
    );
  }

  return { results, timing: { cacheMs, proxyMs, geminiMs } };
}
