import urllib.request
import json

base = 'https://cuscuz-med.onrender.com/api'

# First login to get token
def login(username="testerender123"):
    req = urllib.request.Request(f'{base}/auth/login', 
        data=json.dumps({"username": username, "password": "081092@Al"}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r: 
        data = json.loads(r.read().decode())
        return data.get('token')

token = login()
print("Token:", token[:20] + "...")

# Test apostila endpoint with a known file ID
# We need a real file ID from the user's drive
# Let's test the endpoint without a valid ID first
test_ids = ["1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7", "test"]

for test_id in test_ids:
    req = urllib.request.Request(f'{base}/apostila/html/{test_id}', 
        headers={'Authorization': f'Bearer {token}'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=30) as r: 
            content_type = r.headers.get('Content-Type')
            content = r.read()[:200]
            print(f"\nTest ID: {test_id}")
            print(f"Status: {r.status}")
            print(f"Content-Type: {content_type}")
            print(f"Preview: {content}")
    except urllib.error.HTTPError as e:
        print(f"\nTest ID: {test_id} - ERROR {e.code}:", e.read().decode()[:200])
    except Exception as e:
        print(f"\nTest ID: {test_id} - EXCEPTION:", str(e))