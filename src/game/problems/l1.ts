import type { Problem } from '../types'
import { safeRead, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l1: Problem[] = [
  {
    id: 'l1-01',
    level: 1,
    title: { en: 'First Contact', ko: '첫 접속' },
    prompt: {
      en: 'There is a readme.txt in your home directory. Print its contents to the screen.',
      ko: '홈 디렉터리에 readme.txt 가 있습니다. 그 내용을 화면에 출력하세요.',
    },
    setup: (fs) => {
      fs.writeFile(`${HOME}/readme.txt`, 'ACCESS GRANTED\n')
    },
    hints: [
      { en: 'Want to see which files are here first? That is ls.', ko: '어떤 파일이 있는지 먼저 보고 싶다면 ls 입니다.' },
      { en: 'The command that dumps a file exactly as it is: cat.', ko: '파일 내용을 그대로 뱉는 명령은 cat 입니다.' },
    ],
    check: (ctx) => ctx.lastResult.stdout === 'ACCESS GRANTED\n',
    solution: 'cat readme.txt',
    wrongAnswer: 'ls readme.txt',
    explanation: {
      en: 'cat is short for concatenate. Its original job is to join multiple files and send them to standard output — given just one, it simply shows its contents.',
      ko: 'cat 은 concatenate 의 준말입니다. 파일 여러 개를 이어붙여 표준출력으로 내보내는 것이 본래 목적이고, 하나만 주면 그냥 내용을 보여줍니다.',
    },
  },
  {
    id: 'l1-02',
    level: 1,
    title: { en: 'Hidden in Plain Sight', ko: '숨겨진 것' },
    prompt: {
      en: 'One file in this directory is invisible to the eye. Find it and print its contents.',
      ko: '이 디렉터리에는 눈에 보이지 않는 파일이 하나 있습니다. 찾아서 내용을 출력하세요.',
    },
    setup: (fs) => {
      fs.writeFile(`${HOME}/decoy.txt`, 'nothing here\n')
      fs.writeFile(`${HOME}/.keycard`, 'K-7741-ZX\n')
    },
    hints: [
      { en: 'ls hides files whose names start with a dot (.) by default.', ko: '점(.)으로 시작하는 파일은 ls 가 기본적으로 숨깁니다.' },
      { en: 'Try ls -a.', ko: 'ls -a 를 써보세요.' },
    ],
    check: (ctx) => ctx.lastResult.stdout === 'K-7741-ZX\n',
    solution: 'cat .keycard',
    wrongAnswer: 'cat decoy.txt',
    explanation: {
      en: 'In Unix, a "hidden file" is not a special attribute. Its name simply starts with a dot, and ls conceals it by convention. -a stands for all.',
      ko: '유닉스에서 "숨김 파일"은 특별한 속성이 아닙니다. 그저 이름이 점으로 시작할 뿐이고, ls 가 관례적으로 감춰줍니다. -a 는 all 입니다.',
    },
  },
  {
    id: 'l1-03',
    level: 1,
    title: { en: 'Into the Vault', ko: '금고로' },
    prompt: {
      en: 'Move into the vault directory.',
      ko: 'vault 디렉터리 안으로 이동하세요.',
    },
    setup: (fs) => {
      fs.mkdir(`${HOME}/vault`)
      fs.mkdir(`${HOME}/lobby`)
    },
    hints: [
      { en: 'The command for moving between directories is cd.', ko: '디렉터리를 옮겨다니는 명령은 cd 입니다.' },
    ],
    check: (ctx) => ctx.cwd === `${HOME}/vault`,
    solution: 'cd vault',
    wrongAnswer: 'ls vault',
    explanation: {
      en: "cd stands for change directory. Because it alters the shell's own current working directory, it has to be a builtin the shell runs itself — not a child process, unlike most commands.",
      ko: 'cd 는 change directory 입니다. 셸의 현재 작업 디렉터리를 바꾸므로, 다른 명령과 달리 자식 프로세스가 아니라 셸 자신이 실행하는 빌트인이어야만 합니다.',
    },
  },
  {
    id: 'l1-04',
    level: 1,
    title: { en: 'The Depths', ko: '깊은 곳' },
    prompt: {
      en: 'Move into the srv/logs/2026 directory in a single step.',
      ko: 'srv/logs/2026 디렉터리로 한 번에 이동하세요.',
    },
    setup: (fs) => {
      fs.mkdir(`${HOME}/srv/logs/2026`, { recursive: true })
      fs.mkdir(`${HOME}/srv/logs/2025`, { recursive: true })
    },
    hints: [
      { en: 'cd can take a whole path at once.', ko: 'cd 는 경로를 통째로 받을 수 있습니다.' },
      { en: 'Chain the directories together with slashes.', ko: '슬래시로 디렉터리를 이어붙여 보세요.' },
    ],
    check: (ctx) => ctx.cwd === `${HOME}/srv/logs/2026`,
    solution: 'cd srv/logs/2026',
    wrongAnswer: 'cd srv',
    explanation: {
      en: 'A path can descend several levels in one go. In the other direction, cd ../.. climbs two levels back up at once.',
      ko: '경로는 한 번에 여러 단계를 내려갈 수 있습니다. 반대로 cd ../.. 로 두 단계를 한 번에 올라갈 수도 있습니다.',
    },
  },
  {
    id: 'l1-05',
    level: 1,
    title: { en: 'Head of the Log', ko: '로그의 머리' },
    prompt: {
      en: 'Print only the first 5 lines of access.log.',
      ko: 'access.log 의 첫 5줄만 출력하세요.',
    },
    setup: (fs) => {
      const lines = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join('\n')
      fs.writeFile(`${HOME}/access.log`, `${lines}\n`)
    },
    hints: [
      { en: 'There is a dedicated command for viewing just the top of a file.', ko: '파일 앞부분만 보는 전용 명령이 있습니다.' },
      { en: "head's -n option takes a line count.", ko: 'head 의 -n 옵션은 줄 수를 받습니다.' },
    ],
    check: (ctx) => ctx.lastResult.stdout === 'entry 1\nentry 2\nentry 3\nentry 4\nentry 5\n',
    solution: 'head -n 5 access.log',
    wrongAnswer: 'cat access.log',
    explanation: {
      en: 'head and tail are essential when you work with huge log files. cat pulls the entire file into memory and floods the screen, but head reads only as much as it needs and then stops.',
      ko: 'head 와 tail 은 거대한 로그 파일을 다룰 때 필수입니다. cat 은 파일 전체를 메모리에 올려 화면을 밀어내지만, head 는 필요한 만큼만 읽고 멈춥니다.',
    },
  },
  {
    id: 'l1-06',
    level: 1,
    title: { en: 'Tail of the Log', ko: '로그의 꼬리' },
    prompt: {
      en: 'Print only the last 3 lines of access.log.',
      ko: 'access.log 의 마지막 3줄만 출력하세요.',
    },
    setup: (fs) => {
      const lines = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join('\n')
      fs.writeFile(`${HOME}/access.log`, `${lines}\n`)
    },
    hints: [
      { en: 'Think of the opposite of head.', ko: 'head 의 반대말을 생각해 보세요.' },
    ],
    check: (ctx) => ctx.lastResult.stdout === 'entry 38\nentry 39\nentry 40\n',
    solution: 'tail -n 3 access.log',
    wrongAnswer: 'head -n 3 access.log',
    explanation: {
      en: 'tail is one of the commands you will type most often on the job — the end of a log is whatever happened most recently.',
      ko: '실무에서 가장 많이 치는 명령 중 하나가 tail 입니다. 로그의 끝은 가장 최근에 일어난 일이니까요.',
    },
  },
  {
    id: 'l1-07',
    level: 1,
    title: { en: 'How Many Lines', ko: '몇 줄인가' },
    prompt: {
      en: 'Count how many lines access.log has and print it. The output must contain the number only.',
      ko: 'access.log 가 몇 줄인지 세어 출력하세요. 출력에는 숫자만 있어야 합니다.',
    },
    setup: (fs) => {
      const lines = Array.from({ length: 40 }, (_, i) => `entry ${i + 1}`).join('\n')
      fs.writeFile(`${HOME}/access.log`, `${lines}\n`)
    },
    hints: [
      { en: 'wc stands for word count, but it counts lines too.', ko: 'wc 는 word count 지만 줄도 셉니다.' },
      { en: 'Give wc a filename and it prints the filename too. What if you fed the file in through redirection instead?', ko: 'wc 에 파일명을 주면 파일명까지 출력됩니다. 리다이렉션으로 넘기면 어떨까요?' },
    ],
    check: (ctx) => ctx.lastResult.stdout.trim() === '40',
    solution: 'wc -l < access.log',
    wrongAnswer: 'wc -c < access.log',
    explanation: {
      en: 'wc -l access.log prints "40 access.log" — it received the file as an argument, so it reports the name. But feed it through standard input and wc has no filename to report, so it emits the number alone. The pipe cat access.log | wc -l works for the same reason.',
      ko: 'wc -l access.log 는 "40 access.log" 를 출력합니다. 파일을 인자로 받았으니 이름을 알려주는 것이죠. 하지만 표준입력으로 흘려보내면 wc 는 파일명을 모르므로 숫자만 냅니다. 파이프 cat access.log | wc -l 도 같은 이유로 동작합니다.',
    },
  },
  {
    id: 'l1-08',
    level: 1,
    title: { en: 'Filter by Extension', ko: '확장자로 거르기' },
    prompt: {
      en: 'List only the files ending in .txt, one per line.',
      ko: '.txt 로 끝나는 파일만 한 줄에 하나씩 나열하세요.',
    },
    setup: (fs) => {
      fs.writeFile(`${HOME}/notes.txt`, '')
      fs.writeFile(`${HOME}/todo.txt`, '')
      fs.writeFile(`${HOME}/image.png`, '')
      fs.writeFile(`${HOME}/script.sh`, '')
    },
    hints: [
      { en: 'The shell reads * as a filename pattern.', ko: '셸은 * 를 파일명 패턴으로 해석합니다.' },
      { en: 'Pass a pattern to ls.', ko: 'ls 에 패턴을 넘겨보세요.' },
    ],
    check: (ctx) => ctx.lastResult.stdout === 'notes.txt\ntodo.txt\n',
    solution: 'ls *.txt',
    wrongAnswer: 'ls',
    explanation: {
      en: 'The key point is that ls never interprets the *. The shell expands *.txt into notes.txt todo.txt first, then hands those two arguments to ls. ls never even sees the asterisk.',
      ko: '중요한 것은 ls 가 * 를 해석하지 않는다는 점입니다. 셸이 먼저 *.txt 를 notes.txt todo.txt 로 펼친 뒤, 그 두 인자를 ls 에게 건넵니다. ls 는 별표를 본 적조차 없습니다.',
    },
  },
  {
    id: 'l1-09',
    level: 1,
    title: { en: 'Find the Line', ko: '한 줄 찾기' },
    prompt: {
      en: 'Print only the lines in users.txt that contain admin.',
      ko: 'users.txt 에서 admin 이 들어간 줄만 출력하세요.',
    },
    setup: (fs) => {
      fs.writeFile(`${HOME}/users.txt`, 'guest:x:1001\nadmin:x:0\noperator:x:1002\n')
    },
    hints: [
      { en: 'The command that filters for lines matching a pattern is grep.', ko: '패턴에 맞는 줄만 걸러내는 명령이 grep 입니다.' },
      { en: 'The order is grep pattern filename.', ko: 'grep 패턴 파일명 순서입니다.' },
    ],
    check: (ctx) => ctx.lastResult.stdout === 'admin:x:0\n',
    solution: 'grep admin users.txt',
    wrongAnswer: 'cat users.txt',
    explanation: {
      en: 'The name grep comes from the ed editor command g/re/p — globally search for a regular expression and print. The name itself is the usage.',
      ko: 'grep 이라는 이름은 ed 편집기의 명령 g/re/p — globally search for a regular expression and print — 에서 왔습니다. 이름 자체가 사용법입니다.',
    },
  },
  {
    id: 'l1-10',
    level: 1,
    title: { en: 'Leave Evidence', ko: '증거 남기기' },
    prompt: {
      en: 'Count how many files are in vault, and save just that number to report.txt.',
      ko: 'vault 안에 파일이 몇 개인지 세어, 그 숫자만 report.txt 에 저장하세요.',
    },
    setup: (fs) => {
      fs.mkdir(`${HOME}/vault`)
      fs.writeFile(`${HOME}/vault/alpha`, '')
      fs.writeFile(`${HOME}/vault/beta`, '')
      fs.writeFile(`${HOME}/vault/gamma`, '')
    },
    hints: [
      { en: 'To pass the output of ls to wc, use a pipe |.', ko: 'ls 의 출력을 wc 에게 넘기려면 파이프 | 를 씁니다.' },
      { en: "To send a command's output to a file, use >.", ko: '명령의 출력을 파일로 보내려면 > 를 씁니다.' },
      { en: 'You can chain them like ls vault | wc -l > report.txt.', ko: 'ls vault | wc -l > report.txt 처럼 이어붙일 수 있습니다.' },
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/report.txt`), '3'),
    solution: 'ls vault | wc -l > report.txt',
    wrongAnswer: 'ls vault > report.txt',
    explanation: {
      en: 'A pipe connects the standard output of the first command to the standard input of the next. The redirection > diverts standard output into a file. They are different mechanisms, and you can use both on one line. Here wc had no filename, so it emitted the number alone, and that number landed in the file.',
      ko: '파이프는 앞 명령의 표준출력을 뒤 명령의 표준입력에 연결합니다. 리다이렉션 > 는 표준출력을 파일로 돌립니다. 둘은 다른 장치이고, 한 줄에서 함께 쓸 수 있습니다. 여기서 wc 는 파일명을 모르므로 숫자만 냈고, 그 숫자가 파일에 담겼습니다.',
    },
  },
]
