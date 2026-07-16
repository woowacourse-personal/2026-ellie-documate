import type { VercelRequest, VercelResponse } from '@vercel/node';
import { genai, EXPLAIN_MODEL } from '../lib/gemini.js';
import { codeExplanationSystem, explanationSystem } from '../lib/prompts.js';
import { guard, LIMITS } from '../lib/security.js';

// 개념 해설 엔드포인트 (스트리밍). 이 제품의 심장.
// 입력: { text, docTitle?, precedingText? }
// 출력: text/plain 스트림 (해설 텍스트가 도착하는 대로 흘려보냄)
// 해설은 첫 글자 체감 속도가 중요하므로 스트리밍한다.
// TODO(Phase 3): 후속 질문(멀티턴) 지원, 코드 블록 전용 해설 분기.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return; // CORS·메서드·Origin 검증

  const text: unknown = req.body?.text;
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > LIMITS.MAX_TEXT_CHARS) {
    return res.status(400).json({ error: 'text too long' });
  }
  // 선택 맥락도 길이 상한을 걸고 잘라 쓴다.
  const docTitle =
    typeof req.body?.docTitle === 'string'
      ? req.body.docTitle.slice(0, LIMITS.MAX_TITLE_CHARS)
      : undefined;
  const precedingText =
    typeof req.body?.precedingText === 'string'
      ? req.body.precedingText.slice(0, LIMITS.MAX_CONTEXT_CHARS)
      : undefined;

  const isCode = req.body?.kind === 'code';

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const stream = await genai.models.generateContentStream({
      model: EXPLAIN_MODEL,
      contents: isCode
        ? `다음 코드가 무엇을 하는지 초급자에게 설명해줘:\n\n${text}`
        : `다음 내용을 초급자에게 해설해줘:\n\n${text}`,
      config: {
        systemInstruction: isCode
          ? codeExplanationSystem({ docTitle, precedingText })
          : explanationSystem({ docTitle, precedingText }),
      },
    });

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) res.write(delta);
    }
    return res.end();
  } catch (err) {
    console.error('explain error', err);
    if (!res.headersSent) res.status(502).json({ error: 'upstream_error' });
    return res.end();
  }
}
