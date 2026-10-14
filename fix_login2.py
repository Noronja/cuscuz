with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the exact doLogin function
import re
pattern = r'(async function doLogin\(\{.*?\}catch\(_\)\{\}\})'
match = re.search(pattern, content, re.DOTALL)

if match:
    old_func = match.group(1)
    print(f"Found function length: {len(old_func)}")
    print("First 200 chars:", repr(old_func[:200]))
    
    # Build new function - replace the body
    new_func = """async function doLogin(){const u=cleanStr($('login-user').value.trim()),p=$('login-pass').value;
  const err=$('login-error');
  if(!u||!p){err.textContent='Informe usu\u00e1rio e senha';err.style.display='block';return}
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.token){err.textContent=d.msg||'Usu\u00e1rio ou senha incorretos';err.style.display='block';return}
    localStorage.setItem('cuscuz_token',d.token);
  }catch(e){err.textContent='Servidor indispon\u00edvel. Tente de novo em instantes.';err.style.display='block';return}
  SYNC_USER=u;localStorage.setItem('medplan_logged','1');localStorage.setItem('medplan_user',u);
  err.style.display='none';startApp();
  try{loadDriveFolder(DRIVE_ROOT_ID,'Cursos',false);loadQuestionsBankFromAPI(true);if(typeof fetchRadarMedico==='function')fetchRadarMedico()}catch(_){}}
  
function showSignupForm(){
  $('login-form').style.display='none';
  $('signup-form').style.display='block';
  $('signup-error').style.display='none';
  $('signup-user').focus();
}

function showLoginForm(){
  $('signup-form').style.display='none';
  $('login-form').style.display='block';
  $('login-error').style.display='none';
  $('login-user').focus();
}

async function doSignup(){
  const u=cleanStr($('signup-user').value.trim());
  const d=$('signup-display').value.trim();
  const p=$('signup-pass').value;
  const pc=$('signup-pass-confirm').value;
  const err=$('signup-error');
  
  if(!u||u.length<3){err.textContent='Usu\u00e1rio deve ter pelo menos 3 caracteres';err.style.display='block';return}
  if(!/^[a-z0-9_-]+$/.test(u)){err.textContent='Usu\u00e1rio: apenas letras, n\u00fameros, _ e -';err.style.display='block';return}
  if(p.length<6){err.textContent='Senha deve ter pelo menos 6 caracteres';err.style.display='block';return}
  if(p!==pc){err.textContent='Senhas n\u00e3o conferem';err.style.display='block';return}
  
  try{
    const r=await fetch('/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,displayName:d||u})});
    const res=await r.json().catch(()=>({}));
    if(!r.ok||!res.token){err.textContent=res.msg||'Erro ao criar conta';err.style.display='block';return}
    localStorage.setItem('cuscuz_token',res.token);
  }catch(e){err.textContent='Servidor indispon\u00edvel. Tente de novo em instantes.';err.style.display='block';return}
  
  SYNC_USER=u;localStorage.setItem('medplan_logged','1');localStorage.setItem('medplan_user',u);
  err.style.display='none';startApp();
  try{loadDriveFolder(DRIVE_ROOT_ID,'Cursos',false);loadQuestionsBankFromAPI(true);if(typeof fetchRadarMedico==='function')fetchRadarMedico()}catch(_){}}"""
    
    content = content[:match.start()] + new_func + content[match.end():]
    
    with open('C:/Users/alexl/Downloads/Compressed/cuscuzi/index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print("SUCCESS: Updated login functions")
else:
    print("Function not found!")