/*
 * gamification.js — Plataforma de Estudos CA-AA/AFN
 * -----------------------------------------------------------------------
 * Módulo compartilhado (não é um módulo ES, é um <script> normal que
 * define window.AlfaGamification) usado por ranking.html, jogo-memoria.html,
 * caderno.html e opcionalmente index.html.
 *
 * IMPORTANTE: este arquivo NÃO cria seu próprio cliente Supabase (pra não
 * duplicar o GoTrueClient dentro da mesma página, o que o supabase-js avisa
 * no console e pode causar dessincronia de sessão). Cada página continua
 * criando o seu `sb = supabase.createClient(...)` normalmente, busca os
 * dados (resultados, respostas_detalhadas etc.) com ele, e passa esses
 * dados prontos pras funções abaixo.
 */
(function (global) {
  'use strict';

  // ===================================================================
  // Catálogo de matérias — usado pra montar seletores, links e rótulos
  // de forma consistente entre as páginas novas. Mantido em sincronia
  // manualmente com o grid "Banco de Questões" do index.html.
  // ===================================================================
  var SUBJECTS = {
    PORTUGUES: { label: 'Língua Portuguesa', url: 'portugues.html', total: 372 },
    HISTORIA_NAVAL: { label: 'História Militar Naval', url: 'historia-naval.html', total: 584 },
    GEOGRAFIA: { label: 'Geografia', url: 'geografia.html', total: 200 },
    MATEMATICA: { label: 'Matemática', url: 'matematica.html', total: 200 },
    'CAAML-703': { label: 'Embarcações Miúdas & Segurança', url: 'caaml-703.html', total: 200 },
    CERIMONIAL: { label: 'Cerimonial da Marinha', url: 'cerimonial.html', total: 280 },
    ROSAS_VIRTUDES: { label: 'Rosas das Virtudes', url: 'rosas-virtudes.html', total: 200 },
    JUSTICA_DISCIPLINA: { label: 'Justiça e Disciplina', url: 'justica-disciplina.html', total: 200 },
    LIDERANCA: { label: 'Liderança', url: 'lideranca.html', total: 210 },
    LIDERANCA_ATRIBUTOS: { label: 'Atributos de Liderança', url: 'lideranca-atributos.html', total: 200 },
    OGSA: { label: 'OGSA', url: 'ogsa.html', total: 211 },
    CAMAAL_CAV: { label: 'CAMAAL 1202 (CAV)', url: 'camaal-cav.html', total: 200 },
    ESTATUTO_RDM: { label: 'Estatuto dos Militares & RDM', url: 'estatuto-rdm.html', total: 200 },
    DOC_ADM_MB: { label: 'Documentação Administrativa na MB', url: 'doc-adm-mb.html', total: 200 },
    PEM2040: { label: 'PEM-2040', url: 'pem2040.html', total: 200 },
    PROVA_SIMULADA: { label: 'Prova Simulada', url: 'prova-simulada.html', total: null }
  };

  var TOTAL_SUBJECTS = Object.keys(SUBJECTS).filter(function (k) { return k !== 'PROVA_SIMULADA'; }).length;

  // Prefixo de localStorage usado por cada prova pra gravar o mapa de
  // respostas local (ver recordAnswerLocal/getLocalAnsweredMap abaixo).
  // Tem que bater exatamente com a constante STORAGE_KEY_PREFIX de cada
  // arquivo de prova — é assim que cobertura-banco.html consegue ler o
  // progresso salvo localmente em cada matéria sem precisar de rede.
  var STORAGE_PREFIX_BY_QUIZ = {
    PORTUGUES: 'portugues',
    HISTORIA_NAVAL: 'historia_naval',
    GEOGRAFIA: 'geografia',
    MATEMATICA: 'matematica',
    'CAAML-703': 'caaml_703',
    CERIMONIAL: 'cerimonial',
    ROSAS_VIRTUDES: 'rosas_virtudes',
    JUSTICA_DISCIPLINA: 'justica_disciplina',
    LIDERANCA: 'lideranca',
    LIDERANCA_ATRIBUTOS: 'lideranca_atributos',
    OGSA: 'ogsa',
    CAMAAL_CAV: 'camaal_cav',
    ESTATUTO_RDM: 'estatuto_rdm',
    DOC_ADM_MB: 'doc_adm_mb',
    PEM2040: 'pem2040'
  };

  function labelFor(quizId) {
    return (SUBJECTS[quizId] && SUBJECTS[quizId].label) || quizId;
  }

  // ===================================================================
  // Data da prova — o admin define na página inicial (fica na tabela
  // `configuracoes`, ver AlfaCiclo em sync-offline.js). A linha abaixo é só
  // o valor usado enquanto nenhuma data foi definida por lá.
  // ===================================================================
  var DATA_PROVA = '2026-10-18';

  function diasParaProva() {
    var data = (global.AlfaCiclo && global.AlfaCiclo.dataProva()) || DATA_PROVA;
    if (!data) return null;
    var partes = data.split('-').map(Number);
    var alvo = new Date(partes[0], partes[1] - 1, partes[2]);
    alvo.setHours(0, 0, 0, 0);
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    var dias = Math.round((alvo - hoje) / (24 * 60 * 60 * 1000));
    return { dias: dias, data: data };
  }

  // ===================================================================
  // Patentes navais — título exibido conforme o total de questões
  // corretas acumuladas (mesmo critério usado pra ordenar o ranking
  // geral), do "Recruta" até "Almirante". Puramente cosmético/motivacional,
  // não interfere em nenhuma trava de acesso.
  // ===================================================================
  var PATENTES = [
    { min: 0, nome: 'Recruta', icon: 'fa-user' },
    { min: 50, nome: 'Marinheiro', icon: 'fa-anchor' },
    { min: 150, nome: 'Cabo', icon: 'fa-shield-halved' },
    { min: 300, nome: 'Terceiro-Sargento', icon: 'fa-star' },
    { min: 500, nome: 'Segundo-Sargento', icon: 'fa-star' },
    { min: 800, nome: 'Primeiro-Sargento', icon: 'fa-star' },
    { min: 1200, nome: 'Suboficial', icon: 'fa-star-half-stroke' },
    { min: 1800, nome: 'Guarda-Marinha', icon: 'fa-award' },
    { min: 2500, nome: 'Segundo-Tenente', icon: 'fa-medal' },
    { min: 3500, nome: 'Primeiro-Tenente', icon: 'fa-medal' },
    { min: 5000, nome: 'Capitão-Tenente', icon: 'fa-shield' },
    { min: 7000, nome: 'Capitão de Corveta', icon: 'fa-shield' },
    { min: 9000, nome: 'Capitão de Fragata', icon: 'fa-shield' },
    { min: 12000, nome: 'Capitão de Mar e Guerra', icon: 'fa-shield' },
    { min: 16000, nome: 'Almirante', icon: 'fa-crown' }
  ];

  function patenteFor(totalAcertos) {
    var atual = PATENTES[0];
    for (var i = 0; i < PATENTES.length; i++) {
      if ((totalAcertos || 0) >= PATENTES[i].min) atual = PATENTES[i];
      else break;
    }
    return atual;
  }

  // ===================================================================
  // Sequência de estudo (streak) — calculada a partir das datas em que o
  // aluno tem pelo menos um resultado salvo (tabela `resultados`).
  // Não depende de nenhuma coluna nova nem de localStorage: funciona em
  // qualquer aparelho em que o aluno faça login.
  // ===================================================================
  function toDayKey(dateLike) {
    var d = new Date(dateLike);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function computeStreak(resultados) {
    if (!resultados || resultados.length === 0) return { atual: 0, recorde: 0, diasEstudados: 0 };

    var dayKeys = {};
    resultados.forEach(function (r) {
      if (r.criado_em) dayKeys[toDayKey(r.criado_em)] = true;
    });
    var uniqueDays = Object.keys(dayKeys);

    // Constrói um Set de timestamps (meia-noite) pra andar dia a dia.
    var daySet = {};
    uniqueDays.forEach(function (k) {
      var parts = k.split('-').map(Number);
      var t = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
      daySet[t] = true;
    });

    var oneDay = 24 * 60 * 60 * 1000;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayTime = today.getTime();

    // Streak atual: anda pra trás a partir de hoje (ou de ontem, se hoje
    // ainda não estudou — o streak continua "vivo" até o fim do dia).
    var atual = 0;
    var cursor = todayTime;
    if (!daySet[cursor]) cursor -= oneDay; // ainda não estudou hoje, tenta ontem
    while (daySet[cursor]) {
      atual++;
      cursor -= oneDay;
    }

    // Recorde: maior sequência de dias consecutivos já alcançada.
    var sortedTimes = Object.keys(daySet).map(Number).sort(function (a, b) { return a - b; });
    var recorde = 0, run = 0, prev = null;
    sortedTimes.forEach(function (t) {
      if (prev !== null && t - prev === oneDay) run++;
      else run = 1;
      if (run > recorde) recorde = run;
      prev = t;
    });

    return { atual: atual, recorde: recorde, diasEstudados: uniqueDays.length };
  }

  // ===================================================================
  // Ofensiva — registro diário de atividade.
  //
  // Antes a ofensiva era calculada só em cima de `respostas_detalhadas`,
  // o que falhava de três jeitos: (1) o Supabase devolve no máximo 1000
  // linhas por consulta, então quem já tinha respondido mais que isso via
  // só os dias antigos e a sequência zerava; (2) refazer uma questão já
  // respondida não cria linha nova (é upsert), então um dia inteiro de
  // revisão não contava; (3) refações de erros nem chegam a gravar.
  //
  // Agora cada questão respondida soma +1 no dia de hoje num mapa
  // { "AAAA-MM-DD": quantidade }, salvo no aparelho na hora e enviado à
  // nuvem (tabela dados_usuario, chave "ofensiva_dias") para valer em
  // todos os aparelhos. O histórico antigo continua vindo de
  // respostas_detalhadas e resultados (lido em páginas, sem limite).
  // ===================================================================
  var OFENSIVA_CHAVE = 'ofensiva_dias';
  var AUTH_KEY = 'sb-ghlaukrbwwecpeanlmlp-auth-token';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function diaISO(dateLike) {
    var d = dateLike ? new Date(dateLike) : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function usuarioLogadoId() {
    try {
      var s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      return (s && s.user && s.user.id) || null;
    } catch (e) { return null; }
  }
  function lerJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch (e) { return {}; }
  }
  function gravarJSON(key, valor) {
    try { localStorage.setItem(key, JSON.stringify(valor)); } catch (e) { /* ignora */ }
  }
  function ofensivaLocalKey(userId) { return 'alfa_ofensiva_dias_' + userId; }
  function ofensivaCacheKey(userId) { return 'alfa_ofensiva_cache_' + userId; }

  // Junta dois mapas dia -> quantidade ficando com o maior valor de cada dia
  // (somar contaria duas vezes o mesmo dia vindo da nuvem e do aparelho).
  function mesclarDias(a, b) {
    var out = {};
    [a || {}, b || {}].forEach(function (m) {
      Object.keys(m).forEach(function (k) {
        var n = Number(m[k]) || 0;
        if (n > (out[k] || 0)) out[k] = n;
      });
    });
    return out;
  }
  function mesmosDias(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) { return a[k] === b[k]; });
  }

  function clienteDaPagina() {
    try { return typeof sb !== 'undefined' ? sb : null; } catch (e) { return null; }
  }

  // Envia o mapa do aparelho para a nuvem (mesclando com o que já está lá).
  function sincronizarOfensiva(client, userId) {
    var local = lerJSON(ofensivaLocalKey(userId));
    if (!client || !global.AlfaSync) return Promise.resolve(local);
    return global.AlfaSync.getValue(client, userId, OFENSIVA_CHAVE)
      .then(function (remoto) {
        var juntos = mesclarDias(remoto, local);
        gravarJSON(ofensivaLocalKey(userId), juntos);
        if (remoto && mesmosDias(remoto, juntos)) return juntos;
        return global.AlfaSync.setValue(client, userId, OFENSIVA_CHAVE, juntos)
          .then(function () { return juntos; }, function () { return juntos; });
      })
      .catch(function () { return local; });
  }

  var envioOfensivaTimer = null;
  function registrarAtividade(qtd) {
    var userId = usuarioLogadoId();
    if (!userId) return;
    var mapa = lerJSON(ofensivaLocalKey(userId));
    var hoje = diaISO();
    mapa[hoje] = (mapa[hoje] || 0) + (qtd || 1);
    gravarJSON(ofensivaLocalKey(userId), mapa);
    clearTimeout(envioOfensivaTimer);
    envioOfensivaTimer = setTimeout(function () {
      sincronizarOfensiva(clienteDaPagina(), userId);
    }, 2500);
  }

  // Lê todas as linhas de uma consulta, de 1000 em 1000 (limite do Supabase).
  async function lerTudo(montarConsulta) {
    var linhas = [];
    var LOTE = 1000;
    for (var pagina = 0; pagina < 100; pagina++) {
      var res = await montarConsulta().range(linhas.length, linhas.length + LOTE - 1);
      if (res.error) throw res.error;
      var dados = res.data || [];
      linhas = linhas.concat(dados);
      if (dados.length === 0 || dados.length < LOTE) break;
    }
    return linhas;
  }

  // Tudo o que a ofensiva precisa: { dias: {"AAAA-MM-DD": questões} }.
  // Sem internet, devolve o último retrato salvo neste aparelho somado ao
  // que foi respondido aqui desde então.
  async function carregarAtividade(client, userId) {
    var cacheKey = ofensivaCacheKey(userId);
    try {
      var partes = await Promise.all([
        lerTudo(function () {
          return client.from('respostas_detalhadas').select('criado_em')
            .eq('user_id', userId).order('criado_em', { ascending: true });
        }),
        lerTudo(function () {
          return client.from('resultados').select('criado_em, acertos, erros')
            .eq('user_id', userId).order('criado_em', { ascending: true });
        }),
        sincronizarOfensiva(client, userId)
      ]);
      var porRespostas = {};
      partes[0].forEach(function (r) {
        if (!r.criado_em) return;
        var k = diaISO(r.criado_em);
        porRespostas[k] = (porRespostas[k] || 0) + 1;
      });
      var porSimulados = {};
      partes[1].forEach(function (r) {
        if (!r.criado_em) return;
        var k = diaISO(r.criado_em);
        porSimulados[k] = (porSimulados[k] || 0) + Math.max(1, (r.acertos || 0) + (r.erros || 0));
      });
      var dias = mesclarDias(mesclarDias(porRespostas, porSimulados), partes[2]);
      gravarJSON(cacheKey, dias);
      return { dias: dias, offline: false };
    } catch (e) {
      console.warn('[ofensiva] usando dados salvos no aparelho:', e);
      return { dias: mesclarDias(lerJSON(cacheKey), lerJSON(ofensivaLocalKey(userId))), offline: true };
    }
  }

  // Converte o mapa de dias no formato que computeStreak espera.
  function streakDeDias(dias) {
    var lista = Object.keys(dias || {}).filter(function (k) { return dias[k] > 0; }).map(function (k) {
      var p = k.split('-').map(Number);
      return { criado_em: new Date(p[0], p[1] - 1, p[2], 12) };
    });
    return computeStreak(lista);
  }

  // ===================================================================
  // Estatísticas pessoais agregadas — usadas na aba "Meu Progresso" do
  // ranking e pra decidir quais conquistas já foram desbloqueadas.
  // ===================================================================
  function personalStats(resultados) {
    resultados = resultados || [];
    var totalSimulados = resultados.length;
    var totalAcertos = 0, totalErros = 0;
    var materiasFeitas = {};
    var melhorNota = 0;
    var notaCem = false;

    resultados.forEach(function (r) {
      totalAcertos += (r.acertos || 0);
      totalErros += (r.erros || 0);
      if (r.quiz_id) materiasFeitas[r.quiz_id] = true;
      if (typeof r.percentual === 'number') {
        if (r.percentual > melhorNota) melhorNota = r.percentual;
        if (r.percentual >= 100) notaCem = true;
      }
    });

    var totalQuestoes = totalAcertos + totalErros;
    var percentualMedio = totalQuestoes > 0 ? Math.round((totalAcertos / totalQuestoes) * 1000) / 10 : 0;

    // Evolução cronológica (mais antigo -> mais recente) do % de acerto,
    // pra desenhar um gráfico simples de linha.
    var evolucao = resultados
      .filter(function (r) { return r.criado_em && typeof r.percentual === 'number'; })
      .sort(function (a, b) { return new Date(a.criado_em) - new Date(b.criado_em); })
      .map(function (r) { return { data: r.criado_em, percentual: r.percentual, materia: r.quiz_id }; });

    return {
      totalSimulados: totalSimulados,
      totalAcertos: totalAcertos,
      totalErros: totalErros,
      totalQuestoes: totalQuestoes,
      percentualMedio: percentualMedio,
      melhorNota: melhorNota,
      notaCem: notaCem,
      materiasDistintas: Object.keys(materiasFeitas).length,
      materiasFeitas: materiasFeitas,
      evolucao: evolucao
    };
  }

  // ===================================================================
  // Conquistas (badges) — cada uma tem um id estável (pra lembrar quais já
  // foram vistas, via localStorage) e uma condição calculada em cima das
  // estatísticas já buscadas pela própria página (sem chamadas extras).
  // ===================================================================
  // `streak` (opcional): a ofensiva já calculada por streakDeDias, que é
  // mais fiel que contar só os dias com simulado finalizado.
  function computeBadges(resultados, streak) {
    var stats = personalStats(resultados);
    streak = streak || computeStreak(resultados);
    var quizCount = {};
    resultados.forEach(function (r) { quizCount[r.quiz_id] = (quizCount[r.quiz_id] || 0) + 1; });

    var defs = [
      { id: 'primeiro-passo', label: 'Primeiro Passo', desc: 'Concluiu o primeiro simulado', icon: 'fa-shoe-prints', unlocked: stats.totalSimulados >= 1 },
      { id: 'maratonista', label: 'Maratonista', desc: '10 simulados concluídos', icon: 'fa-person-running', unlocked: stats.totalSimulados >= 10 },
      { id: 'veterano', label: 'Veterano', desc: '50 simulados concluídos', icon: 'fa-medal', unlocked: stats.totalSimulados >= 50 },
      { id: 'lenda', label: 'Lenda da Plataforma', desc: '100 simulados concluídos', icon: 'fa-crown', unlocked: stats.totalSimulados >= 100 },
      { id: 'sequencia-3', label: 'Sequência de Ferro', desc: '3 dias seguidos de estudo', icon: 'fa-fire', unlocked: streak.recorde >= 3 },
      { id: 'sequencia-7', label: 'Disciplina Naval', desc: '7 dias seguidos de estudo', icon: 'fa-fire-flame-curved', unlocked: streak.recorde >= 7 },
      { id: 'sequencia-30', label: 'Inabalável', desc: '30 dias seguidos de estudo', icon: 'fa-anchor', unlocked: streak.recorde >= 30 },
      { id: 'atirador-elite', label: 'Atirador de Elite', desc: 'Média geral acima de 80% (mín. 5 simulados)', icon: 'fa-bullseye', unlocked: stats.totalSimulados >= 5 && stats.percentualMedio >= 80 },
      { id: 'nota-mil', label: 'Nota 1000', desc: 'Gabaritou (100%) um simulado', icon: 'fa-star', unlocked: stats.notaCem },
      { id: 'mil-acertos', label: 'Milhar de Acertos', desc: '1.000 questões corretas no total', icon: 'fa-layer-group', unlocked: stats.totalAcertos >= 1000 },
      { id: 'estudioso-estatuto', label: 'Estudioso do Estatuto', desc: '3+ simulados em Estatuto & RDM', icon: 'fa-book', unlocked: (quizCount.ESTATUTO_RDM || 0) >= 3 },
      { id: 'explorador', label: 'Explorador', desc: 'Já estudou em 6+ matérias diferentes', icon: 'fa-compass', unlocked: stats.materiasDistintas >= 6 },
      { id: 'completo', label: 'Almirantado Completo', desc: 'Já estudou em todas as ' + TOTAL_SUBJECTS + ' matérias', icon: 'fa-ship', unlocked: stats.materiasDistintas >= TOTAL_SUBJECTS }
    ];
    return defs;
  }

  // Compara as conquistas atuais com as últimas vistas (guardadas no
  // localStorage, por usuário) e devolve só as que acabaram de ser
  // desbloqueadas — pra disparar a celebração só uma vez.
  function newlyUnlockedBadges(userId, badges) {
    var key = 'alfa_badges_seen_' + userId;
    var seen = [];
    try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { seen = []; }
    var unlockedIds = badges.filter(function (b) { return b.unlocked; }).map(function (b) { return b.id; });
    var novas = unlockedIds.filter(function (id) { return seen.indexOf(id) === -1; });
    try { localStorage.setItem(key, JSON.stringify(unlockedIds)); } catch (e) { /* localStorage indisponível: ignora */ }
    return badges.filter(function (b) { return novas.indexOf(b.id) !== -1; });
  }

  // ===================================================================
  // Frases motivacionais — uma por dia (determinística, todo mundo vê a
  // mesma no mesmo dia, e ela não muda a cada F5).
  // ===================================================================
  var FRASES = [
    'Disciplina é a ponte entre objetivos e conquistas.',
    'Cada questão respondida hoje é um passo mais perto da farda.',
    'A aprovação se constrói na repetição diária, não na véspera da prova.',
    'Quem estuda com constância não teme a hora da prova.',
    'Um bom marinheiro se prepara antes da tempestade chegar.',
    'Foco no processo — o resultado é consequência.',
    'Errar uma questão hoje é aprender pra não errar amanhã.',
    'A rotina vence o talento quando o talento não tem rotina.',
    'Sua aprovação começa na próxima questão que você resolver.',
    'Constância é o que separa quem sonha de quem conquista.',
    'Não é sobre ser o mais rápido, é sobre não parar de remar.',
    'Cada simulado concluído é um tijolo na sua aprovação.',
    'A disciplina de hoje é a liberdade de amanhã.',
    'Estude como se a prova fosse amanhã, revise como se fosse pra sempre.',
    'Grandes resultados vêm de pequenos esforços repetidos todos os dias.',
    'O cansaço passa, a desistência é que fica pra sempre.',
    'Firme no leme, mesmo quando o mar balança.',
    'A aprovação não é sorte — é planejamento encontrando preparo.',
    'Persistência é o combustível de quem quer vestir a farda.',
    'Não compare seu dia 1 com o dia 100 de outra pessoa.',
    'Revisar o que errou vale mais do que repetir o que já sabe.',
    'Sua melhor versão está do outro lado da constância.',
    'Cada dia de estudo é um voto de confiança no seu futuro.',
    'A caneta que aprova é a mesma que treinou todo santo dia.',
    'Onde há disciplina, o resultado é só uma questão de tempo.',
    'Confiança se constrói questão por questão, dia após dia.',
    'A jornada até a aprovação é longa — por isso não pode ser feita com pressa.',
    'Hoje é um bom dia pra fechar mais uma matéria com 100%.',
    'O que parece impossível hoje vira rotina depois de disciplina.',
    'Marinheiro de primeira viagem também chega a almirante.'
  ];

  function fraseDoDia() {
    var d = new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var diff = d - start;
    var dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    return FRASES[dayOfYear % FRASES.length];
  }

  // ===================================================================
  // Celebração visual (confete) — canvas leve, sem nenhuma biblioteca
  // externa (funciona mesmo offline / sem acesso a CDN).
  // ===================================================================
  function celebrar(opts) {
    opts = opts || {};
    var duracaoMs = opts.duracao || 2400;
    var cores = opts.cores || ['#e0c26f', '#c9a44c', '#0066cc', '#34d399', '#f43f5e', '#ffffff'];

    var canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var count = Math.min(160, Math.max(60, Math.floor(window.innerWidth / 8)));
    var particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.3,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 3.5,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        color: cores[Math.floor(Math.random() * cores.length)]
      });
    }

    var startTime = performance.now();
    function frame(now) {
      var elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < duracaoMs) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
      }
    }
    requestAnimationFrame(frame);
  }

  // Um toast simples (canto superior), usado pra anunciar conquista nova.
  function toastConquista(badge) {
    var el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-12px);' +
      'background:#0B192C;border:1px solid #e0c26f;color:#fff;padding:12px 18px;border-radius:12px;' +
      'box-shadow:0 12px 30px rgba(0,0,0,.35);z-index:10000;font-family:Inter,system-ui,sans-serif;' +
      'font-size:13px;display:flex;align-items:center;gap:10px;opacity:0;transition:opacity .3s,transform .3s;max-width:90vw;';
    el.innerHTML = '<i class="fa-solid ' + (badge.icon || 'fa-medal') + '" style="color:#e0c26f;font-size:18px;"></i>' +
      '<span><strong>Conquista desbloqueada:</strong> ' + badge.label + '</span>';
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(-12px)';
      setTimeout(function () { el.remove(); }, 350);
    }, 3600);
  }

  // ===================================================================
  // Extração de questões de outra página do site (mesma origem) — usada
  // pelo jogo da memória e pelo caderno de erros pra reaproveitar os
  // bancos de questões já existentes em cada matéria, sem duplicar
  // conteúdo em um novo arquivo.
  // ===================================================================
  function extractQuestionsFromHtml(html) {
    var marker = 'const questionsData';
    var idx = html.indexOf(marker);
    if (idx === -1) return null;
    var eq = html.indexOf('=', idx);
    var arrStart = html.indexOf('[', eq);
    if (arrStart === -1) return null;

    // Varre caractere a caractere contando colchetes/chaves, respeitando
    // strings (aspas simples/duplas/template) pra achar o `]` correspondente,
    // já que o array pode ter milhares de linhas.
    var depth = 0, inString = null, i = arrStart, end = -1;
    for (; i < html.length; i++) {
      var c = html[i];
      if (inString) {
        if (c === '\\') { i++; continue; }
        if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;

    var arrayLiteral = html.slice(arrStart, end + 1);
    try {
      // eslint-disable-next-line no-new-func
      var fn = new Function('return (' + arrayLiteral + ');');
      return fn();
    } catch (e) {
      console.warn('[gamification] falha ao extrair questionsData:', e);
      return null;
    }
  }

  async function fetchSubjectQuestions(quizId) {
    var info = SUBJECTS[quizId];
    if (!info || !info.url) return null;
    try {
      var resp = await fetch(info.url, { cache: 'no-store' });
      if (!resp.ok) return null;
      var html = await resp.text();
      return extractQuestionsFromHtml(html);
    } catch (e) {
      console.warn('[gamification] falha ao buscar', quizId, e);
      return null;
    }
  }

  // ===================================================================
  // Acesso offline — cache do último "aprovado" + lista de matérias
  // liberadas, pra tela de acesso não travar em "Verificando seu
  // acesso..." pra sempre quando o aparelho está sem internet.
  //
  // Como funciona: cada página continua chamando o Supabase normalmente,
  // mas através de fetchAprovado/fetchQuizAccess/fetchAllAccess abaixo.
  // Numa consulta bem-sucedida (com internet), o resultado é salvo aqui.
  // Se uma consulta falhar (sem internet), a função devolve o último
  // valor salvo em vez de travar a página — e só mostra a tela de "sem
  // conexão" se nem isso existir (ou seja, o aluno nunca abriu essa
  // página com internet antes).
  //
  // Validade do acesso (venda): o perfil tem "acesso_ate" (vazio = sem
  // prazo). Offline, o valor salvo só vale até essa data e no máximo
  // OFFLINE_MAX_DIAS depois da última conferência com a internet. Se o
  // relógio do aparelho voltar para trás, o acesso salvo deixa de valer.
  // ===================================================================
  var ACCESS_CACHE_PREFIX = 'alfa_access_cache_';
  var OFFLINE_MAX_DIAS = 7;
  var DIA_MS = 24 * 60 * 60 * 1000;
  var TOLERANCIA_RELOGIO_MS = 60 * 60 * 1000; // 1h (fuso, ajuste automático do relógio)

  function readAccessCache(userId) {
    try {
      var raw = localStorage.getItem(ACCESS_CACHE_PREFIX + userId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveAccessCache(userId, value) {
    try {
      localStorage.setItem(ACCESS_CACHE_PREFIX + userId, JSON.stringify(value));
    } catch (e) { /* localStorage indisponível: segue sem cache */ }
  }

  // Regra do acesso a partir da linha de "profiles" vinda do Supabase.
  // Igual à função acesso_valido() do banco.
  function acessoEmDia(perfil) {
    if (!perfil) return false;
    if (perfil.admin) return true;
    if (!perfil.aprovado) return false;
    if (outroAparelho(perfil)) return false;
    return !perfil.acesso_ate || new Date(perfil.acesso_ate).getTime() > Date.now();
  }

  // A conta foi aberta em outro aparelho depois deste (só um por vez;
  // ver supabase_um_aparelho.sql). Admin não tem esse limite.
  function outroAparelho(perfil) {
    if (!perfil || perfil.admin || !perfil.dispositivo || !global.AlfaDispositivo) return false;
    return perfil.dispositivo !== global.AlfaDispositivo.id();
  }

  // Por que o acesso salvo neste aparelho não vale (ou null se vale).
  function motivoBloqueioOffline(cached) {
    var agora = Date.now();
    if (cached.vistoEm && agora < cached.vistoEm - TOLERANCIA_RELOGIO_MS) return 'relogio';
    if (cached.acessoAte && new Date(cached.acessoAte).getTime() <= agora) return 'vencido';
    var verificadoEm = cached.verificadoEm || cached.ts || 0;
    if (agora - verificadoEm > OFFLINE_MAX_DIAS * DIA_MS) return 'offline';
    return null;
  }

  // Devolve o cache já com "aprovado" corrigido pela validade offline
  // (e "motivo" quando bloqueado). Também guarda o horário mais recente
  // visto, pra perceber se o relógio do aparelho for atrasado.
  function getAccessCache(userId) {
    var cached = readAccessCache(userId);
    if (!cached) return null;
    var motivo = cached.aprovado ? motivoBloqueioOffline(cached) : null;
    if (motivo !== 'relogio' && Date.now() > (cached.vistoEm || 0)) {
      cached.vistoEm = Date.now();
      saveAccessCache(userId, cached);
    }
    if (motivo) {
      cached.aprovado = false;
      cached.motivo = motivo;
    }
    return cached;
  }

  function writeAccessCache(userId, patch) {
    var current = readAccessCache(userId) || { aprovado: false, quizIds: [] };
    var next = {
      aprovado: current.aprovado,
      acessoAte: current.acessoAte || null,
      verificadoEm: current.verificadoEm || current.ts || 0,
      vistoEm: Math.max(current.vistoEm || 0, Date.now()),
      quizIds: patch.quizIds || current.quizIds || []
    };
    // Só a consulta do perfil (com internet) renova a validade offline.
    if (patch.verificado) {
      next.aprovado = !!patch.aprovado;
      next.acessoAte = patch.acessoAte || null;
      next.verificadoEm = Date.now();
    }
    saveAccessCache(userId, next);
  }

  function setAccessCacheAprovado(userId, aprovado, acessoAte) {
    writeAccessCache(userId, { verificado: true, aprovado: aprovado, acessoAte: acessoAte });
  }

  function setAccessCacheQuiz(userId, aprovado, quizId, hasAccess) {
    var current = readAccessCache(userId);
    var setIds = {};
    ((current && current.quizIds) || []).forEach(function (q) { setIds[q] = true; });
    if (hasAccess) setIds[quizId] = true; else delete setIds[quizId];
    writeAccessCache(userId, { quizIds: Object.keys(setIds) });
  }

  function setAccessCacheFull(userId, aprovado, quizIds) {
    writeAccessCache(userId, { quizIds: quizIds });
  }

  // Busca aprovado/admin/acesso_ate. Se o SQL da validade ainda não foi
  // rodado (coluna acesso_ate não existe), busca sem ela.
  async function selectPerfilAcesso(sb, userId) {
    var res = await sb.from('profiles').select('aprovado, admin, acesso_ate, dispositivo').eq('id', userId).maybeSingle();
    if (res.error && res.error.code === '42703') {
      res = await sb.from('profiles').select('aprovado, admin, acesso_ate').eq('id', userId).maybeSingle();
    }
    if (res.error && res.error.code === '42703') {
      res = await sb.from('profiles').select('aprovado, admin').eq('id', userId).maybeSingle();
    }
    if (!res.error && res.data && global.AlfaMarcaDagua) AlfaMarcaDagua.definirAdmin(userId, !!res.data.admin);
    return res;
  }

  function formatarData(iso) {
    try { return new Date(iso).toLocaleDateString('pt-BR'); } catch (e) { return ''; }
  }

  // Acesso bloqueado: apaga as páginas, apostilas e questões guardadas
  // neste aparelho para uso offline (caches do sw.js). Anotações, favoritos
  // e progresso ficam no localStorage e na nuvem, então não se perdem.
  function limparConteudoOffline() {
    try {
      if (!global.caches) return;
      caches.keys().then(function (keys) {
        keys.filter(function (k) { return k.indexOf('caaa-afn-') === 0; })
          .forEach(function (k) { caches.delete(k); });
      });
    } catch (e) { /* ignora */ }
  }

  // Troca o texto do aviso "aguardando liberação" (gate-pending nas
  // páginas, pending-panel na inicial) pelo motivo real do bloqueio.
  function mostrarMotivoBloqueio(motivo, acessoAte) {
    var textos = {
      vencido: 'Seu acesso venceu' + (acessoAte ? ' em ' + formatarData(acessoAte) : '') + '. Renove a assinatura para continuar estudando.',
      offline: 'Faz mais de ' + OFFLINE_MAX_DIAS + ' dias que este aparelho não confere seu acesso. Conecte-se à internet uma vez para continuar.',
      relogio: 'A data deste aparelho parece errada. Acerte a data e a hora e conecte-se à internet para continuar.',
      outro_aparelho: 'Sua conta foi aberta em outro aparelho. Ela funciona em um aparelho por vez. Para estudar aqui, toque em "Usar neste aparelho" na página inicial (o outro será desconectado).'
    };
    if (!textos[motivo]) return;
    limparConteudoOffline();
    try {
      ['gate-pending', 'pending-panel'].forEach(function (id) {
        var panel = document.getElementById(id);
        var p = panel && panel.querySelector('p');
        if (p) p.textContent = textos[motivo];
      });
      // Renovar só faz sentido quando venceu; offline/relógio se resolvem conectando.
      var planos = document.getElementById('pending-plans');
      if (planos) planos.classList.toggle('hidden', motivo !== 'vencido');
      var usarAqui = document.getElementById('usar-aqui-btn');
      if (usarAqui) usarAqui.classList.toggle('hidden', motivo !== 'outro_aparelho');
    } catch (e) { /* ignora */ }
  }

  // Reaproveita a mesma tela de acesso que cada página já tem (o painel
  // #gate-checking) pra avisar que está offline e sem dados salvos —
  // não precisa de nenhum HTML novo em nenhuma página.
  function showOfflineGate() {
    try {
      var screen = document.getElementById('access-screen');
      var panel = document.getElementById('gate-checking');
      if (!screen || !panel) return;
      ['gate-checking', 'gate-logged-out', 'gate-pending', 'gate-no-access'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.add('hidden');
        el.classList.remove('flex');
      });
      panel.classList.remove('hidden');
      panel.classList.add('flex');
      screen.classList.remove('hidden');
      var p = panel.querySelector('p');
      if (p) p.textContent = 'Sem conexão com a internet, e ainda não há dados salvos neste aparelho. Conecte-se pelo menos uma vez para liberar o uso offline.';
      var icon = panel.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-wifi text-2xl text-amber-300';
    } catch (e) { /* ignora */ }
  }

  async function fetchAprovado(sb, userId) {
    try {
      var res = await selectPerfilAcesso(sb, userId);
      if (res.error) throw res.error;
      var acessoAte = res.data ? res.data.acesso_ate || null : null;
      var aprovado = acessoEmDia(res.data);
      setAccessCacheAprovado(userId, aprovado, acessoAte);
      if (!aprovado && outroAparelho(res.data)) mostrarMotivoBloqueio('outro_aparelho');
      else if (!aprovado && res.data && res.data.aprovado) mostrarMotivoBloqueio('vencido', acessoAte);
      return aprovado;
    } catch (e) {
      var cached = getAccessCache(userId);
      if (cached) {
        if (cached.motivo) mostrarMotivoBloqueio(cached.motivo, cached.acessoAte);
        return cached.aprovado;
      }
      showOfflineGate();
      throw e;
    }
  }

  async function fetchQuizAccess(sb, userId, quizId) {
    try {
      var res = await sb.from('acessos').select('quiz_id').eq('user_id', userId).eq('quiz_id', quizId).maybeSingle();
      if (res.error) throw res.error;
      var hasAccess = !!res.data;
      var cached = getAccessCache(userId);
      setAccessCacheQuiz(userId, cached ? cached.aprovado : true, quizId, hasAccess);
      return hasAccess;
    } catch (e) {
      var cached2 = getAccessCache(userId);
      if (cached2) return cached2.aprovado && (cached2.quizIds || []).indexOf(quizId) !== -1;
      showOfflineGate();
      throw e;
    }
  }

  async function fetchAllAccess(sb, userId) {
    try {
      var res = await sb.from('acessos').select('quiz_id').eq('user_id', userId);
      if (res.error) throw res.error;
      return (res.data || []).map(function (a) { return a.quiz_id; });
    } catch (e) {
      var cached = getAccessCache(userId);
      return cached ? (cached.quizIds || []) : [];
    }
  }

  // ===================================================================
  // Foto de perfil — upload pro bucket "avatars" do Supabase Storage e
  // atualização da coluna profiles.avatar_url. Requer que o usuário rode
  // o supabase_avatar_setup.sql uma vez (cria a coluna + o bucket + as
  // políticas de acesso).
  // ===================================================================
  var AVATAR_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

  function initialFor(nomeOuEmail) {
    var base = (nomeOuEmail || '?').trim();
    return base ? base.charAt(0).toUpperCase() : '?';
  }

  async function uploadAvatar(sb, userId, file) {
    if (!file) throw new Error('Nenhum arquivo selecionado.');
    if (!/^image\//.test(file.type)) throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WEBP).');
    if (file.size > AVATAR_MAX_BYTES) throw new Error('Imagem muito grande (máx. 3 MB).');

    var ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'jpg';
    var path = userId + '/avatar.' + ext;

    var upload = await sb.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upload.error) throw upload.error;

    var pub = sb.storage.from('avatars').getPublicUrl(path);
    var publicUrl = pub.data.publicUrl + '?v=' + Date.now(); // cache-bust pra trocar de foto na hora

    var update = await sb.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
    if (update.error) throw update.error;

    return publicUrl;
  }

  // ===================================================================
  // Apostila — link "Ver na apostila" a partir de uma questão do banco.
  // Cada quiz tem (quando existe apostila correspondente) um arquivo
  // content/apostila-links-{quizFile}.json mapeando o id da questão pra
  // {slug, block}, gerado offline cruzando o texto da questão com o
  // conteúdo da apostila. Nem toda questão tem mapeamento (cobertura
  // varia por matéria); quando não tem, o link simplesmente não aparece.
  // ===================================================================
  var apostilaLinksCache = {};

  function fetchApostilaLinks(quizFile) {
    if (apostilaLinksCache[quizFile]) return apostilaLinksCache[quizFile];
    var p = fetch('content/apostila-links-' + quizFile + '.json', { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('not found'); return res.json(); })
      .catch(function () { return {}; });
    apostilaLinksCache[quizFile] = p;
    return p;
  }

  function apostilaLinkHtml(linksMap, questionId) {
    var entry = linksMap && linksMap[String(questionId)];
    if (!entry || !entry.slug) return '';
    var href = 'apostila-leitura.html?slug=' + encodeURIComponent(entry.slug) +
      (typeof entry.block === 'number' ? '#blk-' + entry.block : '');
    return '<a href="' + href + '" target="_blank" rel="opener" ' +
      'class="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-amber-300 hover:text-amber-200 hover:underline">' +
      '<i class="fa-solid fa-book-open"></i> Ver na apostila</a>';
  }

  // ===================================================================
  // Reconciliação de respostas_detalhadas (corrige a "cobertura de
  // questões" que ficava presa em um número menor do que o real).
  //
  // O progresso de resumo (retomar de onde parei) fica salvo em
  // `progresso.respostas` (um JSON { índice: opção escolhida }). Já a
  // cobertura por matéria (cobertura-banco.html) conta linhas ÚNICAS em
  // `respostas_detalhadas`. Historicamente essas duas fontes podiam ficar
  // dessincronizadas — por exemplo, se uma tentativa de INSERT falhasse
  // silenciosamente (rede, RLS) só uma vez, a questão nunca mais era
  // reenviada pra `respostas_detalhadas`, porque o gatilho de envio olhava
  // só pro estado local de "já respondi" e não pro banco. Isso fazia a
  // cobertura mostrada ficar presa bem abaixo do que o aluno realmente já
  // fez.
  //
  // Esta função roda uma vez a cada carregamento da página do quiz (depois
  // de `loadSavedState()`), compara o que está em `userAnswers` com o que
  // já está de fato salvo em `respostas_detalhadas`, e reenvia só o que
  // estiver faltando. Autocorretiva: quanto mais o aluno abre um quiz que
  // já tem progresso, mais qualquer buraco antigo se fecha sozinho.
  // ===================================================================
  // Grava uma resposta em respostas_detalhadas com upsert (evita duplicar
  // linha quando o aluno reconfere uma questão já respondida) mas com uma
  // rede de segurança: se o upsert falhar — por exemplo, RLS sem política de
  // UPDATE liberada pra esse caminho, mesmo com a constraint de unicidade já
  // criada — cai pra um insert simples, que sempre funciona contanto que a
  // política de INSERT exista (é a mesma que o código antigo já usava). Sem
  // essa rede, uma falha nesse ponto passava batido (silenciosa) e a questão
  // simplesmente nunca contava pra cobertura.
  // ===================================================================
  // Resposta local robusta — grava no localStorage do navegador NA HORA,
  // sem nenhuma dependência de rede. É a fonte mais confiável que existe:
  // nunca falha por causa de internet, sessão expirada, RLS ou cache do
  // Service Worker desatualizado (motivos que já causaram uma questão
  // respondida não ser contabilizada, mesmo com tudo "certo" no banco).
  // cobertura-banco.html lê esse mapa direto, além do banco — então o
  // número aparece certo NESTE aparelho na hora, não importa o que
  // aconteça com a gravação em nuvem.
  // ===================================================================
  function answeredMapKey(storagePrefix) { return storagePrefix + '_answered_map'; }

  function getLocalAnsweredMap(storagePrefix) {
    try {
      return JSON.parse(localStorage.getItem(answeredMapKey(storagePrefix)) || '{}') || {};
    } catch (e) { return {}; }
  }

  function recordAnswerLocal(storagePrefix, questionId, acertou, subject) {
    registrarAtividade(1);
    try {
      var map = getLocalAnsweredMap(storagePrefix);
      map[String(questionId)] = { acertou: !!acertou, subject: subject || null };
      localStorage.setItem(answeredMapKey(storagePrefix), JSON.stringify(map));
    } catch (e) { /* localStorage indisponível (modo privado etc.) — segue sem travar o quiz */ }
  }

  // Reenvia pro banco tudo que está salvo localmente pra essa matéria. Roda
  // toda vez que a página carrega (além da gravação em tempo real a cada
  // clique) — então, se a gravação em rede tiver falhado em algum momento
  // (por qualquer motivo, mesmo um que a gente não consiga identificar),
  // na próxima vez que o aluno abrir essa matéria a sincronização tenta de
  // novo, com tudo que já tem localmente, não só a questão mais recente.
  // Depois que a Cobertura é reiniciada (botão em cobertura-banco.html, ver
  // sync-offline.js), ela só conta respostas com `respondida_em` posterior ao
  // reinício — então, a partir daí, toda gravação passa a carimbar esse campo.
  function coberturaReiniciada(userId) {
    return !!(global.AlfaOffline && global.AlfaOffline.coberturaResetAt(userId) > 0);
  }

  function syncLocalAnswers(sb, userId, quizId, storagePrefix) {
    if (!sb || !userId || !quizId || !storagePrefix) return Promise.resolve();
    var map = getLocalAnsweredMap(storagePrefix);
    var ids = Object.keys(map);
    if (ids.length === 0) return Promise.resolve();
    var reiniciada = coberturaReiniciada(userId);
    var agora = new Date().toISOString();
    var rows = ids.map(function (qid) {
      var row = {
        user_id: userId,
        quiz_id: quizId,
        subject: map[qid].subject,
        question_id: qid,
        acertou: map[qid].acertou
      };
      // Após o reinício o mapa local só tem respostas novas (ele é limpo no
      // reinício), então atualiza o carimbo também das que já existiam no banco.
      if (reiniciada) row.respondida_em = agora;
      return row;
    });
    var LOTE = 200;
    var chain = Promise.resolve();
    var _loop = function (i) {
      var lote = rows.slice(i, i + LOTE);
      chain = chain.then(function () {
        return sb.from('respostas_detalhadas')
          .upsert(lote, { onConflict: 'user_id,quiz_id,question_id', ignoreDuplicates: !reiniciada })
          .then(function (res) {
            if (res && res.error) return sb.from('respostas_detalhadas').insert(lote).catch(function () {});
            return res;
          })
          .catch(function () {});
      });
    };
    for (var i = 0; i < rows.length; i += LOTE) _loop(i);
    return chain.catch(function () {});
  }

  function logRespostaDetalhada(sb, row) {
    if (row && coberturaReiniciada(row.user_id)) row.respondida_em = new Date().toISOString();
    return sb.from('respostas_detalhadas')
      .upsert(row, { onConflict: 'user_id,quiz_id,question_id' })
      .then(function (res) {
        if (res && res.error) return sb.from('respostas_detalhadas').insert(row);
        return res;
      })
      .catch(function () {
        return sb.from('respostas_detalhadas').insert(row).catch(function () {});
      });
  }

  function reconcileRespostasDetalhadas(sb, userId, quizId, questionsData, userAnswers) {
    if (!sb || !userId || !quizId || !questionsData) return Promise.resolve();
    // Esta recuperação reenvia respostas antigas (de antes de qualquer
    // reinício). Depois que a Cobertura foi reiniciada, elas não devem voltar
    // a contar, então a recuperação deixa de rodar.
    if (coberturaReiniciada(userId)) return Promise.resolve();
    // Junta duas fontes de "o que eu já respondi": o estado atual em memória
    // (userAnswers, de onde você parou agora) E o histórico de toda prova/
    // simulado dessa matéria que você já finalizou (tabela `resultados`,
    // que guarda um retrato de `respostas` — índice da questão -> opção
    // marcada — a cada finalização). A segunda fonte existe justamente pra
    // recuperar respostas de quando a gravação detalhada (respostas_detalhadas)
    // falhava silenciosamente (por exemplo, por falta de permissão no banco
    // antes da correção) — `resultados` não depende dessa mesma permissão e
    // é por isso que o total de acertos da página inicial sempre esteve
    // certo mesmo quando a Cobertura ficava zerada.
    return Promise.all([
      sb.from('respostas_detalhadas').select('question_id').eq('user_id', userId).eq('quiz_id', quizId),
      sb.from('resultados').select('respostas').eq('user_id', userId).eq('quiz_id', quizId)
    ])
      .then(function (results) {
        var detalhesRes = results[0];
        var resultadosRes = results[1];
        if (detalhesRes.error) return;
        var logged = {};
        (detalhesRes.data || []).forEach(function (r) { logged[String(r.question_id)] = true; });

        var combinedAnswers = {};
        Object.keys(userAnswers || {}).forEach(function (idxStr) { combinedAnswers[idxStr] = userAnswers[idxStr]; });
        if (!resultadosRes.error) {
          (resultadosRes.data || []).forEach(function (row) {
            var respostas = (row && row.respostas) || {};
            Object.keys(respostas).forEach(function (idxStr) {
              if (combinedAnswers[idxStr] === undefined) combinedAnswers[idxStr] = respostas[idxStr];
            });
          });
        }

        var toInsert = [];
        Object.keys(combinedAnswers).forEach(function (idxStr) {
          var idx = Number(idxStr);
          var q = questionsData[idx];
          if (!q) return;
          if (logged[String(q.id)]) return;
          var selected = combinedAnswers[idxStr];
          if (selected === undefined || selected === null) return;
          toInsert.push({
            user_id: userId,
            quiz_id: quizId,
            subject: q.subject,
            question_id: q.id,
            acertou: selected === q.correct
          });
        });

        if (toInsert.length === 0) return;

        var LOTE = 200;
        var chain = Promise.resolve();
        var _loop = function (i) {
          var lote = toInsert.slice(i, i + LOTE);
          chain = chain.then(function () {
            return sb.from('respostas_detalhadas')
              .upsert(lote, { onConflict: 'user_id,quiz_id,question_id', ignoreDuplicates: true })
              .then(function (res) {
                if (res && res.error) return sb.from('respostas_detalhadas').insert(lote);
                return res;
              });
          });
        };
        for (var i = 0; i < toInsert.length; i += LOTE) _loop(i);
        return chain;
      })
      .catch(function () { /* silencioso — nunca deve travar o carregamento do quiz */ });
  }

  global.AlfaGamification = {
    SUBJECTS: SUBJECTS,
    TOTAL_SUBJECTS: TOTAL_SUBJECTS,
    labelFor: labelFor,
    diasParaProva: diasParaProva,
    PATENTES: PATENTES,
    patenteFor: patenteFor,
    initialFor: initialFor,
    uploadAvatar: uploadAvatar,
    computeStreak: computeStreak,
    diaISO: diaISO,
    registrarAtividade: registrarAtividade,
    carregarAtividade: carregarAtividade,
    streakDeDias: streakDeDias,
    personalStats: personalStats,
    computeBadges: computeBadges,
    newlyUnlockedBadges: newlyUnlockedBadges,
    fraseDoDia: fraseDoDia,
    celebrar: celebrar,
    toastConquista: toastConquista,
    extractQuestionsFromHtml: extractQuestionsFromHtml,
    fetchSubjectQuestions: fetchSubjectQuestions,
    getAccessCache: getAccessCache,
    acessoEmDia: acessoEmDia,
    outroAparelho: outroAparelho,
    selectPerfilAcesso: selectPerfilAcesso,
    mostrarMotivoBloqueio: mostrarMotivoBloqueio,
    setAccessCacheAprovado: setAccessCacheAprovado,
    setAccessCacheQuiz: setAccessCacheQuiz,
    setAccessCacheFull: setAccessCacheFull,
    showOfflineGate: showOfflineGate,
    fetchAprovado: fetchAprovado,
    fetchQuizAccess: fetchQuizAccess,
    fetchAllAccess: fetchAllAccess,
    fetchApostilaLinks: fetchApostilaLinks,
    apostilaLinkHtml: apostilaLinkHtml,
    reconcileRespostasDetalhadas: reconcileRespostasDetalhadas,
    logRespostaDetalhada: logRespostaDetalhada,
    STORAGE_PREFIX_BY_QUIZ: STORAGE_PREFIX_BY_QUIZ,
    getLocalAnsweredMap: getLocalAnsweredMap,
    recordAnswerLocal: recordAnswerLocal,
    syncLocalAnswers: syncLocalAnswers
  };
})(window);
