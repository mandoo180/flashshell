# 복합 명령 리다이렉션 (M3 Part 3 task 5): for/while/if/case/{ }/( ) 뒤 redir.
# 각 복합 명령은 한 물리 줄에 둔다(골든 하니스가 줄 단위로 실행하므로).
for i in a b c; do echo $i; done > cr_for.txt
cat cr_for.txt
while false; do echo x; done > cr_while.txt
cat cr_while.txt
if true; then echo hi; fi > cr_if.txt
cat cr_if.txt
if false; then echo a; else echo b; fi > cr_ifelse.txt
cat cr_ifelse.txt
case x in x) echo matched;; esac > cr_case.txt
cat cr_case.txt
{ echo a; echo b; } > cr_group.txt
cat cr_group.txt
( echo sub ) > cr_sub.txt
cat cr_sub.txt
for i in 1 2; do echo $i; done >> cr_app.txt
for i in 1 2; do echo $i; done >> cr_app.txt
cat cr_app.txt
for i in a; do echo $i; done > cr_o.txt 2> cr_e.txt
cat cr_o.txt
echo hello > cr_in.txt
if true; then cat; fi < cr_in.txt
{ cat; } < cr_in.txt
( cat ) < cr_in.txt
