import urllib.request
import json

base = 'https://cuscuz-med.onrender.com/api'

def login(username="testerender123"):
    req = urllib.request.Request(f'{base}/auth/login', 
        data=json.dumps({"username": username, "password": "081092@Al"}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r: 
        data = json.loads(r.read().decode())
        return data.get('token')

token = login()
print("Token:", token[:20] + "...")

# Test media ticket endpoint for PDF
req = urllib.request.Request(f'{base}/media/ticket', 
    data=json.dumps({"id": "1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7", "kind": "p"}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'}, method='POST')
try:
    with urllib.request.urlopen(req, timeout=30) as r: 
        data = json.loads(r.read().decode())
        print("Media ticket:", data)
except urllib.error.HTTPError as e:
    print(f"Media ticket ERROR {e.code}:", e.read().decode()[:500])
except Exception as e:
    print(f"Media ticket EXCEPTION:", str(e))

# Test direct PDF endpoint
req = urllib.request.Request(f'{base}/drive/pdf/1pVd7V_pfyM4Vw20yfw45jBmNFqtKTHK7', 
    headers={'Authorization': f'Bearer {token}'}, method='GET')
try:
    with urllib.request.urlopen(req, timeout=30) as r: 
        print(f"\nDirect PDF - Status: {r.status}")
        print(f"Content-Type: {r.headers.get('Content-Type')}")
except urllib.error.HTTPError as e:
    print(f"\nDirect PDF ERROR {e.code}:", e.read().decode()[:500])
except Exception as e:
    print(f"\nDirect PDF EXCEPTION:", str(e))