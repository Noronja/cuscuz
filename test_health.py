import urllib.request
import json
import time
import subprocess
import sys

# Start server
server_process = subprocess.Popen([sys.executable, '-c', 'import os; os.system("node server.js")'], 
                                  cwd='C:/Users/alexl/Downloads/Compressed/cuscuzi')

# Wait for server to start
time.sleep(4)

try:
    # Test health
    req = urllib.request.Request('http://127.0.0.1:3000/api/health', method='GET')
    with urllib.request.urlopen(req, timeout=5) as response:
        result = json.loads(response.read().decode('utf-8'))
        print("HEALTH:", json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    print(f"HEALTH ERROR {e.code}:", e.read().decode('utf-8'))
except Exception as e:
    print(f"HEALTH EXCEPTION:", str(e))
finally:
    server_process.terminate()