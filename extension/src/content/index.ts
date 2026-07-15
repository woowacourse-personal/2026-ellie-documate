// Content Script (초기 타깃: developer.android.com).
//
// Phase 0: 아이콘 클릭(토글 메시지) 시 Shadow DOM 배너를 표시/숨김만 한다.
//   - 클릭 전에는 아무것도 그리지 않고, 본문 추출·LLM 호출도 하지 않는다(유휴).
//   - "주입 파이프라인이 동작한다"를 눈으로 확인하는 것이 목표.
//
// Phase 1+에서 이 자리에 Readability 추출 → 문단 분리 → 원본 DOM 매핑 →
// Preact UI 주입이 들어간다.

import { isMessage } from '../shared/messages';
import { ensureShadowHost, removeShadowHost } from './ui/mount';

let active = false;

// 보안 규칙(중요): Shadow DOM 안이라도 innerHTML에 동적 텍스트를 넣지 않는다.
// 번역/해설(LLM 출력)과 페이지에서 추출한 텍스트는 신뢰 불가 → 반드시 textContent로 넣는다.
// innerHTML은 오직 개발자가 직접 쓴 정적 문자열에만 허용. 여기서는 아예 쓰지 않고
// createElement + textContent로만 구성해 그 패턴을 못박는다.
function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text; // 항상 textContent
  return node;
}

function showBanner(): void {
  const { root } = ensureShadowHost();
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `
    .banner {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      max-width: 320px;
      padding: 14px 16px;
      border-radius: 12px;
      background: #1b1b1f;
      color: #e6e6e6;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    }
    .title { font-weight: 700; margin-bottom: 4px; color: #8ab4f8; }
    .close {
      position: absolute; top: 8px; right: 10px;
      background: none; border: none; color: #9aa0a6;
      font-size: 16px; cursor: pointer;
    }
  `;

  const banner = el('div', 'banner');
  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', '닫기');
  close.addEventListener('click', hideBanner);
  banner.append(
    close,
    el('div', 'title', 'Documate 준비됨'),
    el('div', 'body', '이 페이지에서 확장이 활성화됐어요. (Phase 0 주입 확인)'),
  );

  root.append(style, banner);
}

function hideBanner(): void {
  removeShadowHost();
  active = false;
}

function toggle(): void {
  if (active) {
    hideBanner();
  } else {
    showBanner();
    active = true;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (isMessage(message) && message.type === 'DOCUMATE_TOGGLE') {
    toggle();
  }
});
