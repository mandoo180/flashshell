//
// 서브셋: `diff [-q] FILE1 FILE2`. 종료 코드는 GNU 와 동일 — 같으면 0, 다르면 1,
// 파일을 못 열면 2.
//
// -q(differ 한 줄 요약)와 종료 코드는 파일 두 개의 원문 텍스트를 통째로 비교하는
// 것만으로 정확히 재현된다(줄 단위 분석이 전혀 필요 없다 — docker 실측: trailing
// newline 유무만 다른 두 파일도 -q 로는 그냥 "differ", 바이트가 다르면 무조건
// differ). 그래서 -q 는 이 파일에서 가장 신뢰도 높은 경로다.
//
// 옵션 없는 기본(노멀 포맷: NcM/NaM/NdM 훅 + `< `/`> `/`---`)은 구현하지 않는다.
// 최장공통부분수열(LCS) 자체는 표준 DP로 쉽게 구하지만, 같은 길이의 LCS가 여럿
// 존재할 때(파일에 반복되는 줄이 있을 때) 그중 어느 것을 고르느냐가 훅 경계를
// 통째로 바꾼다. GNU diff 는 실제로 Miller-Myers O(ND) 알고리즘을 쓰고, 흔한
// "동점이면 삭제를 우선한다" 류의 DP 백트래킹 규칙과는 미묘하게 다른 지점에서
// 갈린다. 알파벳 5글자로 최대 8줄짜리 파일 300쌍을 무작위 생성해 docker
// debian:stable-slim(diffutils 3.10)과 대조한 결과 16/300(≈5%)이 훅 경계 또는
// 삭제/삽입 순서가 어긋났다 — 반복되는 줄이 있는 흔한 입력(단어 목록, 로그 등)에서
// 조용히 GNU와 다른 훅을 낼 수 있다는 뜻이다. task-5-report.md 에 재현 스크립트와
// 불일치 사례를 남겼다. "조용히 틀린 출력보다 미구현이 낫다"는 과제 계약에 따라
// 노멀 포맷은 정직하게 거부한다.
//
// 단, "파일이 같다"/"파일을 못 연다" 판정에는 노멀 포맷이 전혀 관여하지 않으므로
// (그냥 원문 비교/파일 열기 실패일 뿐이다) 이 두 경우는 -q 여부와 무관하게 항상
// 정확히 처리한다. 노멀 포맷 거부는 "-q 없이 불렀는데 실제로 보여줄 차이가 있는"
// 경우에만 일어난다.
import type { CommandFn } from '../types'
import { parseFlags, readSources, type Source } from './shared'

export const diff: CommandFn = (e) => {
  const { flags, rest } = parseFlags(e.args)

  const unsupported = [...flags.keys()].find((k) => k !== 'q')
  if (unsupported !== undefined) {
    return {
      stdout: '',
      stderr: `flashshell: diff: -${unsupported} 옵션은 이 환경에서 지원하지 않습니다 — diff [-q] FILE1 FILE2 만 지원합니다\n`,
      exitCode: 1,
    }
  }
  const quiet = flags.has('q')

  if (rest.length < 2) {
    const after = rest[0] ?? 'diff'
    return {
      stdout: '',
      stderr: `diff: missing operand after '${after}'\ndiff: Try 'diff --help' for more information.\n`,
      exitCode: 2,
    }
  }
  if (rest.length > 2) {
    return {
      stdout: '',
      stderr: `diff: extra operand '${rest[2]}'\ndiff: Try 'diff --help' for more information.\n`,
      exitCode: 2,
    }
  }

  const [file1, file2] = rest as [string, string]
  const { sources, stderr, failed } = readSources(e, rest)
  if (failed) return { stdout: '', stderr, exitCode: 2 }

  const [a, b] = sources as [Source, Source]
  if (a.text === b.text) return { stdout: '', stderr: '', exitCode: 0 }
  if (quiet) return { stdout: `Files ${file1} and ${file2} differ\n`, stderr: '', exitCode: 1 }

  // 여기 도달했다는 건: -q 없이 불렀고, 두 파일이 실제로 달라서 노멀 포맷 출력이
  // 필요하다는 뜻이다 — 위 주석에서 설명한 이유로 그 출력은 만들지 않는다.
  return {
    stdout: '',
    stderr: "flashshell: diff: -q 없는 노멀 포맷은 이 환경에서 지원하지 않습니다 — diff -q FILE1 FILE2 를 쓰세요\n",
    exitCode: 1,
  }
}
