if false; then echo a; elif true; then echo b; else echo c; fi
if true; then echo a; elif true; then echo b; else echo c; fi
if false; then echo a; elif false; then echo b; else echo c; fi
if [ -f a.txt ]; then echo has-a; else echo no-a; fi
if [ -f nope.txt ]; then echo has-nope; else echo no-nope; fi
