echo $((2**10))
echo $((10/3))
echo $(( (2+3) * 4 ))
echo $((7 % 3))
x=5; echo $((x + 1))
i=0; while [ $i -lt 3 ]; do echo $i; i=$((i+1)); done
(( 2 > 1 )) && echo arith-true
(( 0 )) || echo arith-false
