mkdir -p project/src
mkdir -p project/docs
mkdir -p empty
echo 'alpha' > a.txt
echo 'beta' > b.txt
echo 'one' > project/src/one.txt
echo 'two' > project/src/two.txt
echo 'note' > project/docs/note.md
printf 'banana\napple\ncherry\napple\n' > fruit.txt
printf '10\n9\n100\n' > nums.txt
printf 'Hello\nhello\nWORLD\n' > mixed.txt
mkdir -p tree/sub
printf 'alice 30\nbob 25\ncarol 35\n' > pairs.txt
printf 'a:b:c\nd:e:f\n' > colon.txt
printf 'a\na\nb\nc\nc\n' > adj.txt
printf '1\n' > tree/one.txt
printf '2\n' > tree/two.log
printf '3\n' > tree/sub/three.txt
printf 'hello\nworld\n' > diffA.txt
printf 'hello\nworld\n' > diffB.txt
printf 'hello\nWORLD\n' > diffC.txt
printf 'x=5\ny=hello\n' > conf.sh
printf '#!/bin/bash\necho hello from script\n' > greet.sh
chmod +x greet.sh
