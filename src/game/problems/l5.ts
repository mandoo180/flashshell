import type { Problem } from '../types'
import { safeRead, safeReaddir } from '../check-helpers'

const HOME = '/home/player'

export const l5: Problem[] = [
  {
    id: 'l5-01',
    level: 5,
    title: { en: '일괄 백업', ko: '일괄 백업' },
    prompt:
      { en: '현재 디렉터리의 모든 .txt 파일을 백업하세요. 각 파일 뒤에 .bak 을 붙인 이름으로 남기고(예: a.txt → a.txt.bak), 원본 이름은 남아있으면 안 됩니다. for 루프를 쓰세요.', ko: '현재 디렉터리의 모든 .txt 파일을 백업하세요. 각 파일 뒤에 .bak 을 붙인 이름으로 남기고(예: a.txt → a.txt.bak), 원본 이름은 남아있으면 안 됩니다. for 루프를 쓰세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/a.txt`, 'alpha content\n')
      fs.writeFile(`${HOME}/b.txt`, 'beta content\n')
    },
    hints: [
      { en: '파일이 여러 개일 때 하나씩 손으로 mv 하면 번거롭습니다 — 목록을 돌면서 같은 동작을 반복하는 구문이 있습니다.', ko: '파일이 여러 개일 때 하나씩 손으로 mv 하면 번거롭습니다 — 목록을 돌면서 같은 동작을 반복하는 구문이 있습니다.' },
      { en: 'for f in *.txt; do ... done 형태로 각 .txt 파일을 하나씩 f 에 담아 반복할 수 있습니다.', ko: 'for f in *.txt; do ... done 형태로 각 .txt 파일을 하나씩 f 에 담아 반복할 수 있습니다.' },
      { en: 'for f in *.txt; do mv "$f" "${f}.bak"; done', ko: 'for f in *.txt; do mv "$f" "${f}.bak"; done' },
    ],
    check: (ctx) => {
      const aOk = safeRead(ctx.fs, `${HOME}/a.txt.bak`) === 'alpha content\n'
      const bOk = safeRead(ctx.fs, `${HOME}/b.txt.bak`) === 'beta content\n'
      const goneOriginal = !ctx.fs.exists(`${HOME}/a.txt`) && !ctx.fs.exists(`${HOME}/b.txt`)
      return aOk && bOk && goneOriginal
    },
    solution: 'for f in *.txt; do mv "$f" "${f}.bak"; done',
    wrongAnswer: 'mv a.txt a.txt.bak',
    explanation:
      { en: 'mv a.txt a.txt.bak 은 딱 한 파일만 처리합니다 — b.txt 는 그대로 남아 백업되지 않습니다. for f in *.txt; do ... done 은 .txt 로 끝나는 모든 파일을 하나씩 f 에 담아 같은 명령(mv "$f" "${f}.bak")을 반복 실행하므로, 파일이 몇 개든 전부 백업됩니다.', ko: 'mv a.txt a.txt.bak 은 딱 한 파일만 처리합니다 — b.txt 는 그대로 남아 백업되지 않습니다. for f in *.txt; do ... done 은 .txt 로 끝나는 모든 파일을 하나씩 f 에 담아 같은 명령(mv "$f" "${f}.bak")을 반복 실행하므로, 파일이 몇 개든 전부 백업됩니다.' },
  },
  {
    id: 'l5-02',
    level: 5,
    title: { en: '조건부 빌드 디렉터리', ko: '조건부 빌드 디렉터리' },
    prompt:
      { en: '배포 설정에 따라 디렉터리를 만드세요: staging.flag 파일이 있으면 build/staging 을, 없으면 build/prod 를 만드세요.', ko: '배포 설정에 따라 디렉터리를 만드세요: staging.flag 파일이 있으면 build/staging 을, 없으면 build/prod 를 만드세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/staging.flag`, '')
    },
    hints: [
      { en: '먼저 staging.flag 가 있는지 확인해야 합니다 — 파일 존재 확인은 test/[ 로 합니다.', ko: '먼저 staging.flag 가 있는지 확인해야 합니다 — 파일 존재 확인은 test/[ 로 합니다.' },
      { en: 'if [ -f staging.flag ]; then ... else ... fi 형태로 두 경우를 나눌 수 있습니다.', ko: 'if [ -f staging.flag ]; then ... else ... fi 형태로 두 경우를 나눌 수 있습니다.' },
      { en: 'if [ -f staging.flag ]; then mkdir -p build/staging; else mkdir -p build/prod; fi', ko: 'if [ -f staging.flag ]; then mkdir -p build/staging; else mkdir -p build/prod; fi' },
    ],
    check: (ctx) => ctx.fs.isDir(`${HOME}/build/staging`) && !ctx.fs.exists(`${HOME}/build/prod`),
    solution: 'if [ -f staging.flag ]; then mkdir -p build/staging; else mkdir -p build/prod; fi',
    wrongAnswer: 'mkdir -p build/prod',
    explanation:
      { en: 'mkdir -p build/prod 는 조건을 전혀 보지 않고 무조건 prod 를 만듭니다 — 지금처럼 staging.flag 가 있는 상황에서는 틀린 디렉터리입니다. if [ -f staging.flag ]; then ... else ... fi 는 flag 파일이 있는지 먼저 test 로 확인한 뒤, 있으면 staging, 없으면 prod 를 만들도록 실제로 분기합니다.', ko: 'mkdir -p build/prod 는 조건을 전혀 보지 않고 무조건 prod 를 만듭니다 — 지금처럼 staging.flag 가 있는 상황에서는 틀린 디렉터리입니다. if [ -f staging.flag ]; then ... else ... fi 는 flag 파일이 있는지 먼저 test 로 확인한 뒤, 있으면 staging, 없으면 prod 를 만들도록 실제로 분기합니다.' },
  },
  {
    id: 'l5-03',
    level: 5,
    title: { en: '대기열 비우기', ko: '대기열 비우기' },
    prompt: { en: 'queue 디렉터리 안의 파일들을 모두 done 디렉터리로 옮기세요. 파일이 몇 개인지 몰라도, 남아있는 동안은 계속 반복해야 하므로 while 을 쓰세요.', ko: 'queue 디렉터리 안의 파일들을 모두 done 디렉터리로 옮기세요. 파일이 몇 개인지 몰라도, 남아있는 동안은 계속 반복해야 하므로 while 을 쓰세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/queue`, { recursive: true })
      fs.mkdir(`${HOME}/done`, { recursive: true })
      fs.writeFile(`${HOME}/queue/j1`, 'job1\n')
      fs.writeFile(`${HOME}/queue/j2`, 'job2\n')
      fs.writeFile(`${HOME}/queue/j3`, 'job3\n')
    },
    hints: [
      { en: "파일이 몇 개인지 미리 알 수 없다면, '남아있는 동안 반복'하는 구문이 필요합니다 — while 입니다.", ko: "파일이 몇 개인지 미리 알 수 없다면, '남아있는 동안 반복'하는 구문이 필요합니다 — while 입니다." },
      { en: 'queue 안에 뭔가 남아있는지는 [ -n "$(ls queue)" ] 로 확인할 수 있습니다.', ko: 'queue 안에 뭔가 남아있는지는 [ -n "$(ls queue)" ] 로 확인할 수 있습니다.' },
      { en: 'while [ -n "$(ls queue)" ]; do f=$(ls queue | head -n 1); mv queue/$f done/$f; done', ko: 'while [ -n "$(ls queue)" ]; do f=$(ls queue | head -n 1); mv queue/$f done/$f; done' },
    ],
    check: (ctx) => {
      const remaining = safeReaddir(ctx.fs, `${HOME}/queue`) ?? []
      const noneLeft = remaining.length === 0
      const doneOk =
        safeRead(ctx.fs, `${HOME}/done/j1`) === 'job1\n' &&
        safeRead(ctx.fs, `${HOME}/done/j2`) === 'job2\n' &&
        safeRead(ctx.fs, `${HOME}/done/j3`) === 'job3\n'
      return noneLeft && doneOk
    },
    solution: 'while [ -n "$(ls queue)" ]; do f=$(ls queue | head -n 1); mv queue/$f done/$f; done',
    wrongAnswer: 'f=$(ls queue | head -n 1); mv queue/$f done/$f',
    explanation:
      { en: '반복문 없이 딱 한 번만 실행하면 맨 앞의 파일 하나(j1)만 옮겨지고 j2, j3 는 queue 에 그대로 남습니다. while [ -n "$(ls queue)" ]; do ... done 은 queue 안에 파일이 남아있는 동안(ls 결과가 비어있지 않은 동안) 계속 반복하므로, 파일이 몇 개든 전부 done 으로 옮겨질 때까지 멈추지 않습니다.', ko: '반복문 없이 딱 한 번만 실행하면 맨 앞의 파일 하나(j1)만 옮겨지고 j2, j3 는 queue 에 그대로 남습니다. while [ -n "$(ls queue)" ]; do ... done 은 queue 안에 파일이 남아있는 동안(ls 결과가 비어있지 않은 동안) 계속 반복하므로, 파일이 몇 개든 전부 done 으로 옮겨질 때까지 멈추지 않습니다.' },
  },
  {
    id: 'l5-04',
    level: 5,
    title: { en: '확장자별 정리', ko: '확장자별 정리' },
    prompt:
      { en: '현재 디렉터리의 .txt/.log/.png 파일들을 각각 txts/logs/imgs 디렉터리로 옮기세요 (다른 파일은 손대지 마세요). 파일마다 확장자를 case 로 판단하세요.', ko: '현재 디렉터리의 .txt/.log/.png 파일들을 각각 txts/logs/imgs 디렉터리로 옮기세요 (다른 파일은 손대지 마세요). 파일마다 확장자를 case 로 판단하세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/a.txt`, 'A\n')
      fs.writeFile(`${HOME}/b.log`, 'B\n')
      fs.writeFile(`${HOME}/c.png`, 'C\n')
      fs.writeFile(`${HOME}/readme.md`, 'R\n')
      fs.mkdir(`${HOME}/txts`, { recursive: true })
      fs.mkdir(`${HOME}/logs`, { recursive: true })
      fs.mkdir(`${HOME}/imgs`, { recursive: true })
    },
    hints: [
      { en: '여러 파일을 하나씩 다루려면 for 로 목록을 돌아야 합니다.', ko: '여러 파일을 하나씩 다루려면 for 로 목록을 돌아야 합니다.' },
      { en: '그 안에서 확장자별로 다른 동작을 하려면 case $f in ... esac 로 분기하세요.', ko: '그 안에서 확장자별로 다른 동작을 하려면 case $f in ... esac 로 분기하세요.' },
      { en: 'for f in *.txt *.log *.png; do case $f in *.txt) mv $f txts/;; *.log) mv $f logs/;; *.png) mv $f imgs/;; esac; done', ko: 'for f in *.txt *.log *.png; do case $f in *.txt) mv $f txts/;; *.log) mv $f logs/;; *.png) mv $f imgs/;; esac; done' },
    ],
    check: (ctx) => {
      const classified =
        safeRead(ctx.fs, `${HOME}/txts/a.txt`) === 'A\n' &&
        safeRead(ctx.fs, `${HOME}/logs/b.log`) === 'B\n' &&
        safeRead(ctx.fs, `${HOME}/imgs/c.png`) === 'C\n'
      const goneFromHome = !ctx.fs.exists(`${HOME}/a.txt`) && !ctx.fs.exists(`${HOME}/b.log`) && !ctx.fs.exists(`${HOME}/c.png`)
      const untouched = safeRead(ctx.fs, `${HOME}/readme.md`) === 'R\n'
      return classified && goneFromHome && untouched
    },
    solution:
      'for f in *.txt *.log *.png; do case $f in *.txt) mv $f txts/;; *.log) mv $f logs/;; *.png) mv $f imgs/;; esac; done',
    wrongAnswer: 'mv a.txt b.log c.png txts/',
    explanation:
      { en: 'mv a.txt b.log c.png txts/ 는 확장자를 가리지 않고 셋 다 txts/ 로 던져버립니다 — logs/b.log, imgs/c.png 는 생기지 않습니다. for 로 파일을 하나씩 돌면서 case $f in *.txt) ... *.log) ... *.png) ... esac 로 확장자별 목적지를 판단해야 각 파일이 알맞은 디렉터리로 갑니다.', ko: 'mv a.txt b.log c.png txts/ 는 확장자를 가리지 않고 셋 다 txts/ 로 던져버립니다 — logs/b.log, imgs/c.png 는 생기지 않습니다. for 로 파일을 하나씩 돌면서 case $f in *.txt) ... *.log) ... *.png) ... esac 로 확장자별 목적지를 판단해야 각 파일이 알맞은 디렉터리로 갑니다.' },
  },
  {
    id: 'l5-05',
    level: 5,
    title: { en: '함수로 반복 생성', ko: '함수로 반복 생성' },
    prompt:
      { en: 'mkfiles 라는 함수를 만드세요. 인자로 받은 이름의 디렉터리를 만들고 그 안에 info.txt 를 만들어야 합니다. 그 함수를 alpha, beta, gamma 세 번 호출해 세 디렉터리를 모두 만드세요.', ko: 'mkfiles 라는 함수를 만드세요. 인자로 받은 이름의 디렉터리를 만들고 그 안에 info.txt 를 만들어야 합니다. 그 함수를 alpha, beta, gamma 세 번 호출해 세 디렉터리를 모두 만드세요.' },
    setup: () => {},
    hints: [
      { en: '같은 작업을 이름만 바꿔 여러 번 반복한다면, 함수로 묶어두면 편합니다.', ko: '같은 작업을 이름만 바꿔 여러 번 반복한다면, 함수로 묶어두면 편합니다.' },
      { en: '함수 안에서는 호출할 때 받은 첫 인자를 $1 로 씁니다. 정의는 name() { ... } 형태입니다(중괄호 앞 공백 필수).', ko: '함수 안에서는 호출할 때 받은 첫 인자를 $1 로 씁니다. 정의는 name() { ... } 형태입니다(중괄호 앞 공백 필수).' },
      { en: 'mkfiles() { mkdir -p "$1"; touch "$1/info.txt"; }; mkfiles alpha; mkfiles beta; mkfiles gamma', ko: 'mkfiles() { mkdir -p "$1"; touch "$1/info.txt"; }; mkfiles alpha; mkfiles beta; mkfiles gamma' },
    ],
    check: (ctx) =>
      ctx.fs.exists(`${HOME}/alpha/info.txt`) && ctx.fs.exists(`${HOME}/beta/info.txt`) && ctx.fs.exists(`${HOME}/gamma/info.txt`),
    solution: 'mkfiles() { mkdir -p "$1"; touch "$1/info.txt"; }; mkfiles alpha; mkfiles beta; mkfiles gamma',
    wrongAnswer: 'mkfiles() { mkdir -p "$1"; touch "$1/info.txt"; }; mkfiles alpha',
    explanation:
      { en: '함수를 정의만 하고 한 번(alpha)만 호출하면 beta, gamma 디렉터리는 만들어지지 않습니다. 함수는 정의해두고 필요한 만큼 여러 번 호출해야 그때마다 실행됩니다 — mkfiles alpha; mkfiles beta; mkfiles gamma 처럼 세 번 불러야 세 디렉터리가 다 생깁니다.', ko: '함수를 정의만 하고 한 번(alpha)만 호출하면 beta, gamma 디렉터리는 만들어지지 않습니다. 함수는 정의해두고 필요한 만큼 여러 번 호출해야 그때마다 실행됩니다 — mkfiles alpha; mkfiles beta; mkfiles gamma 처럼 세 번 불러야 세 디렉터리가 다 생깁니다.' },
  },
  {
    id: 'l5-06',
    level: 5,
    title: { en: '설정 불러오기', ko: '설정 불러오기' },
    prompt:
      { en: "config.sh 를 불러와 appname 과 env 값을 얻은 뒤, 'appname-env' 형식의 이름으로 디렉터리를 만드세요(예: appname=foo, env=bar 라면 foo-bar). source 를 쓰세요.", ko: "config.sh 를 불러와 appname 과 env 값을 얻은 뒤, 'appname-env' 형식의 이름으로 디렉터리를 만드세요(예: appname=foo, env=bar 라면 foo-bar). source 를 쓰세요." },
    setup: (fs) => {
      fs.writeFile(`${HOME}/config.sh`, 'appname=billing\nenv=prod\n')
    },
    hints: [
      { en: 'config.sh 안의 변수 값을 지금 셸에서 쓰려면 그냥 실행(./config.sh)해서는 안 됩니다 — 실행은 다른 환경에서 끝나버려 변수가 사라집니다. 지금 셸에 그대로 불러들여야(source) 값이 남습니다.', ko: 'config.sh 안의 변수 값을 지금 셸에서 쓰려면 그냥 실행(./config.sh)해서는 안 됩니다 — 실행은 다른 환경에서 끝나버려 변수가 사라집니다. 지금 셸에 그대로 불러들여야(source) 값이 남습니다.' },
      { en: 'source config.sh (또는 . config.sh) 로 불러온 뒤 ${appname}, ${env} 로 값을 씁니다.', ko: 'source config.sh (또는 . config.sh) 로 불러온 뒤 ${appname}, ${env} 로 값을 씁니다.' },
      { en: 'source config.sh; mkdir "${appname}-${env}"', ko: 'source config.sh; mkdir "${appname}-${env}"' },
    ],
    check: (ctx) => ctx.fs.isDir(`${HOME}/billing-prod`),
    solution: 'source config.sh; mkdir "${appname}-${env}"',
    wrongAnswer: 'mkdir "appname-env"',
    explanation:
      { en: 'mkdir "appname-env" 는 변수를 전혀 읽지 않고 글자 그대로 "appname-env" 라는 디렉터리를 만듭니다. source config.sh 로 config.sh 를 지금 셸에 불러들이면 appname=billing, env=prod 가 실제 변수로 설정되고, ${appname}-${env} 로 그 값을 읽어야 billing-prod 라는 올바른 이름이 됩니다.', ko: 'mkdir "appname-env" 는 변수를 전혀 읽지 않고 글자 그대로 "appname-env" 라는 디렉터리를 만듭니다. source config.sh 로 config.sh 를 지금 셸에 불러들이면 appname=billing, env=prod 가 실제 변수로 설정되고, ${appname}-${env} 로 그 값을 읽어야 billing-prod 라는 올바른 이름이 됩니다.' },
  },
  {
    id: 'l5-07',
    level: 5,
    title: { en: '설치 스크립트 실행', ko: '설치 스크립트 실행' },
    prompt: { en: 'setup.sh 를 실행해 프로젝트 폴더 구조(project/src/main.py, project/docs/readme.md)를 만드세요. 실행 권한은 이미 있습니다.', ko: 'setup.sh 를 실행해 프로젝트 폴더 구조(project/src/main.py, project/docs/readme.md)를 만드세요. 실행 권한은 이미 있습니다.' },
    setup: (fs) => {
      fs.writeFile(
        `${HOME}/setup.sh`,
        '#!/bin/bash\nmkdir -p project/src\nmkdir -p project/docs\ntouch project/src/main.py\ntouch project/docs/readme.md\n',
        0o755
      )
    },
    hints: [
      { en: '파일 내용을 보는 것과 실행하는 것은 다릅니다 — cat 이나 touch 는 그저 파일을 다룰 뿐 안의 명령을 실행하지 않습니다.', ko: '파일 내용을 보는 것과 실행하는 것은 다릅니다 — cat 이나 touch 는 그저 파일을 다룰 뿐 안의 명령을 실행하지 않습니다.' },
      { en: '실행 권한이 있는 스크립트는 ./이름 형태로 실행합니다.', ko: '실행 권한이 있는 스크립트는 ./이름 형태로 실행합니다.' },
      { en: './setup.sh', ko: './setup.sh' },
    ],
    check: (ctx) => ctx.fs.exists(`${HOME}/project/src/main.py`) && ctx.fs.exists(`${HOME}/project/docs/readme.md`),
    solution: './setup.sh',
    wrongAnswer: 'touch setup.sh',
    explanation:
      { en: 'touch setup.sh 는 그 파일의 수정 시각만 갱신할 뿐, 안에 적힌 명령을 하나도 실행하지 않습니다 — project 디렉터리는 생기지 않습니다. ./setup.sh 처럼 실행 권한이 있는 스크립트를 경로로 직접 부르면 그 안의 mkdir/touch 명령들이 실제로 실행되어 폴더 구조가 만들어집니다.', ko: 'touch setup.sh 는 그 파일의 수정 시각만 갱신할 뿐, 안에 적힌 명령을 하나도 실행하지 않습니다 — project 디렉터리는 생기지 않습니다. ./setup.sh 처럼 실행 권한이 있는 스크립트를 경로로 직접 부르면 그 안의 mkdir/touch 명령들이 실제로 실행되어 폴더 구조가 만들어집니다.' },
  },
  {
    id: 'l5-08',
    level: 5,
    title: { en: '있으면 보존, 없으면 생성', ko: '있으면 보존, 없으면 생성' },
    prompt:
      { en: 'data 디렉터리는 이미 있고 안에 중요한 파일이 있습니다 — 절대 지우지 말고 그대로 두세요. cache 디렉터리는 아직 없으니 새로 만드세요. 두 디렉터리 다 이미 있는지 test 로 먼저 확인한 뒤, 없을 때만 만드세요.', ko: 'data 디렉터리는 이미 있고 안에 중요한 파일이 있습니다 — 절대 지우지 말고 그대로 두세요. cache 디렉터리는 아직 없으니 새로 만드세요. 두 디렉터리 다 이미 있는지 test 로 먼저 확인한 뒤, 없을 때만 만드세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/data`, { recursive: true })
      fs.writeFile(`${HOME}/data/keep.txt`, 'important\n')
    },
    hints: [
      { en: '이미 있는 디렉터리를 조건 없이 다시 만들려고 지웠다 새로 만들면, 안의 내용까지 같이 사라집니다.', ko: '이미 있는 디렉터리를 조건 없이 다시 만들려고 지웠다 새로 만들면, 안의 내용까지 같이 사라집니다.' },
      { en: '디렉터리가 있는지 확인하는 연산자는 [ -d 이름 ] 입니다. 없을 때만 만들려면 || 를 씁니다.', ko: '디렉터리가 있는지 확인하는 연산자는 [ -d 이름 ] 입니다. 없을 때만 만들려면 || 를 씁니다.' },
      { en: '[ -d data ] || mkdir data; [ -d cache ] || mkdir cache', ko: '[ -d data ] || mkdir data; [ -d cache ] || mkdir cache' },
    ],
    check: (ctx) => ctx.fs.isDir(`${HOME}/data`) && safeRead(ctx.fs, `${HOME}/data/keep.txt`) === 'important\n' && ctx.fs.isDir(`${HOME}/cache`),
    solution: '[ -d data ] || mkdir data; [ -d cache ] || mkdir cache',
    wrongAnswer: 'rm -rf data; mkdir data; mkdir cache',
    explanation:
      { en: 'rm -rf data; mkdir data 는 data 를 통째로 지웠다가 빈 채로 새로 만듭니다 — 안에 있던 keep.txt 는 영영 사라집니다. [ -d data ] || mkdir data 는 먼저 data 가 이미 있는지 test 로 확인해서, 있으면(참) mkdir 을 건너뛰고, 없을 때만(거짓) 새로 만듭니다 — 있는 걸 건드리지 않으면서 없는 것만 채웁니다.', ko: 'rm -rf data; mkdir data 는 data 를 통째로 지웠다가 빈 채로 새로 만듭니다 — 안에 있던 keep.txt 는 영영 사라집니다. [ -d data ] || mkdir data 는 먼저 data 가 이미 있는지 test 로 확인해서, 있으면(참) mkdir 을 건너뛰고, 없을 때만(거짓) 새로 만듭니다 — 있는 걸 건드리지 않으면서 없는 것만 채웁니다.' },
  },
  {
    id: 'l5-09',
    level: 5,
    title: { en: '이름을 인자로 받는 스크립트', ko: '이름을 인자로 받는 스크립트' },
    prompt: { en: 'mk.sh 는 인자로 받은 이름의 디렉터리와 그 안에 README.md 를 만드는 스크립트입니다. widget 이라는 이름으로 실행하세요.', ko: 'mk.sh 는 인자로 받은 이름의 디렉터리와 그 안에 README.md 를 만드는 스크립트입니다. widget 이라는 이름으로 실행하세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/mk.sh`, '#!/bin/bash\nmkdir -p "$1"\ntouch "$1/README.md"\n', 0o755)
    },
    hints: [
      { en: '스크립트를 실행할 때 뒤에 붙이는 값은 스크립트 안에서 $1 로 쓰입니다.', ko: '스크립트를 실행할 때 뒤에 붙이는 값은 스크립트 안에서 $1 로 쓰입니다.' },
      { en: './mk.sh 뒤에 원하는 이름을 인자로 붙여 실행하세요.', ko: './mk.sh 뒤에 원하는 이름을 인자로 붙여 실행하세요.' },
      { en: './mk.sh widget', ko: './mk.sh widget' },
    ],
    check: (ctx) => ctx.fs.exists(`${HOME}/widget/README.md`),
    solution: './mk.sh widget',
    wrongAnswer: './mk.sh notwidget',
    explanation:
      { en: '인자로 다른 이름(notwidget)을 주면 스크립트는 그 이름으로 디렉터리를 만듭니다 — widget 디렉터리는 생기지 않습니다. 스크립트 안의 $1 은 실행할 때 뒤에 적은 첫 번째 값을 그대로 받으므로, ./mk.sh widget 처럼 원하는 이름을 정확히 인자로 줘야 합니다.', ko: '인자로 다른 이름(notwidget)을 주면 스크립트는 그 이름으로 디렉터리를 만듭니다 — widget 디렉터리는 생기지 않습니다. 스크립트 안의 $1 은 실행할 때 뒤에 적은 첫 번째 값을 그대로 받으므로, ./mk.sh widget 처럼 원하는 이름을 정확히 인자로 줘야 합니다.' },
  },
  {
    id: 'l5-10',
    level: 5,
    title: { en: '내용 있는 파일만 이동', ko: '내용 있는 파일만 이동' },
    prompt: { en: '현재 디렉터리의 .log 파일들 중, 내용이 있는(비어있지 않은) 파일만 processed 디렉터리로 옮기세요. 빈 파일은 그대로 두세요.', ko: '현재 디렉터리의 .log 파일들 중, 내용이 있는(비어있지 않은) 파일만 processed 디렉터리로 옮기세요. 빈 파일은 그대로 두세요.' },
    setup: (fs) => {
      fs.mkdir(`${HOME}/processed`, { recursive: true })
      fs.writeFile(`${HOME}/a.log`, 'data\n')
      fs.writeFile(`${HOME}/b.log`, '')
      fs.writeFile(`${HOME}/c.log`, 'more\n')
    },
    hints: [
      { en: '먼저 .log 파일들을 하나씩 봐야 하므로 for 로 목록을 돕니다.', ko: '먼저 .log 파일들을 하나씩 봐야 하므로 for 로 목록을 돕니다.' },
      { en: '그 안에서 파일이 비어있지 않은지 test 로 확인해, 조건에 맞을 때만 옮기세요: [ -s 파일 ]', ko: '그 안에서 파일이 비어있지 않은지 test 로 확인해, 조건에 맞을 때만 옮기세요: [ -s 파일 ]' },
      { en: 'for f in *.log; do if [ -s $f ]; then mv $f processed/; fi; done', ko: 'for f in *.log; do if [ -s $f ]; then mv $f processed/; fi; done' },
    ],
    check: (ctx) => {
      const movedOk = safeRead(ctx.fs, `${HOME}/processed/a.log`) === 'data\n' && safeRead(ctx.fs, `${HOME}/processed/c.log`) === 'more\n'
      const emptyStayed = safeRead(ctx.fs, `${HOME}/b.log`) === '' && !ctx.fs.exists(`${HOME}/processed/b.log`)
      const goneFromHome = !ctx.fs.exists(`${HOME}/a.log`) && !ctx.fs.exists(`${HOME}/c.log`)
      return movedOk && emptyStayed && goneFromHome
    },
    solution: 'for f in *.log; do if [ -s $f ]; then mv $f processed/; fi; done',
    wrongAnswer: 'mv *.log processed/',
    explanation:
      { en: 'mv *.log processed/ 는 내용이 있든 없든 .log 파일을 전부 옮겨버려서, 빈 파일이었던 b.log 까지 processed 로 들어갑니다. for 로 파일을 하나씩 돌면서 if [ -s $f ]; then mv $f processed/; fi 로 "비어있지 않은" 파일만 걸러 옮겨야 빈 파일은 원래 자리에 그대로 남습니다.', ko: 'mv *.log processed/ 는 내용이 있든 없든 .log 파일을 전부 옮겨버려서, 빈 파일이었던 b.log 까지 processed 로 들어갑니다. for 로 파일을 하나씩 돌면서 if [ -s $f ]; then mv $f processed/; fi 로 "비어있지 않은" 파일만 걸러 옮겨야 빈 파일은 원래 자리에 그대로 남습니다.' },
  },
]
