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
    title: { en: 'Server Roster Array', ko: '서버 명단 배열' },
    prompt:
      { en: 'Put the names of the three servers you manage (web, db, cache) into an array. Write the names to servers.txt as a single space-separated line, and rather than counting the servers by hand, get how many there are from the array size and write it to count.txt.', ko: '관리 중인 서버 세 대의 이름(web, db, cache)을 배열에 담으세요. 이름들을 공백으로 구분한 한 줄로 servers.txt 에 쓰고, 서버가 몇 대인지(개수)는 직접 세지 말고 배열 크기로 구해 count.txt 에 쓰세요.' },
    setup: () => {},
    hints: [
      { en: 'Instead of putting each name into a separate variable, use an array, which bundles several values into one variable, and you can handle the whole list and its count at once.', ko: '이름을 각각 다른 변수에 담는 대신, 여러 값을 한 변수에 묶는 배열을 쓰면 목록 전체와 개수를 한꺼번에 다룰 수 있습니다.' },
      { en: 'An array is made with name=(value1 value2 value3). Pull all elements out with "${name[@]}" and the element count with ${#name[@]}.', ko: '배열은 이름=(값1 값2 값3) 로 만듭니다. 전체 원소는 "${이름[@]}", 원소 개수는 ${#이름[@]} 로 꺼냅니다.' },
      { en: 'servers=(web db cache); echo "${servers[@]}" > servers.txt; echo "${#servers[@]}" > count.txt', ko: 'servers=(web db cache); echo "${servers[@]}" > servers.txt; echo "${#servers[@]}" > count.txt' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/servers.txt`) === 'web db cache\n' && safeRead(ctx.fs, `${HOME}/count.txt`) === '3\n',
    solution: 'servers=(web db cache); echo "${servers[@]}" > servers.txt; echo "${#servers[@]}" > count.txt',
    wrongAnswer: 'echo "web db cache" > servers.txt',
    explanation:
      { en: 'echo "web db cache" > servers.txt merely writes the name list in by hand and never even creates count.txt with the count. Put the names into an array like servers=(web db cache) and you can write the whole list on one line with "${servers[@]}" and, without counting by hand, obtain the element count (3) with ${#servers[@]} to leave in count.txt.', ko: 'echo "web db cache" > servers.txt 는 이름 목록만 손으로 적어 넣을 뿐, 개수를 담은 count.txt 는 아예 만들지 않습니다. 이름들을 servers=(web db cache) 처럼 배열에 담아 두면, "${servers[@]}" 로 전체 목록을 한 줄로 쓰고 ${#servers[@]} 로 원소 개수(3)를 직접 세지 않고도 얻어 count.txt 에 남길 수 있습니다.' },
  },
  {
    id: 'l6-02',
    level: 6,
    title: { en: 'Swap a Member', ko: '담당자 교체' },
    prompt:
      { en: 'team.txt holds a roster of members on one line, space-separated (alice bob carol dave). The second member (index 1) has changed from bob to erin. Read the roster into an array, replace just that one slot with erin, and write the whole roster back to roster.txt as a single line.', ko: 'team.txt 에는 담당자 명단이 한 줄에 공백으로 구분돼 있습니다(alice bob carol dave). 두 번째 담당자(인덱스 1)가 bob 에서 erin 으로 바뀌었습니다. 명단을 배열로 읽어들여 그 자리 하나만 erin 으로 교체하고, 전체 명단을 다시 한 줄로 roster.txt 에 쓰세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/team.txt`, 'alice bob carol dave\n')
    },
    hints: [
      { en: 'Instead of rewriting the whole roster, you can pinpoint and change just one particular slot of the array.', ko: '명단을 통째로 다시 적는 대신, 배열의 특정 자리 하나만 콕 집어 바꿀 수 있습니다.' },
      { en: 'To read a line into an array, use read -a name < file. Array slots are counted from 0, and name[n]=value replaces just that slot.', ko: '한 줄을 배열로 읽으려면 read -a 이름 < 파일 을 씁니다. 배열의 자리는 0 부터 세며, 이름[n]=값 으로 그 자리만 교체합니다.' },
      { en: 'read -a team < team.txt; team[1]=erin; echo "${team[@]}" > roster.txt', ko: 'read -a team < team.txt; team[1]=erin; echo "${team[@]}" > roster.txt' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/roster.txt`) === 'alice erin carol dave\n',
    solution: 'read -a team < team.txt; team[1]=erin; echo "${team[@]}" > roster.txt',
    wrongAnswer: 'read -a team < team.txt; echo "${team[@]}" > roster.txt',
    explanation:
      { en: 'read -a team < team.txt; echo "${team[@]}" > roster.txt just reads the roster and writes it straight back without changing bob, so bob still remains in roster.txt. With an array you can replace just one slot by index, as in team[1]=erin — since indexes count from 0, [1] is the second slot (bob), and the rest, alice, carol, and dave, are left untouched.', ko: 'read -a team < team.txt; echo "${team[@]}" > roster.txt 는 명단을 읽어 그대로 다시 쓸 뿐 bob 을 바꾸지 않아, roster.txt 에 여전히 bob 이 남습니다. 배열에서는 team[1]=erin 처럼 인덱스로 한 자리만 지정해 교체할 수 있습니다 — 인덱스는 0 부터 세므로 [1] 이 두 번째 자리(bob)이고, 나머지 alice·carol·dave 는 건드리지 않고 그대로 둡니다.' },
  },
  {
    id: 'l6-03',
    level: 6,
    title: { en: 'Extend the Allowlist', ko: '허용 목록 이어붙이기' },
    prompt:
      { en: 'You are filling out a firewall allowlist of IPs in stages. To an array that starts with just 10.0.0.1, append the newly approved 10.0.0.2 and 10.0.0.3 on the end. Write the final list to allowlist.txt as a single space-separated line.', ko: '방화벽 허용 IP 목록을 단계적으로 채웁니다. 처음엔 10.0.0.1 하나로 시작한 배열에, 새로 승인된 10.0.0.2 와 10.0.0.3 을 뒤에 이어 붙이세요. 최종 목록을 공백으로 구분한 한 줄로 allowlist.txt 에 쓰세요.' },
    setup: () => {},
    hints: [
      { en: 'Without rebuilding the existing array wholesale, you can append just the new elements on the end.', ko: '이미 있는 배열을 통째로 다시 만들지 않고, 뒤에 새 원소만 덧붙일 수 있습니다.' },
      { en: 'To append elements to an array, use += rather than =: name+=(value value). Reassigning with = makes the existing elements vanish.', ko: '배열에 원소를 덧붙일 때는 = 가 아니라 += 를 씁니다: 이름+=(값 값). = 로 다시 대입하면 기존 원소가 사라집니다.' },
      { en: 'ips=(10.0.0.1); ips+=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt', ko: 'ips=(10.0.0.1); ips+=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/allowlist.txt`) === '10.0.0.1 10.0.0.2 10.0.0.3\n',
    solution: 'ips=(10.0.0.1); ips+=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt',
    wrongAnswer: 'ips=(10.0.0.1); ips=(10.0.0.2 10.0.0.3); echo "${ips[@]}" > allowlist.txt',
    explanation:
      { en: 'Do ips=(10.0.0.1) and then ips=(10.0.0.2 10.0.0.3) again and, since = swaps the whole array out, the original 10.0.0.1 disappears and only two remain in allowlist.txt. += keeps the existing elements and appends on the end, so ips+=(10.0.0.2 10.0.0.3) leaves all three IPs in order.', ko: 'ips=(10.0.0.1) 다음에 다시 ips=(10.0.0.2 10.0.0.3) 을 하면, = 는 배열을 통째로 갈아치우므로 처음의 10.0.0.1 이 사라져 allowlist.txt 에 두 개만 남습니다. += 는 기존 원소를 유지한 채 뒤에 덧붙이므로, ips+=(10.0.0.2 10.0.0.3) 으로 세 IP 가 모두 순서대로 남습니다.' },
  },
  {
    id: 'l6-04',
    level: 6,
    title: { en: 'Extract the Value', ko: '설정값 뽑아내기' },
    prompt:
      { en: 'The first line of message.conf is in "key value" format (title Welcome to Flash Shell). Write only the value part to message.txt — you must preserve the spaces inside the value exactly.', ko: 'message.conf 의 첫 줄은 "키 값" 형식입니다(title Welcome to Flash Shell). 여기서 값 부분만 message.txt 에 쓰세요 — 값 안의 공백까지 그대로 살려야 합니다.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/message.conf`, 'title Welcome to Flash Shell\n')
    },
    hints: [
      { en: 'When you want to split a line into a leading key and a trailing value, give read two variables.', ko: '한 줄을 앞의 키와 뒤의 값으로 나눠 담고 싶을 때, read 에 변수를 두 개 주면 됩니다.' },
      { en: 'Read with read keyvar valuevar < file and the first word goes into keyvar, while all the rest after it (including the spaces in between) goes into the last variable in one piece.', ko: 'read 키변수 값변수 < 파일 로 읽으면, 첫 단어는 키변수에, 그 뒤 나머지 전부(중간 공백 포함)는 마지막 변수에 통째로 들어갑니다.' },
      { en: 'read key value < message.conf; echo "$value" > message.txt', ko: 'read key value < message.conf; echo "$value" > message.txt' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/message.txt`) === 'Welcome to Flash Shell\n',
    solution: 'read key value < message.conf; echo "$value" > message.txt',
    wrongAnswer: 'read value < message.conf; echo "$value" > message.txt',
    explanation:
      { en: 'Give just one variable, as in read value < message.conf, and the whole line ("title Welcome to Flash Shell") goes into that variable, so the key title comes out mixed in too. Give two variables, as in read key value, and the first word title is split off into key while the rest, "Welcome to Flash Shell", is stored whole into the last variable value, spaces in between and all — thanks to the rule that the last variable receives everything that remains.', ko: 'read value < message.conf 처럼 변수를 하나만 주면, 그 변수에 줄 전체("title Welcome to Flash Shell")가 들어가 키 title 까지 섞여 나옵니다. read key value 처럼 변수를 둘 주면 첫 단어 title 은 key 로 떼어내고, 나머지 "Welcome to Flash Shell" 은 중간 공백까지 그대로 마지막 변수 value 에 통째로 담깁니다 — 마지막 변수가 남은 전부를 받는다는 규칙 덕분입니다.' },
  },
  {
    id: 'l6-05',
    level: 6,
    title: { en: 'Folders from a List', ko: '명단으로 폴더 만들기' },
    prompt:
      { en: 'users.txt has one username per line. So that you need not know how many lines there are, read it a line at a time with while read, and for each name make a directory with that name and create profile.txt inside it.', ko: 'users.txt 에는 사용자 이름이 한 줄에 하나씩 있습니다. 줄이 몇 개인지 몰라도 되도록 while read 로 한 줄씩 읽어, 이름마다 그 이름의 디렉터리를 만들고 그 안에 profile.txt 를 만드세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/users.txt`, 'alice\nbob\ncarol\n')
    },
    hints: [
      { en: 'When you do not know in advance how many lines there are, you have to read a line at a time repeatedly until the file ends — that is while read.', ko: '줄이 몇 개인지 미리 모른다면, 파일이 끝날 때까지 한 줄씩 반복해서 읽어야 합니다 — while read 입니다.' },
      { en: 'The form is while read var; do ... done < file. Each iteration loads the next line into var, and when there are no more lines to read it stops on its own.', ko: 'while read 변수; do ... done < 파일 형태입니다. 반복마다 변수에 다음 한 줄이 담기고, 읽을 줄이 떨어지면 저절로 멈춥니다.' },
      { en: 'while read u; do mkdir "$u"; touch "$u/profile.txt"; done < users.txt', ko: 'while read u; do mkdir "$u"; touch "$u/profile.txt"; done < users.txt' },
    ],
    check: (ctx) =>
      ctx.fs.exists(`${HOME}/alice/profile.txt`) &&
      ctx.fs.exists(`${HOME}/bob/profile.txt`) &&
      ctx.fs.exists(`${HOME}/carol/profile.txt`),
    solution: 'while read u; do mkdir "$u"; touch "$u/profile.txt"; done < users.txt',
    wrongAnswer: 'read u < users.txt; mkdir "$u"; touch "$u/profile.txt"',
    explanation:
      { en: 'read u < users.txt reads only the first line of the file (alice) once and stops, so the directories for bob and carol never get made. while read u; do ... done < users.txt loads the next line into u on every iteration until the file ends and repeats the same work, so no matter how many lines there are, a directory and profile.txt get made for every name.', ko: 'read u < users.txt 는 파일의 첫 줄(alice)만 한 번 읽고 끝나므로, bob·carol 의 디렉터리는 만들어지지 않습니다. while read u; do ... done < users.txt 는 파일이 끝날 때까지 매 반복마다 다음 줄을 u 에 담아 같은 작업을 되풀이하므로, 줄이 몇 개든 모든 이름에 대해 디렉터리와 profile.txt 가 만들어집니다.' },
  },
  {
    id: 'l6-06',
    level: 6,
    title: { en: 'All Checks into One File', ko: '점검 결과 한 파일로' },
    prompt:
      { en: 'Gather the results of checking the three services api, worker, and scheduler in turn into a single report file (report.txt). Each service should be one line in "name: ok" format, in the order they came. Do not attach the redirection (>) on each iteration; attach it just once to the whole loop to send all the output to report.txt at once.', ko: 'api, worker, scheduler 세 서비스를 차례로 점검한 결과를 보고서 파일 하나(report.txt)에 모으세요. 각 서비스마다 "이름: ok" 형식으로 한 줄씩, 나온 순서대로 담겨야 합니다. 리다이렉션(>)은 반복마다 걸지 말고, 루프 전체에 딱 한 번만 걸어 전체 출력을 한꺼번에 report.txt 로 보내세요.' },
    setup: () => {},
    hints: [
      { en: 'Redirect to the file on each iteration and it overwrites anew every time, leaving only the last line — the redirection needs to happen just once, at the point where the loop ends.', ko: '반복마다 파일로 방향을 돌리면 매번 새로 덮어써 마지막 한 줄만 남습니다 — 방향 전환은 루프가 끝나는 지점에서 한 번이면 됩니다.' },
      { en: 'Treat the whole for ...; do ... done as a single command, and attaching > file after the closing done gathers every line the loop prints into that file.', ko: 'for ...; do ... done 전체를 하나의 명령처럼 보고, 닫는 done 뒤에 > 파일 을 붙이면 루프가 찍는 모든 줄이 그 파일로 모입니다.' },
      { en: 'for s in api worker scheduler; do echo "$s: ok"; done > report.txt', ko: 'for s in api worker scheduler; do echo "$s: ok"; done > report.txt' },
    ],
    check: (ctx) => safeRead(ctx.fs, `${HOME}/report.txt`) === 'api: ok\nworker: ok\nscheduler: ok\n',
    solution: 'for s in api worker scheduler; do echo "$s: ok"; done > report.txt',
    wrongAnswer: 'for s in api worker scheduler; do echo "$s: ok" > report.txt; done',
    explanation:
      { en: 'Put echo "$s: ok" > report.txt inside the loop and it overwrites report.txt anew on each iteration, leaving only the last service (scheduler) as a single line — > does not append; it empties the file and rewrites it every time. Attach the redirection just once to the whole loop, as in done > report.txt, and the three lines echo prints while the loop runs all flow into the same file and stack up in order.', ko: 'echo "$s: ok" > report.txt 를 루프 안에 두면 반복마다 report.txt 를 새로 덮어써서, 마지막 서비스(scheduler) 한 줄만 남습니다 — > 는 이어붙이지 않고 매번 파일을 비우고 다시 씁니다. 반면 done > report.txt 처럼 루프 전체에 리다이렉션을 한 번만 걸면, 루프가 도는 동안 echo 가 찍는 세 줄이 모두 같은 파일로 흘러들어가 순서대로 쌓입니다.' },
  },
  {
    id: 'l6-07',
    level: 6,
    title: { en: 'Count and the Third Reading', ko: '측정값 개수와 세 번째 값' },
    prompt:
      { en: 'A single line of readings.txt has sensor readings separated by spaces (12 19 7 23 15). Read this line into an array and write how many readings there are to count.txt and the third reading (index 2) to third.txt.', ko: 'readings.txt 한 줄에는 센서 측정값들이 공백으로 구분돼 있습니다(12 19 7 23 15). 이 줄을 배열로 읽어들여, 측정값이 몇 개인지 count.txt 에, 세 번째 측정값(인덱스 2)을 third.txt 에 쓰세요.' },
    setup: (fs) => {
      fs.writeFile(`${HOME}/readings.txt`, '12 19 7 23 15\n')
    },
    hints: [
      { en: 'When several values are laid out on one line by spaces, you have to store them not as a single string but as an array whose values can be pulled out individually, so that you can handle both the count and a specific slot.', ko: '한 줄에 여러 값이 공백으로 나열돼 있으면, 하나의 문자열이 아니라 값마다 따로 꺼낼 수 있는 배열로 담아야 개수와 특정 자리를 다룰 수 있습니다.' },
      { en: 'Read with read -a name < file and each space-separated value goes into one slot of the array. The count is ${#name[@]}, and the third value (counting from 0, index 2) is ${name[2]}.', ko: 'read -a 이름 < 파일 로 읽으면 공백으로 나뉜 각 값이 배열의 한 자리씩 들어갑니다. 개수는 ${#이름[@]}, 세 번째 값(0부터 세어 인덱스 2)은 ${이름[2]} 입니다.' },
      { en: 'read -a nums < readings.txt; echo "${#nums[@]}" > count.txt; echo "${nums[2]}" > third.txt', ko: 'read -a nums < readings.txt; echo "${#nums[@]}" > count.txt; echo "${nums[2]}" > third.txt' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/count.txt`) === '5\n' && safeRead(ctx.fs, `${HOME}/third.txt`) === '7\n',
    solution: 'read -a nums < readings.txt; echo "${#nums[@]}" > count.txt; echo "${nums[2]}" > third.txt',
    wrongAnswer: 'read nums < readings.txt; echo "${#nums[@]}" > count.txt; echo "${nums[2]}" > third.txt',
    explanation:
      { en: 'Read with read nums without -a and the whole line ("12 19 7 23 15") goes into nums as a single string rather than an array — then ${#nums[@]} counts it as one element and comes out 1, and a slot access like ${nums[2]} is an empty value, so count.txt and third.txt are both wrong. Read with read -a nums and the five space-separated values each go into a slot of the array, so ${#nums[@]} gives the count 5 and ${nums[2]} gives the third value 7.', ko: '-a 없이 read nums 로 읽으면 줄 전체("12 19 7 23 15")가 배열이 아니라 문자열 하나로 nums 에 들어갑니다 — 그러면 ${#nums[@]} 는 원소 하나로 쳐서 1 이 되고, ${nums[2]} 같은 자리 접근은 빈 값이라 count.txt·third.txt 가 모두 틀립니다. read -a nums 로 읽어야 공백으로 나뉜 다섯 값이 각각 배열의 한 자리에 담겨, ${#nums[@]} 로 개수 5 를, ${nums[2]} 로 세 번째 값 7 을 얻습니다.' },
  },
  {
    id: 'l6-08',
    level: 6,
    title: { en: 'A Script That Stamps Out Config', ko: '설정을 찍어내는 스크립트' },
    prompt:
      { en: 'provision.sh is a script that creates a database config file. First read its contents with cat provision.sh to grasp what file it fills with what, then run it. Then get the port number from the config file it created and make a directory in "db-port" format (e.g. if the port is 5432, db-5432).', ko: 'provision.sh 는 데이터베이스 설정 파일을 만들어 주는 스크립트입니다. 먼저 cat provision.sh 로 내용을 읽어 어떤 파일에 무엇을 담는지 파악한 뒤 실행하세요. 그런 다음 만들어진 설정 파일에서 포트 번호를 얻어, "db-포트" 형식의 디렉터리를 만드세요(예: 포트가 5432 면 db-5432).' },
    setup: (fs) => {
      fs.writeFile(
        `${HOME}/provision.sh`,
        '#!/bin/bash\ncat > db.conf <<EOF\nhost=localhost\nport=5432\ndbname=orders\nEOF\n',
        0o755
      )
    },
    hints: [
      { en: 'Look inside with cat provision.sh before running the script and you can see what file (db.conf) it makes with what contents — in particular, note what the port value is.', ko: '스크립트를 실행하기 전에 cat provision.sh 로 안을 들여다보면, 무슨 파일(db.conf)을 어떤 내용으로 만드는지 알 수 있습니다 — 특히 포트 값이 몇인지 확인해 두세요.' },
      { en: 'You run it with ./provision.sh. The db.conf it makes is in "key=value" format, so loading it with source db.conf lets you use the port variable directly.', ko: '실행은 ./provision.sh 입니다. 만들어진 db.conf 는 "키=값" 형식이라 source db.conf 로 불러오면 port 변수를 그대로 쓸 수 있습니다.' },
      { en: './provision.sh; source db.conf; mkdir "db-$port"', ko: './provision.sh; source db.conf; mkdir "db-$port"' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/db.conf`) === 'host=localhost\nport=5432\ndbname=orders\n' &&
      ctx.fs.isDir(`${HOME}/db-5432`),
    solution: './provision.sh\nsource db.conf; mkdir "db-$port"',
    wrongAnswer: './provision.sh',
    explanation:
      { en: 'Run just ./provision.sh and db.conf gets made, but the finishing step of making a directory from the port written there is not done, so db-5432 never appears. The cat > db.conf <<EOF ... EOF in the script body is the part that writes several lines verbatim into db.conf with a here-document — run it and port=5432 gets stored, and loading that value with source db.conf and doing mkdir "db-$port" makes db-5432.', ko: './provision.sh 만 실행하면 db.conf 는 만들어지지만, 거기 적힌 포트로 디렉터리를 만드는 마무리 작업은 하지 않아 db-5432 가 생기지 않습니다. 스크립트 본문의 cat > db.conf <<EOF ... EOF 는 here-document 로 여러 줄을 그대로 db.conf 에 써넣는 부분입니다 — 실행하면 port=5432 가 담기고, source db.conf 로 그 값을 불러와 mkdir "db-$port" 하면 db-5432 가 만들어집니다.' },
  },
  {
    id: 'l6-09',
    level: 6,
    title: { en: 'A Config File per Environment', ko: '환경마다 설정 파일' },
    prompt:
      { en: 'mkconf.sh is a script that, for each environment name it receives as an argument, makes a "name.conf" file and writes one line "environment=name" inside it — it takes several names at once and processes them one by one. Make all three files for the dev, stage, and prod environments in a single run.', ko: 'mkconf.sh 는 인자로 받은 환경 이름마다 "이름.conf" 파일을 만들고 그 안에 "environment=이름" 한 줄을 쓰는 스크립트입니다 — 이름을 여러 개 한꺼번에 받아 하나씩 처리합니다. dev, stage, prod 세 환경에 대해 한 번의 실행으로 세 파일을 모두 만드세요.' },
    setup: (fs) => {
      fs.writeFile(
        `${HOME}/mkconf.sh`,
        '#!/bin/bash\nfor name in "$@"; do\n  echo "environment=$name" > "$name.conf"\ndone\n',
        0o755
      )
    },
    hints: [
      { en: 'The script takes several names and processes them one by one, so you have to pass the names as separate arguments, spaced apart.', ko: '스크립트가 이름을 여러 개 받아 하나씩 처리하므로, 이름들을 공백으로 띄워 각각 따로 된 인자로 넘겨야 합니다.' },
      { en: 'List the three names after ./mkconf.sh as separate arguments each — do not quote them into a single chunk.', ko: './mkconf.sh 뒤에 세 이름을 각각 별개의 인자로 나열하세요 — 따옴표로 묶어 한 덩어리로 만들면 안 됩니다.' },
      { en: './mkconf.sh dev stage prod', ko: './mkconf.sh dev stage prod' },
    ],
    check: (ctx) =>
      safeRead(ctx.fs, `${HOME}/dev.conf`) === 'environment=dev\n' &&
      safeRead(ctx.fs, `${HOME}/stage.conf`) === 'environment=stage\n' &&
      safeRead(ctx.fs, `${HOME}/prod.conf`) === 'environment=prod\n',
    solution: './mkconf.sh dev stage prod',
    wrongAnswer: './mkconf.sh "dev stage prod"',
    explanation:
      { en: 'Quote them into one chunk, as in ./mkconf.sh "dev stage prod", and the three names become a single argument, spaces and all, so the for ... in "$@" loop in the script runs only once and makes just one file named "dev stage prod.conf" — dev.conf, stage.conf, and prod.conf never appear. Pass them without quotes, as ./mkconf.sh dev stage prod, and "$@" splits into three arguments, looping per name to make each of the three config files.', ko: './mkconf.sh "dev stage prod" 처럼 따옴표로 묶으면 세 이름이 공백째로 인자 하나가 되어, 스크립트의 for ... in "$@" 루프가 한 번만 돌며 "dev stage prod.conf" 라는 파일 하나만 만듭니다 — dev.conf·stage.conf·prod.conf 는 생기지 않습니다. 따옴표 없이 ./mkconf.sh dev stage prod 로 넘겨야 "$@" 가 세 인자로 나뉘어, 이름마다 반복하며 세 설정 파일을 각각 만듭니다.' },
  },
  {
    id: 'l6-10',
    level: 6,
    title: { en: 'Write Your Own Job Script', ko: '직접 짜는 작업 스크립트' },
    prompt:
      { en: 'Save a repetitive task as a script. Using echo, write the commands into a job.sh file — authoring the script yourself — so that running it creates the three files file1, file2, and file3. Then run that script to actually create the three files.', ko: '반복 작업을 스크립트로 남기세요. echo 로 명령을 job.sh 파일에 써넣어, 실행하면 file1, file2, file3 세 파일을 만드는 스크립트를 직접 작성하세요. 그리고 그 스크립트를 실행해 세 파일을 실제로 만드세요.' },
    setup: () => {},
    hints: [
      { en: 'Wrap the commands wholesale in single quotes and write them to the file with echo, and the $variables and semicolons inside are not run now but stored to the file verbatim — execution happens later, when you run that file.', ko: '명령을 작은따옴표로 통째로 감싸 echo 로 파일에 쓰면, 안의 $변수나 세미콜론이 지금 실행되지 않고 글자 그대로 파일에 저장됩니다 — 실행은 나중에 그 파일을 돌릴 때 일어납니다.' },
      { en: "After making the script with echo 'commands' > job.sh, the file you just made has no execute permission, so load and run it in the current shell with source job.sh.", ko: "echo '명령들' > job.sh 로 스크립트를 만든 뒤, 방금 만든 파일엔 실행 권한이 없으니 source job.sh 로 지금 셸에서 불러 실행합니다." },
      { en: "echo 'for n in 1 2 3; do touch file$n; done' > job.sh; source job.sh", ko: "echo 'for n in 1 2 3; do touch file$n; done' > job.sh; source job.sh" },
    ],
    // job.sh 존재까지 요구한다 — 이 문제의 핵심이 "스크립트를 작성해서" 만드는 것이라,
    // touch file1 file2 file3 처럼 스크립트 없이 결과만 만드는 우회를 막는다. 내용은
    // 강제하지 않는다(루프든 touch 나열이든, 스크립트로 만들었다면 유효한 풀이다).
    check: (ctx) =>
      ctx.fs.exists(`${HOME}/job.sh`) &&
      ctx.fs.exists(`${HOME}/file1`) && ctx.fs.exists(`${HOME}/file2`) && ctx.fs.exists(`${HOME}/file3`),
    solution: "echo 'for n in 1 2 3; do touch file$n; done' > job.sh\nsource job.sh",
    wrongAnswer: "echo 'for n in 1 2 3; do touch file$n; done' > job.sh",
    explanation:
      { en: "echo 'for n in 1 2 3; do touch file$n; done' > job.sh merely stores the command verbatim into job.sh and does not run it yet — so this line alone does not create file1 through file3. Because it is wrapped in single quotes, the $n and the semicolon are not interpreted now but land in the file as they are, and only when you then load and run that file with source job.sh does the loop finally run and make the three files.", ko: "echo 'for n in 1 2 3; do touch file$n; done' > job.sh 는 명령을 job.sh 에 글자 그대로 저장할 뿐, 아직 실행하지는 않습니다 — 그래서 이 줄만으로는 file1~file3 가 생기지 않습니다. 작은따옴표로 감쌌기 때문에 $n 이나 세미콜론이 지금 해석되지 않고 그대로 파일에 담기고, 이어서 source job.sh 로 그 파일을 불러 실행해야 비로소 루프가 돌아 세 파일이 만들어집니다." },
  },
]
