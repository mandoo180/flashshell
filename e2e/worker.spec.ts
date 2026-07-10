import { test, expect } from '@playwright/test'
import { EXEC_DEADLINE_MS } from '../src/ui/worker-session'

test('워커 경로 정상: l1-01을 풀면 해설 시트가 뜬다', async ({ page }) => {
  // Task 9 이후 스토어는 항상 WorkerShellSession(진짜 Worker)을 통해 셸을 돌린다.
  // 워커 배선 자체가 깨지지 않았는지부터 확인한다 — 아래 ReDoS 테스트가 뭔가
  // 이상해도, 이 테스트가 초록이면 최소한 "정상 경로"는 살아있다는 뜻이다.
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await expect(page.getByText('첫 접속')).toBeVisible()

  await page.getByRole('textbox').fill('cat readme.txt')
  await page.getByRole('textbox').press('Enter')

  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('cat readme.txt')).toBeVisible()
})

test('grep ReDoS 가 탭을 얼리지 않고, 데드라인 뒤 정상 복구된다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await expect(page.getByText('첫 접속')).toBeVisible()

  const input = page.getByRole('textbox')
  async function run(line: string) {
    await input.fill(line)
    await input.press('Enter')
  }

  // 제어문(반복문) 없이, cp + cat 리다이렉션만으로 파일을 지수적으로 두 배씩
  // 키운다 — echo -n 으로 후행 개행을 두지 않아야 이후 doubling 이 "줄 하나"를
  // 유지한다(개행이 섞이면 grep 이 줄 단위로 쪼개 각 줄이 짧아져 버려서 폭주하지
  // 않는다). `cat x x2 > x` 처럼 자기 자신을 다시 쓰면 안 된다 — 이 셸은 `>`
  // 리다이렉션을 명령 실행 "전에" 대상 파일을 비운다(진짜 bash와 동일한 open()
  // 순서, interpreter.ts 4~6단계 참고). 그래서 항상 안전한 사본(x2)에서 읽어
  // x 에 쓴다: `cp x x2; cat x2 x2 > x`.
  await run('echo -n aaaaaaaaaa > x') // x = 'a' * 10, 개행 없음

  const DOUBLINGS = 13 // 10 * 2^13 = 81920자 — ReDoS 를 일으키기에 충분하고도 남는다
  for (let i = 0; i < DOUBLINGS; i++) {
    await run('cp x x2')
    await run('cat x2 x2 > x')
  }

  await run('wc -c x')
  await expect(page.getByText(/81920 x/)).toBeVisible()

  // `(a*)*$` 는 이 셸의 grep 이 그대로 JS RegExp 로 컴파일한다(ReDoS 방어 없음).
  // 다만 "전부 a인 줄"만으로는 이 패턴이 폭주하지 않는다 — `(a*)*` 는 첫 시도에서
  // 바로 줄 전체를 욕심껏 삼키고 `$` 가 곧장 성공해, 어떤 백트래킹도 필요 없다
  // (직접 검증: `/(a*)*$/.test('a'.repeat(30000))` 는 V8에서 0ms). 파국적
  // 백트래킹은 시작 위치에서의 매치가 "실패"할 때만 벌어진다(모든 분할을
  // 소진해야 실패를 확정할 수 있으므로) — 그래서 정규식이 절대 소비할 수 없는
  // 문자 하나를 끝에 붙여, 앵커링된 매치가 정말로 실패하게 만든다(브리프가 말한
  // "매치 실패로 파국적 백트래킹"이 실제로 일어나게 하는 조건). 직접 검증:
  // `/(a*)*$/.test('a'.repeat(30) + 'b')` 는 로컬 Node/V8 에서 26초가 넘게 걸렸다.
  await run('echo -n b >> x')

  const submittedAt = Date.now()
  await run(`grep '(a*)*$' x`)

  // 탭이 얼지 않았다는 걸 직접 잰다: 워커가 폭주 중인 동안(데드라인이 아직
  // 지나기 전) 메인 스레드에서 실행되는 evaluate() 의 왕복 시간을 잰다. 메인
  // 스레드가 막혀 있었다면 이 evaluate 자체가 지연됐을 것이다 — 실제로는 grep
  // 이 별도 Worker 스레드에서 도므로 메인 스레드는 자유롭다.
  await page.waitForTimeout(300) // 워커가 확실히 계산 중인 시점(데드라인 전)
  const rtStart = Date.now()
  await page.evaluate(() => 1 + 1)
  expect(Date.now() - rtStart).toBeLessThan(1000)

  // 입력창도 여전히 조작 가능해야 한다 — disabled 는 solved 일 때만 켜진다.
  await expect(input).toBeEnabled()

  // 데드라인(EXEC_DEADLINE_MS)이 지나면 워커가 죽고, 그 사실을 알리는 줄이 뜬다.
  await expect(page.getByText(/실행 한도 초과/)).toBeVisible({ timeout: EXEC_DEADLINE_MS + 4000 })
  const recoveredAt = Date.now() - submittedAt
  expect(recoveredAt).toBeGreaterThanOrEqual(EXEC_DEADLINE_MS)

  // 복구: 새 워커가 히스토리를 리플레이했으므로(폭주한 grep 줄은 제외) 바로 다음
  // 명령이 멀쩡하게 동작해야 한다.
  await run('pwd')
  await expect(page.getByText('/home/player', { exact: true })).toBeVisible()

  await run('ls')
  await expect(page.getByText('readme.txt', { exact: true })).toBeVisible()
})
