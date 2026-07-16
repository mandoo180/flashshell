import type { Problem } from '../types'
import { safeRead, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l2: Problem[] = [
  {
    id: 'l2-01',
    level: 2,
    title: { en: '사본 만들기', ko: '사본 만들기' },
    prompt: { en: 'config.ini 를 config.ini.bak 이라는 이름으로 복사하세요. 원본은 그대로 두어야 합니다.', ko: 'config.ini 를 config.ini.bak 이라는 이름으로 복사하세요. 원본은 그대로 두어야 합니다.' },
    setup: (fs) => { fs.writeFile(`${HOME}/config.ini`, 'port=8080\n') },
    hints: [
      { en: '복사는 cp, 이동은 mv 입니다.', ko: '복사는 cp, 이동은 mv 입니다.' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/config.ini`) === 'port=8080\n' &&
      safeRead(ctx.fs, `${HOME}/config.ini.bak`) === 'port=8080\n',
    solution: 'cp config.ini config.ini.bak',
    wrongAnswer: 'mv config.ini config.ini.bak',
    explanation: { en: 'mv 를 썼다면 원본이 사라집니다. 백업의 목적은 원본을 남기는 것이므로 cp 여야 합니다. 이름이 비슷해서 자주 틀립니다.', ko: 'mv 를 썼다면 원본이 사라집니다. 백업의 목적은 원본을 남기는 것이므로 cp 여야 합니다. 이름이 비슷해서 자주 틀립니다.' },
  },
  {
    id: 'l2-02',
    level: 2,
    title: { en: '정리', ko: '정리' },
    prompt: { en: 'archive 디렉터리를 만들고, old.log 를 그 안으로 옮기세요.', ko: 'archive 디렉터리를 만들고, old.log 를 그 안으로 옮기세요.' },
    setup: (fs) => { fs.writeFile(`${HOME}/old.log`, 'stale\n') },
    hints: [
      { en: '디렉터리를 만드는 명령은 mkdir 입니다.', ko: '디렉터리를 만드는 명령은 mkdir 입니다.' },
      { en: '두 명령을 세미콜론으로 이어 한 줄에 쓸 수 있습니다.', ko: '두 명령을 세미콜론으로 이어 한 줄에 쓸 수 있습니다.' },
    ],
    check: (ctx) =>
      ctx.fs.isDir(`${HOME}/archive`) &&
      safeRead(ctx.fs, `${HOME}/archive/old.log`) === 'stale\n' &&
      !ctx.fs.exists(`${HOME}/old.log`),
    solution: 'mkdir archive ; mv old.log archive',
    wrongAnswer: 'mkdir archive ; cp old.log archive',
    explanation: { en: 'mv 의 대상이 이미 존재하는 디렉터리이면, 셸은 "그 디렉터리 안으로 넣으라"는 뜻으로 해석합니다. 대상이 없으면 이름을 바꾸는 것이 되고요. 같은 명령이 상황에 따라 다르게 행동합니다.', ko: 'mv 의 대상이 이미 존재하는 디렉터리이면, 셸은 "그 디렉터리 안으로 넣으라"는 뜻으로 해석합니다. 대상이 없으면 이름을 바꾸는 것이 되고요. 같은 명령이 상황에 따라 다르게 행동합니다.' },
  },
  {
    id: 'l2-03',
    level: 2,
    title: { en: '통째로 복사', ko: '통째로 복사' },
    prompt: { en: 'src 디렉터리를 하위 내용까지 전부 backup 이라는 이름으로 복사하세요.', ko: 'src 디렉터리를 하위 내용까지 전부 backup 이라는 이름으로 복사하세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/src/lib`, { recursive: true })
      fs.writeFile(`${HOME}/src/main.js`, 'main\n')
      fs.writeFile(`${HOME}/src/lib/util.js`, 'util\n')
    },
    hints: [
      { en: 'cp 는 기본적으로 디렉터리를 거부합니다.', ko: 'cp 는 기본적으로 디렉터리를 거부합니다.' },
      { en: '재귀(recursive)를 뜻하는 짧은 플래그가 있습니다.', ko: '재귀(recursive)를 뜻하는 짧은 플래그가 있습니다.' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/backup/main.js`) === 'main\n' &&
      safeRead(ctx.fs, `${HOME}/backup/lib/util.js`) === 'util\n' &&
      ctx.fs.exists(`${HOME}/src/main.js`),
    solution: 'cp -r src backup',
    wrongAnswer: 'cp src backup',
    explanation: { en: 'cp 는 기본적으로 파일 하나만 다룹니다. 디렉터리를 주면 "omitting directory" 라며 거부합니다. -r 은 recursive 이고, 대문자 -R 도 같은 뜻입니다.', ko: 'cp 는 기본적으로 파일 하나만 다룹니다. 디렉터리를 주면 "omitting directory" 라며 거부합니다. -r 은 recursive 이고, 대문자 -R 도 같은 뜻입니다.' },
  },
  {
    id: 'l2-04',
    level: 2,
    title: { en: '흔적 지우기', ko: '흔적 지우기' },
    prompt: { en: 'tmp 디렉터리와 그 안의 모든 것을 지우세요.', ko: 'tmp 디렉터리와 그 안의 모든 것을 지우세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/tmp/cache`, { recursive: true })
      fs.writeFile(`${HOME}/tmp/session`, 'x\n')
      fs.writeFile(`${HOME}/tmp/cache/blob`, 'y\n')
      fs.writeFile(`${HOME}/keep.txt`, 'keep\n')
    },
    hints: [
      { en: 'rm 은 기본적으로 디렉터리를 거부합니다.', ko: 'rm 은 기본적으로 디렉터리를 거부합니다.' },
      { en: 'cp 와 같은 플래그를 씁니다.', ko: 'cp 와 같은 플래그를 씁니다.' },
    ],
    check: (ctx) => !ctx.fs.exists(`${HOME}/tmp`) && ctx.fs.exists(`${HOME}/keep.txt`),
    solution: 'rm -r tmp',
    wrongAnswer: 'rm -r tmp keep.txt',
    explanation: { en: 'rm -r 은 되돌릴 수 없습니다. 휴지통도 없습니다. 이 명령 앞에서 잠시 멈추는 습관이 경력을 구합니다. 특히 rm -rf 에 변수를 섞을 때는 그 변수가 빈 문자열일 가능성을 항상 의심하세요.', ko: 'rm -r 은 되돌릴 수 없습니다. 휴지통도 없습니다. 이 명령 앞에서 잠시 멈추는 습관이 경력을 구합니다. 특히 rm -rf 에 변수를 섞을 때는 그 변수가 빈 문자열일 가능성을 항상 의심하세요.' },
  },
  {
    id: 'l2-05',
    level: 2,
    title: { en: '기록하기', ko: '기록하기' },
    prompt: { en: 'log.txt 파일을 만들고 그 안에 정확히 "boot ok" 한 줄만 넣으세요.', ko: 'log.txt 파일을 만들고 그 안에 정확히 "boot ok" 한 줄만 넣으세요.' },
    setup: () => {},
    hints: [
      { en: 'echo 의 출력을 파일로 돌리려면 > 를 씁니다.', ko: 'echo 의 출력을 파일로 돌리려면 > 를 씁니다.' },
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/log.txt`), 'boot ok'),
    solution: 'echo "boot ok" > log.txt',
    wrongAnswer: 'touch log.txt',
    explanation: { en: '> 는 파일을 열면서 즉시 비웁니다(truncate). 파일이 없으면 만들고, 있으면 내용을 날립니다. 그래서 실수로 중요한 파일에 > 를 쓰면 순식간에 사라집니다.', ko: '> 는 파일을 열면서 즉시 비웁니다(truncate). 파일이 없으면 만들고, 있으면 내용을 날립니다. 그래서 실수로 중요한 파일에 > 를 쓰면 순식간에 사라집니다.' },
  },
  {
    id: 'l2-06',
    level: 2,
    title: { en: '덧붙이기', ko: '덧붙이기' },
    prompt: { en: 'log.txt 에 이미 한 줄이 있습니다. 기존 내용을 지우지 말고 "shutdown" 을 다음 줄에 추가하세요.', ko: 'log.txt 에 이미 한 줄이 있습니다. 기존 내용을 지우지 말고 "shutdown" 을 다음 줄에 추가하세요.' },
    setup: (fs) => { fs.writeFile(`${HOME}/log.txt`, 'boot ok\n') },
    hints: [
      { en: '> 는 파일을 비우고 씁니다.', ko: '> 는 파일을 비우고 씁니다.' },
      { en: '비우지 않고 이어붙이는 연산자는 꺾쇠 두 개입니다.', ko: '비우지 않고 이어붙이는 연산자는 꺾쇠 두 개입니다.' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/log.txt`) === 'boot ok\nshutdown\n',
    solution: 'echo shutdown >> log.txt',
    wrongAnswer: 'echo shutdown > log.txt',
    explanation: { en: '> 와 >> 의 차이는 하나뿐입니다. > 는 truncate 하고 >> 는 append 합니다. 로그 파일을 다룰 때 이 하나를 틀리면 하루치 로그가 사라집니다.', ko: '> 와 >> 의 차이는 하나뿐입니다. > 는 truncate 하고 >> 는 append 합니다. 로그 파일을 다룰 때 이 하나를 틀리면 하루치 로그가 사라집니다.' },
  },
  {
    id: 'l2-07',
    level: 2,
    title: { en: '오류만 걸러내기', ko: '오류만 걸러내기' },
    prompt: { en: 'ghost.txt 는 존재하지 않습니다. cat 으로 읽되, 오류 메시지가 화면에 뜨지 않고 errors.log 에 저장되게 하세요.', ko: 'ghost.txt 는 존재하지 않습니다. cat 으로 읽되, 오류 메시지가 화면에 뜨지 않고 errors.log 에 저장되게 하세요.' },
    setup: () => {},
    hints: [
      { en: '표준출력과 표준오류는 다른 통로입니다.', ko: '표준출력과 표준오류는 다른 통로입니다.' },
      { en: '표준출력은 1번, 표준오류는 2번입니다.', ko: '표준출력은 1번, 표준오류는 2번입니다.' },
      { en: '2> 로 표준오류만 파일로 보낼 수 있습니다.', ko: '2> 로 표준오류만 파일로 보낼 수 있습니다.' },
    ],
    check: (ctx) => {
      const log = safeRead(ctx.fs, `${HOME}/errors.log`)
      return log !== null && log.includes('No such file or directory') && ctx.lastResult.stderr === ''
    },
    solution: 'cat ghost.txt 2> errors.log',
    wrongAnswer: 'cat ghost.txt > errors.log',
    explanation: { en: '> 는 사실 1> 의 줄임말입니다. 1번 파일 서술자, 즉 표준출력을 돌립니다. 오류 메시지는 2번으로 나가므로 > 로는 잡히지 않고 화면에 그대로 뜹니다. 2> 를 써야 합니다.', ko: '> 는 사실 1> 의 줄임말입니다. 1번 파일 서술자, 즉 표준출력을 돌립니다. 오류 메시지는 2번으로 나가므로 > 로는 잡히지 않고 화면에 그대로 뜹니다. 2> 를 써야 합니다.' },
  },
  {
    id: 'l2-08',
    level: 2,
    title: { en: '실행 권한', ko: '실행 권한' },
    prompt: { en: 'deploy.sh 에 소유자 실행 권한을 부여하세요. 최종 권한은 755 여야 합니다.', ko: 'deploy.sh 에 소유자 실행 권한을 부여하세요. 최종 권한은 755 여야 합니다.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/deploy.sh`, '#!/bin/bash\necho deploying\n')
      fs.chmod(`${HOME}/deploy.sh`, 0o644)
    },
    hints: [
      { en: '권한을 바꾸는 명령은 chmod 입니다.', ko: '권한을 바꾸는 명령은 chmod 입니다.' },
      { en: '8진수 세 자리로 rwx 를 표현합니다. r=4, w=2, x=1.', ko: '8진수 세 자리로 rwx 를 표현합니다. r=4, w=2, x=1.' },
    ],
    check: (ctx) => ctx.fs.lstat(`${HOME}/deploy.sh`)?.mode === 0o755,
    solution: 'chmod 755 deploy.sh',
    wrongAnswer: 'chmod 644 deploy.sh',
    explanation: { en: '755 는 소유자에게 rwx(4+2+1), 그룹과 나머지에게 r-x(4+1) 를 줍니다. chmod +x 도 실행 비트를 켜지만, 644 에서 시작하면 755 가 됩니다 — 이 문제에서는 둘 다 정답입니다.', ko: '755 는 소유자에게 rwx(4+2+1), 그룹과 나머지에게 r-x(4+1) 를 줍니다. chmod +x 도 실행 비트를 켜지만, 644 에서 시작하면 755 가 됩니다 — 이 문제에서는 둘 다 정답입니다.' },
  },
  {
    id: 'l2-09',
    level: 2,
    title: { en: '지름길', ko: '지름길' },
    prompt: { en: 'data/2026/reports 디렉터리를 한 번에 만드세요. 중간 디렉터리는 아직 없습니다.', ko: 'data/2026/reports 디렉터리를 한 번에 만드세요. 중간 디렉터리는 아직 없습니다.' },
    setup: () => {},
    hints: [
      { en: 'mkdir 은 기본적으로 부모가 없으면 실패합니다.', ko: 'mkdir 은 기본적으로 부모가 없으면 실패합니다.' },
      { en: 'parents 를 뜻하는 플래그가 있습니다.', ko: 'parents 를 뜻하는 플래그가 있습니다.' },
    ],
    check: (ctx) => ctx.fs.isDir(`${HOME}/data/2026/reports`),
    solution: 'mkdir -p data/2026/reports',
    wrongAnswer: 'mkdir data/2026/reports',
    explanation: { en: '-p 는 parents 입니다. 없는 중간 디렉터리를 전부 만들어 주고, 이미 있어도 오류를 내지 않습니다. 스크립트에서 "있으면 말고, 없으면 만들어" 를 표현하는 가장 짧은 방법입니다.', ko: '-p 는 parents 입니다. 없는 중간 디렉터리를 전부 만들어 주고, 이미 있어도 오류를 내지 않습니다. 스크립트에서 "있으면 말고, 없으면 만들어" 를 표현하는 가장 짧은 방법입니다.' },
  },
  {
    id: 'l2-10',
    level: 2,
    title: { en: '수확', ko: '수확' },
    prompt: { en: 'logs 디렉터리 안의 .log 파일들을 전부 합쳐 all.log 하나로 만드세요. 파일들이 사전순으로 이어져야 합니다.', ko: 'logs 디렉터리 안의 .log 파일들을 전부 합쳐 all.log 하나로 만드세요. 파일들이 사전순으로 이어져야 합니다.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/logs`)
      fs.writeFile(`${HOME}/logs/a.log`, 'first\n')
      fs.writeFile(`${HOME}/logs/b.log`, 'second\n')
      fs.writeFile(`${HOME}/logs/c.log`, 'third\n')
      fs.writeFile(`${HOME}/logs/notes.md`, 'ignore me\n')
    },
    hints: [
      { en: 'cat 은 여러 파일을 인자로 받아 순서대로 이어붙입니다.', ko: 'cat 은 여러 파일을 인자로 받아 순서대로 이어붙입니다.' },
      { en: '글롭 logs/*.log 는 셸이 사전순으로 펼쳐줍니다.', ko: '글롭 logs/*.log 는 셸이 사전순으로 펼쳐줍니다.' },
      { en: '그 결과를 > 로 파일에 담으세요.', ko: '그 결과를 > 로 파일에 담으세요.' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/all.log`) === 'first\nsecond\nthird\n',
    solution: 'cat logs/*.log > all.log',
    wrongAnswer: 'cat logs/* > all.log',
    explanation: { en: 'cat 의 이름이 concatenate 인 이유가 여기서 드러납니다. 그리고 셸은 글롭을 항상 사전순으로 정렬해 펼치므로 순서가 보장됩니다. notes.md 를 제외하려면 패턴을 *.log 로 좁혀야 합니다 — logs/* 는 그것까지 삼킵니다.', ko: 'cat 의 이름이 concatenate 인 이유가 여기서 드러납니다. 그리고 셸은 글롭을 항상 사전순으로 정렬해 펼치므로 순서가 보장됩니다. notes.md 를 제외하려면 패턴을 *.log 로 좁혀야 합니다 — logs/* 는 그것까지 삼킵니다.' },
  },
]
