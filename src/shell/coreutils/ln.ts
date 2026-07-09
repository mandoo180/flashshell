import type { CommandFn } from '../types'
import { parseFlags, errnoText } from './shared'

export const ln: CommandFn = ({ args, fs, state }) => {
  const { flags, rest } = parseFlags(args)
  if (!flags.has('s')) {
    // task-11 trap 12: 하드 링크는 이 VFS 모델(트리 구조, 노드가 부모 하나만 가짐)로는
    // 표현할 수 없다. GNU 문구를 흉내 내지 않고 flashshell 고유의 정직한 한계 안내로
    // 대체한다(interpreter.ts 의 "이 환경에는 없는 명령입니다" 와 같은 톤).
    return { stdout: '', stderr: 'flashshell: ln: 하드 링크(hard links)는 이 환경에서 지원하지 않습니다 — -s 로 심볼릭 링크를 쓰세요.\n', exitCode: 1 }
  }
  const [target, linkName] = rest
  if (!target || !linkName) return { stdout: '', stderr: 'usage: ln -s TARGET LINK\n', exitCode: 1 }
  try {
    // task-11 trap 2: target 은 사용자가 입력한 그대로 저장해야 한다. 브리프 원본은
    // `fs.resolve(target, state.cwd)`로 절대경로로 바꿔서 저장했는데, 이러면 상대
    // target(`ln -s sub link`)이 항상 절대경로로 굳어버려 실제 `ln -s`와 다르게
    // 동작한다 — 링크를 다른 디렉터리로 옮기면 진짜 ln -s는(상대 target이므로)
    // 깨지거나 다른 곳을 가리키게 되는데 우리는 안 그런다. vfs.symlink()는 이미
    // target을 그대로 저장하고, 조회 시점(resolvePhysical)에 "링크가 실제로 놓인
    // 디렉터리" 기준으로 상대 target을 해석하도록 Task 6에서 고쳐졌으므로, 여기서는
    // target을 손대지 않고 그대로 넘기기만 하면 된다. linkName(링크를 만들 위치)만
    // 절대경로로 해석한다.
    fs.symlink(target, fs.resolve(linkName, state.cwd))
  } catch (e) {
    return { stdout: '', stderr: `ln: failed to create symbolic link '${linkName}': ${errnoText(e)}\n`, exitCode: 1 }
  }
  return { stdout: '', stderr: '', exitCode: 0 }
}
