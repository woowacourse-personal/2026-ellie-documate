import { GoogleGenAI } from '@google/genai';

// Gemini 클라이언트. API 키는 오직 이 프록시 환경변수에만 존재한다(확장에는 절대 두지 않는다).
// GEMINI_API_KEY 를 Vercel 환경변수 또는 로컬 .env.local 에 둔다.
export const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 모델 선택.
//  - 번역: 대량 호출이라 비용/지연 중요 → 경량·빠른 Flash. thinking 끔.
//  - 해설: 이 제품의 심장. 이상적으론 상위 Pro지만 gemini-2.5-pro는 무료 티어
//    한도가 0(결제 필요)이라, 무료로 도는 Flash를 기본으로 둔다.
//    결제 활성화 후 품질을 더 원하면 EXPLAIN_MODEL을 'gemini-2.5-pro'로 올린다.
// 'gemini-flash-latest'는 현재 Flash 최신을 가리키는 별칭. 구형 2.5-flash는
// 신규 사용자 generateContent가 막혀 이걸로 둔다(결제 활성화 시 pro로 상향 검토).
export const TRANSLATE_MODEL = 'gemini-flash-latest';
export const EXPLAIN_MODEL = 'gemini-flash-latest';
