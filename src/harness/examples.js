'use strict';

// Seed project created on first launch so the app is usable immediately.

module.exports = [
  {
    id: 'example-project',
    name: '예제: 회의록 요약 스킬',
    skillName: 'meeting-notes-summarizer',
    purpose:
      '회의 녹취 또는 메모를 입력받아 핵심 결정사항, 액션 아이템(담당자/기한 포함), 다음 회의 안건으로 정리한다. 비전공자도 바로 쓸 수 있게 형식을 고정한다.',
    audience: '회의를 주재하거나 기록하는 모든 팀원',
    triggerDescription:
      '회의록·녹취·메모를 요약하거나 액션 아이템을 정리해달라고 할 때 사용합니다.',
    outputs: ['skill', 'design'],
    steps: [
      { id: 's1', title: '입력 정리', detail: '녹취/메모에서 잡담·중복을 제거하고 주제별로 묶는다.' },
      { id: 's2', title: '핵심 추출', detail: '결정사항과 미결 안건을 구분해 추출한다.' },
      { id: 's3', title: '액션 아이템화', detail: '각 항목에 담당자와 기한을 붙인다. 없으면 "미정"으로 표기.' },
      { id: 's4', title: '형식 출력', detail: '결정사항 / 액션 아이템(표) / 다음 안건 3단 구조로 출력.' }
    ],
    tools: [
      { id: 't1', name: '파일 읽기', note: '첨부된 회의 메모/녹취 파일을 읽는다' }
    ],
    constraints: ['추측으로 담당자나 기한을 만들지 않는다', '원문에 없는 결정사항을 추가하지 않는다'],
    attachments: [],
    layout: {}
  }
];
