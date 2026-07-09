import { test, expect } from '@playwright/test'

test('한 문제를 실제 브라우저에서 푼다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await expect(page.getByText('FLASHSHELL')).toBeVisible()

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await expect(page.getByText('첫 접속')).toBeVisible()

  await page.getByRole('textbox').fill('cat readme.txt')
  await page.getByRole('textbox').press('Enter')

  const sheet = page.getByRole('dialog', { name: '해설' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('cat readme.txt')).toBeVisible()

  await sheet.getByRole('button', { name: 'NEXT ▸' }).click()
  await expect(page.getByText('숨겨진 것')).toBeVisible()
})

test('진행도가 새로고침을 넘어 살아남는다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: /LEVEL 1/ }).click()
  await page.getByRole('textbox').fill('cat readme.txt')
  await page.getByRole('textbox').press('Enter')
  await expect(page.getByRole('dialog', { name: '해설' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('button', { name: /LEVEL 1/ })).toContainText('1/10')
})
