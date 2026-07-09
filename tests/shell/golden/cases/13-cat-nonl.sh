# A file with no trailing newline must round-trip without one.
echo -n 'no-trailing-newline' > nonl.txt
cat nonl.txt
wc -l nonl.txt
wc -c nonl.txt
cat nonl.txt a.txt
