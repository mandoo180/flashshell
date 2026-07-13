import { test, expect } from '@playwright/test'

// L6 해금 조건(progress.ts의 isLevelUnlocked)은 재귀적이다: 레벨 6을 열려면 레벨
// 5가 열려 있어야 하고, 레벨 5가 열리려면 레벨 4가 열려 있어야 하고 ... 결국 L1~L5
// 전부 각각 8문제 이상 풀어야 한다. L5만 8개 채워서는(L1~L4가 비어 있으면) 부족하다.
function seededProgress(): { solved: string[]; hintsUsed: string[] } {
  const solved: string[] = []
  for (const level of [1, 2, 3, 4, 5]) {
    for (let i = 1; i <= 8; i++) {
      solved.push(`l${level}-${String(i).padStart(2, '0')}`)
    }
  }
  return { solved, hintsUsed: [] }
}

test('L6 해금: L1~L5 각 8문제 이상 풀면 LEVEL 6 이 열리고 자동화 첫 문제로 진입한다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  // 기존 핀(빈 progress면 LEVEL 6이 LOCKED)이 실브라우저에서도 유지되는지 — 값
  // 하나하나(자동화/COMING SOON 아님/LOCKED 문구)는 LevelSelect.test.tsx가 이미
  // 촘촘히 박아 두었으므로, 여기서는 e2e 관점에서 중요한 한 가지(disabled)만
  // 가볍게 재확인하고 곧장 해금 시나리오로 넘어간다.
  await expect(page.getByRole('button', { name: /LEVEL 6/ })).toBeDisabled()

  await page.evaluate((progress) => {
    localStorage.setItem('flashshell.progress.v1', JSON.stringify(progress))
  }, seededProgress())
  await page.reload()

  const level6 = page.getByRole('button', { name: /LEVEL 6/ })
  await expect(level6).toBeEnabled()
  await expect(level6).toContainText('자동화')
  await expect(level6).toContainText('0/10')

  await level6.click()
  await expect(page.getByText('서버 명단 배열')).toBeVisible() // l6-01 타이틀
})
