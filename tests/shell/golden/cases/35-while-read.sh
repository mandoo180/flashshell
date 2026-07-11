# while/for read — 줄별 stdin 커서 (M3 Part 3 task 6).
# 각 루프는 한 물리 줄에 둔다(골든 하니스가 줄 단위로 실행하므로).
while read x; do echo "got:$x"; done < fruit.txt
while read a b; do echo "$a=$b"; done < pairs.txt
for i in 1 2; do read v; echo "line:$v"; done < nums.txt
for i in x y; do read z < fruit.txt; echo $z; done
while read; do echo "R=$REPLY"; done < nums.txt
