import type { Problem } from '../types'
import { safeRead, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l2: Problem[] = [
  {
    id: 'l2-01',
    level: 2,
    title: { en: 'Make a Copy', ko: '사본 만들기' },
    prompt: {
      en: 'Copy config.ini to a file named config.ini.bak. The original must stay put.',
      ko: 'config.ini 를 config.ini.bak 이라는 이름으로 복사하세요. 원본은 그대로 두어야 합니다.',
    },
    setup: (fs) => { fs.writeFile(`${HOME}/config.ini`, 'port=8080\n') },
    hints: [
      { en: 'Copy is cp, move is mv.', ko: '복사는 cp, 이동은 mv 입니다.' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/config.ini`) === 'port=8080\n' &&
      safeRead(ctx.fs, `${HOME}/config.ini.bak`) === 'port=8080\n',
    solution: 'cp config.ini config.ini.bak',
    wrongAnswer: 'mv config.ini config.ini.bak',
    explanation: {
      en: 'Use mv and the original is gone. The whole point of a backup is to keep the original, so it has to be cp. The two are easy to confuse because the names look so alike.',
      ko: 'mv 를 썼다면 원본이 사라집니다. 백업의 목적은 원본을 남기는 것이므로 cp 여야 합니다. 이름이 비슷해서 자주 틀립니다.',
    },
  },
  {
    id: 'l2-02',
    level: 2,
    title: { en: 'Tidy Up', ko: '정리' },
    prompt: {
      en: 'Create an archive directory and move old.log into it.',
      ko: 'archive 디렉터리를 만들고, old.log 를 그 안으로 옮기세요.',
    },
    setup: (fs) => { fs.writeFile(`${HOME}/old.log`, 'stale\n') },
    hints: [
      { en: 'The command that creates a directory is mkdir.', ko: '디렉터리를 만드는 명령은 mkdir 입니다.' },
      { en: 'You can join two commands on one line with a semicolon.', ko: '두 명령을 세미콜론으로 이어 한 줄에 쓸 수 있습니다.' },
    ],
    check: (ctx) =>
      ctx.fs.isDir(`${HOME}/archive`) &&
      safeRead(ctx.fs, `${HOME}/archive/old.log`) === 'stale\n' &&
      !ctx.fs.exists(`${HOME}/old.log`),
    solution: 'mkdir archive ; mv old.log archive',
    wrongAnswer: 'mkdir archive ; cp old.log archive',
    explanation: {
      en: 'When the target of mv is a directory that already exists, the shell reads it as "put this inside that directory." When the target does not exist, it becomes a rename. The same command behaves differently depending on the situation.',
      ko: 'mv 의 대상이 이미 존재하는 디렉터리이면, 셸은 "그 디렉터리 안으로 넣으라"는 뜻으로 해석합니다. 대상이 없으면 이름을 바꾸는 것이 되고요. 같은 명령이 상황에 따라 다르게 행동합니다.',
    },
  },
  {
    id: 'l2-03',
    level: 2,
    title: { en: 'Copy It Whole', ko: '통째로 복사' },
    prompt: {
      en: 'Copy the src directory, everything inside it included, to a copy named backup.',
      ko: 'src 디렉터리를 하위 내용까지 전부 backup 이라는 이름으로 복사하세요.',
    },
    setup: (fs) => {
      fs.mkdir(`${HOME}/src/lib`, { recursive: true })
      fs.writeFile(`${HOME}/src/main.js`, 'main\n')
      fs.writeFile(`${HOME}/src/lib/util.js`, 'util\n')
    },
    hints: [
      { en: 'By default cp refuses directories.', ko: 'cp 는 기본적으로 디렉터리를 거부합니다.' },
      { en: 'There is a short flag that means recursive.', ko: '재귀(recursive)를 뜻하는 짧은 플래그가 있습니다.' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/backup/main.js`) === 'main\n' &&
      safeRead(ctx.fs, `${HOME}/backup/lib/util.js`) === 'util\n' &&
      ctx.fs.exists(`${HOME}/src/main.js`),
    solution: 'cp -r src backup',
    wrongAnswer: 'cp src backup',
    explanation: {
      en: 'By default cp handles only a single file. Give it a directory and it refuses with "omitting directory". -r stands for recursive, and the capital -R means the same thing.',
      ko: 'cp 는 기본적으로 파일 하나만 다룹니다. 디렉터리를 주면 "omitting directory" 라며 거부합니다. -r 은 recursive 이고, 대문자 -R 도 같은 뜻입니다.',
    },
  },
  {
    id: 'l2-04',
    level: 2,
    title: { en: 'Erase the Traces', ko: '흔적 지우기' },
    prompt: {
      en: 'Delete the tmp directory and everything inside it.',
      ko: 'tmp 디렉터리와 그 안의 모든 것을 지우세요.',
    },
    setup: (fs) => {
      fs.mkdir(`${HOME}/tmp/cache`, { recursive: true })
      fs.writeFile(`${HOME}/tmp/session`, 'x\n')
      fs.writeFile(`${HOME}/tmp/cache/blob`, 'y\n')
      fs.writeFile(`${HOME}/keep.txt`, 'keep\n')
    },
    hints: [
      { en: 'By default rm refuses directories.', ko: 'rm 은 기본적으로 디렉터리를 거부합니다.' },
      { en: 'Use the same flag as cp.', ko: 'cp 와 같은 플래그를 씁니다.' },
    ],
    check: (ctx) => !ctx.fs.exists(`${HOME}/tmp`) && ctx.fs.exists(`${HOME}/keep.txt`),
    solution: 'rm -r tmp',
    wrongAnswer: 'rm -r tmp keep.txt',
    explanation: {
      en: 'rm -r cannot be undone. There is no trash can either. The habit of pausing for a moment before this command is what saves careers. Above all, when you mix a variable into rm -rf, always suspect that the variable could be an empty string.',
      ko: 'rm -r 은 되돌릴 수 없습니다. 휴지통도 없습니다. 이 명령 앞에서 잠시 멈추는 습관이 경력을 구합니다. 특히 rm -rf 에 변수를 섞을 때는 그 변수가 빈 문자열일 가능성을 항상 의심하세요.',
    },
  },
  {
    id: 'l2-05',
    level: 2,
    title: { en: 'Put It on Record', ko: '기록하기' },
    prompt: {
      en: 'Create a log.txt file and put exactly one line inside it: "boot ok".',
      ko: 'log.txt 파일을 만들고 그 안에 정확히 "boot ok" 한 줄만 넣으세요.',
    },
    setup: () => {},
    hints: [
      { en: "To divert echo's output into a file, use >.", ko: 'echo 의 출력을 파일로 돌리려면 > 를 씁니다.' },
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/log.txt`), 'boot ok'),
    solution: 'echo "boot ok" > log.txt',
    wrongAnswer: 'touch log.txt',
    explanation: {
      en: '> opens the file and empties it immediately (truncate). If the file does not exist it creates one; if it does, it wipes the contents. So aim > at an important file by mistake and it vanishes in an instant.',
      ko: '> 는 파일을 열면서 즉시 비웁니다(truncate). 파일이 없으면 만들고, 있으면 내용을 날립니다. 그래서 실수로 중요한 파일에 > 를 쓰면 순식간에 사라집니다.',
    },
  },
  {
    id: 'l2-06',
    level: 2,
    title: { en: 'Append', ko: '덧붙이기' },
    prompt: {
      en: 'log.txt already holds one line. Without erasing what is there, add "shutdown" on the next line.',
      ko: 'log.txt 에 이미 한 줄이 있습니다. 기존 내용을 지우지 말고 "shutdown" 을 다음 줄에 추가하세요.',
    },
    setup: (fs) => { fs.writeFile(`${HOME}/log.txt`, 'boot ok\n') },
    hints: [
      { en: '> empties the file before it writes.', ko: '> 는 파일을 비우고 씁니다.' },
      { en: 'The operator that appends without emptying is a pair of angle brackets.', ko: '비우지 않고 이어붙이는 연산자는 꺾쇠 두 개입니다.' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/log.txt`) === 'boot ok\nshutdown\n',
    solution: 'echo shutdown >> log.txt',
    wrongAnswer: 'echo shutdown > log.txt',
    explanation: {
      en: 'There is only one difference between > and >>. > truncates; >> appends. Get this one wrong on a log file and a full day of logs disappears.',
      ko: '> 와 >> 의 차이는 하나뿐입니다. > 는 truncate 하고 >> 는 append 합니다. 로그 파일을 다룰 때 이 하나를 틀리면 하루치 로그가 사라집니다.',
    },
  },
  {
    id: 'l2-07',
    level: 2,
    title: { en: 'Capture Only Errors', ko: '오류만 걸러내기' },
    prompt: {
      en: 'ghost.txt does not exist. Read it with cat, but make the error message land in errors.log instead of showing on screen.',
      ko: 'ghost.txt 는 존재하지 않습니다. cat 으로 읽되, 오류 메시지가 화면에 뜨지 않고 errors.log 에 저장되게 하세요.',
    },
    setup: () => {},
    hints: [
      { en: 'Standard output and standard error are separate channels.', ko: '표준출력과 표준오류는 다른 통로입니다.' },
      { en: 'Standard output is number 1, standard error is number 2.', ko: '표준출력은 1번, 표준오류는 2번입니다.' },
      { en: '2> sends only standard error to a file.', ko: '2> 로 표준오류만 파일로 보낼 수 있습니다.' },
    ],
    check: (ctx) => {
      const log = safeRead(ctx.fs, `${HOME}/errors.log`)
      return log !== null && log.includes('No such file or directory') && ctx.lastResult.stderr === ''
    },
    solution: 'cat ghost.txt 2> errors.log',
    wrongAnswer: 'cat ghost.txt > errors.log',
    explanation: {
      en: '> is really shorthand for 1>. It diverts file descriptor 1, that is, standard output. Error messages go out on descriptor 2, so > never catches them and they appear on screen anyway. You have to use 2>.',
      ko: '> 는 사실 1> 의 줄임말입니다. 1번 파일 서술자, 즉 표준출력을 돌립니다. 오류 메시지는 2번으로 나가므로 > 로는 잡히지 않고 화면에 그대로 뜹니다. 2> 를 써야 합니다.',
    },
  },
  {
    id: 'l2-08',
    level: 2,
    title: { en: 'Execute Permission', ko: '실행 권한' },
    prompt: {
      en: 'Grant the owner execute permission on deploy.sh. The final mode must be 755.',
      ko: 'deploy.sh 에 소유자 실행 권한을 부여하세요. 최종 권한은 755 여야 합니다.',
    },
    setup: (fs) => {
      fs.writeFile(`${HOME}/deploy.sh`, '#!/bin/bash\necho deploying\n')
      fs.chmod(`${HOME}/deploy.sh`, 0o644)
    },
    hints: [
      { en: 'The command that changes permissions is chmod.', ko: '권한을 바꾸는 명령은 chmod 입니다.' },
      { en: 'Three octal digits express rwx. r=4, w=2, x=1.', ko: '8진수 세 자리로 rwx 를 표현합니다. r=4, w=2, x=1.' },
    ],
    check: (ctx) => ctx.fs.lstat(`${HOME}/deploy.sh`)?.mode === 0o755,
    solution: 'chmod 755 deploy.sh',
    wrongAnswer: 'chmod 644 deploy.sh',
    explanation: {
      en: '755 gives the owner rwx (4+2+1) and the group and everyone else r-x (4+1). chmod +x also flips on the execute bit, and starting from 644 it lands on 755 — for this puzzle either one is correct.',
      ko: '755 는 소유자에게 rwx(4+2+1), 그룹과 나머지에게 r-x(4+1) 를 줍니다. chmod +x 도 실행 비트를 켜지만, 644 에서 시작하면 755 가 됩니다 — 이 문제에서는 둘 다 정답입니다.',
    },
  },
  {
    id: 'l2-09',
    level: 2,
    title: { en: 'The Shortcut', ko: '지름길' },
    prompt: {
      en: 'Create the data/2026/reports directory in a single step. The intermediate directories do not exist yet.',
      ko: 'data/2026/reports 디렉터리를 한 번에 만드세요. 중간 디렉터리는 아직 없습니다.',
    },
    setup: () => {},
    hints: [
      { en: 'By default mkdir fails when the parent is missing.', ko: 'mkdir 은 기본적으로 부모가 없으면 실패합니다.' },
      { en: 'There is a flag that means parents.', ko: 'parents 를 뜻하는 플래그가 있습니다.' },
    ],
    check: (ctx) => ctx.fs.isDir(`${HOME}/data/2026/reports`),
    solution: 'mkdir -p data/2026/reports',
    wrongAnswer: 'mkdir data/2026/reports',
    explanation: {
      en: '-p stands for parents. It creates every missing intermediate directory, and raises no error even if they already exist. It is the shortest way to say "make it if it is not there, leave it if it is" in a script.',
      ko: '-p 는 parents 입니다. 없는 중간 디렉터리를 전부 만들어 주고, 이미 있어도 오류를 내지 않습니다. 스크립트에서 "있으면 말고, 없으면 만들어" 를 표현하는 가장 짧은 방법입니다.',
    },
  },
  {
    id: 'l2-10',
    level: 2,
    title: { en: 'Harvest', ko: '수확' },
    prompt: {
      en: 'Combine every .log file inside the logs directory into a single all.log. The files must be joined in alphabetical order.',
      ko: 'logs 디렉터리 안의 .log 파일들을 전부 합쳐 all.log 하나로 만드세요. 파일들이 사전순으로 이어져야 합니다.',
    },
    setup: (fs) => {
      fs.mkdir(`${HOME}/logs`)
      fs.writeFile(`${HOME}/logs/a.log`, 'first\n')
      fs.writeFile(`${HOME}/logs/b.log`, 'second\n')
      fs.writeFile(`${HOME}/logs/c.log`, 'third\n')
      fs.writeFile(`${HOME}/logs/notes.md`, 'ignore me\n')
    },
    hints: [
      { en: 'cat takes several files as arguments and joins them in order.', ko: 'cat 은 여러 파일을 인자로 받아 순서대로 이어붙입니다.' },
      { en: 'The glob logs/*.log is expanded by the shell in alphabetical order.', ko: '글롭 logs/*.log 는 셸이 사전순으로 펼쳐줍니다.' },
      { en: 'Capture the result into a file with >.', ko: '그 결과를 > 로 파일에 담으세요.' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/all.log`) === 'first\nsecond\nthird\n',
    solution: 'cat logs/*.log > all.log',
    wrongAnswer: 'cat logs/* > all.log',
    explanation: {
      en: 'This is where the name cat — concatenate — shows itself. And because the shell always expands a glob in sorted alphabetical order, the ordering is guaranteed. To leave out notes.md you must narrow the pattern to *.log — logs/* would swallow that too.',
      ko: 'cat 의 이름이 concatenate 인 이유가 여기서 드러납니다. 그리고 셸은 글롭을 항상 사전순으로 정렬해 펼치므로 순서가 보장됩니다. notes.md 를 제외하려면 패턴을 *.log 로 좁혀야 합니다 — logs/* 는 그것까지 삼킵니다.',
    },
  },
]
