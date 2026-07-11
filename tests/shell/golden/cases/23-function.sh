greet() { echo hi $1; }; greet bob
add() { echo $1-$2; }; add foo bar
count3() { echo one; echo two; echo three; }; count3
usearg() { if [ -n "$1" ]; then echo got:$1; else echo empty; fi; }; usearg; usearg x
exitfn() { return 7; }; exitfn; echo code=$?
