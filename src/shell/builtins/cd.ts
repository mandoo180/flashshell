import type { CommandFn } from '../types'
import { ok, fail } from '../types'
import { VfsError, errnoText } from '../errors'

export const cd: CommandFn = ({ args, fs, state }) => {
  const raw = args[0]
  let target: string

  if (raw === undefined) target = state.home
  else if (raw === '-') target = state.oldPwd
  else target = fs.resolve(raw, state.cwd)

  const label = raw ?? target
  if (!fs.exists(target)) return fail(`cd: ${label}: ${errnoText(new VfsError('ENOENT', target))}\n`)
  if (!fs.isDir(target)) return fail(`cd: ${label}: ${errnoText(new VfsError('ENOTDIR', target))}\n`)

  // oldPwd는 반드시 "옮기기 전" cwd를 가리켜야 한다 — 그래야 `cd -`를 연달아
  // 호출했을 때 마지막 두 디렉터리 사이를 오갈 수 있다. 여기서 순서를 바꾸면
  // (cwd를 먼저 옮긴 뒤 oldPwd를 갱신하면) `cd -`가 제자리에서 멈춘다.
  state.oldPwd = state.cwd
  state.cwd = target
  state.env.PWD = target
  // `cd -` 만 새 경로를 출력한다. 진짜 bash가 그렇다.
  return ok(raw === '-' ? `${target}\n` : '')
}
