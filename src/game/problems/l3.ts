import type { Problem } from '../types'
import { safeRead, trimEq } from '../check-helpers'

const HOME = '/home/player'

export const l3: Problem[] = [
  {
    id: 'l3-01',
    level: 3,
    title: '오류 세기',
    prompt: 'log.txt 에서 ERROR 가 든 줄이 몇 줄인지, 숫자만 출력하세요.',
    setup: (fs) => {
      fs.writeFile(
        `${HOME}/log.txt`,
        'boot ok\nERROR disk full\ninfo: retry\nERROR timeout\nwarn: low mem\nERROR conn refused\ndone\n',
      )
    },
    hints: [
      '패턴에 맞는 줄만 세는 grep 옵션이 있습니다.',
      '-c 는 매치된 줄을 출력하는 대신 그 개수만 셉니다.',
    ],
    check: (ctx) => ctx.lastResult.stdout.trim() === '3',
    solution: 'grep -c ERROR log.txt',
    wrongAnswer: 'grep ERROR log.txt',
    explanation:
      'grep ERROR log.txt 는 매치된 줄 자체를 그대로 출력합니다. 줄 수만 필요하다면 grep -c 를 쓰세요 — grep 이 직접 세어 숫자 하나만 내놓습니다. grep ... | wc -l 로도 같은 숫자를 얻을 수 있지만 -c 가 더 짧습니다.',
  },
  {
    id: 'l3-02',
    level: 3,
    title: '치환 저장',
    prompt: 'config.txt 의 모든 localhost 를 0.0.0.0 으로 바꿔 config.new 에 저장하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/config.txt`, 'host=localhost\nport=8080\nmirror=localhost backup=localhost\n')
    },
    hints: [
      '텍스트를 치환하는 명령은 sed 입니다. 문법은 s/찾을것/바꿀것/ 입니다.',
      '기본은 각 줄에서 첫 매치만 바꿉니다. 줄 안의 모든 매치를 바꾸려면 끝에 플래그가 필요합니다.',
      '전역(global) 치환 플래그는 g 입니다: s/.../.../g',
    ],
    check: (ctx) => {
      const original = safeRead(ctx.fs, `${HOME}/config.txt`)
      const updated = safeRead(ctx.fs, `${HOME}/config.new`)
      if (original === null || updated === null) return false
      // config.txt 의 모든 localhost 를 0.0.0.0 으로 바꾼 결과와 정확히 일치해야 한다
      // (나머지 문제처럼 정확-바이트 매치 — 개수만 맞춘 조작 내용은 통과하지 못하고,
      // 파일을 실제로 읽어 치환한 정답만 통과한다). 원본에 localhost 가 남아 있어야
      // 소스를 지워 우회하는 걸 막는다.
      return original.includes('localhost') && updated === original.split('localhost').join('0.0.0.0')
    },
    solution: "sed 's/localhost/0.0.0.0/g' config.txt > config.new",
    wrongAnswer: "sed 's/localhost/0.0.0.0/' config.txt > config.new",
    explanation:
      'sed 의 s 명령은 기본적으로 한 줄에서 첫 매치만 바꿉니다. mirror=localhost backup=localhost 처럼 한 줄에 localhost 가 두 번 나오면, g 플래그 없이는 뒤쪽 하나가 그대로 남습니다. 모든 매치를 바꾸려면 s/.../.../g 가 필요합니다.',
  },
  {
    id: 'l3-03',
    level: 3,
    title: '이름만 뽑기',
    prompt: 'passwd.txt(콜론으로 구분된 파일)에서 사용자 이름(첫 번째 필드)만 뽑아 users.txt 로 저장하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/passwd.txt`, 'root:x:0\nalice:x:1000\nbob:x:1001\n')
    },
    hints: [
      '구분자로 나뉜 필드를 뽑는 명령은 cut 입니다.',
      '-d 로 구분자를, -f 로 몇 번째 필드인지 지정합니다.',
      'cut -d: -f1 은 콜론으로 나눈 첫 번째 필드입니다.',
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/users.txt`), 'root\nalice\nbob'),
    solution: 'cut -d: -f1 passwd.txt > users.txt',
    wrongAnswer: 'cut -d: -f2 passwd.txt > users.txt',
    explanation:
      'cut -f 는 몇 번째 필드인지를 지정합니다. -f2 를 쓰면 두 번째 필드(여기서는 항상 x)가 나오지, 사용자 이름이 나오지 않습니다. passwd 형식에서 이름은 첫 번째 필드, -f1 입니다.',
  },
  {
    id: 'l3-04',
    level: 3,
    title: '빈도 집계',
    prompt: 'words.txt 의 각 단어가 몇 번 나오는지 세어 counts.txt 로 저장하세요. (정렬 후 집계해야 합니다)',
    setup: (fs) => {
      fs.writeFile(`${HOME}/words.txt`, 'banana\napple\ncherry\napple\nbanana\napple\n')
    },
    hints: [
      'uniq -c 는 연속으로 반복된 줄만 묶어서 셉니다. 흩어진 반복은 못 잡습니다.',
      '먼저 정렬해서 같은 단어를 서로 붙여놓아야 합니다.',
      'sort words.txt | uniq -c > counts.txt',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/counts.txt`) === '      3 apple\n      2 banana\n      1 cherry\n',
    solution: 'sort words.txt | uniq -c > counts.txt',
    wrongAnswer: 'uniq -c words.txt > counts.txt',
    explanation:
      'uniq 는 이름 그대로 "인접한" 중복만 봅니다. 정렬하지 않은 words.txt 에 그냥 uniq -c 를 돌리면 banana, apple, cherry, apple, banana, apple 이 흩어져 있어 전부 1번씩으로 집계됩니다. sort 로 같은 단어를 먼저 모아야 uniq -c 가 제대로 셉니다.',
  },
  {
    id: 'l3-05',
    level: 3,
    title: '중복 제거',
    prompt: 'names.txt 를 정렬하고 중복을 없앤 목록을 unique.txt 로 저장하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/names.txt`, 'carol\nalice\nbob\nalice\ncarol\nalice\n')
    },
    hints: [
      'uniq 혼자로는 정렬되지 않은 파일의 중복을 못 걷어냅니다 — 인접한 것만 봅니다.',
      'sort 로 먼저 정렬한 뒤 uniq 로 넘기세요.',
      'sort -u 를 쓰면 정렬과 중복 제거를 한 번에 할 수도 있습니다.',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/unique.txt`) === 'alice\nbob\ncarol\n',
    solution: 'sort names.txt | uniq > unique.txt',
    wrongAnswer: 'uniq names.txt > unique.txt',
    explanation:
      'uniq 는 인접한 중복만 접습니다. carol, alice, bob, alice, carol, alice 는 같은 이름끼리 붙어있지 않으므로 uniq 혼자서는 하나도 못 걸러냅니다. sort | uniq 로 먼저 정렬해 같은 이름을 붙여놓거나, sort -u 로 한 번에 처리해야 합니다.',
  },
  {
    id: 'l3-06',
    level: 3,
    title: '대문자로',
    prompt: 'quiet.txt 내용을 전부 대문자로 바꿔 loud.txt 로 저장하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/quiet.txt`, 'hello world\nthis is a test\n')
    },
    hints: [
      '문자를 문자로 바꾸는 명령은 tr 입니다. 파일이 아니라 표준입력만 받습니다.',
      '< 로 파일을 표준입력으로 흘려보낼 수 있습니다.',
      'tr a-z A-Z < quiet.txt > loud.txt',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/loud.txt`) === 'HELLO WORLD\nTHIS IS A TEST\n',
    solution: 'tr a-z A-Z < quiet.txt > loud.txt',
    wrongAnswer: 'cp quiet.txt loud.txt',
    explanation:
      'cp 는 내용을 그대로 복사할 뿐 바꾸지 않습니다. tr SET1 SET2 는 SET1 의 각 문자를 SET2 의 대응 문자로 치환합니다 — a-z 를 A-Z 로 매핑하면 소문자가 전부 대문자가 됩니다. tr 은 파일 인자를 받지 않으므로 < 로 표준입력을 연결하거나, cat quiet.txt | tr a-z A-Z 처럼 파이프로 흘려보내야 합니다.',
  },
  {
    id: 'l3-07',
    level: 3,
    title: '합계',
    prompt: 'sales.txt 둘째 열(금액)의 합계를 구해 total.txt 에 숫자만 저장하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/sales.txt`, 'alice 30\nbob 25\ncarol 45\n')
    },
    hints: [
      '필드별로 계산하려면 awk 를 씁니다. $2 는 두 번째 필드입니다.',
      '변수에 값을 누적하려면 s += $2 처럼 씁니다.',
      "awk '{s+=$2} END{print s}' sales.txt > total.txt",
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/total.txt`), '100'),
    solution: "awk '{s+=$2} END{print s}' sales.txt > total.txt",
    wrongAnswer: "awk '{print $2}' sales.txt > total.txt",
    explanation:
      "awk '{print $2}' 는 각 줄의 둘째 필드를 그대로 나열할 뿐 더하지 않습니다. 합계를 내려면 매 줄마다 변수에 누적(s+=$2)한 뒤, 모든 줄을 다 읽고 나서 실행되는 END 블록에서 그 변수를 출력해야 합니다.",
  },
  {
    id: 'l3-08',
    level: 3,
    title: '실패한 것만',
    prompt: 'runs.txt 의 각 줄은 "상태 이름 코드" 형식입니다. FAIL 이 든 줄의 세 번째 필드(코드)만 출력하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/runs.txt`, 'PASS alpha 200\nFAIL beta 500\nPASS gamma 200\nFAIL delta 404\nFAIL epsilon 503\n')
    },
    hints: [
      'awk 는 패턴과 액션을 함께 쓸 수 있습니다: /패턴/{액션}',
      '패턴에 맞는 줄에서만 액션이 실행됩니다.',
      "awk '/FAIL/{print $3}' runs.txt",
    ],
    check: (ctx) => ctx.lastResult.stdout === '500\n404\n503\n',
    solution: "awk '/FAIL/{print $3}' runs.txt",
    wrongAnswer: "awk '{print $3}' runs.txt",
    explanation:
      "awk '{print $3}' 는 패턴이 없으므로 모든 줄에 적용되어 PASS 줄의 코드까지 함께 나옵니다. /FAIL/{print $3} 처럼 정규식 패턴을 붙이면 그 줄에 매치될 때만 액션이 실행되어, FAIL 이 든 줄의 코드만 걸러낼 수 있습니다.",
  },
  {
    id: 'l3-09',
    level: 3,
    title: '주석 빼고 세기',
    prompt: 'conf.txt 에서 # 로 시작하는 주석 줄을 뺀 실제 설정 줄이 몇 줄인지, count.txt 에 숫자만 저장하세요.',
    setup: (fs) => {
      fs.writeFile(
        `${HOME}/conf.txt`,
        '# comment 1\nhost=localhost\n# comment 2\nport=8080\ntimeout=30\n# trailing comment\n',
      )
    },
    hints: [
      '주석 줄을 빼고 싶다면 grep -v 로 매치되는 줄을 반대로 걸러낼 수 있습니다.',
      '줄 맨 앞을 뜻하는 정규식 기호는 ^ 입니다.',
      "grep -v '^#' conf.txt | wc -l > count.txt",
    ],
    check: (ctx) => trimEq(safeRead(ctx.fs, `${HOME}/count.txt`), '3'),
    solution: "grep -v '^#' conf.txt | wc -l > count.txt",
    wrongAnswer: 'wc -l conf.txt > count.txt',
    explanation:
      'wc -l conf.txt 는 주석 줄까지 포함한 전체 줄 수를 셉니다. 주석을 빼려면 먼저 grep -v \'^#\' 로 #으로 시작하는 줄을 걸러낸 뒤, 그 결과를 파이프로 wc -l 에 넘겨야 합니다. 참고로 wc 가 파이프로 표준입력을 받으면 파일명 없이 숫자만 냅니다.',
  },
  {
    id: 'l3-10',
    level: 3,
    title: '상위 세 줄',
    prompt: 'scores.txt 에 점수가 한 줄에 하나씩 있습니다. 점수를 내림차순으로 정렬해 상위 3개만 top3.txt 로 저장하세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/scores.txt`, '42\n88\n15\n67\n93\n71\n29\n')
    },
    hints: [
      '숫자로 정렬하려면 sort -n 을, 내림차순은 -r 을 씁니다.',
      '앞쪽 몇 줄만 필요하다면 head 로 이어보세요.',
      'sort -nr scores.txt | head -n 3 > top3.txt',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/top3.txt`) === '93\n88\n71\n',
    solution: 'sort -nr scores.txt | head -n 3 > top3.txt',
    wrongAnswer: 'head -n 3 scores.txt > top3.txt',
    explanation:
      'head -n 3 은 파일에 쓰인 순서 그대로 앞 3줄을 가져올 뿐 크기와는 무관합니다. 점수 크기 순으로 상위를 뽑으려면 먼저 sort -nr 로 숫자 기준 내림차순 정렬을 한 뒤, 그 결과를 head -n 3 으로 이어 앞의 세 줄만 남겨야 합니다.',
  },
]
