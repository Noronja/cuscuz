/* Jarvis — assistente de voz do Cuscuz-MED (toque no orbe, fale; ele responde e age no app) */
(function () {
  'use strict';
  if (window.__jarvis) return; window.__jarvis = true;
  const $ = id => document.getElementById(id);
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  const DEST = { inicio: 'view-inicio', acervo: 'view-acervo', treino: 'view-treino', simulados: 'view-simulados', planner: 'view-planneria', calendario: 'view-calendario', semana: 'view-semana', preparatorio: 'view-preparatorio' };
  let estado = 'idle', rec = null, audio = null, ttsOff = 0, hist = [], aberto = false, falando = false;

  function css() {
    const s = document.createElement('style');
    s.textContent = `
#jv-orb{position:fixed;left:18px;bottom:24px;z-index:901;width:54px;height:54px;border-radius:50%;border:1px solid var(--teal-border);background:radial-gradient(circle at 35% 30%,#7ff3ff,#0284c7 55%,#06283d);box-shadow:0 0 18px var(--teal-glow),inset 0 0 14px rgba(255,255,255,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;transition:transform .2s,box-shadow .2s;-webkit-tap-highlight-color:transparent}
#jv-orb:active{transform:scale(.94)}
#jv-orb.listening{animation:jvp 1.1s infinite;box-shadow:0 0 30px #38bdf8,0 0 60px rgba(56,189,248,.5)}
#jv-orb.thinking{animation:jvs 1.4s linear infinite}
#jv-orb.speaking{animation:jvp .7s infinite;background:radial-gradient(circle at 35% 30%,#fff3b0,#f59e0b 55%,#4a2a05);box-shadow:0 0 30px #fbbf24}
@keyframes jvp{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes jvs{to{filter:hue-rotate(360deg)}}
#jv-panel{position:fixed;left:18px;bottom:90px;z-index:901;width:min(360px,calc(100vw - 36px));max-height:46vh;display:none;flex-direction:column;border-radius:16px;background:var(--bg-overlay);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--border-strong);box-shadow:var(--shadow-lg);font-family:var(--font-ui);color:var(--text-primary);overflow:hidden}
#jv-panel.open{display:flex}
#jv-head{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);border-bottom:1px solid var(--border-subtle)}
#jv-head button{background:none;border:0;color:var(--text-secondary);font-size:16px;cursor:pointer}
#jv-log{overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:13.5px;line-height:1.45}
#jv-log .u{align-self:flex-end;background:var(--teal-dim);border:1px solid var(--teal-border);padding:6px 10px;border-radius:12px}
#jv-log .j{align-self:flex-start;background:var(--bg-elevated);border:1px solid var(--border-subtle);padding:6px 10px;border-radius:12px}
#jv-form{display:flex;gap:6px;padding:8px;border-top:1px solid var(--border-subtle)}
#jv-form input{flex:1;background:var(--bg-base);color:var(--text-primary);border:1px solid var(--border-muted);border-radius:10px;padding:8px 10px;font:inherit;font-size:16px}
#jv-form button{background:var(--teal);color:var(--text-inverse);border:0;border-radius:10px;padding:0 12px;font-weight:700;cursor:pointer}
@media(max-width:820px){#jv-orb{bottom:86px;left:12px;width:50px;height:50px}#jv-panel{bottom:146px;left:12px}}`;
    document.head.appendChild(s);
  }

  function dom() {
    const orb = document.createElement('button');
    orb.id = 'jv-orb'; orb.setAttribute('aria-label', 'Jarvis — falar'); orb.title = 'Jarvis: toque e fale'; orb.innerHTML = '<i class="ph ph-microphone"></i>';
    orb.onclick = toque;
    const pn = document.createElement('div');
    pn.id = 'jv-panel';
    pn.innerHTML = '<div id="jv-head"><span>Jarvis</span><button onclick="__jv.fechar()" aria-label="Fechar">✕</button></div><div id="jv-log"></div><form id="jv-form" onsubmit="event.preventDefault();__jv.digitar()"><input id="jv-in" placeholder="' + (SR ? 'Toque no orbe ou digite…' : 'Digite o pedido…') + '" autocomplete="off"><button type="submit">Enviar</button></form>';
    document.body.append(orb, pn);
  }

  function setEstado(e) { estado = e; const o = $('jv-orb'); if (o) o.className = e === 'idle' ? '' : e; }
  function log(cls, txt) { const l = $('jv-log'); if (!l) return; const d = document.createElement('div'); d.className = cls; d.textContent = txt; l.appendChild(d); l.scrollTop = l.scrollHeight; }
  function abrir() { aberto = true; $('jv-panel').classList.add('open'); }

  function destravarAudio() {
    try {
      if (!audio) { audio = new Audio(); audio.setAttribute('playsinline', ''); }
      audio.src = SILENT; audio.play().catch(() => {});
      if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
    } catch (_) {}
  }

  function pararFala() {
    falando = false;
    try { if (audio) { audio.pause(); } if (window.speechSynthesis) speechSynthesis.cancel(); } catch (_) {}
  }

  async function falar(texto) {
    falando = true; setEstado('speaking');
    const fim = () => { if (falando) { falando = false; setEstado('idle'); } };
    if (Date.now() > ttsOff) {
      try {
        const r = await fetch('/api/jarvis/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) });
        if (r.ok && /audio/.test(r.headers.get('content-type') || '')) {
          const url = URL.createObjectURL(await r.blob());
          if (!audio) audio = new Audio();
          audio.onended = () => { URL.revokeObjectURL(url); fim(); };
          audio.onerror = fim;
          audio.src = url;
          await audio.play();
          return;
        }
        ttsOff = Date.now() + 10 * 60 * 1000; // voz premium indisponível: usa a do aparelho por 10 min
      } catch (_) { ttsOff = Date.now() + 2 * 60 * 1000; }
    }
    try {
      if (!window.speechSynthesis) return fim();
      const vozes = speechSynthesis.getVoices().filter(v => /^pt/i.test(v.lang));
      const v = vozes.find(x => /felipe|daniel|google.*portugu|male|masc/i.test(x.name) && /BR/i.test(x.lang)) || vozes.find(x => /BR/i.test(x.lang)) || vozes[0];
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR'; if (v) u.voice = v; u.pitch = 0.75; u.rate = 0.95;
      u.onend = fim; u.onerror = fim;
      speechSynthesis.speak(u);
    } catch (_) { fim(); }
  }

  /* ───── contexto e ações ───── */
  function contexto() {
    const plano = get('planner-v2-plan', null);
    const h = hojeISO();
    const hoje = plano ? plano.tarefas.filter(t => t.data === h && t.tipo !== 'prova').map(t => ({ titulo: t.titulo, minutos: t.minutos, status: t.status })) : [];
    let flash = 0, erros = 0;
    try { flash = fcDue(buildFCList()).length; } catch (_) {}
    try { erros = WRONG.size; } catch (_) {}
    const nome = ((document.querySelector('.sidebar-user-name') || {}).textContent || 'Alex').trim().split(/\s+/)[0];
    return { nome, hoje, flashcards: flash, erros, dataHoje: h, planoAtivo: !!plano };
  }

  function irPara(dest) {
    const lobby = $('lobby-screen');
    if (lobby && getComputedStyle(lobby).display !== 'none' && typeof enterApp === 'function') enterApp(DEST[dest] || 'view-inicio');
    else go(DEST[dest] || 'view-inicio');
  }

  function executar(a) {
    try {
      switch (a.tipo) {
        case 'ir_para': return irPara(a.destino);
        case 'abrir_aula':
          irPara('acervo');
          return (typeof ac2Init === 'function' ? ac2Init() : Promise.resolve()).then(() => ac2Abrir(a.id, false, true));
        case 'praticar_questoes': return iniciarSimuladoDoTema(a.tema || '', a.disciplina || '', []);
        case 'abrir_flashcards': irPara('treino'); return setTimeout(() => { try { startFC(); } catch (_) {} }, 200);
        case 'abrir_erros': irPara('treino'); return setTimeout(() => { try { startWrongQuiz(); } catch (_) {} }, 200);
        case 'concluir_tarefa': {
          const plano = get('planner-v2-plan', null); if (!plano) return;
          const h = hojeISO(); const q = norm(a.tarefa);
          const pend = plano.tarefas.filter(t => t.data === h && t.status !== 'feito' && t.tipo !== 'prova');
          const alvo = pend.find(t => q && norm(t.titulo).includes(q)) || (pend.length === 1 ? pend[0] : null);
          if (alvo && window.plv2) { plv2.feito(alvo.id); }
          return;
        }
        case 'ajustar_plano': irPara('planner'); return setTimeout(() => window.plv2 && plv2.ajustar && plv2.ajustar(a.texto || 'Quero ajustar meu cronograma'), 300);
        case 'gerar_plano': irPara('planner'); return setTimeout(() => window.plv2 && plv2.conversar && plv2.conversar(), 300);
      }
    } catch (e) { console.warn('[Jarvis] ação falhou', a, e); }
  }

  async function processar(texto) {
    texto = String(texto || '').trim(); if (!texto) { setEstado('idle'); return; }
    abrir(); log('u', texto); setEstado('thinking');
    try {
      const r = await fetch('/api/jarvis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto, contexto: contexto(), historico: hist }) });
      const j = await r.json();
      if (!r.ok || !j.fala) throw new Error(j.msg || 'sem resposta');
      hist.push({ role: 'user', content: texto }, { role: 'model', content: j.fala }); hist = hist.slice(-10);
      log('j', j.fala);
      for (const a of j.acoes || []) await executar(a);
      await falar(j.fala);
    } catch (e) {
      const m = 'Perdão, não consegui processar agora. Tente novamente em instantes.';
      log('j', m); falar(m);
    }
  }

  function ouvir() {
    if (!SR) { abrir(); $('jv-in').focus(); log('j', 'Seu navegador não permite reconhecimento de voz. Digite o pedido abaixo.'); return; }
    abrir(); pararFala();
    rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = '', acabou = false;
    const enviar = () => { if (acabou) return; acabou = true; if (final.trim()) processar(final); else { setEstado('idle'); } };
    rec.onresult = ev => { let t = ''; for (const r of ev.results) t += r[0].transcript; final = t; const i = $('jv-in'); if (i) i.value = t; };
    rec.onend = () => { const i = $('jv-in'); if (i) i.value = ''; enviar(); };
    rec.onerror = ev => {
      acabou = true; setEstado('idle');
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') log('j', 'Preciso da permissão do microfone. Libere nas configurações do navegador e toque no orbe de novo.');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') log('j', 'Não consegui ouvir (' + ev.error + '). Pode digitar abaixo.');
    };
    try { rec.start(); setEstado('listening'); } catch (_) { setEstado('idle'); }
  }

  function toque() {
    destravarAudio();
    if (estado === 'listening') { try { rec.stop(); } catch (_) {} return; }
    if (estado === 'speaking' || estado === 'thinking') { pararFala(); setEstado('idle'); return; }
    ouvir();
  }

  window.__jv = {
    fechar() { aberto = false; $('jv-panel').classList.remove('open'); pararFala(); try { rec && rec.abort(); } catch (_) {} setEstado('idle'); },
    digitar() { const i = $('jv-in'); const t = i.value.trim(); if (!t) return; i.value = ''; destravarAudio(); processar(t); }
  };

  function iniciar() {
    css(); dom();
    // esconde enquanto estiver na tela de login
    const sync = () => { const lock = window.appLocked && appLocked(); const o = $('jv-orb'); if (o) o.style.display = lock ? 'none' : 'flex'; if (lock && aberto) window.__jv.fechar(); };
    sync(); setInterval(sync, 1500);
    if (window.speechSynthesis) speechSynthesis.getVoices();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
