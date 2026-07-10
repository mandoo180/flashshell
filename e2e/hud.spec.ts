import { test, expect, type Page } from '@playwright/test'

// l1-01(힌트 2개)로 들어가 힌트를 둘 다 펼친다 — HUD가 가장 크게 자란 상태.
async function enterLevel1AndExpandAllHints(page: Page) {
  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await expect(page.getByText('첫 접속')).toBeVisible()

  const hintButton = page.getByRole('button', { name: /HINT/ })
  await hintButton.click() // 힌트 1/2
  await expect(hintButton).toHaveText('HINT 2/2')
  await hintButton.click() // 힌트 2/2 — 이후 버튼은 사라진다
  await expect(hintButton).toBeHidden()
}

// 기하학적 비겹침: HUD 하단이 입력창 상단보다 위(또는 같은 지점)여야 한다.
async function expectHudClearsInput(page: Page) {
  const hudBox = await page.locator('.hud').boundingBox()
  const inputBox = await page.getByRole('textbox').boundingBox()
  expect(hudBox).not.toBeNull()
  expect(inputBox).not.toBeNull()
  expect(hudBox!.y + hudBox!.height).toBeLessThanOrEqual(inputBox!.y)
}

// Task 12 (M1 최종 리뷰 Important 결함): 375px 폭에서는 한국어 prompt가
// 줄바꿈되고, 힌트를 펼치면 HUD가 더 자라 예전의 고정 `padding-top: 11rem`
// 예산을 넘어 입력 줄(과 그 위 출력)을 덮었다. HudCard가 ResizeObserver로
// 실측한 높이를 `--hud-height`에 쓰고 `.terminal`이 그 값을 따라가는지,
// 힌트를 둘 다 펼친(HUD가 가장 큰) 상태에서도 입력창이 클릭·타이핑 가능한지
// 직접 확인한다.
test('375px 좁은 화면에서 힌트를 다 펼쳐도 HUD가 입력 줄을 덮지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 })

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await enterLevel1AndExpandAllHints(page)
  await expectHudClearsInput(page)

  // HUD가 가장 크게 자란(힌트 2개 모두 펼쳐진) 바로 이 순간을 찍는다 — 입력
  // 줄이 여전히 화면에 드러나 있는지 눈으로도 확인할 수 있게.
  await page.screenshot({ path: '.superpowers/sdd/m2-hud-375.png' })

  // 실제 조작 가능성: Playwright의 click()은 다른 요소가 그 지점의 포인터
  // 이벤트를 가로채면(=덮여 있으면) actionability 체크에서 실패한다. 클릭 +
  // 타이핑 + 엔터가 실제로 명령을 실행시키는지까지 끝까지 확인한다.
  const input = page.getByRole('textbox')
  await input.click()
  await input.fill('cat readme.txt')
  await expect(input).toHaveValue('cat readme.txt')
  await input.press('Enter')

  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()
})

// 접근성 텍스트 확대 회귀: 루트 글꼴을 키우면 rem 기반인 .hud 의 top/padding 도
// 함께 커진다. `--hud-height` 를 실측 픽셀(offsetTop+offsetHeight)로 재므로 이를
// 자동 반영해야 한다. (옛 방식의 고정 px 여백 보정이라면 여기서 ~20px 과소 예약해
// 375px + 큰 글꼴에서 HUD 가 입력을 다시 덮었다 — 이 테스트가 그 회귀를 잡는다.)
test('375px + 큰 루트 글꼴에서도 HUD가 입력 줄을 덮지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 })

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  // 브라우저 기본 글꼴 크기를 키우는 상황(전체 확대와 별개인 접근성 설정)을 재현.
  await page.evaluate(() => { document.documentElement.style.fontSize = '24px' })

  await enterLevel1AndExpandAllHints(page)
  await expectHudClearsInput(page)
})
