import json
import urllib.request

def test(username="testefinal123"):
    base = 'http://127.0.0.1:3000/api'
    
    # Check username
    req = urllib.request.Request(f'{base}/auth/check-username?username={username}')
    with urllib.request.urlopen(req) as r: print("CHECK:", json.loads(r.read().decode()))
    
    # Signup
    req = urllib.request.Request(f'{base}/auth/signup', 
        data=json.dumps({"username": username, "password": "081092@Al", "displayName": "Teste Final"}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req) as r: 
        data = json.loads(r.read().decode())
        print("SIGNUP:", data)
        token = data.get('token')
    
    # Login
    req = urllib.request.Request(f'{base}/auth/login', 
        data=json.dumps({"username": username, "password": "081092@Al"}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req) as r: 
        data = json.loads(r.read().decode())
        print("LOGIN:", data)
        token = data.get('token')
    
    # Me
    req = urllib.request.Request(f'{base}/auth/me', headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as r: print("ME:", json.loads(r.read().decode()))

if __name__ == '__main__':
    test()