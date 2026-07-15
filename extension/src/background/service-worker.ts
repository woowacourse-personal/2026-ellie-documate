// Service Worker.
// Phase 0에서는 아이콘 클릭을 감지해 해당 탭의 content script에 토글 메시지만 보낸다.
// 이후 Phase 2+에서 프록시 호출 중계와 캐싱이 여기에 추가된다.

import type { ToggleMessage } from '../shared/messages';

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
