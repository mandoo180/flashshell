sed 's/o/0/' pairs.txt
sed 's/a/A/g' pairs.txt
sed -n '2p' pairs.txt
sed -n '/bob/p' pairs.txt
sed '2d' pairs.txt
sed '/carol/d' pairs.txt
