import type { Problem } from '../types'
import { safeRead, safeWalk, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l4: Problem[] = [
  {
    id: 'l4-01',
    level: 4,
    title: { en: '임시파일 청소', ko: '임시파일 청소' },
    prompt: { en: '현재 디렉터리 아래(하위 디렉터리 포함) 모든 .tmp 파일을 찾아 지우세요. 다른 파일은 건드리지 마세요.', ko: '현재 디렉터리 아래(하위 디렉터리 포함) 모든 .tmp 파일을 찾아 지우세요. 다른 파일은 건드리지 마세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/keep.txt`, 'keep\n')
      fs.writeFile(`${HOME}/top.tmp`, 'x\n')
      fs.mkdir(`${HOME}/sub`, { recursive: true })
      fs.writeFile(`${HOME}/sub/keep2.txt`, 'keep2\n')
      fs.writeFile(`${HOME}/sub/b.tmp`, 'y\n')
      fs.mkdir(`${HOME}/sub/deep`, { recursive: true })
      fs.writeFile(`${HOME}/sub/deep/c.tmp`, 'z\n')
      fs.writeFile(`${HOME}/sub/deep/keep3.txt`, 'keep3\n')
    },
    hints: [
      { en: '하위 디렉터리까지 뒤지려면 find 가 필요합니다.', ko: '하위 디렉터리까지 뒤지려면 find 가 필요합니다.' },
      { en: "find . -name '*.tmp' 로 대상을 먼저 찾아보세요.", ko: "find . -name '*.tmp' 로 대상을 먼저 찾아보세요." },
      { en: "찾은 각 파일에 rm 을 걸려면 -exec rm {} \\; 를 붙입니다.", ko: "찾은 각 파일에 rm 을 걸려면 -exec rm {} \\; 를 붙입니다." },
    ],
    check: (ctx) => {
      const entries = safeWalk(ctx.fs, HOME)
      if (entries.some((p) => p.endsWith('.tmp'))) return false
      return (
        safeRead(ctx.fs, `${HOME}/keep.txt`) === 'keep\n' &&
        safeRead(ctx.fs, `${HOME}/sub/keep2.txt`) === 'keep2\n' &&
        safeRead(ctx.fs, `${HOME}/sub/deep/keep3.txt`) === 'keep3\n'
      )
    },
    solution: "find . -name '*.tmp' -exec rm {} \\;",
    wrongAnswer: 'rm *.tmp',
    explanation:
      { en: '글롭 *.tmp 는 현재 디렉터리에 바로 있는 항목만 봅니다. sub/b.tmp, sub/deep/c.tmp 처럼 하위 디렉터리에 있는 파일은 셸이 펼쳐주지 않아 rm 은 그 존재조차 모릅니다. find . -name \'*.tmp\' 는 하위 디렉터리까지 전부 뒤져 경로를 찾아주고, -exec rm {} \\; 가 찾은 경로마다 rm 을 실행합니다.', ko: '글롭 *.tmp 는 현재 디렉터리에 바로 있는 항목만 봅니다. sub/b.tmp, sub/deep/c.tmp 처럼 하위 디렉터리에 있는 파일은 셸이 펼쳐주지 않아 rm 은 그 존재조차 모릅니다. find . -name \'*.tmp\' 는 하위 디렉터리까지 전부 뒤져 경로를 찾아주고, -exec rm {} \\; 가 찾은 경로마다 rm 을 실행합니다.' },
  },
  {
    id: 'l4-02',
    level: 4,
    title: { en: '파일 수 세기', ko: '파일 수 세기' },
    prompt: { en: 'tree 디렉터리 아래(하위 포함)의 파일이 몇 개인지(디렉터리는 빼고) 세어 count.txt 에 숫자만 저장하세요.', ko: 'tree 디렉터리 아래(하위 포함)의 파일이 몇 개인지(디렉터리는 빼고) 세어 count.txt 에 숫자만 저장하세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/tree/sub/deep`, { recursive: true })
      fs.writeFile(`${HOME}/tree/a.txt`, '1\n')
      fs.writeFile(`${HOME}/tree/b.txt`, '2\n')
      fs.writeFile(`${HOME}/tree/sub/c.txt`, '3\n')
      fs.writeFile(`${HOME}/tree/sub/deep/d.txt`, '4\n')
      fs.writeFile(`${HOME}/tree/sub/deep/e.txt`, '5\n')
    },
    hints: [
      { en: 'ls tree 는 tree 바로 안만 보여줄 뿐, sub 안의 파일은 세지 못합니다.', ko: 'ls tree 는 tree 바로 안만 보여줄 뿐, sub 안의 파일은 세지 못합니다.' },
      { en: "하위까지 파일만 골라내려면 find tree -type f 를 씁니다.", ko: "하위까지 파일만 골라내려면 find tree -type f 를 씁니다." },
      { en: "find tree -type f | wc -l > count.txt", ko: "find tree -type f | wc -l > count.txt" },
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/count.txt`), '5'),
    solution: 'find tree -type f | wc -l > count.txt',
    wrongAnswer: 'ls tree | wc -l > count.txt',
    explanation:
      { en: 'ls tree 는 tree 바로 아래의 항목(파일 2개 + sub 디렉터리 1개 = 3개)만 세므로 하위 디렉터리 안의 파일들을 놓칩니다. find tree -type f 는 하위 디렉터리까지 재귀적으로 뒤지면서 디렉터리는 빼고 파일만 골라내므로 정확히 5개가 나옵니다.', ko: 'ls tree 는 tree 바로 아래의 항목(파일 2개 + sub 디렉터리 1개 = 3개)만 세므로 하위 디렉터리 안의 파일들을 놓칩니다. find tree -type f 는 하위 디렉터리까지 재귀적으로 뒤지면서 디렉터리는 빼고 파일만 골라내므로 정확히 5개가 나옵니다.' },
  },
  {
    id: 'l4-03',
    level: 4,
    title: { en: '일괄 실행권한', ko: '일괄 실행권한' },
    prompt: { en: 'scripts 디렉터리 아래(하위 포함) 모든 .sh 파일에 755 권한을 주세요.', ko: 'scripts 디렉터리 아래(하위 포함) 모든 .sh 파일에 755 권한을 주세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/scripts/sub`, { recursive: true })
      fs.writeFile(`${HOME}/scripts/build.sh`, '#!/bin/bash\necho build\n')
      fs.chmod(`${HOME}/scripts/build.sh`, 0o644)
      fs.writeFile(`${HOME}/scripts/deploy.sh`, '#!/bin/bash\necho deploy\n')
      fs.chmod(`${HOME}/scripts/deploy.sh`, 0o644)
      fs.writeFile(`${HOME}/scripts/sub/test.sh`, '#!/bin/bash\necho test\n')
      fs.chmod(`${HOME}/scripts/sub/test.sh`, 0o644)
      fs.writeFile(`${HOME}/scripts/readme.md`, 'notes\n')
    },
    hints: [
      { en: 'scripts/*.sh 글롭은 scripts 바로 아래만 보고, scripts/sub 안은 못 봅니다.', ko: 'scripts/*.sh 글롭은 scripts 바로 아래만 보고, scripts/sub 안은 못 봅니다.' },
      { en: "find scripts -name '*.sh' 로 하위까지 대상을 모두 찾으세요.", ko: "find scripts -name '*.sh' 로 하위까지 대상을 모두 찾으세요." },
      { en: "find scripts -name '*.sh' -exec chmod 755 {} \\;", ko: "find scripts -name '*.sh' -exec chmod 755 {} \\;" },
    ],
    check: (ctx) => {
      const shPaths = [`${HOME}/scripts/build.sh`, `${HOME}/scripts/deploy.sh`, `${HOME}/scripts/sub/test.sh`]
      return shPaths.every((p) => ctx.fs.lstat(p)?.mode === 0o755)
    },
    solution: "find scripts -name '*.sh' -exec chmod 755 {} \\;",
    wrongAnswer: 'chmod 755 scripts/*.sh',
    explanation:
      { en: 'chmod 755 scripts/*.sh 는 셸이 글롭을 펼치는 시점에 scripts 바로 아래 것만 대상이 됩니다. scripts/sub/test.sh 는 매칭되지 않아 644 그대로 남습니다. find scripts -name \'*.sh\' -exec chmod 755 {} \\; 는 하위 디렉터리까지 뒤져 찾은 파일마다 chmod 를 실행하므로 전부 755 가 됩니다.', ko: 'chmod 755 scripts/*.sh 는 셸이 글롭을 펼치는 시점에 scripts 바로 아래 것만 대상이 됩니다. scripts/sub/test.sh 는 매칭되지 않아 644 그대로 남습니다. find scripts -name \'*.sh\' -exec chmod 755 {} \\; 는 하위 디렉터리까지 뒤져 찾은 파일마다 chmod 를 실행하므로 전부 755 가 됩니다.' },
  },
  {
    id: 'l4-04',
    level: 4,
    title: { en: '목록대로 삭제', ko: '목록대로 삭제' },
    prompt: { en: 'delete.txt 에 적힌 파일들을 모두 지우세요.', ko: 'delete.txt 에 적힌 파일들을 모두 지우세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/keep.txt`, 'keep\n')
      fs.writeFile(`${HOME}/a.log`, 'a\n')
      fs.writeFile(`${HOME}/b.log`, 'b\n')
      fs.writeFile(`${HOME}/c.log`, 'c\n')
      fs.writeFile(`${HOME}/delete.txt`, 'a.log\nb.log\nc.log\n')
    },
    hints: [
      { en: 'delete.txt 는 지울 파일 "이름 목록"이지, 지울 대상 자체가 아닙니다.', ko: 'delete.txt 는 지울 파일 "이름 목록"이지, 지울 대상 자체가 아닙니다.' },
      { en: '한 명령의 출력을 다른 명령의 인자로 넘기는 도구는 xargs 입니다.', ko: '한 명령의 출력을 다른 명령의 인자로 넘기는 도구는 xargs 입니다.' },
      { en: 'cat delete.txt | xargs rm', ko: 'cat delete.txt | xargs rm' },
    ],
    check: (ctx) => {
      const gone = ['a.log', 'b.log', 'c.log'].every((f) => !ctx.fs.exists(`${HOME}/${f}`))
      return gone && ctx.fs.exists(`${HOME}/keep.txt`)
    },
    solution: 'cat delete.txt | xargs rm',
    wrongAnswer: 'rm delete.txt',
    explanation:
      { en: 'rm delete.txt 는 목록이 적힌 그 파일 자체를 지울 뿐, 목록 안의 a.log/b.log/c.log 는 전혀 건드리지 않습니다. cat delete.txt | xargs rm 은 delete.txt 의 각 줄(파일 이름)을 rm 뒤에 인자로 이어붙여 rm a.log b.log c.log 를 실행합니다.', ko: 'rm delete.txt 는 목록이 적힌 그 파일 자체를 지울 뿐, 목록 안의 a.log/b.log/c.log 는 전혀 건드리지 않습니다. cat delete.txt | xargs rm 은 delete.txt 의 각 줄(파일 이름)을 rm 뒤에 인자로 이어붙여 rm a.log b.log c.log 를 실행합니다.' },
  },
  {
    id: 'l4-05',
    level: 4,
    title: { en: '총 줄 수', ko: '총 줄 수' },
    prompt: { en: 'logs 디렉터리 아래(하위 포함) 모든 .log 파일의 줄 수 합계를 total.txt 에 저장하세요. (wc 의 total 줄 형식 그대로)', ko: 'logs 디렉터리 아래(하위 포함) 모든 .log 파일의 줄 수 합계를 total.txt 에 저장하세요. (wc 의 total 줄 형식 그대로)' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/logs/sub`, { recursive: true })
      fs.writeFile(`${HOME}/logs/app.log`, 'l1\nl2\n')
      fs.writeFile(`${HOME}/logs/db.log`, 'l1\nl2\nl3\n')
      fs.writeFile(`${HOME}/logs/sub/worker.log`, 'l1\nl2\nl3\nl4\n')
    },
    hints: [
      { en: 'logs/*.log 글롭은 logs/sub 안의 로그를 놓칩니다.', ko: 'logs/*.log 글롭은 logs/sub 안의 로그를 놓칩니다.' },
      { en: "find logs -name '*.log' 로 하위까지 파일 목록을 모으고, 그 목록을 wc -l 에 넘기세요.", ko: "find logs -name '*.log' 로 하위까지 파일 목록을 모으고, 그 목록을 wc -l 에 넘기세요." },
      { en: "find logs -name '*.log' | sort | xargs wc -l > total.txt", ko: "find logs -name '*.log' | sort | xargs wc -l > total.txt" },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/total.txt`) ===
      ' 2 logs/app.log\n 3 logs/db.log\n 4 logs/sub/worker.log\n 9 total\n',
    solution: "find logs -name '*.log' | sort | xargs wc -l > total.txt",
    wrongAnswer: 'wc -l logs/*.log > total.txt',
    explanation:
      { en: 'logs/*.log 글롭은 logs 바로 아래만 보이므로 logs/sub/worker.log 를 빠뜨려 합계가 9 대신 5 로 잘못 나옵니다. find 로 하위까지 모든 .log 경로를 모으고(순서를 고정하려 sort 를 거친 뒤) xargs wc -l 에 넘기면 wc 가 여러 파일을 한 번에 받아 각 파일 줄 수와 total 줄까지 정확히 냅니다.', ko: 'logs/*.log 글롭은 logs 바로 아래만 보이므로 logs/sub/worker.log 를 빠뜨려 합계가 9 대신 5 로 잘못 나옵니다. find 로 하위까지 모든 .log 경로를 모으고(순서를 고정하려 sort 를 거친 뒤) xargs wc -l 에 넘기면 wc 가 여러 파일을 한 번에 받아 각 파일 줄 수와 total 줄까지 정확히 냅니다.' },
  },
  {
    id: 'l4-06',
    level: 4,
    title: { en: '같게 만들기', ko: '같게 만들기' },
    prompt: { en: 'actual.txt 를 expected.txt 와 완전히 같게 고치세요. (diff -q 로 확인할 수 있습니다)', ko: 'actual.txt 를 expected.txt 와 완전히 같게 고치세요. (diff -q 로 확인할 수 있습니다)' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/expected.txt`, 'line1\nline2\nline3\n')
      fs.writeFile(`${HOME}/actual.txt`, 'line1\nWRONG\nline3\n')
    },
    hints: [
      { en: 'diff -q expected.txt actual.txt 로 두 파일이 다른지 빠르게 확인할 수 있습니다.', ko: 'diff -q expected.txt actual.txt 로 두 파일이 다른지 빠르게 확인할 수 있습니다.' },
      { en: '내용을 그대로 옮기는 명령을 떠올려보세요.', ko: '내용을 그대로 옮기는 명령을 떠올려보세요.' },
      { en: 'cp expected.txt actual.txt', ko: 'cp expected.txt actual.txt' },
    ],
    check: (ctx) => {
      const expected = safeRead(ctx.fs, `${HOME}/expected.txt`)
      const actual = safeRead(ctx.fs, `${HOME}/actual.txt`)
      return expected === 'line1\nline2\nline3\n' && actual === expected
    },
    solution: 'cp expected.txt actual.txt',
    wrongAnswer: 'touch actual.txt',
    explanation:
      { en: 'touch 는 파일의 수정 시각만 갱신할 뿐 내용은 전혀 바꾸지 않습니다. actual.txt 의 둘째 줄은 여전히 WRONG 그대로라 diff -q 를 돌리면 여전히 differ 라고 나옵니다. cp expected.txt actual.txt 처럼 내용 자체를 덮어써야 두 파일이 완전히 같아집니다.', ko: 'touch 는 파일의 수정 시각만 갱신할 뿐 내용은 전혀 바꾸지 않습니다. actual.txt 의 둘째 줄은 여전히 WRONG 그대로라 diff -q 를 돌리면 여전히 differ 라고 나옵니다. cp expected.txt actual.txt 처럼 내용 자체를 덮어써야 두 파일이 완전히 같아집니다.' },
  },
  {
    id: 'l4-07',
    level: 4,
    title: { en: '심볼릭 링크', ko: '심볼릭 링크' },
    prompt: { en: 'current 라는 이름으로 releases/v2 를 가리키는 심볼릭 링크를 만드세요.', ko: 'current 라는 이름으로 releases/v2 를 가리키는 심볼릭 링크를 만드세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/releases/v1`, { recursive: true })
      fs.writeFile(`${HOME}/releases/v1/app.txt`, 'version 1\n')
      fs.mkdir(`${HOME}/releases/v2`, { recursive: true })
      fs.writeFile(`${HOME}/releases/v2/app.txt`, 'version 2\n')
    },
    hints: [
      { en: '복사(cp)는 실제 내용을 통째로 새로 만들 뿐, 원본을 "가리키는" 것이 아닙니다.', ko: '복사(cp)는 실제 내용을 통째로 새로 만들 뿐, 원본을 "가리키는" 것이 아닙니다.' },
      { en: '심볼릭 링크를 만드는 명령은 ln -s TARGET LINK 입니다.', ko: '심볼릭 링크를 만드는 명령은 ln -s TARGET LINK 입니다.' },
      { en: 'ln -s releases/v2 current', ko: 'ln -s releases/v2 current' },
    ],
    check: (ctx) => {
      const node = ctx.fs.lstat(`${HOME}/current`)
      if (!node || node.kind !== 'symlink') return false
      return safeRead(ctx.fs, `${HOME}/current/app.txt`) === 'version 2\n'
    },
    solution: 'ln -s releases/v2 current',
    wrongAnswer: 'cp -r releases/v2 current',
    explanation:
      { en: 'cp -r 은 releases/v2 의 내용을 통째로 복사한 새 디렉터리를 만듭니다 — current 는 진짜 디렉터리가 되어, 나중에 releases/v2 가 바뀌어도 current 는 따라가지 않습니다. ln -s releases/v2 current 는 이름만 다른 "가리키는 화살표"(심볼릭 링크)를 만들어, current 를 통해 읽으면 항상 releases/v2 의 최신 내용을 보게 됩니다.', ko: 'cp -r 은 releases/v2 의 내용을 통째로 복사한 새 디렉터리를 만듭니다 — current 는 진짜 디렉터리가 되어, 나중에 releases/v2 가 바뀌어도 current 는 따라가지 않습니다. ln -s releases/v2 current 는 이름만 다른 "가리키는 화살표"(심볼릭 링크)를 만들어, current 를 통해 읽으면 항상 releases/v2 의 최신 내용을 보게 됩니다.' },
  },
  {
    id: 'l4-08',
    level: 4,
    title: { en: '숨은 것 포함 개수', ko: '숨은 것 포함 개수' },
    prompt: { en: 'dir 디렉터리 아래(하위 포함, 숨김 파일도 포함, dir 자기 자신도 포함) 모든 파일과 디렉터리의 개수를 세어 n.txt 에 숫자만 저장하세요.', ko: 'dir 디렉터리 아래(하위 포함, 숨김 파일도 포함, dir 자기 자신도 포함) 모든 파일과 디렉터리의 개수를 세어 n.txt 에 숫자만 저장하세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/dir/sub`, { recursive: true })
      fs.writeFile(`${HOME}/dir/a.txt`, '1\n')
      fs.writeFile(`${HOME}/dir/.hidden`, 'h\n')
      fs.writeFile(`${HOME}/dir/sub/b.txt`, '2\n')
      fs.writeFile(`${HOME}/dir/sub/.hidden2`, 'h2\n')
    },
    hints: [
      { en: 'ls dir 은 기본적으로 숨김 파일(.으로 시작)을 감추고, 하위 디렉터리 안도 보지 않습니다.', ko: 'ls dir 은 기본적으로 숨김 파일(.으로 시작)을 감추고, 하위 디렉터리 안도 보지 않습니다.' },
      { en: 'find dir 는 dir 자기 자신부터 하위의 모든 항목(숨김 포함)을 한 줄씩 냅니다.', ko: 'find dir 는 dir 자기 자신부터 하위의 모든 항목(숨김 포함)을 한 줄씩 냅니다.' },
      { en: 'find dir | wc -l > n.txt', ko: 'find dir | wc -l > n.txt' },
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/n.txt`), '6'),
    solution: 'find dir | wc -l > n.txt',
    wrongAnswer: 'ls dir | wc -l > n.txt',
    explanation:
      { en: 'ls dir 은 dir 바로 아래의 숨김 아닌 항목(a.txt, sub 딱 2개)만 보여줍니다. .hidden 은 감춰지고, sub 안의 b.txt/.hidden2 도 보이지 않습니다. find dir 는 dir 자신을 포함해 하위의 모든 항목(숨김 파일까지)을 재귀적으로 낸다는 점에서 완전히 다릅니다 — 그래서 6개가 정확합니다(dir, .hidden, a.txt, sub, sub/.hidden2, sub/b.txt).', ko: 'ls dir 은 dir 바로 아래의 숨김 아닌 항목(a.txt, sub 딱 2개)만 보여줍니다. .hidden 은 감춰지고, sub 안의 b.txt/.hidden2 도 보이지 않습니다. find dir 는 dir 자신을 포함해 하위의 모든 항목(숨김 파일까지)을 재귀적으로 낸다는 점에서 완전히 다릅니다 — 그래서 6개가 정확합니다(dir, .hidden, a.txt, sub, sub/.hidden2, sub/b.txt).' },
  },
  {
    id: 'l4-09',
    level: 4,
    title: { en: '특정 확장자만 이동', ko: '특정 확장자만 이동' },
    prompt: { en: 'mixed 디렉터리 아래(하위 포함) .log 파일을 전부 archive 로 옮기세요.', ko: 'mixed 디렉터리 아래(하위 포함) .log 파일을 전부 archive 로 옮기세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/mixed/sub`, { recursive: true })
      fs.mkdir(`${HOME}/archive`, { recursive: true })
      fs.writeFile(`${HOME}/mixed/top.log`, 'top log\n')
      fs.writeFile(`${HOME}/mixed/note.txt`, 'note\n')
      fs.writeFile(`${HOME}/mixed/sub/deep.log`, 'deep log\n')
      fs.writeFile(`${HOME}/mixed/sub/keep.txt`, 'keep\n')
    },
    hints: [
      { en: 'mixed/*.log 글롭은 mixed 바로 아래만 보고, mixed/sub 안은 놓칩니다.', ko: 'mixed/*.log 글롭은 mixed 바로 아래만 보고, mixed/sub 안은 놓칩니다.' },
      { en: "find mixed -name '*.log' 로 하위까지 모든 .log 경로를 찾으세요.", ko: "find mixed -name '*.log' 로 하위까지 모든 .log 경로를 찾으세요." },
      { en: "find mixed -name '*.log' -exec mv {} archive \\;", ko: "find mixed -name '*.log' -exec mv {} archive \\;" },
    ],
    check: (ctx) => {
      const mixedEntries = safeWalk(ctx.fs, `${HOME}/mixed`)
      if (mixedEntries.some((p) => p.endsWith('.log'))) return false
      return (
        safeRead(ctx.fs, `${HOME}/archive/top.log`) === 'top log\n' &&
        safeRead(ctx.fs, `${HOME}/archive/deep.log`) === 'deep log\n' &&
        safeRead(ctx.fs, `${HOME}/mixed/note.txt`) === 'note\n' &&
        safeRead(ctx.fs, `${HOME}/mixed/sub/keep.txt`) === 'keep\n'
      )
    },
    solution: "find mixed -name '*.log' -exec mv {} archive \\;",
    wrongAnswer: 'mv mixed/*.log archive',
    explanation:
      { en: 'mv mixed/*.log archive 는 mixed 바로 아래의 top.log 만 옮기고, mixed/sub/deep.log 는 글롭이 보지 못해 그대로 남습니다. find mixed -name \'*.log\' -exec mv {} archive \\; 는 하위 디렉터리까지 뒤져 찾은 .log 파일마다 mv 를 실행하므로 전부 archive 로 옮겨집니다.', ko: 'mv mixed/*.log archive 는 mixed 바로 아래의 top.log 만 옮기고, mixed/sub/deep.log 는 글롭이 보지 못해 그대로 남습니다. find mixed -name \'*.log\' -exec mv {} archive \\; 는 하위 디렉터리까지 뒤져 찾은 .log 파일마다 mv 를 실행하므로 전부 archive 로 옮겨집니다.' },
  },
  {
    id: 'l4-10',
    level: 4,
    title: { en: '치환 실행 (xargs -I)', ko: '치환 실행 (xargs -I)' },
    prompt: { en: 'names.txt 에 적힌 각 이름으로 디렉터리를 하나씩 만드세요. (xargs -I 를 써보세요)', ko: 'names.txt 에 적힌 각 이름으로 디렉터리를 하나씩 만드세요. (xargs -I 를 써보세요)' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/names.txt`, 'alpha\nbeta\ngamma\n')
    },
    hints: [
      { en: 'mkdir names.txt 는 names.txt 라는 이름의 디렉터리 하나를 만들려는 것이지, 그 안의 내용을 읽는 게 아닙니다(이미 같은 이름의 파일이 있어 실패하기도 합니다).', ko: 'mkdir names.txt 는 names.txt 라는 이름의 디렉터리 하나를 만들려는 것이지, 그 안의 내용을 읽는 게 아닙니다(이미 같은 이름의 파일이 있어 실패하기도 합니다).' },
      { en: 'xargs -I {} 는 입력의 각 줄을 {} 자리에 넣어 명령을 줄마다 한 번씩 실행합니다.', ko: 'xargs -I {} 는 입력의 각 줄을 {} 자리에 넣어 명령을 줄마다 한 번씩 실행합니다.' },
      { en: 'cat names.txt | xargs -I {} mkdir {}', ko: 'cat names.txt | xargs -I {} mkdir {}' },
    ],
    check: (ctx) => ['alpha', 'beta', 'gamma'].every((n) => ctx.fs.lstat(`${HOME}/${n}`)?.kind === 'dir'),
    solution: 'cat names.txt | xargs -I {} mkdir {}',
    wrongAnswer: 'mkdir names.txt',
    explanation:
      { en: 'mkdir names.txt 는 이미 존재하는 파일 names.txt 와 이름이 겹쳐 그대로 실패합니다(설령 이름이 안 겹쳐도, "파일 내용을 줄마다 읽어 각각 디렉터리를 만든다"는 동작과는 무관합니다). xargs -I {} 는 표준입력을 줄 단위로 쪼개 각 줄을 {} 자리에 채워 넣어 명령을 여러 번 실행합니다 — cat names.txt | xargs -I {} mkdir {} 는 결국 mkdir alpha, mkdir beta, mkdir gamma 를 차례로 실행하는 것과 같습니다.', ko: 'mkdir names.txt 는 이미 존재하는 파일 names.txt 와 이름이 겹쳐 그대로 실패합니다(설령 이름이 안 겹쳐도, "파일 내용을 줄마다 읽어 각각 디렉터리를 만든다"는 동작과는 무관합니다). xargs -I {} 는 표준입력을 줄 단위로 쪼개 각 줄을 {} 자리에 채워 넣어 명령을 여러 번 실행합니다 — cat names.txt | xargs -I {} mkdir {} 는 결국 mkdir alpha, mkdir beta, mkdir gamma 를 차례로 실행하는 것과 같습니다.' },
  },
]
