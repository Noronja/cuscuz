/* Planejador v2 — chat adaptativo + cronograma em tabela (Tarefa | Passo a passo | Materiais | Observações) */
(function () {
  'use strict';
  const K_PLAN = 'planner-v2-plan', K_CHAT = 'planner-v2-chat';
  const legacyRender = typeof window.renderPlannerIA === 'function' ? window.renderPlannerIA : null;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = () => document.getElementById('planner-ia-root');
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { if (window.toast) toast('Armazenamento cheio — exporte um backup', 'error'); } };
  const sync = () => { try { if (typeof pushCloud === 'function') pushCloud(); } catch (_) {} };
  const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const fmtDia = iso => { const d = new Date(iso + 'T00:00:00Z'); return DIAS[d.getUTCDay()] + ', ' + iso.slice(8, 10) + '/' + iso.slice(5, 7); };
  const fmtMin = m => m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '') : m + ' min';
  const ICON = { aula: 'ph-video-camera', resumo: 'ph-notebook', questoes: 'ph-list-checks', flashcards: 'ph-cards', erros: 'ph-warning-circle', simulado: 'ph-timer', prova: 'ph-flag' };
  const NOME = { aula: 'Aula', resumo: 'Resumo', questoes: 'Questões', flashcards: 'Flashcards', erros: 'Erros', simulado: 'Simulado', prova: 'Prova' };
  const COR = { estudo: 'var(--teal)', revisao: 'var(--violet)', simulado: 'var(--amber)', erros: 'var(--rose)', prova: 'var(--rose)' };
  let tab = 'hoje', busy = false;

  function css() {
    if (document.getElementById('plv2-css')) return;
    const s = document.createElement('style'); s.id = 'plv2-css';
    s.textContent = `
.plv2{max-width:1180px;margin:0 auto}
.plv2-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;margin-bottom:14px}
.plv2-bar h2{margin:0;font-size:20px;color:var(--text-primary)}
.plv2-sub{font-size:12px;color:var(--text-secondary)}
.plv2-btns{display:flex;flex-wrap:wrap;gap:6px}
.plv2 .b{background:var(--bg-surface);border:1px solid var(--border-muted);color:var(--text-primary);border-radius:var(--radius-md);padding:7px 11px;font-size:12.5px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.plv2 .b:hover{border-color:var(--teal-border);background:var(--teal-dim)}
.plv2 .b.pri{background:var(--teal);color:var(--text-inverse);border-color:var(--teal);font-weight:700}
.plv2 .b:disabled{opacity:.5;cursor:default}
.plv2-chat{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);display:flex;flex-direction:column;min-height:60vh;max-height:78vh}
.plv2-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.plv2-m{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.plv2-m.bot{background:var(--bg-elevated);border:1px solid var(--border-subtle);align-self:flex-start;color:var(--text-primary)}
.plv2-m.me{background:var(--teal-dim);border:1px solid var(--teal-border);align-self:flex-end;color:var(--text-primary)}
.plv2-q{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 8px}
.plv2-q button{background:transparent;border:1px solid var(--teal-border);color:var(--teal);border-radius:var(--radius-full);padding:6px 12px;font-size:12.5px;cursor:pointer}
.plv2-q button:hover{background:var(--teal-dim)}
.plv2-in{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border-subtle)}
.plv2-in textarea{flex:1;resize:none;background:var(--bg-base);color:var(--text-primary);border:1px solid var(--border-muted);border-radius:var(--radius-md);padding:9px 11px;font:inherit;font-size:16px;min-height:42px;max-height:120px}
.plv2-sum{margin:0 16px 10px;padding:10px 12px;background:var(--bg-base);border:1px dashed var(--teal-border);border-radius:var(--radius-md);font-size:12.5px;color:var(--text-secondary)}
.plv2-sum li{margin:2px 0}
.plv2-tabs{display:flex;gap:6px;margin-bottom:12px;overflow-x:auto}
.plv2-tabs button{white-space:nowrap}
.plv2-tabs .on{background:var(--teal-dim);border-color:var(--teal-border);color:var(--teal)}
.plv2-day{margin-bottom:18px}
.plv2-dh{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:8px 12px;background:var(--bg-elevated);border:1px solid var(--border-subtle);border-radius:var(--radius-md) var(--radius-md) 0 0;font-weight:700;font-size:14px;color:var(--text-primary);text-transform:capitalize}
.plv2-dh span{font-weight:500;font-size:12px;color:var(--text-secondary);text-transform:none}
.plv2-dh.hoje{border-color:var(--teal-border);color:var(--teal)}
.plv2-t{width:100%;border-collapse:collapse;background:var(--bg-surface);border:1px solid var(--border-subtle)}
.plv2-t th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);text-align:left;padding:7px 10px;border-bottom:1px solid var(--border-subtle);background:var(--bg-base)}
.plv2-t td{vertical-align:top;padding:10px;border-bottom:1px solid var(--border-subtle);font-size:13px;color:var(--text-primary);line-height:1.5}
.plv2-t tr.feito td{opacity:.5}
.plv2-t .tt{font-weight:700;font-size:13.5px}
.plv2-t .mt{font-size:11.5px;color:var(--text-secondary);margin-top:3px}
.plv2-pill{display:inline-block;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:99px;border:1px solid;margin-bottom:5px}
.plv2-st{display:flex;gap:7px;margin-bottom:8px}
.plv2-st i{font-size:16px;margin-top:2px;color:var(--teal);flex:none}
.plv2-st b{font-size:12px;color:var(--text-secondary)}
.plv2-rec{display:flex;gap:6px;align-items:center;width:100%;text-align:left;background:var(--bg-base);border:1px solid var(--border-muted);color:var(--text-primary);border-radius:var(--radius-sm);padding:6px 8px;margin-bottom:5px;font-size:12px;cursor:pointer}
.plv2-rec:hover{border-color:var(--teal-border);background:var(--teal-dim)}
.plv2-rec span{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.plv2-obs{font-size:12px;color:var(--text-secondary)}
.plv2-done{margin-top:8px}
.plv2-empty{padding:30px;text-align:center;color:var(--text-secondary);background:var(--bg-surface);border:1px dashed var(--border-muted);border-radius:var(--radius-lg)}
.plv2-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.plv2-chips em{font-style:normal;font-size:10.5px;color:var(--text-secondary);border:1px solid var(--border-muted);border-radius:99px;padding:1px 7px}
@media(max-width:820px){
 .plv2-t thead{display:none}
 .plv2-t,.plv2-t tbody,.plv2-t tr,.plv2-t td{display:block;width:100%}
 .plv2-t tr{border-bottom:6px solid var(--bg-void)}
 .plv2-t td{border-bottom:0;padding:8px 12px}
 .plv2-t td::before{content:attr(data-l);display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:4px}
 .plv2-m{max-width:94%}
}`;
    document.head.appendChild(s);
  }

  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.msg || j.error || ('Erro ' + r.status));
    return j;
  }

  /* ───────────── Chat ───────────── */
  const chatState = () => get(K_CHAT, { msgs: [], perfil: null, asking: '', jaExtras: false, quick: [], pronto: false, resumo: [] });

  function renderChat() {
    const st = chatState(); const r = root(); if (!r) return;
    const plano = get(K_PLAN, null);
    r.innerHTML = `<div class="plv2"><div class="plv2-bar"><div><h2>Planejador inteligente</h2><div class="plv2-sub">Converse comigo: o cronograma nasce das suas respostas e usa suas aulas e PDFs reais.</div></div>
      <div class="plv2-btns">${plano ? '<button class="b" onclick="plv2.voltar()"><i class="ph ph-calendar"></i> Ver cronograma</button>' : ''}<button class="b" onclick="plv2.reiniciar()"><i class="ph ph-arrow-counter-clockwise"></i> Recomeçar</button></div></div>
      <div class="plv2-chat"><div class="plv2-msgs" id="plv2-msgs">${st.msgs.map(m => `<div class="plv2-m ${m.role === 'user' ? 'me' : 'bot'}">${E(m.content)}</div>`).join('')}</div>
      ${st.pronto && st.resumo.length ? `<div class="plv2-sum"><b>O que entendi de você:</b><ul style="margin:6px 0 0 16px;padding:0">${st.resumo.map(x => `<li>${E(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="plv2-q" id="plv2-q">${(st.pronto ? ['Quero ajustar algo'] : []).concat(st.quick.filter(q => !st.pronto || !/gerar/i.test(q))).map(q => `<button onclick="plv2.enviar(${E(JSON.stringify(JSON.stringify(q)))})">${E(q)}</button>`).join('')}${st.pronto ? '<button class="b pri" style="border-radius:99px;background:var(--teal);color:var(--text-inverse);font-weight:700" onclick="plv2.gerar()"><i class="ph ph-magic-wand"></i> Gerar meu cronograma</button>' : ''}</div>
      <div class="plv2-in"><textarea id="plv2-txt" rows="1" placeholder="Escreva sua resposta…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();plv2.enviar()}"></textarea><button class="b pri" id="plv2-send" onclick="plv2.enviar()"><i class="ph ph-paper-plane-tilt"></i></button></div></div></div>`;
    const box = document.getElementById('plv2-msgs'); if (box) box.scrollTop = box.scrollHeight;
  }

  async function turno(texto) {
    if (busy) return; busy = true;
    const st = chatState();
    if (texto) st.msgs.push({ role: 'user', content: texto });
    st.quick = []; set(K_CHAT, st); renderChat();
    const box = document.getElementById('plv2-msgs');
    if (box) { const d = document.createElement('div'); d.className = 'plv2-m bot'; d.id = 'plv2-typing'; d.textContent = 'Pensando…'; box.appendChild(d); box.scrollTop = box.scrollHeight; }
    try {
      const j = await api('/api/planner/chat', { messages: st.msgs, perfil: st.perfil, asking: st.asking, jaExtras: st.jaExtras, hoje: hoje() });
      st.perfil = j.perfil; st.asking = j.asking || ''; st.jaExtras = !!j.jaExtras; st.quick = j.quickReplies || []; st.pronto = !!j.pronto; st.resumo = j.resumo || [];
      st.msgs.push({ role: 'model', content: j.reply });
    } catch (e) {
      st.msgs.push({ role: 'model', content: 'Não consegui falar com o servidor agora (' + e.message + '). Tente de novo em instantes.' });
    }
    set(K_CHAT, st); busy = false; renderChat();
  }

  /* ───────────── Cronograma ───────────── */
  async function gerar(opts) {
    if (busy) return; busy = true;
    const st = chatState(); const antigo = get(K_PLAN, null);
    if (window.toast) toast('Montando seu cronograma com as aulas do acervo…', 'info');
    try {
      const j = await api('/api/planner/generate-tasks', { perfil: (opts && opts.perfil) || st.perfil || (antigo && antigo.perfil), hoje: hoje(), dias: opts && opts.dias, retidas: antigo ? antigo.tarefas.filter(t => t.status === 'feito') : [] });
      set(K_PLAN, j.plan); sync();
      tab = 'hoje'; busy = false; renderPlano();
      enriquecer(true);
    } catch (e) { busy = false; if (window.toast) toast('Erro ao gerar: ' + e.message, 'error'); }
  }

  async function enriquecer(silencioso) {
    const plano = get(K_PLAN, null); if (!plano) return;
    const alvo = plano.tarefas.filter(t => t.tipo === 'estudo' && t.status !== 'feito' && !t.ia && t.data >= hoje()).slice(0, 10);
    if (!alvo.length) { if (!silencioso && window.toast) toast('Tudo já está detalhado.', 'success'); return; }
    try {
      const j = await api('/api/planner/enrich', { perfil: plano.perfil, tarefas: alvo });
      const n = Object.keys(j.itens || {}).length;
      if (!n) { if (!silencioso && window.toast) toast(j.ia ? 'A IA não devolveu melhorias agora.' : 'IA indisponível: mantive o passo a passo padrão.', 'warning'); return; }
      const p2 = get(K_PLAN, null);
      p2.tarefas.forEach(t => { const it = j.itens[t.id]; if (!it) return; t.passos.forEach((s, i) => (s.texto = it.passos[i])); if (it.observacoes) t.observacoes = it.observacoes + (t.observacoes ? ' ' + (t.observacoes.match(/Revisões automáticas[^]*$/) || [''])[0] : ''); t.ia = true; });
      set(K_PLAN, p2); sync(); if (document.getElementById('plv2-lista')) renderPlano();
      if (!silencioso && window.toast) toast(n + ' tarefas detalhadas pela IA ✨', 'success');
    } catch (_) {}
  }

  function tarefaRow(t) {
    const cor = COR[t.tipo] || 'var(--teal)';
    const passos = (t.passos || []).map(s => `<div class="plv2-st"><i class="ph ${ICON[s.acao] || 'ph-check'}"></i><div><b>${E(NOME[s.acao] || s.acao)}${s.minutos ? ' · ' + s.minutos + ' min' : ''}</b><div>${E(s.texto)}</div></div></div>`).join('');
    const recs = (t.recursos || []).map((r, i) => {
      const ic = r.tipo === 'video' ? 'ph-play-circle' : r.tipo === 'pdf' ? 'ph-file-pdf' : r.tipo === 'questoes' || r.tipo === 'simulado' ? 'ph-list-checks' : r.tipo === 'erros' ? 'ph-warning-circle' : 'ph-cards';
      const rot = r.tipo === 'video' ? 'Aula' : r.tipo === 'pdf' ? (r.rotulo || 'Resumo/PDF') : r.tipo === 'questoes' ? 'Questões' : r.tipo === 'simulado' ? 'Simulado' : r.tipo === 'erros' ? 'Caderno de erros' : 'Flashcards';
      return `<button class="plv2-rec" onclick="plv2.abrir('${E(t.id)}',${i})"><i class="ph ${ic}" style="color:var(--teal);font-size:16px"></i><span><b>${rot}:</b> ${E(String(r.titulo).replace(/^(Questões|Flashcards|Aula): /, ''))}</span></button>`;
    }).join('');
    const est = t.estrategia || {}; const chips = Object.entries(est).filter(([, v]) => v).map(([k, v]) => `<em>${E(NOME[k] || k)} ${v}′</em>`).join('');
    return `<tr class="${t.status === 'feito' ? 'feito' : ''}"><td data-l="Tarefa"><span class="plv2-pill" style="color:${cor};border-color:${cor}">${({ estudo: 'ESTUDO', revisao: 'REVISÃO', simulado: 'SIMULADO', erros: 'ERROS', prova: 'PROVA' })[t.tipo] || 'TAREFA'}</span><div class="tt">${E(t.titulo)}</div><div class="mt">${t.minutos ? fmtMin(t.minutos) : ''}${t.ia ? ' · ✨ detalhado por IA' : ''}</div><div class="plv2-chips">${chips}</div>
      ${t.tipo !== 'prova' ? `<div class="plv2-done"><button class="b" onclick="plv2.feito('${E(t.id)}')">${t.status === 'feito' ? '<i class="ph ph-check-circle" style="color:var(--green)"></i> Concluída' : '<i class="ph ph-circle"></i> Marcar como feita'}</button></div>` : ''}</td>
      <td data-l="Passo a passo">${passos}</td><td data-l="Materiais">${recs || '<span class="plv2-obs">—</span>'}</td><td data-l="Observações"><div class="plv2-obs">${E(t.observacoes || '')}</div></td></tr>`;
  }

  function renderPlano() {
    const r = root(); if (!r) return; css();
    const plano = get(K_PLAN, null);
    if (!plano) return renderChat();
    const h = hoje();
    let ts = plano.tarefas;
    const atrasadas = ts.filter(t => t.data < h && t.status !== 'feito' && t.tipo !== 'prova');
    if (tab === 'hoje') ts = ts.filter(t => t.data === h);
    else if (tab === 'semana') { const fim = new Date(h + 'T00:00:00Z'); fim.setUTCDate(fim.getUTCDate() + 7); ts = ts.filter(t => t.data >= h && t.data < fim.toISOString().slice(0, 10)); }
    else if (tab === 'atrasadas') ts = atrasadas;
    else ts = ts.filter(t => t.data >= h);
    const porDia = {}; ts.forEach(t => (porDia[t.data] = porDia[t.data] || []).push(t));
    const dias = Object.keys(porDia).sort();
    const done = plano.tarefas.filter(t => t.status === 'feito' && t.tipo !== 'prova').length, tot = plano.tarefas.filter(t => t.tipo !== 'prova').length;
    const tabs = [['hoje', 'Hoje'], ['semana', 'Próximos 7 dias'], ['tudo', 'Tudo'], ['atrasadas', 'Atrasadas' + (atrasadas.length ? ' (' + atrasadas.length + ')' : '')]];
    r.innerHTML = `<div class="plv2"><div class="plv2-bar"><div><h2>Seu cronograma</h2><div class="plv2-sub">${done}/${tot} tarefas concluídas · de ${plano.inicio.split('-').reverse().slice(0, 2).join('/')} a ${plano.fim.split('-').reverse().slice(0, 2).join('/')}${plano.perfil && plano.perfil.dataProva ? ' · prova ' + plano.perfil.dataProva.split('-').reverse().join('/') : ''}</div></div>
      <div class="plv2-btns"><button class="b pri" onclick="plv2.conversar()"><i class="ph ph-chats-circle"></i> Conversar / ajustar</button><button class="b" onclick="plv2.maisSemanas()"><i class="ph ph-calendar-plus"></i> +4 semanas</button><button class="b" onclick="plv2.ia()"><i class="ph ph-sparkle"></i> Detalhar com IA</button>${atrasadas.length ? '<button class="b" onclick="plv2.reagendar()"><i class="ph ph-arrows-clockwise"></i> Reagendar atrasadas</button>' : ''}${legacyRender ? '<button class="b" onclick="plv2.antigo()"><i class="ph ph-clock-counter-clockwise"></i> Planner antigo</button>' : ''}</div></div>
      <div class="plv2-tabs">${tabs.map(([k, n]) => `<button class="b ${tab === k ? 'on' : ''}" onclick="plv2.aba('${k}')">${n}</button>`).join('')}</div>
      <div id="plv2-lista">${dias.length ? dias.map(d => { const lst = porDia[d]; const m = lst.reduce((a, t) => a + (t.minutos || 0), 0); return `<div class="plv2-day"><div class="plv2-dh ${d === h ? 'hoje' : ''}">${fmtDia(d)}${d === h ? ' · hoje' : ''}<span>${m ? fmtMin(m) + ' planejados' : ''}</span></div><table class="plv2-t"><thead><tr><th style="width:21%">Tarefa</th><th style="width:36%">Passo a passo</th><th style="width:23%">Materiais</th><th>Observações</th></tr></thead><tbody>${lst.map(tarefaRow).join('')}</tbody></table></div>`; }).join('') : `<div class="plv2-empty">${tab === 'hoje' ? 'Nada agendado para hoje — dia livre no seu cronograma. 🎉' : tab === 'atrasadas' ? 'Nenhuma tarefa atrasada.' : 'Nada por aqui.'}</div>`}</div></div>`;
  }

  /* ───────────── Abrir materiais ───────────── */
  function abrir(tid, idx) {
    const plano = get(K_PLAN, null); if (!plano) return;
    const t = plano.tarefas.find(x => x.id === tid); const rec = t && t.recursos[idx]; if (!rec) return;
    try {
      if (rec.tipo === 'video') {
        go('view-acervo');
        const abre = () => { if (window.AC2 && AC2.indice && AC2.indice.has(rec.id)) ac2Abrir(rec.id); else if (typeof openDriveItemById === 'function') openDriveItemById(rec.id); else toast('Aula não encontrada no acervo.', 'warning'); };
        if (typeof ac2Init === 'function') ac2Init().then(abre).catch(abre); else abre();
      } else if (rec.tipo === 'pdf') {
        window.open(window.cuscuzMediaUrl ? cuscuzMediaUrl('/api/drive/pdf/' + encodeURIComponent(rec.id)) : '/api/drive/pdf/' + encodeURIComponent(rec.id), '_blank');
      } else if (rec.tipo === 'questoes') {
        iniciarSimuladoDoTema(rec.tema || t.tema, rec.disc || t.materia, []);
      } else if (rec.tipo === 'flashcards') {
        go('view-treino'); setTimeout(() => { try { startFC(); } catch (_) {} }, 150);
      } else if (rec.tipo === 'erros') {
        go('view-treino'); setTimeout(() => { try { startWrongQuiz(); } catch (_) {} }, 150);
      } else if (rec.tipo === 'simulado') {
        go('view-simulados');
      }
    } catch (e) { if (window.toast) toast('Não consegui abrir: ' + e.message, 'error'); }
  }

  /* ───────────── API pública ───────────── */
  window.plv2 = {
    enviar(txt) { const el = document.getElementById('plv2-txt'); let v = txt !== undefined ? JSON.parse(txt) : (el ? el.value.trim() : ''); if (!v) return; if (/^gerar meu cronograma$/i.test(v)) return gerar(); turno(v); },
    gerar() { gerar(); },
    aba(k) { tab = k; renderPlano(); },
    feito(id) { const p = get(K_PLAN, null); const t = p && p.tarefas.find(x => x.id === id); if (!t) return; t.status = t.status === 'feito' ? 'pendente' : 'feito'; set(K_PLAN, p); sync(); renderPlano(); },
    conversar() {
      const p = get(K_PLAN, null); const st = chatState();
      st.perfil = (p && p.perfil) || st.perfil; st.pronto = false; st.asking = ''; st.jaExtras = true;
      st.msgs.push({ role: 'model', content: 'Claro! O que mudou ou o que você quer ajustar? (horário, prova nova, matéria que está pesando, cansaço…) Vou adaptar o cronograma daqui para frente e manter o que você já fez.' });
      st.quick = ['Mudou meu tempo disponível', 'Tenho uma prova nova', 'Quero mais questões', 'Quero focar numa matéria']; set(K_CHAT, st); renderChat();
    },
    voltar() { renderPlano(); },
    reiniciar() { if (!confirm('Recomeçar a conversa? (seu cronograma atual é mantido até você gerar outro)')) return; localStorage.removeItem(K_CHAT); init(true); },
    maisSemanas() { const p = get(K_PLAN, null); if (!p) return; const dias = Math.round((new Date(p.fim) - new Date(hoje())) / 864e5) + 1 + 28; gerar({ dias: Math.min(120, Math.max(28, dias)) }); },
    reagendar() { gerar({}); },
    ia() { enriquecer(false); },
    antigo() { if (legacyRender) legacyRender(); },
    abrir
  };

  function init(forceChat) {
    css();
    const plano = get(K_PLAN, null);
    if (plano && !forceChat) return renderPlano();
    const st = chatState();
    if (!st.msgs.length) { renderChat(); turno(''); } else renderChat();
  }
  window.renderPlannerIA = function () { init(false); };
})();
