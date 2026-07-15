// Content Script (초기 타깃: developer.android.com — 하드코딩 아님, matches로 범위만 제한).
//
// Phase 1: 아이콘 클릭 시 Readability로 본문을 추출하고 문단으로 분리해
//   콘솔에 문단 경계를 찍는다(눈으로 확인). 뷰포트·SPA 옵저버도 연결한다.
//   아직 페이지에 번역/해설을 주입하진 않는다 → Phase 2에서.

import { isMessage } from '../shared/messages';
import { ensureShadowHost, removeShadowHost } from './ui/mount';
import { extractParagraphs } from './extract';
import { observeMutations, observeViewport } from './observer';

let active = false;
let viewportIO: IntersectionObserver | undefined;
let mutationMO: MutationObserver | undefined;

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

// 추출 결과 요약을 배너로 보여준다(현 단계의 시각 확인 요소).
function showBanner(message: string): void {
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
    .hint { color: #9aa0a6; margin-top: 6px; font-size: 12px; }
    .close {
      position: absolute; top: 8px; right: 10px;
      background: none; border: none; color: #9aa0a6;
      font-size: 16px; cursor: pointer;
    }
  `;

  const banner = el('div', 'banner');
  const close = el('button', 'close', '×');
  close.setAttribute('aria-label', '닫기');
  close.addEventListener('click', deactivate);
  banner.append(
    close,
    el('div', 'title', 'Documate'),
    el('div', 'body', message),
    el('div', 'hint', '콘솔(DevTools)에서 문단 목록을 확인하세요.'),
  );

  root.append(style, banner);
}

// 추출 → 콘솔 출력 → 옵저버 연결. Phase 1 완료 기준: 문단 경계가 콘솔에 정확히 찍힌다.
function runPipeline(): void {
  const result = extractParagraphs();

  console.log(
    `[Documate] "${result.title}" — 문단 ${result.paragraphs.length}개 매핑` +
      (result.unmappedCount ? `, ${result.unmappedCount}개 매핑실패(폴백)` : '') +
      ` (Readability ${result.readabilityOk ? 'OK' : '실패 → 드래그 폴백 후보'})`,
  );
  console.table(
    result.paragraphs.map((p) => ({
      id: p.id,
      kind: p.kind,
      text: p.text.length > 60 ? `${p.text.slice(0, 60)}…` : p.text,
    })),
  );

  showBanner(
    `문단 ${result.paragraphs.length}개 인식` +
      (result.readabilityOk ? '' : ' (폴백 후보)'),
  );

  // 뷰포트 진입 문단 로깅(Phase 2: 여기서 번역 요청).
  viewportIO?.disconnect();
  viewportIO = observeViewport(result.paragraphs, (p) => {
    console.log('[Documate] 뷰포트 진입:', p.id, '·', p.text.slice(0, 40));
  });

  // SPA 리렌더 시 재추출(한 번만 설치).
  if (!mutationMO) {
    mutationMO = observeMutations(() => {
      if (!active) return;
      console.log('[Documate] DOM 변경 감지 → 재추출');
      runPipeline();
    });
  }
}

function deactivate(): void {
  removeShadowHost();
  viewportIO?.disconnect();
  viewportIO = undefined;
  mutationMO?.disconnect();
  mutationMO = undefined;
  active = false;
}

function toggle(): void {
  if (active) {
    deactivate();
  } else {
    active = true;
    runPipeline();
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (isMessage(message) && message.type === 'DOCUMATE_TOGGLE') {
    toggle();
  }
});

// content script가 이 페이지에 실제로 주입됐음을 확인하는 로그.
console.log('[Documate] content script 로드됨 ·', location.href);
