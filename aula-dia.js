/* Aula do dia — grava a aula da faculdade, transcreve por trechos e gera material de estudo */
(function () {
  'use strict';
  const VIEW = 'view-auladia', K_SESS = 'aula-dia-sessoes', CHUNK_MS = 90 * 1000;
  const $ = id => document.getElementById(id);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { if (window.toast) toast('Armazenamento do navegador cheio — baixe e apague aulas antigas.', 'error'); return false; } };
  const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
  const mmss = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const hms = s => (s >= 3600 ? Math.floor(s / 3600) + 'h' : '') + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + 'min';

  let geminiOk = null;
  let rec = null;       // estado da gravação em andamento
  let sessAtual = null; // sessão exibida (em gravação ou aberta do histórico)
  let abaRes = 'transcricao';

  /* ───────────── armazenamento ───────────── */
  const sessoes = () => get(K_SESS, []);
  const salvarSessoes = l => set(K_SESS, l.slice(0, 40));
  function salvarSess(s) { const l = sessoes(); const i = l.findIndex(x => x.id === s.id); if (i >= 0) l[i] = s; else l.unshift(s); salvarSessoes(l); }
  function idb() {
    return new Promise((ok, no) => { const r = indexedDB.open('aulaDia', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  }
  async function idbPut(k, blob) { try { const d = await idb(); await new Promise((ok, no) => { const t = d.transaction('audio', 'readwrite'); t.objectStore('audio').put(blob, k); t.oncomplete = ok; t.onerror = no; }); } catch (_) {} }
  async function idbGet(k) { try { const d = await idb(); return await new Promise((ok, no) => { const r = d.transaction('audio').objectStore('audio').get(k); r.onsuccess = () => ok(r.result); r.onerror = no; }); } catch (_) { return null; } }
  async function idbDel(prefix) { try { const d = await idb(); const t = d.transaction('audio', 'readwrite'); const st = t.objectStore('audio'); const rq = st.openCursor(); rq.onsuccess = () => { const c = rq.result; if (c) { if (String(c.key).startsWith(prefix)) c.delete(); c.continue(); } }; } catch (_) {} }

  /* ───────────── tela ───────────── */
  function css() {
    if ($('ad-css')) return;
    const s = document.createElement('style'); s.id = 'ad-css';
    s.textContent = `
.ad{max-width:980px;margin:0 auto;font-family:var(--font-ui);color:var(--text-primary)}
.ad h2{margin:0 0 4px;font-size:21px}.ad .sub{font-size:12.5px;color:var(--text-secondary);margin-bottom:14px}
.ad .card{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:14px;margin-bottom:14px}
.ad label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:0 0 4px}
.ad input,.ad select{width:100%;background:var(--bg-base);color:var(--text-primary);border:1px solid var(--border-muted);border-radius:var(--radius-md);padding:9px 10px;font:inherit;font-size:16px}
.ad .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ad .b{background:var(--bg-surface);border:1px solid var(--border-muted);color:var(--text-primary);border-radius:var(--radius-md);padding:8px 12px;font-size:13px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.ad .b:hover{border-color:var(--teal-border);background:var(--teal-dim)}.ad .b.pri{background:var(--teal);color:var(--text-inverse);border-color:var(--teal);font-weight:700}
.ad .b.rec{background:#e11d48;border-color:#e11d48;color:#fff;font-weight:700}
.ad .b:disabled{opacity:.5}
.ad-big{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}
.ad-timer{font:700 28px var(--font-mono);letter-spacing:.04em}
.ad-meter{flex:1;min-width:120px;height:10px;background:var(--bg-base);border-radius:99px;overflow:hidden;border:1px solid var(--border-subtle)}
.ad-meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--teal),var(--cyan));transition:width .1s}
.ad-dot{width:10px;height:10px;border-radius:50%;background:#e11d48;animation:adp 1s infinite}
@keyframes adp{50%{opacity:.25}}
.ad-tr{white-space:pre-wrap;font-size:14px;line-height:1.65;max-height:55vh;overflow:auto;padding:4px 2px}
.ad-tr .mk{color:var(--amber);font-weight:700}
.ad-tr .pend{color:var(--text-muted);font-style:italic}
.ad-tabs{display:flex;gap:6px;margin-bottom:10px;overflow-x:auto}.ad-tabs .b.on{background:var(--teal-dim);border-color:var(--teal-border);color:var(--teal)}
.ad ul{margin:4px 0 10px 18px;padding:0}.ad li{margin:3px 0;font-size:13.5px;line-height:1.5}
.ad h4{margin:12px 0 4px;font-size:14px;color:var(--cyan)}
.ad .fc{border:1px solid var(--border-muted);border-radius:var(--radius-md);padding:10px;margin-bottom:8px;background:var(--bg-base);font-size:13.5px}
.ad .fc b{display:block;margin-bottom:4px}
.ad .hist{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border-subtle);font-size:13px}
.ad .hist small{color:var(--text-secondary)}
.ad .aviso{font-size:12px;color:var(--amber);background:var(--amber-dim);border:1px solid var(--amber-border);border-radius:var(--radius-md);padding:8px 10px;margin-top:10px}
@media(max-width:600px){.ad .row{grid-template-columns:1fr}}`;
    document.head.appendChild(s);
  }

  function garantirView() {
    if ($(VIEW)) return;
    const ref = $('view-planneria'); if (!ref) return;
    const v = document.createElement('div'); v.id = VIEW; v.className = 'view-section';
    v.innerHTML = '<div class="pad" id="ad-root"></div>';
    ref.parentNode.insertBefore(v, ref.nextSibling);
    const nav = document.querySelector('.nav-item[data-view="view-acervo"]');
    if (nav && !document.querySelector('.nav-item[data-view="' + VIEW + '"]')) {
      const n = document.createElement('div'); n.className = 'nav-item'; n.dataset.view = VIEW; n.dataset.tooltip = 'Aula do dia';
      n.setAttribute('onclick', "go('" + VIEW + "')");
      n.innerHTML = '<i class="ph ph-microphone-stage"></i><span class="nav-text">Aula do dia</span><div class="nav-tooltip">Aula do dia</div>';
      nav.parentNode.insertBefore(n, nav.nextSibling);
    }
  }

  function opcoesDisciplina() {
    const plano = get('planner-v2-plan', null);
    const set1 = new Set();
    if (plano && plano.perfil) {
      (plano.perfil.provasFaculdade || []).forEach(p => set1.add(p.disciplina));
      (plano.perfil.aulasFaculdade || []).forEach(a => set1.add(a.disciplina));
    }
    return [...set1];
  }
  function temaDeHoje(disc) {
    const plano = get('planner-v2-plan', null); if (!plano || !plano.perfil) return '';
    const a = (plano.perfil.aulasFaculdade || []).find(x => x.data === hojeISO() && (!disc || x.disciplina === disc));
    return a ? a.tema : '';
  }
  function assuntosPlano(disc) {
    const plano = get('planner-v2-plan', null); if (!plano || !plano.perfil || !disc) return [];
    return [].concat(...(plano.perfil.provasFaculdade || []).filter(p => p.disciplina === disc).map(p => p.assuntos || []));
  }

  async function render() {
    css(); garantirView();
    const r = $('ad-root'); if (!r) return;
    if (geminiOk === null) { try { geminiOk = !!(await (await fetch('/api/aula/status')).json()).gemini; } catch (_) { geminiOk = false; } }
    if (rec) return desenharGravando();
    if (sessAtual && !rec) return desenharResultado();
    const opts = opcoesDisciplina();
    const hoje = (get('planner-v2-plan', null) || { perfil: {} }).perfil.aulasFaculdade || [];
    const aulaHoje = hoje.find(a => a.data === hojeISO());
    const lista = sessoes();
    r.innerHTML = `<div class="ad"><h2>Aula do dia</h2><div class="sub">Grave a aula da faculdade: a transcrição completa aparece enquanto você assiste, e no fim eu gero resumo, flashcards e questões.</div>
    <div class="card"><div class="row"><div><label>Disciplina</label><input id="ad-disc" list="ad-discs" placeholder="Ex.: Farmacologia" value="${E(aulaHoje ? aulaHoje.disciplina : '')}"><datalist id="ad-discs">${opts.map(o => `<option value="${E(o)}">`).join('')}</datalist></div>
    <div><label>Tema da aula (opcional)</label><input id="ad-tema" placeholder="Ex.: Antibióticos beta-lactâmicos" value="${E(aulaHoje ? aulaHoje.tema : '')}"></div></div>
    <div class="ad-big"><button class="b rec" id="ad-start" onclick="auladia.iniciar()"><i class="ph ph-record"></i> Iniciar gravação</button>
    <span class="sub" style="margin:0">${geminiOk ? 'Transcrição por IA (a cada ~1,5 min).' : 'Sem chave do Gemini: usarei a legenda ao vivo do navegador (Chrome/Safari), sem resumo por IA.'}</span></div>
    <div class="aviso">Deixe a tela ligada e o navegador aberto durante a aula — no iPhone, bloquear a tela ou trocar de app pausa a gravação. Posicione o aparelho perto de quem fala e use o botão ⭐ quando o professor disser "isso cai na prova". Grave apenas se a faculdade/professor permitirem.</div></div>
    <div class="card"><b>Aulas gravadas</b>${lista.length ? lista.map(s => `<div class="hist"><div><b>${E(s.disciplina || 'Sem disciplina')}</b>${s.tema ? ' — ' + E(s.tema) : ''}<br><small>${E(s.data)} · ${hms(s.duracao || 0)} · ${(s.texto || '').split(/\s+/).filter(Boolean).length} palavras${s.resultado ? ' · ✔ material pronto' : ''}</small></div><div style="display:flex;gap:6px"><button class="b" onclick="auladia.abrir('${s.id}')">Abrir</button><button class="b" onclick="auladia.apagar('${s.id}')">🗑</button></div></div>`).join('') : '<div class="sub" style="margin-top:6px">Nenhuma aula gravada ainda.</div>'}</div></div>`;
  }

  function desenharGravando() {
    const r = $('ad-root'); if (!r || !rec) return;
    r.innerHTML = `<div class="ad"><h2><span class="ad-dot" style="display:inline-block;margin-right:8px"></span>Gravando — ${E(rec.sess.disciplina || 'aula')}</h2><div class="sub">${E(rec.sess.tema || '')}</div>
    <div class="card"><div class="ad-big" style="margin-top:0"><span class="ad-timer" id="ad-timer">00:00</span><div class="ad-meter"><i id="ad-meter"></i></div>
    <button class="b" onclick="auladia.marcar()">⭐ Marcar momento</button><button class="b pri" onclick="auladia.parar()"><i class="ph ph-stop-circle"></i> Finalizar</button></div>
    <div class="sub" id="ad-status" style="margin:8px 0 0"></div></div>
    <div class="card"><b>Transcrição ao vivo</b><div class="ad-tr" id="ad-tr"></div></div></div>`;
    atualizarTexto();
  }

  function textoHtml(s) {
    const partes = (s.chunks || []).slice().sort((a, b) => a.i - b.i).map(c => c.status === 'ok' ? E(c.texto) : c.status === 'erro' ? '<span class="pend">[trecho ' + (c.i + 1) + ' sem transcrição — toque em "Tentar novamente"]</span>' : '<span class="pend">[transcrevendo trecho ' + (c.i + 1) + '…]</span>');
    const live = s.live ? E(s.live) : '';
    return (partes.join('\n\n') + (live ? (partes.length ? '\n\n' : '') + live : '')).replace(/⭐ \[(\d\d:\d\d)\]/g, '<span class="mk">⭐ [$1]</span>') || '<span class="pend">A transcrição aparecerá aqui…</span>';
  }
  function textoPuro(s) {
    const t = (s.chunks || []).slice().sort((a, b) => a.i - b.i).filter(c => c.status === 'ok').map(c => c.texto).join('\n\n');
    return (t + (s.live ? '\n\n' + s.live : '')).trim();
  }
  function atualizarTexto() {
    const s = rec ? rec.sess : sessAtual; if (!s) return;
    s.texto = textoPuro(s);
    const el = $('ad-tr'); if (el) { const colado = el.scrollTop + el.clientHeight >= el.scrollHeight - 40; el.innerHTML = textoHtml(s); if (colado) el.scrollTop = el.scrollHeight; }
    salvarSess(s);
  }

  /* ───────────── gravação ───────────── */
  function escolherMime() {
    const c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
    return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  }

  async function iniciar() {
    if (rec) return;
    garantirView(); css();
    if ($('view-auladia') && !$('view-auladia').classList.contains('active')) { go(VIEW); await new Promise(r => setTimeout(r, 200)); }
    if (geminiOk === null) await render();
    const disc = ($('ad-disc') || {}).value || '', tema = ($('ad-tema') || {}).value || '';
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Este navegador não permite gravar áudio. Use Safari (iOS 14.3+) ou Chrome.', 'error'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { toast('Preciso da permissão do microfone. Libere nas configurações do navegador e tente de novo.', 'error'); return; }
    const sess = { id: 'a' + Date.now(), data: hojeISO(), inicio: Date.now(), disciplina: disc.trim(), tema: tema.trim(), duracao: 0, chunks: [], marcas: [], texto: '', live: '', resultado: null };
    const mime = escolherMime();
    rec = { sess, stream, mime, mr: null, t0: Date.now(), parar: false, fila: [], enviando: false, chunkIdx: 0, silencio: 0, timers: [], ctx: null, wake: null, sr: null };
    sessAtual = sess; salvarSess(sess);
    // medidor de nível
    try {
      const AC = window.AudioContext || window.webkitAudioContext; rec.ctx = new AC();
      const src = rec.ctx.createMediaStreamSource(stream); const an = rec.ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      rec.timers.push(setInterval(() => {
        an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
        const nv = Math.min(100, m * 1.6); const el = $('ad-meter'); if (el) el.style.width = nv + '%';
        rec.silencio = nv < 3 ? rec.silencio + 0.1 : 0;
        const st = $('ad-status'); if (st) st.textContent = rec.silencio > 20 ? '⚠ Sem som há mais de 20 s — verifique o microfone e a distância do professor.' : (geminiOk ? 'Gravando · trechos enviados à IA a cada ~1,5 min' : 'Gravando · legenda ao vivo do navegador');
      }, 100));
    } catch (_) {}
    rec.timers.push(setInterval(() => { const el = $('ad-timer'); if (el) el.textContent = mmss((Date.now() - rec.t0) / 1000); sess.duracao = Math.round((Date.now() - rec.t0) / 1000); }, 500));
    try { if (navigator.wakeLock) rec.wake = await navigator.wakeLock.request('screen'); } catch (_) {}
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    desenharGravando();
    iniciarTrecho();
    if (!geminiOk) iniciarLegendaAoVivo();
    toast('Gravação iniciada', 'success');
  }

  async function aoMudarVisibilidade() {
    if (!rec) return;
    if (document.visibilityState === 'visible') { try { if (navigator.wakeLock && !rec.wake) rec.wake = await navigator.wakeLock.request('screen'); } catch (_) {} if (rec.ctx && rec.ctx.state === 'suspended') rec.ctx.resume().catch(() => {}); }
    else toast('A aula continua gravando, mas o iPhone pode pausar a gravação com a tela em segundo plano.', 'warning');
  }

  function iniciarTrecho() {
    if (!rec) return;
    const idx = rec.chunkIdx++;
    const parts = [];
    let mr;
    try { mr = new MediaRecorder(rec.stream, rec.mime ? { mimeType: rec.mime, audioBitsPerSecond: 32000 } : undefined); }
    catch (e) { try { mr = new MediaRecorder(rec.stream); } catch (e2) { toast('Não foi possível iniciar a gravação neste navegador.', 'error'); return; } }
    rec.mr = mr;
    mr.ondataavailable = ev => { if (ev.data && ev.data.size) parts.push(ev.data); };
    mr.onstop = () => {
      const blob = new Blob(parts, { type: mr.mimeType || rec.mime || 'audio/webm' });
      if (blob.size > 2000) { const sess = sessAtual; sess.chunks.push({ i: idx, status: 'pendente', texto: '', mime: blob.type }); salvarSess(sess); idbPut(sess.id + ':' + idx, blob); if (geminiOk) { rec.fila.push({ sess, idx, blob }); bombear(); } }
      if (rec && !rec.parar) iniciarTrecho(); else if (rec && rec.parar) finalizarDepois();
    };
    mr.start();
    clearTimeout(rec.tChunk);
    rec.tChunk = setTimeout(() => { try { if (mr.state !== 'inactive') mr.stop(); } catch (_) {} }, CHUNK_MS);
  }

  function iniciarLegendaAoVivo() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Sem chave do Gemini e este navegador não tem legenda ao vivo: a aula será só gravada.', 'warning'); return; }
    const sr = new SR(); sr.lang = 'pt-BR'; sr.continuous = true; sr.interimResults = true; rec.sr = sr;
    let base = '';
    sr.onresult = ev => {
      let fin = '', interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += t + ' '; else interim += t; }
      if (fin) { sessAtual.live = (sessAtual.live ? sessAtual.live + ' ' : '') + fin.trim(); }
      sessAtual.liveInterim = interim;
      const el = $('ad-tr'); if (el) { el.innerHTML = textoHtml(sessAtual) + (interim ? ' <span class="pend">' + E(interim) + '</span>' : ''); el.scrollTop = el.scrollHeight; }
      if (fin) { sessAtual.texto = textoPuro(sessAtual); salvarSess(sessAtual); }
    };
    sr.onend = () => { if (rec && !rec.parar) { try { sr.start(); } catch (_) {} } };
    sr.onerror = () => {};
    try { sr.start(); } catch (_) {}
  }

  function marcar() {
    if (!rec) return;
    const t = mmss((Date.now() - rec.t0) / 1000);
    sessAtual.marcas.push(t);
    // insere a marca no ponto atual da transcrição ao vivo / entre trechos
    if (!geminiOk) sessAtual.live = (sessAtual.live ? sessAtual.live + '\n' : '') + '⭐ [' + t + ']\n';
    else sessAtual.chunks.push({ i: rec.chunkIdx - 0.5 + sessAtual.marcas.length * 0.001, status: 'ok', texto: '⭐ [' + t + ']' });
    atualizarTexto(); toast('Momento marcado em ' + t, 'success');
  }

  async function parar() {
    if (!rec) return;
    rec.parar = true;
    rec.timers.forEach(clearInterval); clearTimeout(rec.tChunk);
    try { rec.sr && rec.sr.stop(); } catch (_) {}
    sessAtual.duracao = Math.round((Date.now() - rec.t0) / 1000);
    try { if (rec.mr && rec.mr.state !== 'inactive') rec.mr.stop(); else finalizarDepois(); } catch (_) { finalizarDepois(); }
    const r = $('ad-root'); if (r) { const st = $('ad-status'); if (st) st.textContent = 'Finalizando e transcrevendo o último trecho…'; }
  }

  function finalizarDepois() {
    if (!rec) return;
    const r0 = rec;
    try { r0.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { r0.ctx && r0.ctx.close(); } catch (_) {}
    try { r0.wake && r0.wake.release(); } catch (_) {}
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    const esperar = async () => {
      while (r0.fila.length || r0.enviando) await new Promise(r => setTimeout(r, 400));
      rec = null;
      atualizarTexto(); sessAtual.texto = textoPuro(sessAtual); salvarSess(sessAtual);
      desenharResultado();
      if (geminiOk && sessAtual.texto.length > 200) processar();
    };
    esperar();
  }

  /* ───────────── envio dos trechos ───────────── */
  async function bombear() {
    if (!rec || rec.enviando) return;
    rec.enviando = true;
    const r0 = rec;
    while (r0.fila.length) {
      const it = r0.fila.shift();
      await transcreverTrecho(it.sess, it.idx, it.blob);
      atualizarTexto();
    }
    r0.enviando = false;
  }

  const blobParaB64 = blob => new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] || ''); f.onerror = no; f.readAsDataURL(blob); });

  async function paraWav16k(blob) {
    const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
    const dec = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close && ctx.close();
    const off = new OfflineAudioContext(1, Math.ceil(dec.duration * 16000), 16000);
    const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  async function transcreverTrecho(sess, idx, blob) {
    const c = sess.chunks.find(x => x.i === idx); if (!c) return;
    const anterior = textoPuro(sess).slice(-300);
    let usarWav = false;
    for (let tent = 0; tent < 4; tent++) {
      try {
        const b = usarWav ? await paraWav16k(blob) : blob;
        const r = await fetch('/api/aula/transcrever', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: await blobParaB64(b), mime: b.type, disciplina: sess.disciplina, tema: sess.tema, anterior }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.success) { c.status = 'ok'; c.texto = j.texto || ''; salvarSess(sess); idbDel(sess.id + ':' + idx); if (!c.texto) c.texto = ''; return; }
        if (j.formato && !usarWav) { usarWav = true; continue; }
        if (r.status === 503) break;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 1500 * (tent + 1)));
    }
    c.status = 'erro'; salvarSess(sess);
  }

  async function reenviarFalhas() {
    const s = sessAtual; if (!s) return;
    const falhas = (s.chunks || []).filter(c => c.status === 'erro' || c.status === 'pendente');
    if (!falhas.length) return toast('Nada pendente.', 'success');
    toast('Reenviando ' + falhas.length + ' trecho(s)…', 'info');
    for (const c of falhas) {
      const blob = await idbGet(s.id + ':' + c.i);
      if (!blob) { c.status = 'erro'; continue; }
      c.status = 'pendente'; await transcreverTrecho(s, c.i, blob);
    }
    s.texto = textoPuro(s); salvarSess(s); desenharResultado();
    toast('Pronto.', 'success');
  }

  /* ───────────── resultado ───────────── */
  async function processar() {
    const s = sessAtual; if (!s) return;
    s.texto = textoPuro(s);
    const st = $('ad-proc'); if (st) st.textContent = 'Gerando resumo, flashcards e questões…';
    try {
      const r = await fetch('/api/aula/processar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcricao: s.texto, disciplina: s.disciplina, tema: s.tema, assuntosPlano: assuntosPlano(s.disciplina), marcas: s.marcas }) });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.msg || 'erro');
      s.resultado = j.resultado; salvarSess(s); abaRes = 'resumo'; desenharResultado();
    } catch (e) { if (st) st.textContent = 'Não consegui gerar o material agora (' + e.message + '). Toque em "Gerar material" para tentar de novo.'; }
  }

  function desenharResultado() {
    const r = $('ad-root'); const s = sessAtual; if (!r || !s) return;
    const res = s.resultado;
    const tabs = [['transcricao', 'Transcrição']].concat(res ? [['resumo', 'Resumo'], ['prova', 'Cai na prova'], ['flash', 'Flashcards (' + (res.flashcards || []).length + ')'], ['quest', 'Questões (' + (res.questoes || []).length + ')']] : []);
    if (!tabs.some(t => t[0] === abaRes)) abaRes = tabs[0][0];
    let corpo = '';
    if (abaRes === 'transcricao') corpo = `<div class="ad-tr">${textoHtml(s)}</div>`;
    else if (res && abaRes === 'resumo') corpo = `<h4>${E(res.titulo)}</h4><p style="font-size:14px;line-height:1.6">${E(res.resumo)}</p>${(res.topicos || []).map(t => `<h4>${E(t.titulo)}</h4><ul>${(t.pontos || []).map(p => `<li>${E(p)}</li>`).join('')}</ul>`).join('')}${(res.termos || []).length ? '<h4>Termos</h4><ul>' + res.termos.map(t => `<li><b>${E(t.termo)}</b>: ${E(t.definicao)}</li>`).join('') + '</ul>' : ''}${(res.duvidas || []).length ? '<h4>Para conferir (possíveis imprecisões)</h4><ul>' + res.duvidas.map(d => `<li>${E(d)}</li>`).join('') + '</ul>' : ''}`;
    else if (res && abaRes === 'prova') corpo = `${(res.caiNaProva || []).length ? '<ul>' + res.caiNaProva.map(p => `<li>${E(p)}</li>`).join('') + '</ul>' : '<div class="sub">O professor não indicou explicitamente o que cai na prova.</div>'}${(s.marcas || []).length ? '<h4>Momentos que você marcou</h4><div class="sub">' + s.marcas.map(E).join(' · ') + '</div>' : ''}${(res.assuntosCobertos || []).length ? '<h4>Assuntos do manual abordados nesta aula</h4><ul>' + res.assuntosCobertos.map(a => `<li>${E(a)}</li>`).join('') + '</ul>' : ''}`;
    else if (res && abaRes === 'flash') corpo = `<button class="b pri" onclick="auladia.enviarFlash()"><i class="ph ph-cards"></i> Adicionar ao Treino (SRS)</button><div style="margin-top:10px">${(res.flashcards || []).map(f => `<div class="fc"><b>${E(f.frente)}</b>${E(f.verso)}</div>`).join('')}</div>`;
    else if (res && abaRes === 'quest') corpo = (res.questoes || []).map((q, i) => `<div class="fc"><b>${i + 1}. ${E(q.enunciado)}</b>${q.alternativas.map((a, k) => `<div>${'ABCDE'[k]}) ${E(a)}</div>`).join('')}<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--teal)">Ver resposta</summary><div style="margin-top:4px"><b>${'ABCDE'[q.correta]}</b> — ${E(q.explicacao)}</div></details></div>`).join('') || '<div class="sub">Sem questões.</div>';
    const falhas = (s.chunks || []).filter(c => c.status === 'erro' || c.status === 'pendente').length;
    r.innerHTML = `<div class="ad"><h2>${E(s.disciplina || 'Aula')}${s.tema ? ' — ' + E(s.tema) : ''}</h2><div class="sub">${E(s.data)} · ${hms(s.duracao || 0)} · ${(s.texto || '').split(/\s+/).filter(Boolean).length} palavras</div>
    <div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="b" onclick="auladia.voltar()"><i class="ph ph-arrow-left"></i> Aulas</button>${!res && geminiOk ? '<button class="b pri" onclick="auladia.gerar()"><i class="ph ph-sparkle"></i> Gerar material</button>' : ''}${falhas ? `<button class="b" onclick="auladia.reenviar()">Tentar novamente (${falhas})</button>` : ''}<button class="b" onclick="auladia.copiar()">Copiar texto</button><button class="b" onclick="auladia.baixar()">Baixar .md (NotebookLM)</button></div><div class="sub" id="ad-proc" style="margin:0 0 8px"></div>
    <div class="ad-tabs">${tabs.map(([k, n]) => `<button class="b ${abaRes === k ? 'on' : ''}" onclick="auladia.aba('${k}')">${n}</button>`).join('')}</div>${corpo}</div></div>`;
  }

  /* ───────────── ações ───────────── */
  function pacoteMd(s) {
    const res = s.resultado;
    let md = `# ${s.disciplina || 'Aula'}${s.tema ? ' — ' + s.tema : ''}\n\nData: ${s.data} · Duração: ${hms(s.duracao || 0)}\n\n`;
    if (res) {
      md += `## Resumo\n${res.resumo}\n\n`;
      (res.topicos || []).forEach(t => { md += `### ${t.titulo}\n${(t.pontos || []).map(p => '- ' + p).join('\n')}\n\n`; });
      if ((res.caiNaProva || []).length) md += `## Cai na prova\n${res.caiNaProva.map(p => '- ' + p).join('\n')}\n\n`;
      if ((res.termos || []).length) md += `## Termos\n${res.termos.map(t => `- **${t.termo}**: ${t.definicao}`).join('\n')}\n\n`;
    }
    md += `## Transcrição completa\n${s.texto || textoPuro(s)}\n`;
    return md;
  }
  function baixar() {
    const s = sessAtual; if (!s) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([pacoteMd(s)], { type: 'text/markdown' }));
    a.download = ((s.disciplina || 'aula') + '-' + s.data).replace(/[^\w\-]+/g, '_') + '.md'; document.body.appendChild(a); a.click(); a.remove();
  }
  async function copiar() { const s = sessAtual; if (!s) return; try { await navigator.clipboard.writeText(s.texto || textoPuro(s)); toast('Transcrição copiada', 'success'); } catch (_) { toast('Não consegui copiar — use "Baixar .md".', 'error'); } }
  function enviarFlash() {
    const s = sessAtual; if (!s || !s.resultado || typeof FCS === 'undefined') return;
    const ja = new Set(FCS.map(c => c.f + '::' + c.b)); let n = 0;
    (s.resultado.flashcards || []).forEach(f => { if (!ja.has(f.frente + '::' + f.verso)) { FCS.push({ f: f.frente, b: f.verso, s: 'x' }); n++; } });
    if (typeof saveFC === 'function') saveFC();
    toast(n + ' flashcards adicionados ao Treino — eles entram na revisão espaçada de hoje.', 'success');
  }
  function abrirSess(id) { const s = sessoes().find(x => x.id === id); if (!s) return; sessAtual = s; abaRes = s.resultado ? 'resumo' : 'transcricao'; desenharResultado(); }
  function apagarSess(id) { if (!confirm('Apagar esta aula gravada?')) return; salvarSessoes(sessoes().filter(x => x.id !== id)); idbDel(id + ':'); if (sessAtual && sessAtual.id === id) sessAtual = null; render(); }

  window.auladia = {
    iniciar, parar, marcar, abrir: abrirSess, apagar: apagarSess, enviarFlash, baixar, copiar,
    gerar() { processar(); }, reenviar: reenviarFalhas,
    aba(k) { abaRes = k; desenharResultado(); },
    voltar() { if (rec) return; sessAtual = null; render(); }
  };

  // integra com a navegação do app
  function integrar() {
    garantirView();
    if (window.__adGo) return; window.__adGo = true;
    const og = window.go;
    window.go = function (id) { const rv = og.apply(this, arguments); if (id === VIEW) render(); return rv; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', integrar); else integrar();
  window.addEventListener('beforeunload', e => { if (rec) { e.preventDefault(); e.returnValue = ''; } });
})();
