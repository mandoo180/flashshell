import { test, expect, type Page, type Locator } from '@playwright/test'

// l1-01(첫 접속): cat readme.txt / l1-02(숨겨진 것): cat .keycard / l1-03(금고로): cd vault
// — 정답은 src/game/problems/l1.ts 의 solution 필드 그대로.

async function freshStart(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

async function enterLevel1(page: Page) {
  await page.getByRole('button', { name: /LEVEL 1/ }).click()
}

/** 정답을 제출하고 해설 시트가 뜨는 것까지 확인한 뒤, 그 시트 로케이터를 돌려준다. */
async function submitAndGetSheet(page: Page, command: string): Promise<Locator> {
  const input = page.getByRole('textbox')
  await input.fill(command)
  await input.press('Enter')
  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()
  return sheet
}

async function clickNext(sheet: Locator) {
  await sheet.getByRole('button', { name: 'NEXT ▸' }).click()
}

/** ① 이어하기의 준비 단계: l1-01, l1-02 를 풀어 l1-03(프런티어)에 서 있는 상태로 만든다. */
async function solveFirstTwoProblems(page: Page) {
  await enterLevel1(page)
  await expect(page.getByText('첫 접속')).toBeVisible()

  const sheet1 = await submitAndGetSheet(page, 'cat readme.txt')
  await clickNext(sheet1)
  await expect(page.getByText('숨겨진 것')).toBeVisible()

  const sheet2 = await submitAndGetSheet(page, 'cat .keycard')
  await clickNext(sheet2)
  await expect(page.getByText('금고로')).toBeVisible()
}

test('① 이어하기: 두 문제를 풀고 레벨을 나갔다 재진입하면 프런티어(3번)에 착지한다', async ({ page }) => {
  await freshStart(page)
  await solveFirstTwoProblems(page)

  await page.getByRole('button', { name: '← LEVELS' }).click()
  await enterLevel1(page)
  await expect(page.getByText('금고로')).toBeVisible()
})

test('② 뒤로/앞으로: 이전 문제는 SOLVED 배지를 보여주고, 다음 문제는 프런티어에서 막힌다', async ({ page }) => {
  await freshStart(page)
  await solveFirstTwoProblems(page)

  await page.getByRole('button', { name: '이전 문제' }).click()
  await expect(page.getByText('숨겨진 것')).toBeVisible()
  await expect(page.getByText('✓ SOLVED')).toBeVisible()

  await page.getByRole('button', { name: '다음 문제' }).click()
  await expect(page.getByText('금고로')).toBeVisible()
  await expect(page.getByRole('button', { name: '다음 문제' })).toBeDisabled()
})

test('③ 리셋: 파일을 지운 뒤 RESET 하면 터미널이 비고 초기 파일이 복원된다', async ({ page }) => {
  await freshStart(page)
  await enterLevel1(page)
  await expect(page.getByText('첫 접속')).toBeVisible()

  const input = page.getByRole('textbox')
  await input.fill('rm readme.txt')
  await input.press('Enter')
  await expect(page.getByText('rm readme.txt')).toBeVisible()

  await input.fill('ls')
  await input.press('Enter')
  await expect(page.getByText('readme.txt', { exact: true })).toHaveCount(0) // 지워졌다 — 상태가 실제로 망가졌음을 확인

  await page.getByRole('button', { name: 'RESET', exact: true }).click()
  await expect(page.getByText('rm readme.txt')).toBeHidden() // 터미널 클리어

  await input.fill('ls')
  await input.press('Enter')
  await expect(page.getByText('readme.txt', { exact: true })).toBeVisible() // 초기 파일 복원
})

test('④ 재플레이 멱등 + 시트 열린 채 이동: 다시 풀면 시트가 다시 뜨고, 그 상태로 다음 문제를 누르면 자동 소멸 + 3번으로 전환된다', async ({ page }) => {
  await freshStart(page)
  await solveFirstTwoProblems(page)

  await page.getByRole('button', { name: '이전 문제' }).click()
  await expect(page.getByText('숨겨진 것')).toBeVisible()

  // 이미 푼 문제를 다시 정답 제출 — 재풀이 멱등: 해설 시트가 다시 뜬다.
  const input = page.getByRole('textbox')
  await input.fill('cat .keycard')
  await input.press('Enter')
  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()

  // 시트가 열린 채로 HUD의 다음 문제 클릭 — 시트가 HUD를 가려 이 클릭을 가로채면
  // Playwright의 actionability 체크가 여기서 그대로 실패한다(z-index/레이아웃 결함).
  await page.getByRole('button', { name: '다음 문제' }).click()

  await expect(sheet).toBeHidden() // 자동 소멸(status: playing 으로 파생 전환)
  await expect(page.getByText('금고로')).toBeVisible()
})
