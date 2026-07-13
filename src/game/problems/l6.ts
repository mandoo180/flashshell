import type { Problem } from '../types'
import { safeRead } from '../check-helpers'

const HOME = '/home/player'

// L6 "자동화" — 배열 · read · 스크립트(M3: 배열/인덱스/+=, read/-a/IFS, while read,
// 복합 리다이렉션 등). Task 2에서 l6-01~05(배열 기초·인덱스·+=·read·while read)를
// 채운다. Task 3에서 l6-06~10을 이어 채운다.
export const l6: Problem[] = [
  {
    id: 'l6-01',
    level: 6,
    title: '서버 명단 배열',
    prompt:
      '관리 중인 서버 세 대의 이름(web, db, cache)을 배열에 담으세요. 이름들을 공백으로 구분한 한 줄로 servers.txt 에 쓰고, 서버가 몇 대인지(개수)는 직접 세지 말고 배열 크기로 구해 count.txt 에 쓰세요.',
    setup: () => {},
    hints: [
      '이름을 각각 다른 변수에 담는 대신, 여러 값을 한 변수에 묶는 배열을 쓰면 목록 전체와 개수를 한꺼번에 다룰 수 있습니다.',
      '배열은 이름=(값1 값2 값3) 로 만듭니다. 전체 원소는 "${이름[@]}", 원소 개수는 ${#이름[@]} 로 꺼냅니다.',
      'servers=(web db cache); echo "${servers[@]}" > servers.txt; echo "${#servers[@]}" > count.txt',
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/servers.txt`) === 'web db cache\n' && safeRead(ctx.fs, `${HOME}/count.txt`) === '3\n',
    solution: 'servers=(web db cache); echo "${servers[@]}" > servers.txt; echo "${#servers[@]}" > count.txt',
    wrongAnswer: 'echo "web db cache" > servers.txt',
    explanation:
      'echo "web db cache" > servers.txt 는 이름 목록만 손으로 적어 넣을 뿐, 개수를 담은 count.txt 는 아예 만들지 않습니다. 이름들을 servers=(web db cache) 처럼 배열에 담아 두면, "${servers[@]}" 로 전체 목록을 한 줄로 쓰고 ${#servers[@]} 로 원소 개수(3)를 직접 세지 않고도 얻어 count.txt 에 남길 수 있습니다.',
  },
  {
    id: 'l6-02',
    level: 6,
    title: '담당자 교체',
    prompt:
      'team.txt 에는 담당자 명단이 한 줄에 공백으로 구분돼 있습니다(alice bob carol dave). 두 번째 담당자(인덱스 1)가 bob 에서 erin 으로 바뀌었습니다. 명단을 배열로 읽어들여 그 자리 하나만 erin 으로 교체하고, 전체 명단을 다시 한 줄로 roster.txt 에 쓰세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/team.txt`, 'alice bob carol dave\n')
    },
    hints: [
      '명단을 통째로 다시 적는 대신, 배열의 특정 자리 하나만 콕 집어 바꿀 수 있습니다.',
      '한 줄을 배열로 읽으려면 read -a 이름 < 파일 을 씁니다. 배열의 자리는 0 부터 세며, 이름[n]=값 으로 그 자리만 교체합니다.',
      'read -a team < team.txt; team[1]=erin; echo "${team[@]}" > roster.txt',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/roster.txt`) === 'alice erin carol dave\n',
    solution: 'read -a team < team.txt; team[1]=erin; echo "${team[@]}" > roster.txt',
    wrongAnswer: 'read -a team < team.txt; echo "${team[@]}" > roster.txt',
    explanation:
      'read -a team < team.txt; echo "${team[@]}" > roster.txt 는 명단을 읽어 그대로 다시 쓸 뿐 bob 을 바꾸지 않아, roster.txt 에 여전히 bob 이 남습니다. 배열에서는 team[1]=erin 처럼 인덱스로 한 자리만 지정해 교체할 수 있습니다 — 인덱스는 0 부터 세므로 [1] 이 두 번째 자리(bob)이고, 나머지 alice·carol·dave 는 건드리지 않고 그대로 둡니다.',
  },
  {
    id: 'l6-03',
    level: 6,
    title: '허용 목록 이어붙이기',
    prompt:
      '방화벽 허용 IP 목록을 단계적으로 채웁니다. 처음엔 10.0.0.1 하나로 시작한 배열에, 새로 승인된 10.0.0.2 와 10.0.0.3 을 뒤에 이어 붙이세요. 최종 목록을 공백으로 구분한 한 줄로 allowlist.txt 에 쓰세요.',
    setup: () => {},
    hints: [
      '이미 있는 배열을 통째로 다시 만들지 않고, 뒤에 새 원소만 덧붙일 수 있습니다.',
      '배열에 원소를 덧붙일 때는 = 가 아니라 += 를 씁니다: 이름+=(값 값). = 로 다시 대입하면 기존 원소가 사라집니다.',
      'ips=(10.0.0.1); ips+=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/allowlist.txt`) === '10.0.0.1 10.0.0.2 10.0.0.3\n',
    solution: 'ips=(10.0.0.1); ips+=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt',
    wrongAnswer: 'ips=(10.0.0.1); ips=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt',
    explanation:
      'ips=(10.0.0.1) 다음에 다시 ips=(10.0.0.2 10.0.0.3) 을 하면, = 는 배열을 통째로 갈아치우므로 처음의 10.0.0.1 이 사라져 allowlist.txt 에 두 개만 남습니다. += 는 기존 원소를 유지한 채 뒤에 덧붙이므로, ips+=(10.0.0.2 10.0.0.3) 으로 세 IP 가 모두 순서대로 남습니다.',
  },
  {
    id: 'l6-04',
    level: 6,
    title: '설정값 뽑아내기',
    prompt:
      'message.conf 의 첫 줄은 "키 값" 형식입니다(title Welcome to Flash Shell). 여기서 값 부분만 message.txt 에 쓰세요 — 값 안의 공백까지 그대로 살려야 합니다.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/message.conf`, 'title Welcome to Flash Shell\n')
    },
    hints: [
      '한 줄을 앞의 키와 뒤의 값으로 나눠 담고 싶을 때, read 에 변수를 두 개 주면 됩니다.',
      'read 키변수 값변수 < 파일 로 읽으면, 첫 단어는 키변수에, 그 뒤 나머지 전부(중간 공백 포함)는 마지막 변수에 통째로 들어갑니다.',
      'read key value < message.conf; echo "$value" > message.txt',
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/message.txt`) === 'Welcome to Flash Shell\n',
    solution: 'read key value < message.conf; echo "$value" > message.txt',
    wrongAnswer: 'read value < message.conf; echo "$value" > message.txt',
    explanation:
      'read value < message.conf 처럼 변수를 하나만 주면, 그 변수에 줄 전체("title Welcome to Flash Shell")가 들어가 키 title 까지 섞여 나옵니다. read key value 처럼 변수를 둘 주면 첫 단어 title 은 key 로 떼어내고, 나머지 "Welcome to Flash Shell" 은 중간 공백까지 그대로 마지막 변수 value 에 통째로 담깁니다 — 마지막 변수가 남은 전부를 받는다는 규칙 덕분입니다.',
  },
  {
    id: 'l6-05',
    level: 6,
    title: '명단으로 폴더 만들기',
    prompt:
      'users.txt 에는 사용자 이름이 한 줄에 하나씩 있습니다. 줄이 몇 개인지 몰라도 되도록 while read 로 한 줄씩 읽어, 이름마다 그 이름의 디렉터리를 만들고 그 안에 profile.txt 를 만드세요.',
    setup: (fs) => {
      fs.writeFile(`${HOME}/users.txt`, 'alice\nbob\ncarol\n')
    },
    hints: [
      '줄이 몇 개인지 미리 모른다면, 파일이 끝날 때까지 한 줄씩 반복해서 읽어야 합니다 — while read 입니다.',
      'while read 변수; do ... done < 파일 형태입니다. 반복마다 변수에 다음 한 줄이 담기고, 읽을 줄이 떨어지면 저절로 멈춥니다.',
      'while read u; do mkdir "$u"; touch "$u/profile.txt"; done < users.txt',
    ],
    check: (ctx) =>
      ctx.fs.exists(`${HOME}/alice/profile.txt`) &&
      ctx.fs.exists(`${HOME}/bob/profile.txt`) &&
      ctx.fs.exists(`${HOME}/carol/profile.txt`),
    solution: 'while read u; do mkdir "$u"; touch "$u/profile.txt"; done < users.txt',
    wrongAnswer: 'read u < users.txt; mkdir "$u"; touch "$u/profile.txt"',
    explanation:
      'read u < users.txt 는 파일의 첫 줄(alice)만 한 번 읽고 끝나므로, bob·carol 의 디렉터리는 만들어지지 않습니다. while read u; do ... done < users.txt 는 파일이 끝날 때까지 매 반복마다 다음 줄을 u 에 담아 같은 작업을 되풀이하므로, 줄이 몇 개든 모든 이름에 대해 디렉터리와 profile.txt 가 만들어집니다.',
  },
]
