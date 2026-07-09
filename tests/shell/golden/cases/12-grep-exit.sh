# A non-matching grep must exit 1, and it must be the LAST command so the
# fixture's exit code records it.
grep apple fruit.txt
grep -c zzz fruit.txt
grep zzz fruit.txt
