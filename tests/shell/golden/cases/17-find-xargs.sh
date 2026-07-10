find tree -name "*.txt" | sort
find tree -type d | sort
find tree -type f | sort
find tree | sort
find tree -name "*.txt" | sort | xargs cat
find tree -name "one.txt" -exec cat {} \;
cat adj.txt | xargs echo
cat nums.txt | xargs -I{} echo got:{}
