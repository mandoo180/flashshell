#!/usr/bin/env bash
# 진짜 bash(데비안, GNU coreutils)로 기대 출력을 생성한다.
# 결과는 커밋된다. 테스트를 돌리는 데는 Docker가 필요 없다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GOLDEN="$ROOT/tests/shell/golden"
IMAGE="debian:stable-slim"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker가 필요합니다. .expected 파일은 이미 커밋되어 있으니, 테스트만 돌릴 거면 이 스크립트는 필요 없습니다." >&2
  exit 1
fi

mkdir -p "$GOLDEN/expected"

for case_file in "$GOLDEN"/cases/*.sh; do
  name="$(basename "$case_file" .sh)"
  echo "generating $name"

  docker run --rm -i \
    -v "$GOLDEN/seed.sh:/golden/seed.sh:ro" \
    -v "$case_file:/golden/case.sh:ro" \
    "$IMAGE" \
    bash -c '
      set +e
      mkdir -p /work && cd /work
      bash /golden/seed.sh >/dev/null 2>&1
      # 주의: stdout 을 $(...) 로 캡처하면 안 된다 — 명령치환은 후행 개행을 전부
      # 벗겨내므로(몇 개든), 실제 출력이 개행으로 끝나는지 정보가 통째로 사라진다.
      # stderr 와 동일하게 파일로 리다이렉트해 바이트 그대로 보존한다.
      bash /golden/case.sh >/tmp/out 2>/tmp/err
      code=$?
      cat /tmp/out
      printf "\n===STDERR===\n"
      cat /tmp/err
      printf "===EXIT===\n%s\n" "$code"
    ' > "$GOLDEN/expected/$name.txt"
done

echo "완료. git diff 로 변화를 확인하세요."
