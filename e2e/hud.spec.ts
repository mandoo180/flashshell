import { test, expect } from '@playwright/test'

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

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await expect(page.getByText('첫 접속')).toBeVisible()

  // l1-01은 힌트가 두 개다(src/game/problems 참고) — 브리프가 명시한
  // "힌트 둘이면 224px" 최대 성장 시나리오를 그대로 재현한다.
  const hintButton = page.getByRole('button', { name: /HINT/ })
  await hintButton.click() // 힌트 1/2
  await expect(hintButton).toHaveText('HINT 2/2')
  await hintButton.click() // 힌트 2/2 — 이후 버튼은 사라진다
  await expect(hintButton).toBeHidden()

  const input = page.getByRole('textbox')
  const hud = page.locator('.hud')

  // 기하학적으로도 안 겹치는지: HUD 하단이 입력창 상단보다 위(또는 같은 지점)
  // 여야 한다.
  const hudBox = await hud.boundingBox()
  const inputBox = await input.boundingBox()
  expect(hudBox).not.toBeNull()
  expect(inputBox).not.toBeNull()
  expect(hudBox!.y + hudBox!.height).toBeLessThanOrEqual(inputBox!.y)

  // HUD가 가장 크게 자란(힌트 2개 모두 펼쳐진) 바로 이 순간을 찍는다 — 입력
  // 줄이 여전히 화면에 드러나 있는지 눈으로도 확인할 수 있게.
  await page.screenshot({ path: '.superpowers/sdd/m2-hud-375.png' })

  // 실제 조작 가능성: Playwright의 click()은 다른 요소가 그 지점의 포인터
  // 이벤트를 가로채면(=덮여 있으면) actionability 체크에서 실패한다. 클릭 +
  // 타이핑 + 엔터가 실제로 명령을 실행시키는지까지 끝까지 확인한다.
  await input.click()
  await input.fill('cat readme.txt')
  await expect(input).toHaveValue('cat readme.txt')
  await input.press('Enter')

  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()
})
