cut -d: -f1 colon.txt
cut -d: -f2,3 colon.txt
cut -c1-3 colon.txt
cat pairs.txt | tr 'a-z' 'A-Z'
cat colon.txt | tr ':' '-'
uniq adj.txt
uniq -c adj.txt
uniq -d adj.txt
uniq -u adj.txt
