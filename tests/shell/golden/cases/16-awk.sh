awk '{print $1}' pairs.txt
awk '{s+=$2} END{print s}' pairs.txt
awk -F: '{print $2}' colon.txt
awk '/bob/{print}' pairs.txt
awk '$2>28{print $1}' pairs.txt
