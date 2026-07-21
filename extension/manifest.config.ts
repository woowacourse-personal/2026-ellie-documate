import { defineManifest } from '@crxjs/vite-plugin';

// Documate 크롬 확장 매니페스트 (MV3)
// 활성화 모델(B안): 사용자가 아이콘을 클릭한 탭에서만 동작한다.
//   - default_popup을 두지 않아 아이콘 클릭이 background의 action.onClicked로 전달된다.
//   - content script는 모든 웹페이지에 주입되지만, 클릭 메시지를 받기 전까지는
//     리스너 등록만 하고 UI를 그리거나 LLM을 호출하지 않는다(유휴 상태).
export default defineManifest({
  manifest_version: 3,
  name: 'DocuMate',
  version: '1.0.1',

  // 확장 ID는 크롬 웹스토어가 게시 시 배정한다(매니페스트에 `key`를 넣으면 업로드가
  // 거부됨 — "key 입력란은 매니페스트에 허용되지 않습니다"). 따라서 여기엔 key를 두지
  // 않고, 게시 후 대시보드에서 배정된 ID를 확인해 프록시 ALLOWED_ORIGINS를 맞춘다.
  // (로컬 개발 unpacked ID는 이와 다르므로, 프록시를 붙여 개발할 땐 localhost 프록시를
  //  쓰거나 그 dev ID도 ALLOWED_ORIGINS에 추가한다.)
  description:
    '영어 개발 문서와 기술 아티클을 개발 용어와 기술적인 맥락에 맞게 번역하고 해설하는 Chrome 확장 프로그램입니다.',

  // 아이콘: public/icons/ 의 PNG가 빌드 시 dist/icons/ 로 복사된다(Vite public).
  // 툴바·확장 관리 화면·스토어에서 쓰인다. 원본 로고(문서 모양 D + M)에서 흰 배경을
  // 투명 처리하고 여백을 크롭해 작은 사이즈에서도 마크가 또렷하게 보이도록 생성했다.
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },

  action: {
    default_title: 'DocuMate 켜기 / 끄기',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },

  background: {
    // content/index.ts 와 파일명이 겹치면 CRXJS 청크가 충돌해 SW가 엉뚱한 번들을
    // 로드한다(onClicked 미등록 버그). 진입점 파일명을 반드시 구분한다.
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  // 모든 웹페이지(http/https). 클릭 전엔 유휴 상태라 특정 사이트 제한을 두지 않는다.
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

  // storage: 번역 결과 로컬 캐시(같은 문단 재번역 방지).
  permissions: ['activeTab', 'storage'],

  // 우리 프록시 호출 허용. 프로덕션 프록시 URL. 로컬에서 프록시를 고칠 땐
  // 'http://localhost:3000/*'를 잠깐 추가한다(PROXY_BASE_URL도 함께).
  host_permissions: ['https://documate-proxy-jo-eungyeongs-projects.vercel.app/*'],
});
