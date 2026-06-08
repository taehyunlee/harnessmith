/* 단계(스텝) 타입 카탈로그 — main(generator)과 renderer가 공유.
   CommonJS(require)와 브라우저(window.STEP_TYPES) 양쪽에서 동작. */
(function (root, factory) {
  const data = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  if (typeof window !== 'undefined') window.STEP_TYPES = data;
})(typeof self !== 'undefined' ? self : this, function () {
  const TYPES = [
    { id: 'intake', icon: '📥', label: '입력 수집', color: '#3b82f6', guide: '어떤 입력을 받고 어떻게 정리·파싱하는지' },
    { id: 'analyze', icon: '🔍', label: '분석·이해', color: '#6366f1', guide: '무엇을 이해·분류·추출하는지' },
    { id: 'retrieve', icon: '🗂️', label: '검색·조회', color: '#14b8a6', guide: '어떤 소스에서 무엇을 검색·조회하는지' },
    { id: 'tool', icon: '🔧', label: '도구 호출', color: '#22c55e', guide: '어떤 도구/MCP를 어떤 인자로 호출하는지' },
    { id: 'transform', icon: '⚙️', label: '변환·처리', color: '#06b6d4', guide: '데이터를 어떻게 변환·계산·재구성하는지' },
    { id: 'generate', icon: '✨', label: '생성', color: '#a855f7', guide: '무엇을 생성하는지, 출력 형식은 무엇인지' },
    { id: 'validate', icon: '✅', label: '검증', color: '#f59e0b', guide: '무엇을 기준으로 어떻게 검증·테스트하는지' },
    { id: 'decision', icon: '🔀', label: '분기·결정', color: '#fb923c', guide: '조건과 분기(예/아니오)별 흐름' },
    { id: 'review', icon: '🙋', label: '사람 확인', color: '#ec4899', guide: '누가 무엇을 확인·승인하는지' },
    { id: 'output', icon: '📤', label: '출력·정리', color: '#64748b', guide: '최종 결과를 어떤 형식으로 정리·전달하는지' }
  ];
  const byId = {};
  TYPES.forEach((t) => (byId[t.id] = t));
  const DEFAULT = 'analyze';
  function get(id) {
    return byId[id] || byId[DEFAULT];
  }
  return { TYPES, byId, DEFAULT, get };
});
