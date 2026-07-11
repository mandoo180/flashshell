# read 빌트인 — 단일 라인, 단순명령 리다이렉션 (M3 Part 3 task 7).
# 각 read 는 한 물리 줄에 둔다(골든 하니스가 줄 단위로 실행하므로).
echo 'x y z' > f; read a b < f; echo "a=$a b=$b"
echo 'one two three' > g; read p q r < g; echo "$p|$q|$r"
echo '  padded   value  ' > h; read w < h; echo "[$w]"
echo hi > i; read < i; echo "REPLY=$REPLY"
