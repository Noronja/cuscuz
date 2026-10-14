import json
import urllib.request
import time

def test_signup(username="alexmed2026b"):
    url = 'http://127.0.0.1:3000/api/auth/signup'
    data = json.dumps({"username": username, "password": "081092@Al", "displayName": "Alex Lima"}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("SIGNUP:", json.dumps(result, indent=2))
            return result.get('token')
    except urllib.error.HTTPError as e:
        print(f"SIGNUP ERROR {e.code}:", e.read().decode('utf-8'))
        return None
    except Exception as e:
        print(f"SIGNUP EXCEPTION:", str(e))
        return None

def test_login(username="alexmed2026b"):
    url = 'http://127.0.0.1:3000/api/auth/login'
    data = json.dumps({"username": username, "password": "081092@Al"}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("LOGIN:", json.dumps(result, indent=2))
            return result.get('token')
    except urllib.error.HTTPError as e:
        print(f"LOGIN ERROR {e.code}:", e.read().decode('utf-8'))
        return None
    except Exception as e:
        print(f"LOGIN EXCEPTION:", str(e))
        return None

def test_me(token):
    url = 'http://127.0.0.1:3000/api/auth/me'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("ME:", json.dumps(result, indent=2))
    except urllib.error.HTTPError as e:
        print(f"ME ERROR {e.code}:", e.read().decode('utf-8'))
    except Exception as e:
        print(f"ME EXCEPTION:", str(e))

def test_check_username(username="novousuario123"):
    url = f'http://127.0.0.1:3000/api/auth/check-username?username={username}'
    req = urllib.request.Request(url, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.loads(response.read().decode('utf-8'))
            print("CHECK USERNAME:", json.dumps(result, indent=2))
    except urllib.error.HTTPError as e:
        print(f"CHECK ERROR {e.code}:", e.read().decode('utf-8'))
    except Exception as e:
        print(f"CHECK EXCEPTION:", str(e))

if __name__ == '__main__':
    print("=== Testing Multi-User Auth ===\n")
    test_check_username("novousuario123")
    print()
    token = test_signup("novousuario123")
    print()
    if token:
        token = test_login("novousuario123")
        print()
        if token:
            test_me(token)