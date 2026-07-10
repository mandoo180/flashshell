diff -q diffA.txt diffB.txt
echo $?
diff -q diffA.txt diffC.txt
echo $?
diff -q diffA.txt diff-missing.txt
echo $?
