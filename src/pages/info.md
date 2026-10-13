


curl -s -X POST "https://titaniumhut.com/api/pay/create-checkout.php" \
  -H "Content-Type: application/json" \
  -d '{"domain":"example.com","price":1299}' > resp.json

python3 - <<'PY'
import json
d=json.load(open("resp.json"))
print("id:", d.get("id"))
print("url:", d.get("url"))
PY
