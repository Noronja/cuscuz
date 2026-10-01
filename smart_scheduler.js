// ══════════════════════════════════════════════════════════════════════════════════
// MOTOR DE AGENDAMENTO INTELIGENTE — CUSCUZ-MED
// 1. Seletor de Modo: [Modo Híbrido: Faculdade + Residência] vs [Modo Foco Total: Apenas Graduação]
// 2. Ingestão Racional de Tempo & Dias de Estágio/Aulas Práticas (Baixa Energia)
// 3. Método de 3 Fases: Aquisição (50%), Revisão Ativa (30%), Modo Sobrevivência (<= 14d)
// 4. Formato de Saída Estruturado com Cards Interativos
// ══════════════════════════════════════════════════════════════════════════════════

export function plIso(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date();
  return dt.toISOString().slice(0, 10);
}

export function plAddDias(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return plIso(d);
}

export function plDiff(d1, d2) {
  const t1 = new Date(d1 + 'T12:00:00').getTime();
  const t2 = new Date(d2 + 'T12:00:00').getTime();
  return Math.round((t2 - t1) / 86400000);
}

export function hwqNorm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function plDeckKey(materia, tema) {
  return hwqNorm(materia || 'Geral') + '::' + hwqNorm(tema || 'Estudo');
}

export function gerarQuestoesIds(materia, tema, count = 5) {
  const normMat = hwqNorm(materia || 'geral').slice(0, 4);
  const normTema = hwqNorm(tema || 'estudo').replace(/[^a-z0-9]/g, '').slice(0, 8) || 'med';
  const ids = [];
  for (let i = 1; i <= count; i++) {
    ids.push(`q-${normMat}-${normTema}-${String(i).padStart(2, '0')}`);
  }
  return ids;
}

export function detectarTipoEvento(str) {
  const s = hwqNorm(str || '');
  if (/\btbl\b|team.based|irat|trat/i.test(s)) return 'tbl';
  if (/\bosce\b|pratica|habilidade|checklist/i.test(s)) return 'osce';
  if (/\bpbl\b|tutoria|abertura|fechamento/i.test(s)) return 'pbl';
  if (/seminario|apresentacao/i.test(s)) return 'seminario';
  return 'prova';
}

const TOPICOS_FACULDADE_CANONICOS = [
  { tema: 'Antibioticoterapia & Sepse', materia: 'Clínica Médica' },
  { tema: 'Hipertensão Arterial Sistêmica & Crise Hipertensiva', materia: 'Clínica Médica' },
  { tema: 'Insuficiência Cardíaca & Choque Cardiogênico', materia: 'Clínica Médica' },
  { tema: 'Diabetes Mellitus & Cetoacidose Diabética', materia: 'Clínica Médica' },
  { tema: 'Semiologia Médica & Raciocínio Clínico', materia: 'Clínica Médica' },
  { tema: 'Doença Pulmonar Obstrutiva Crônica (DPOC) & Asma', materia: 'Clínica Médica' },
  { tema: 'Insuficiência Renal Aguda & Glomerulopatias', materia: 'Clínica Médica' },
  { tema: 'Abdome Agudo Inflamatório, Obstrutivo & Perfurativo', materia: 'Cirurgia Geral' },
  { tema: 'Trauma & Protocolo ATLS (Vias Aéreas, Torácico e Choque)', materia: 'Cirurgia Geral' },
  { tema: 'Hérnias da Parede Abdominal & Complicações', materia: 'Cirurgia Geral' },
  { tema: 'Litíase Biliar, Colecistite & Coledocolitíase', materia: 'Cirurgia Geral' },
  { tema: 'Pré-natal de Baixo e Alto Risco & Modificações Fisiológicas', materia: 'Ginecologia e Obstetrícia' },
  { tema: 'Síndromes Hipertensivas da Gravidez (Pré-eclâmpsia e Eclâmpsia)', materia: 'Ginecologia e Obstetrícia' },
  { tema: 'Hemorragias da Primeira e Segunda Metade da Gestação', materia: 'Ginecologia e Obstetrícia' },
  { tema: 'Sangramento Uterino Anormal & Miomatose Uterina', materia: 'Ginecologia e Obstetrícia' },
  { tema: 'Puericultura & Marcos do Neurodesenvolvimento Infantil', materia: 'Pediatria' },
  { tema: 'Diarreia Aguda, Desidratação & Terapia de Reidratação Oral (TRO)', materia: 'Pediatria' },
  { tema: 'Infecções de Vias Aéreas Superiores e Inferiores na Infância', materia: 'Pediatria' },
  { tema: 'Aleitamento Materno & Alimentação Complementar', materia: 'Pediatria' },
  { tema: 'Atenção Primária à Saúde, Princípios e Diretrizes do SUS', materia: 'Medicina Preventiva' },
  { tema: 'Estudos Epidemiológicos, Desenhos de Pesquisa & Bioestatística', materia: 'Medicina Preventiva' },
  { tema: 'Vigilância em Saúde, Notificação Compulsória & Saúde do Trabalhador', materia: 'Medicina Preventiva' }
];

export function plGerarPlanSinergia(config, extras = {}) {
  const hoje = config.inicio || plIso(new Date());
  const energia = config.energiaPosFaculdade || 'moderada';
  const modoEstudo = config.modoEstudo || 'hibrido'; // 'hibrido' ou 'foco_graduacao'
  const diasEstagio = Array.isArray(config.diasEstagio) ? config.diasEstagio.map(Number) : [];
  const dataAlvoResid = config.dataAlvoResidencia || plAddDias(hoje, 120);

  // Normaliza provas cadastradas e detectadas
  const todasProvas = (config.provas || []).map(p => ({
    ...p,
    tipo: p.tipo || (/resid|r1|enare|usp|unifesp|sus/i.test(p.nome) ? 'resid' : 'grad')
  })).sort((a, b) => (a.data < b.data ? -1 : 1));

  const provasFaculdade = todasProvas.filter(p => p.tipo === 'grad');

  // Horizonte do cronograma:
  // Se for 'foco_graduacao', baliza pela última avaliação da faculdade (+ 15 dias de consolidação)
  let fim = dataAlvoResid;
  if (modoEstudo === 'foco_graduacao' && provasFaculdade.length) {
    const ultProva = provasFaculdade[provasFaculdade.length - 1].data;
    fim = plAddDias(ultProva, 15);
  } else if (todasProvas.length) {
    const ultProva = todasProvas[todasProvas.length - 1].data;
    if (plDiff(ultProva, fim) > 0) fim = ultProva;
  }
  if (!fim || plDiff(hoje, fim) < 21) {
    fim = plAddDias(hoje, 120);
  }

  if (plDiff(hoje, fim) < 0) return { erro: 'A data final precisa ser hoje ou posterior.' };

  // Mapeamento de Provas da Faculdade e Gatilho do Modo Sobrevivência (<= 14 dias antes da prova)
  const protecaoDias = {};
  provasFaculdade.forEach(pf => {
    const tipoEv = pf.tipoEvento || detectarTipoEvento(pf.nome);
    const maxOffset = 14; // 1 a 2 semanas antes da avaliação
    for (let offset = -maxOffset; offset <= 0; offset++) {
      const d = plAddDias(pf.data, offset);
      if (plDiff(hoje, d) >= 0 && plDiff(d, fim) >= 0) {
        if (!protecaoDias[d] || offset === 0) {
          protecaoDias[d] = {
            provaNome: pf.nome,
            materia: pf.materia || 'Graduação',
            tipoEvento: tipoEv,
            diasAte: Math.abs(offset),
            isDiaDoEvento: offset === 0
          };
        }
      }
    }
  });

  // Capacidade diária baseada na energia
  const slotsPorDiaSemana = {
    baixa: { util: 2, fimDeSemana: 3 },
    moderada: { util: 2, fimDeSemana: 4 },
    alta: { util: 3, fimDeSemana: 4 }
  }[energia] || { util: 2, fimDeSemana: 3 };

  // Sinergias detectadas
  const sinergiaLista = extras.sinergiaMatches || [];
  const temasSinergicosMap = new Map();
  sinergiaLista.forEach(s => {
    temasSinergicosMap.set(hwqNorm(s.tema), s);
  });

  // 100% Integração da Ementa da Faculdade (Manual do Aluno)
  const conteudosFaculdadeExtras = extras.conteudosFaculdade || [];
  const todosTopicosFaculdadeMap = new Map();
  conteudosFaculdadeExtras.forEach(cf => {
    if (cf && cf.tema) {
      todosTopicosFaculdadeMap.set(hwqNorm(cf.tema), {
        tema: cf.tema,
        materia: cf.materia || 'Clínica Médica',
        sinergia: !!cf.sinergia || temasSinergicosMap.has(hwqNorm(cf.tema)),
        sinergiaScore: cf.score || 98
      });
    }
  });

  if (todosTopicosFaculdadeMap.size === 0) {
    TOPICOS_FACULDADE_CANONICOS.forEach(tc => {
      todosTopicosFaculdadeMap.set(hwqNorm(tc.tema), {
        ...tc,
        sinergia: temasSinergicosMap.has(hwqNorm(tc.tema)),
        sinergiaScore: 98
      });
    });
  }

  const totalTopicosFaculdade = todosTopicosFaculdadeMap.size;

  // FILA DE CONTEÚDO (DIRETRIZ 1: SELETOR DE MODO)
  // Se for 'foco_graduacao', SUSPENDE todas as metas de cursinho de residência!
  const materias = (config.materias || []).filter(m => m.nome);
  const filaConteudo = [];

  // 1) Temas da Faculdade
  todosTopicosFaculdadeMap.forEach(item => {
    if (modoEstudo !== 'foco_graduacao' && (item.sinergia || temasSinergicosMap.has(hwqNorm(item.tema)))) {
      const match = temasSinergicosMap.get(hwqNorm(item.tema)) || {};
      filaConteudo.push({
        materia: item.materia,
        tema: item.tema,
        dificuldade: 'Sinergia 100%',
        sinergia: true,
        sinergiaScore: match.score || item.sinergiaScore || 98,
        sinergiaDesc: match.desc || 'Sinergia 100%: Conteúdo simultâneo da Faculdade e da Residência Médica',
        origem: 'faculdade_sinergia',
        ementaFaculdade: true,
        key: plDeckKey(item.materia, item.tema)
      });
    } else {
      filaConteudo.push({
        materia: item.materia,
        tema: item.tema,
        dificuldade: modoEstudo === 'foco_graduacao' ? 'Graduação Foco Total' : 'Ementa Faculdade',
        sinergia: false,
        origem: 'faculdade',
        focoFaculdade: true,
        ementaFaculdade: true,
        desc: modoEstudo === 'foco_graduacao'
          ? '🎓 Ementa da Graduação (Foco 100% Faculdade)'
          : '🎓 Conteúdo da Faculdade (100% Integrado à rotina)',
        key: plDeckKey(item.materia, item.tema)
      });
    }
  });

  // 2) Tópicos de Residência (SOMENTE SE MODO HÍBRIDO)
  if (modoEstudo !== 'foco_graduacao') {
    const conteudosResidenciaExtras = extras.conteudosResidencia || [];
    conteudosResidenciaExtras.forEach(cr => {
      if (cr && cr.tema && !todosTopicosFaculdadeMap.has(hwqNorm(cr.tema)) && !temasSinergicosMap.has(hwqNorm(cr.tema))) {
        filaConteudo.push({
          materia: cr.materia || 'Residência Médica',
          tema: cr.tema,
          dificuldade: 'Residência R1',
          sinergia: false,
          origem: 'residencia',
          ementaResidencia: true,
          desc: '🏥 Cursinho de Residência Médica (100% Coberto)',
          key: plDeckKey(cr.materia || 'Residência Médica', cr.tema)
        });
      }
    });

    // Complementos da matriz canônica de residência
    materias.forEach(m => {
      const temasIA = extras.temasPorMateria && extras.temasPorMateria[m.nome];
      const baseTemas = Array.isArray(temasIA) && temasIA.length ? temasIA : [
        'Semiologia & Diagnóstico', 'Condutas Terapêuticas', 'Emergências Clínicas', 'Questões de Alto Rendimento'
      ];
      baseTemas.forEach(tema => {
        if (!todosTopicosFaculdadeMap.has(hwqNorm(tema)) && !temasSinergicosMap.has(hwqNorm(tema)) && !filaConteudo.some(f => hwqNorm(f.tema) === hwqNorm(tema))) {
          filaConteudo.push({
            materia: m.nome,
            tema,
            dificuldade: m.dificuldade || 'Médio',
            sinergia: false,
            origem: 'residencia',
            key: plDeckKey(m.nome, tema)
          });
        }
      });
    });
  }

  // Pendentes anteriores / imprevistos
  (extras.pendentes || []).forEach(p => filaConteudo.unshift(p));

  // Agendador de repetição espaçada ativa (24h, 7d, 30d)
  const revisoesAgendadas = {};
  function agendarRevisoesSinergia(deData, bloco) {
    [{ tipo: 'revisao24', off: 1 }, { tipo: 'revisao7', off: 7 }, { tipo: 'revisao30', off: 30 }].forEach(({ tipo, off }) => {
      let d = plAddDias(deData, off);
      if (plDiff(d, fim) >= 0) {
        revisoesAgendadas[d] = revisoesAgendadas[d] || [];
        revisoesAgendadas[d].push({
          tipo,
          materia: bloco.materia,
          tema: bloco.tema,
          key: bloco.key,
          dificuldade: bloco.dificuldade,
          sinergia: !!bloco.sinergia,
          horas: 1,
          status: 'pendente'
        });
      }
    });
  }

  const dias = [];
  let ci = 0;

  for (let curr = new Date(hoje + 'T12:00:00'); plDiff(plIso(curr), fim) >= 0; curr.setDate(curr.getDate() + 1)) {
    const data = plIso(curr);
    const dow = curr.getDay(); // 0 = Dom, 6 = Sáb
    const isFimDeSemana = dow === 0 || dow === 6;
    const isEstagio = diasEstagio.includes(dow);
    const horasConfig = config.horasDia || 4;

    // Racionalidade de tempo: nos dias de estágio/aulas práticas, dia de baixa energia (50% da carga extraclasse)
    const horasDiaReal = isEstagio
      ? Math.min(2, Math.max(1, Math.round(horasConfig * 0.5 * 10) / 10))
      : (isFimDeSemana ? Math.min(horasConfig + 1, 6) : horasConfig);

    // Detecção automática de Modo Sobrevivência / Atenção para Prova (1 a 2 semanas antes: <= 14 dias)
    let provaProxima = null;
    for (const pf of provasFaculdade) {
      const diff = plDiff(data, pf.data);
      if (diff >= 0 && diff <= 14) {
        if (!provaProxima || diff < provaProxima.diasAte) {
          provaProxima = {
            nome: pf.nome,
            materia: pf.materia || 'Graduação',
            diasAte: diff,
            data: pf.data,
            tipoEvento: pf.tipoEvento || detectarTipoEvento(pf.nome),
            isDiaDoEvento: diff === 0
          };
        }
      }
    }

    const emModoSobrevivencia = !!(provaProxima && provaProxima.diasAte <= 14 && !provaProxima.isDiaDoEvento);
    const isDiaDaProva = !!(provaProxima && provaProxima.isDiaDoEvento);
    const statusAlerta = isDiaDaProva ? 'dia_prova' : (emModoSobrevivencia ? 'atencao_prova' : 'normal');

    const blocos = [];
    const metodo3Fases = {
      aquisicao: null,
      revisaoAtiva: null,
      sobrevivencia: null
    };

    const horasAquisicao = Math.round(horasDiaReal * 0.5 * 10) / 10;
    const horasRevisao = Math.round(horasDiaReal * 0.3 * 10) / 10;
    const horasConsolidacao = Math.max(0.5, Math.round((horasDiaReal - horasAquisicao - horasRevisao) * 10) / 10);
    const horasSimulado = Math.round(horasDiaReal * 0.6 * 10) / 10;
    const horasRevisaoIntensa = Math.round((horasDiaReal - horasSimulado) * 10) / 10;
    let conteudoAlocado = null;
    let revAlocada = null;
    let temaRev = 'Medicina Geral';
    let matRev = 'Clínica Médica';

    if (isDiaDaProva) {
      // DIA OFICIAL DA PROVA / TBL / OSCE
      const evTipo = provaProxima.tipoEvento || 'prova';
      const labelEv = evTipo === 'tbl' ? '👥 Sessão Oficial de TBL (iRAT + tRAT)'
        : (evTipo === 'osce' ? '🩺 Avaliação Prática OSCE de Habilidades Clínicas'
        : '🎯 Prova Oficial da Faculdade');

      blocos.push({
        id: 'prova-' + data,
        tipo: 'prova',
        tipoEvento: evTipo,
        fase: 'avaliacao',
        prova: provaProxima.nome,
        materia: provaProxima.materia,
        horas: 0,
        status: 'pendente',
        desc: labelEv
      });
      metodo3Fases.sobrevivencia = {
        ativada: true,
        isDiaDoEvento: true,
        provaNome: provaProxima.nome,
        acao: labelEv
      };
    } else if (emModoSobrevivencia) {
      // 🚨 MODO SOBREVIVÊNCIA ATIVADO (1 A 2 SEMANAS ANTES DA PROVA)
      // Cancela aulas inéditas! Foco 100% em provas antigas, simulados e revisão ativa intensiva
      const blocoSimulado = {
        id: 'sob-sim-' + data,
        tipo: 'simulado_prova',
        fase: 'sobrevivencia',
        materia: provaProxima.materia,
        tema: `Resolução de Provas Antigas & Simulado da Banca (${provaProxima.nome})`,
        horas: horasSimulado,
        protecao: true,
        focoFaculdade: true,
        status: 'pendente',
        desc: `🚨 Modo Sobrevivência Ativo (${provaProxima.diasAte}d para a prova). Aulas inéditas canceladas! Foco total em treinar com questões e provas anteriores da faculdade.`
      };

      const blocoRevisaoIntensa = {
        id: 'sob-rev-' + data,
        tipo: 'revisao_intensiva',
        fase: 'sobrevivencia',
        materia: provaProxima.materia,
        tema: `Revisão Ativa Intensiva & Checklists (${provaProxima.materia})`,
        horas: horasRevisaoIntensa,
        protecao: true,
        focoFaculdade: true,
        status: 'pendente',
        desc: 'Revisão ativa focal: critérios diagnósticos, condutas de primeira linha e pontos críticos da banca.'
      };

      blocos.push(blocoSimulado, blocoRevisaoIntensa);

      metodo3Fases.aquisicao = {
        cancelada: true,
        motivo: `Aulas inéditas suspensas: Modo Sobrevivência ativo (${provaProxima.diasAte}d para ${provaProxima.nome}).`
      };
      metodo3Fases.revisaoAtiva = {
        tema: `Revisão Ativa Intensiva (${provaProxima.materia})`,
        metodo: 'Flashcards de Alta Retenção & Casos Clínicos da Prova',
        horas: horasRevisaoIntensa
      };
      metodo3Fases.sobrevivencia = {
        ativada: true,
        provaNome: provaProxima.nome,
        diasAte: provaProxima.diasAte,
        horas: horasSimulado,
        acao: 'Resolução de Provas Antigas & Simulado da Faculdade'
      };
    } else {
      // DIA NORMAL DE ESTUDO (MÉTODO DE 3 FASES: 50% AQUISIÇÃO, 30% REVISÃO ATIVA, 20% CONSOLIDAÇÃO)
      // 1) Área de Estudo (Aquisição: 50% do tempo)
      if (ci < filaConteudo.length) {
        conteudoAlocado = filaConteudo[ci];
        ci++;
      } else {
        const matAlvo = materias.length ? materias[blocos.length % materias.length].nome : 'Clínica Médica';
        conteudoAlocado = {
          materia: matAlvo,
          tema: 'Aprofundamento Clínico & Terapêutico',
          dificuldade: 'Avançado',
          sinergia: false,
          key: plDeckKey(matAlvo, 'Aprofundamento Clínico')
        };
      }

      const blocoAquisicao = {
        id: 'aq-' + data,
        tipo: 'conteudo',
        fase: 'aquisicao',
        materia: conteudoAlocado.materia,
        tema: conteudoAlocado.tema,
        key: conteudoAlocado.key,
        dificuldade: conteudoAlocado.dificuldade,
        sinergia: !!conteudoAlocado.sinergia,
        sinergiaDesc: conteudoAlocado.sinergiaDesc,
        focoFaculdade: !!conteudoAlocado.focoFaculdade,
        horas: horasAquisicao,
        status: 'pendente',
        formato: 'Videoaula / Leitura de Apostila',
        desc: `📖 Área de Estudo (Aquisição · 50% do tempo): Primeiro contato aprofundado com ${conteudoAlocado.tema}. Alocação de videoaula no LMS e leitura dirigida.`
      };
      blocos.push(blocoAquisicao);

      agendarRevisoesSinergia(data, conteudoAlocado);

      // 2) Área de Revisão (Estudo Ativo Obrigatório: 30% do tempo)
      const revsDoDia = revisoesAgendadas[data] || [];
      revAlocada = revsDoDia.length ? revsDoDia.shift() : null;
      temaRev = revAlocada ? revAlocada.tema : (conteudoAlocado ? conteudoAlocado.tema : 'Medicina Geral');
      matRev = revAlocada ? revAlocada.materia : (conteudoAlocado ? conteudoAlocado.materia : 'Clínica Médica');

      const blocoRevisao = {
        id: 'rev-' + data,
        tipo: revAlocada ? revAlocada.tipo : 'revisao24',
        fase: 'revisao_ativa',
        materia: matRev,
        tema: temaRev,
        key: revAlocada ? revAlocada.key : plDeckKey(matRev, temaRev),
        horas: horasRevisao,
        status: 'pendente',
        metodo: 'Flashcards SRS + Questões Práticas',
        desc: `🧠 Área de Revisão (Estudo Ativo · 30% do tempo): Repetição espaçada obrigatória de ${temaRev}. NUNCA leitura passiva; apenas recall ativo com flashcards e resolução de questões.`
      };
      blocos.push(blocoRevisao);

      // 3) Bloco de Consolidação Prática (20% do tempo)
      const blocoTreino = {
        id: 'quest-' + data,
        tipo: 'questoes',
        fase: 'consolidacao',
        materia: conteudoAlocado.materia,
        tema: `Treino de Questões Comentadas: ${conteudoAlocado.tema}`,
        horas: horasConsolidacao,
        status: 'pendente',
        desc: `✏️ Fixação Prática: Bateria de 10 a 15 questões comentadas do tema estudado hoje para consolidar o aprendizado.`
      };
      blocos.push(blocoTreino);

      metodo3Fases.aquisicao = {
        tema: conteudoAlocado.tema,
        materia: conteudoAlocado.materia,
        formato: 'Videoaula / Apostila',
        horas: horasAquisicao,
        duracaoMin: Math.round(horasAquisicao * 60)
      };
      metodo3Fases.revisaoAtiva = {
        tema: temaRev,
        materia: matRev,
        metodo: 'Flashcards SRS + Questões Práticas',
        horas: horasRevisao,
        duracaoMin: Math.round(horasRevisao * 60)
      };
      metodo3Fases.sobrevivencia = {
        ativada: false,
        msg: 'Aulas regulares ativas. Modo Sobrevivência entrará automaticamente a 14 dias da prova.'
      };
    }

    // Formatação dos Blocos segundo a Arquitetura de 3 Fases
    const blocoEstudoOut = emModoSobrevivencia ? {
      fase: 'A) Área de Estudo (Aquisição)',
      materia: provaProxima.materia,
      tema: `Aulas inéditas suspensas (Modo Sobrevivência: ${provaProxima.nome})`,
      horas: 0,
      tempoMin: 0,
      cancelada: true,
      formato: 'Videoaula Suspensa',
      linkAula: null,
      desc: `Aulas inéditas canceladas: Foco 100% em simulados e revisão para a prova da faculdade.`
    } : (isDiaDaProva ? {
      fase: 'A) Área de Estudo (Aquisição)',
      materia: provaProxima.materia,
      tema: `Dia Oficial da Avaliação: ${provaProxima.nome}`,
      horas: 0,
      tempoMin: 0,
      cancelada: true,
      formato: 'Avaliação Presencial',
      linkAula: null,
      desc: `Dia da prova oficial: sem novos conteúdos.`
    } : {
      fase: 'A) Área de Estudo (Aquisição)',
      materia: conteudoAlocado.materia,
      tema: conteudoAlocado.tema,
      horas: horasAquisicao,
      tempoMin: Math.round(horasAquisicao * 60),
      cancelada: false,
      formato: 'Videoaula + Leitura de Apostila',
      linkAula: `/aula.html?tema=${encodeURIComponent(conteudoAlocado.tema)}&materia=${encodeURIComponent(conteudoAlocado.materia)}`,
      aulaId: `aula-${hwqNorm(conteudoAlocado.tema).slice(0, 20)}`,
      desc: `Primeiro contato com ${conteudoAlocado.tema} (50% do tempo). Assista à videoaula e leia a apostila dirigida.`
    });

    const temaRevFinal = emModoSobrevivencia
      ? `Revisão Ativa Intensiva (${provaProxima.materia})`
      : (isDiaDaProva ? provaProxima.nome : (revAlocada ? revAlocada.tema : (conteudoAlocado ? conteudoAlocado.tema : 'Medicina Geral')));
    const matRevFinal = emModoSobrevivencia
      ? provaProxima.materia
      : (isDiaDaProva ? provaProxima.materia : (revAlocada ? revAlocada.materia : (conteudoAlocado ? conteudoAlocado.materia : 'Clínica Médica')));
    const horasRevFinal = emModoSobrevivencia ? horasRevisaoIntensa : (isDiaDaProva ? 0 : horasRevisao);
    const questoesIdsRev = gerarQuestoesIds(matRevFinal, temaRevFinal, 5);

    const blocoRevisaoOut = {
      fase: 'B) Área de Revisão (Estudo Ativo)',
      materia: matRevFinal,
      tema: temaRevFinal,
      horas: horasRevFinal,
      tempoMin: Math.round(horasRevFinal * 60),
      metodo: 'Flashcards SRS + Questões Práticas (Repetição Espaçada)',
      questoesIds: questoesIdsRev,
      desc: emModoSobrevivencia
        ? `Revisão ativa focal em tópicos de alta incidência da prova da faculdade.`
        : `Revisão ativa obrigatória de ${temaRevFinal} (30% do tempo). NUNCA leitura passiva.`
    };

    const blocoSobrevivenciaOut = (emModoSobrevivencia || isDiaDaProva) ? {
      fase: 'C) Área de Atenção para Prova (Modo Sobrevivência)',
      ativada: true,
      isDiaDoEvento: isDiaDaProva,
      provaNome: provaProxima.nome,
      diasAte: provaProxima.diasAte,
      materia: provaProxima.materia,
      horas: emModoSobrevivencia ? horasSimulado : 0,
      tempoMin: Math.round((emModoSobrevivencia ? horasSimulado : 0) * 60),
      acao: isDiaDaProva ? 'Realização da Avaliação Oficial' : 'Resolução de Provas Antigas & Simulado da Faculdade',
      questoesIds: gerarQuestoesIds(provaProxima.materia, provaProxima.nome + ' Simulado', 10),
      desc: isDiaDaProva
        ? `Dia da prova oficial ${provaProxima.nome}. Boa sorte!`
        : `🚨 Modo Sobrevivência Ativo: faltam ${provaProxima.diasAte} dias para ${provaProxima.nome}. Resolução de provas antigas e simulados direcionados da faculdade.`
    } : {
      fase: 'C) Área de Atenção para Prova (Modo Sobrevivência)',
      ativada: false,
      desc: 'Modo Sobrevivência entra em alerta automático quando faltar 1 a 2 semanas para prova da faculdade.'
    };

    const modoAtivoTexto = modoEstudo === 'foco_graduacao'
      ? 'Modo Foco Total: Apenas Graduação'
      : 'Modo Híbrido: Faculdade + Residência';
    const statusAlertaTexto = isDiaDaProva
      ? 'Dia de Prova'
      : (emModoSobrevivencia ? 'Atenção para Prova' : 'Normal');

    dias.push({
      data,
      dow,
      modoAtivo: modoAtivoTexto,
      isEstagio,
      horasDisponiveis: horasDiaReal,
      statusAlerta: statusAlertaTexto,
      alertaStatus: statusAlertaTexto,
      blocoEstudo: blocoEstudoOut,
      blocoRevisao: blocoRevisaoOut,
      blocoSobrevivencia: blocoSobrevivenciaOut,
      diasAteProva: provaProxima ? provaProxima.diasAte : null,
      provaProxima: provaProxima || null,
      tipo: isDiaDaProva ? 'prova' : (emModoSobrevivencia ? 'protecao' : 'normal'),
      tipoEvento: provaProxima ? provaProxima.tipoEvento : null,
      protecaoProvas: emModoSobrevivencia || isDiaDaProva,
      metodo3Fases,
      blocos
    });
  }

  const todosBlocos = dias.flatMap(dd => dd.blocos);
  const sinergicosCount = todosBlocos.filter(b => b.sinergia).length;
  const protecaoDiasCount = dias.filter(d => d.protecaoProvas).length;
  const faculdadeAgendadosCount = todosBlocos.filter(b => b.ementaFaculdade).length;

  return {
    geradoEm: new Date().toISOString(),
    algoritmo: 'Motor de Agendamento Inteligente (Método 3 Fases + Modo Sobrevivência)',
    modoAtivo: modoEstudo,
    descricaoModo: modoEstudo === 'foco_graduacao'
      ? 'Modo Foco Total: Apenas Graduação (Metas de Cursinho Suspensas)'
      : 'Modo Híbrido: Faculdade + Residência (Sinergia Total)',
    config: {
      modoEstudo,
      diasEstagio,
      horasDia: config.horasDia,
      horasSemana: config.horasSemana,
      energiaPosFaculdade: energia,
      provas: todasProvas,
      materias: config.materias,
      sinergiaTotal: sinergicosCount,
      diasBlindados: protecaoDiasCount,
      ementaFaculdadeIntegrada: 100,
      totalTopicosFaculdade,
      topicosFaculdadeAgendados: faculdadeAgendadosCount
    },
    sinergias: extras.sinergiaMatches || [],
    conteudosFaculdade: extras.conteudosFaculdade || [],
    conteudosResidencia: extras.conteudosResidencia || [],
    inicio: hoje,
    fim,
    dias,
    estatisticas: {
      dias: dias.length,
      modoAtivo: modoEstudo,
      conteudos: todosBlocos.filter(b => b.tipo === 'conteudo').length,
      revisoes: todosBlocos.filter(b => b.tipo && b.tipo.startsWith('revisao')).length,
      sinergias: sinergicosCount,
      diasProtegidos: protecaoDiasCount,
      provas: todasProvas.length,
      ementaFaculdadeIntegrada: 100,
      totalTopicosFaculdade,
      topicosFaculdadeAgendados: faculdadeAgendadosCount
    }
  };
}
