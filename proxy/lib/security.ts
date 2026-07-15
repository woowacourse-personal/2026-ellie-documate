import type { VercelRequest, VercelResponse } from '@vercel/node';

// 프록시 보안 유틸.
//
// 핵심 사실: 이 확장은 공개 배포되므로, 확장에 심는 어떤 비밀(API 키·공유 토큰)도
// 사실상 공개된다. 따라서 "확장만 호출 가능"을 암호학적으로 보장할 방법은 없다.
// 여기서 하는 것은 남용의 문턱을 높이는 방어(심층 방어)이고,
// 진짜 안전장치는 (a) 레이트리밋 (b) 지출 상한 (c) 모니터링이다. 아래 NOTE 참고.

// 허용 Origin 목록. Vercel 환경변수 ALLOWED_ORIGINS(콤마 구분)로 설정한다.
//  예: chrome-extension://<확장ID>,chrome-extension://<개발용ID>
// 미설정 시 개발 편의로 모든 chrome-extension:// 를 허용한다(프로덕션에선 반드시 설정).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin);
  // 미설정 fallback: 어떤 확장이든(개발 중), 단 웹페이지 Origin은 거부.
  return origin.startsWith('chrome-extension://');
}

// CORS + Origin 검증. 통과하면 true, 아니면 응답을 닫고 false.
// NOTE: Origin 헤더는 브라우저가 붙이며 웹페이지 JS가 위조할 수 없다. 다만
// 비브라우저 클라이언트(curl 등)는 위조 가능 → 이건 인증이 아니라 문턱 높이기다.
export function guard(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return false;
  }
  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'forbidden_origin' });
    return false;
  }
  return true;
}

// 입력 크기 상한 — 비용 폭탄·DoS 방지.
export const LIMITS = {
  MAX_BATCH: 25, // 한 번에 번역할 문단 수
  MAX_TEXT_CHARS: 6_000, // 문단/해설 대상 1건 최대 길이
  MAX_TOTAL_CHARS: 60_000, // 배치 전체 합계
  MAX_CONTEXT_CHARS: 2_000, // 해설 앞문단 맥락
  MAX_TITLE_CHARS: 300,
} as const;

// 번역 배치 검증. 문제가 있으면 오류 메시지, 없으면 null.
export function validateTexts(value: unknown): { error: string } | null {
  if (!Array.isArray(value)) return { error: 'texts must be an array' };
  if (value.length === 0) return { error: 'texts is empty' };
  if (value.length > LIMITS.MAX_BATCH) return { error: 'too many texts' };
  let total = 0;
  for (const t of value) {
    if (typeof t !== 'string') return { error: 'texts must be string[]' };
    if (t.length > LIMITS.MAX_TEXT_CHARS) return { error: 'text too long' };
    total += t.length;
  }
  if (total > LIMITS.MAX_TOTAL_CHARS) return { error: 'batch too large' };
  return null;
}
