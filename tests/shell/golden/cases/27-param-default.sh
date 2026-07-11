NAME=world
echo ${#NAME}
echo ${UNSET:-fallback}
echo ${NAME:-fallback}
EMPTY=
echo ${EMPTY:-fb}
echo ${EMPTY-notsub}
echo ${NAME:+present}
echo ${UNSET:=assigned}
echo $UNSET
