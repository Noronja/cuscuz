import urllib.request
import json

url = 'https://cuscuz-med.onrender.com/api/health'
req = urllib.request.Request(url, method='GET')
try:
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.loads(response.read().decode('utf-8'))
        print("HEALTH:", json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    print(f"HEALTH ERROR {e.code}:", e.read().decode('utf-8'))
except Exception as e:
    print(f"HEALTH EXCEPTION:", str(e))