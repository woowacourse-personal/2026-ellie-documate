// Service Worker.
// Phase 0에서는 아이콘 클릭을 감지해 해당 탭의 content script에 토글 메시지만 보낸다.
// 이후 Phase 2+에서 프록시 호출 중계와 캐싱이 여기에 추가된다.

import type { ToggleMessage } from '../shared/messages';

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;

  const message: ToggleMessage = { type: 'DOCUMATE_TOGGLE' };
  chrome.tabs.sendMessage(tab.id, message).catch(() => {
    // content script가 없는 페이지(타깃 사이트가 아님)에서 클릭한 경우 무시.
    // 타깃 사이트 확대 시 여기서 프로그래매틱 주입으로 대체할 수 있다.
  });
});
