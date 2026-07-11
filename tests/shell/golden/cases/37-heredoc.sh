# GOLDEN: whole-file
# here-document (M3 Part 4 task 5): <<EOF(확장), <<-EOF(선행 TAB 제거), <<'EOF'(리터럴, 무확장).
cat <<EOF
line one
two
EOF
x=hi
cat <<EOF
val=$x
EOF
cat <<'EOF'
literal=$x
EOF
cat <<-DONE
	indented
	tabs stripped
DONE
