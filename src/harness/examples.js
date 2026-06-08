'use strict';

// Seed harnesses created on first launch so the app is usable immediately.

module.exports = [
  {
    id: 'example-api-test',
    name: '예제: API 테스트 하네스 (GitHub 상태)',
    type: 'api',
    variables: {
      baseUrl: 'https://api.github.com'
    },
    steps: [
      {
        name: 'GitHub Zen 엔드포인트',
        kind: 'http',
        timeoutMs: 15000,
        request: {
          method: 'GET',
          url: '{{baseUrl}}/zen',
          headers: { 'User-Agent': 'HarnessForge' }
        },
        assertions: [
          { type: 'status', op: 'eq', value: 200 },
          { type: 'responseTime', op: 'lt', value: 5000 }
        ]
      },
      {
        name: '레포 메타데이터 조회 + 필드 검증',
        kind: 'http',
        timeoutMs: 15000,
        request: {
          method: 'GET',
          url: '{{baseUrl}}/repos/electron/electron',
          headers: { 'User-Agent': 'HarnessForge', Accept: 'application/vnd.github+json' }
        },
        assertions: [
          { type: 'status', op: 'eq', value: 200 },
          { type: 'jsonPath', path: 'name', op: 'eq', value: 'electron' },
          { type: 'jsonPath', path: 'stargazers_count', op: 'gt', value: 1000 }
        ],
        extract: [{ name: 'repoId', from: 'jsonPath', path: 'id' }]
      }
    ]
  },
  {
    id: 'example-code-verify',
    name: '예제: AI 코드 검증 하네스 (로컬 셸)',
    type: 'code',
    variables: {},
    steps: [
      {
        name: 'Node 버전 확인',
        kind: 'shell',
        timeoutMs: 10000,
        command: 'node --version',
        assertions: [
          { type: 'exitCode', op: 'eq', value: 0 },
          { type: 'stdoutContains', value: 'v' }
        ]
      },
      {
        name: '생성된 코드 실행 → 출력 검증',
        kind: 'shell',
        timeoutMs: 10000,
        command: 'node -e "console.log(2+2)"',
        assertions: [
          { type: 'exitCode', op: 'eq', value: 0 },
          { type: 'stdoutContains', value: '4' },
          { type: 'stderrNotContains', value: 'Error' }
        ]
      }
    ]
  }
];
