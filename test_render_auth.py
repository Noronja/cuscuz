import urllib.request
import json

base = 'https://cuscuz-med.onrender.com/api'

def test(username="testerender123"):
    # Check username
    req = urllib.request.Request(f'{base}/auth/check-username?username={username}')
    with urllib.request.urlopen(req, timeout=30) as r: 
        print("CHECK:", json.loads(r.read().decode()))
    
    # Signup
    req = urllib.request.Request(f'{base}/auth/signup', 
        data=json.dumps({"username": username, "password": "081092@Al", "displayName": "Teste Render"}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r: 
        data = json.loads(r.read().decode())
        print("SIGNUP:", data)
        token = data.get('token')
    
    # Login
    req = urllib.request.Request(f'{base}/auth/login', 
        data=json.dumps({"username": username, "password": "081092@Al"}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r: 
        data = json.loads(r.read().decode())
        print("LOGIN:", data)
        token = data.get('token')
    
    # Me
    req = urllib.request.Request(f'{base}/auth/me', headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req, timeout=30) as r: 
        print("ME:", json.loads(r.read().decode()))

if __name__ == '__main__':
    test()