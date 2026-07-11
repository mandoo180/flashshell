# read -a(줄 → 배열, M3 Part 4 task 2).
echo 'a b c' > f; read -a arr < f; echo "${#arr[@]}"; echo "${arr[1]}"
