f=archive.tar.gz
echo ${f%.gz}
echo ${f%%.*}
echo ${f#*.}
echo ${f##*.}
p=/usr/local/bin
echo ${p##*/}
echo ${p%/*}
