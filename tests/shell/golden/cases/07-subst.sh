echo $(echo nested)
echo "$(cat a.txt)"
X=$(cat fruit.txt | wc -l)
echo $X
echo $(echo a; echo b)
