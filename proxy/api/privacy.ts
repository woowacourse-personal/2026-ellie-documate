import type { VercelRequest, VercelResponse } from '@vercel/node';

// 개인정보 처리방침 페이지 (공개 GET, HTML).
// 크롬 웹스토어 등록 폼의 "개인정보 처리방침 URL"에 이 주소를 넣는다: /privacy (vercel.json rewrite).
//
// ⚠️ 정본은 리포 루트의 PRIVACY.md 다. 문구를 고칠 땐 **양쪽을 함께** 고쳐 갈라지지 않게 한다
// (dev-server.mjs 복제 드리프트와 같은 함정).
//
// guard()를 태우지 않는다: 이건 브라우저가 직접 여는 공개 문서지 확장이 부르는 API가 아니다.
const HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>DocuMate 개인정보 처리방침</title>
<style>
  :root { color-scheme: light dark; }
  body {
    max-width: 720px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem;
    font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
    color: #1a1a1a; background: #fff;
  }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
  .updated { color: #6b7280; font-size: .9rem; margin: 0 0 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; font-size: .93rem; }
  th, td { border: 1px solid #d1d5db; padding: .5rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  code { background: #f3f4f6; padding: .1rem .35rem; border-radius: 4px; font-size: .9em; }
  a { color: #2563eb; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e5e7eb; background: #111; }
    .updated { color: #9ca3af; }
    th, td { border-color: #374151; }
    th { background: #1f2937; }
    code { background: #1f2937; }
    a { color: #60a5fa; }
    hr { border-top-color: #374151; }
  }
</style>
</head>
<body>
<h1>DocuMate 개인정보 처리방침</h1>
<p class="updated">최종 수정: 2026-07-19</p>

<p>DocuMate(&quot;본 확장&quot;)는 영어 개발 문서를 번역·해설해 이해를 돕는 Chrome 확장 프로그램입니다. 본 문서는 본 확장이 어떤 데이터를 다루고, 어디로 보내며, 무엇을 보관하는지 설명합니다.</p>

<h2>1. 요약</h2>
<ul>
  <li>본 확장은 <strong>아이콘을 누른 탭에서만</strong> 동작합니다(<code>activeTab</code> 권한). 누르기 전에는 어떤 페이지에서도 내용을 읽거나 전송하지 않습니다.</li>
  <li>번역·해설을 위해, 사용자가 활성화한 페이지의 <strong>본문 텍스트</strong> 또는 <strong>드래그로 선택한 텍스트</strong>를 처리 서버(프록시)를 거쳐 <strong>Google Gemini</strong>로 보냅니다.</li>
  <li><strong>계정·로그인·비밀번호·결제정보를 수집하지 않습니다.</strong> 방문 기록을 추적하지 않고, 광고·분석 트래커를 심지 않습니다.</li>
  <li>반복 번역 비용을 줄이기 위해 <strong>번역 결과</strong>를 캐시합니다. 단 <strong>드래그로 선택한 텍스트는 공용 캐시에 저장하지 않습니다</strong>(사내·비공개 문서일 수 있으므로).</li>
</ul>

<h2>2. 수집·처리하는 데이터</h2>
<table>
  <thead><tr><th>데이터</th><th>언제</th><th>목적</th><th>어디로</th></tr></thead>
  <tbody>
    <tr><td>페이지 본문 텍스트(문단·제목·콜아웃)</td><td>사용자가 아이콘을 눌러 활성화한 페이지에서</td><td>번역</td><td>프록시 → Google Gemini</td></tr>
    <tr><td>드래그로 선택한 텍스트</td><td>텍스트를 선택하고 번역/해설을 요청할 때</td><td>번역·해설</td><td>프록시 → Google Gemini</td></tr>
    <tr><td>해설 대상 문장/코드 + 문서 맥락(제목·앞 문단)</td><td>해설 버튼을 누를 때</td><td>개념·코드 해설</td><td>프록시 → Google Gemini</td></tr>
    <tr><td>후속 질문과 대화 내역</td><td>해설에 후속 질문을 할 때</td><td>대화형 해설</td><td>프록시 → Google Gemini</td></tr>
    <tr><td>IP 주소</td><td>모든 프록시 요청 시</td><td>남용 방지(레이트리밋)</td><td>프록시(임시 카운터)</td></tr>
  </tbody>
</table>
<p><strong>수집하지 않는 것:</strong> 이름·이메일·전화번호 등 신원정보, 계정·비밀번호, 결제·금융정보, 전체 방문 기록, 위치정보, 마케팅·분석용 추적 식별자.</p>

<h2>3. 제3자 서비스</h2>
<p>번역·해설 기능은 다음 외부 서비스를 사용하며, 위 데이터가 해당 서비스로 전송됩니다.</p>
<ul>
  <li><strong>Google Gemini API</strong> — 전송한 텍스트를 번역·해설로 처리합니다. Google의 API 데이터 사용 정책이 적용됩니다.</li>
  <li><strong>Vercel</strong> — 처리 서버(프록시)를 호스팅합니다.</li>
  <li><strong>Upstash (Redis)</strong> — 공용 번역 캐시와 레이트리밋 카운터를 저장합니다.</li>
</ul>
<p>본 확장은 이 외의 제3자에게 데이터를 판매하거나 공유하지 않습니다.</p>

<h2>4. 데이터 보관</h2>
<ul>
  <li><strong>공용 번역 캐시</strong> — 같은 문장을 반복 번역하지 않도록 <strong>번역된 문단 텍스트</strong>를 서버 캐시에 저장합니다. <strong>드래그로 선택한 텍스트는 저장하지 않습니다.</strong></li>
  <li><strong>로컬 캐시</strong> — 번역 결과는 사용자 브라우저의 <code>chrome.storage.local</code>에도 저장되어, 확장을 제거하면 함께 삭제됩니다.</li>
  <li><strong>IP 주소</strong> — 레이트리밋 목적의 임시 카운터로만 쓰이며, 시간 창이 지나면 자동 만료됩니다. 사용자 프로필로 축적하지 않습니다.</li>
</ul>

<h2>5. 권한 사용 이유</h2>
<ul>
  <li><code>activeTab</code> — 사용자가 아이콘을 누른 그 탭의 내용에만 접근하기 위함입니다. 상시 전체 웹 접근 권한(<code>&lt;all_urls&gt;</code>)을 요구하지 않습니다.</li>
  <li><code>storage</code> — 번역 결과를 로컬에 캐시해 재번역을 줄이기 위함입니다.</li>
  <li>호스트 접근(프록시 도메인) — 번역·해설 요청을 본 확장의 처리 서버로 보내기 위함입니다.</li>
</ul>

<h2>6. 사용자 선택권</h2>
<ul>
  <li>아이콘을 누르지 않으면 본 확장은 아무 데이터도 처리하지 않습니다.</li>
  <li>민감한(사내·비공개) 텍스트는 <strong>드래그 선택 방식</strong>으로 요청하면 공용 캐시에 저장되지 않습니다.</li>
  <li>Chrome의 확장 관리 화면에서 언제든 제거할 수 있으며, 제거 시 로컬 캐시도 삭제됩니다.</li>
</ul>

<h2>7. 문의</h2>
<p>개인정보 처리에 관한 문의: <a href="mailto:joeungyeong23@gmail.com">joeungyeong23@gmail.com</a></p>
<p>본 방침은 기능 변경에 따라 개정될 수 있으며, 개정 시 상단의 &quot;최종 수정&quot; 날짜를 갱신합니다.</p>

<hr />
<p style="color:#9ca3af;font-size:.85rem">DocuMate · 개인정보 처리방침</p>
</body>
</html>`;

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send(HTML);
}
