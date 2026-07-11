touch flag
while [ -f flag ]; do echo tick; rm flag; done
touch flag1 flag2 flag3
while [ -f flag3 ]; do echo tick; if [ -f flag1 ]; then rm flag1; elif [ -f flag2 ]; then rm flag2; else rm flag3; fi; done
mkdir until_dir
until [ ! -d until_dir ]; do echo utick; rmdir until_dir; done
