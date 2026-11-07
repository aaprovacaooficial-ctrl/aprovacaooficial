/*
 * sync-offline.js — Plataforma de Estudos CA-AA/AFN
 *
 * Carregado em todas as páginas logo depois do supabase-js. Faz três coisas:
 *
 *  1. LOGIN OFFLINE: o token de acesso do Supabase vence a cada 1h. Sem
 *     internet, o supabase-js não consegue renová-lo e avisava a página como
 *     se você estivesse deslogado (tela de login). Aqui, se não há conexão com
 *     o Supabase mas existe uma sessão salva neste aparelho, a página recebe
 *     essa sessão e abre normalmente com os dados em cache. Quando a internet
 *     volta, o próprio supabase-js renova o token sozinho.
 *
 *  2. SINCRONIZAÇÃO ENTRE APARELHOS (AlfaSync): listas que antes ficavam só
 *     no localStorage (flashcards criados de questões, questões favoritas,
 *     favoritos dos flashcards, itens lidos nas apostilas) passam a ser
 *     guardadas também na tabela `dados_usuario` (supabase_sincronizacao.sql).
 *     Cada item guarda quando foi adicionado/removido, então mudanças feitas
 *     no celular e no computador se juntam em vez de uma apagar a outra. Sem
 *     internet, a mudança fica pendente e é enviada quando a conexão volta.
 *
 *  3. REINICIAR COBERTURA e DOWNLOAD OFFLINE (AlfaOffline): marca o momento a
 *     partir do qual a Cobertura do Banco volta a contar do zero (sem apagar
 *     nada), e baixa todas as páginas/apostilas/provas pro cache do aparelho.
 */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://ghlaukrbwwecpeanlmlp.supabase.co';
  var AUTH_STORAGE_KEY = 'sb-ghlaukrbwwecpeanlmlp-auth-token';
  var TABLE = 'dados_usuario';
  var PENDING_KEY = 'alfa_sync_pendentes';

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* modo privado etc. */ }
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, ms); })
    ]);
  }

  // ===================================================================
  // 1. Login offline
  // ===================================================================
  // Cópia de reserva da sessão: se o supabase-js apagar a sessão salva por
  // causa de uma falha de rede, o aparelho continua entrando offline. Só é
  // apagada quando a pessoa toca em "Sair".
  var BACKUP_KEY = 'alfa_sessao_reserva';

  function storedSession() {
    var s = lsGet(AUTH_STORAGE_KEY, null);
    if (s && s.user) return s;
    var b = lsGet(BACKUP_KEY, null);
    return b && b.user ? b : null;
  }

  function guardarReserva(session) {
    if (session && session.user && session.refresh_token) lsSet(BACKUP_KEY, session);
  }

  // Lembra o resultado por alguns segundos para não testar a rede duas
  // vezes seguidas ao abrir a página.
  var ultimoTeste = null;
  function supabaseReachable() {
    if (navigator.onLine === false) return Promise.resolve(false);
    if (ultimoTeste && Date.now() - ultimoTeste.t < 10000) return ultimoTeste.p;
    // Qualquer resposta (mesmo 401) significa que há rede até o Supabase.
    var p = withTimeout(fetch(SUPABASE_URL + '/auth/v1/health', { cache: 'no-store' }), 3500)
      .then(function () { return true; }, function () { return false; });
    ultimoTeste = { t: Date.now(), p: p };
    return p;
  }

  // Sem internet e com o token vencido (passa de 1h), o supabase-js fica
  // até 30 segundos tentando renovar o token antes de abrir a página — era
  // a demora ao abrir o app. Aqui, nesse caso, o supabase-js não recebe a
  // sessão (fica "sem login" e não tenta renovar) e a página abre na hora
  // com a sessão salva (patchClient abaixo). Nada é apagado: quando a
  // internet volta, ele lê a sessão de novo e renova sozinho.
  var modoOffline = false;
  var authStorage = {
    getItem: function (key) {
      var raw = null;
      try { raw = localStorage.getItem(key); } catch (e) { return null; }
      if (key !== AUTH_STORAGE_KEY || !raw) return raw;
      if (modoOffline) return null;
      var s = null;
      try { s = JSON.parse(raw); } catch (e) { return raw; }
      var vencendo = s && s.expires_at && s.expires_at * 1000 - Date.now() < 90 * 1000;
      if (!vencendo) return raw;
      return supabaseReachable().then(function (online) {
        if (online) return raw;
        modoOffline = true;
        return null;
      });
    },
    setItem: function (key, value) {
      // Sessão nova acabou de chegar do servidor (login ou renovação):
      // então há internet, e o supabase-js precisa enxergar essa sessão.
      // Antes, uma rede lenta ao abrir a página deixava o modo offline
      // ligado e o login feito em seguida "não pegava".
      if (key === AUTH_STORAGE_KEY && value) modoOffline = false;
      try { localStorage.setItem(key, value); } catch (e) { /* ignora */ }
    },
    removeItem: function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
    }
  };

  // Um aparelho por vez: cada navegador ganha um código próprio, enviado em
  // toda consulta ao Supabase (dentro do X-Client-Info, cabeçalho que o
  // Supabase já aceita de qualquer site) e no cookie "alfa_disp" para o
  // middleware.js. O banco (supabase_um_aparelho.sql) só libera o conteúdo
  // para o aparelho registrado por último na conta.
  var DEVICE_KEY = 'alfa_dispositivo';
  var DEVICE_COOKIE = 'alfa_disp';
  var deviceIdCache = null;

  function deviceId() {
    if (deviceIdCache) return deviceIdCache;
    try { deviceIdCache = localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignora */ }
    if (!deviceIdCache) {
      deviceIdCache = (global.crypto && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      try { localStorage.setItem(DEVICE_KEY, deviceIdCache); } catch (e) { /* ignora */ }
    }
    return deviceIdCache;
  }

  try {
    document.cookie = DEVICE_COOKIE + '=' + deviceId() + '; Path=/; Max-Age=31536000; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  } catch (e) { /* ignora */ }

  // Faz deste aparelho o único da conta (os outros perdem o acesso).
  function registrarDispositivo(sb) {
    return Promise.resolve(sb.rpc('registrar_dispositivo', { p_dispositivo: deviceId() }))
      .catch(function () { /* SQL ainda não aplicado ou sem internet */ });
  }

  // Guarda data, aparelho e cidade aproximada deste login (função
  // registrar-acesso; só o administrador vê, em acessos.html).
  function registrarAcesso(sb, tipo) {
    if (!sb || !sb.functions) return Promise.resolve();
    return withTimeout(sb.functions.invoke('registrar-acesso', {
      body: { dispositivo: deviceId(), tipo: tipo || 'login' }
    }), 6000).catch(function () { /* sem internet: segue sem registrar */ });
  }

  global.AlfaDispositivo = { id: deviceId, registrar: registrarDispositivo, registrarAcesso: registrarAcesso };

  // Cookie com o token de acesso: o servidor do site (middleware.js) lê
  // esse cookie para só entregar apostilas, questões e flashcards a quem
  // está logado e com o acesso em dia.
  var AUTH_COOKIE = 'alfa_token';
  function syncAuthCookie(session) {
    try {
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      if (session && session.access_token) {
        var maxAge = session.expires_at ? Math.max(0, session.expires_at - Math.floor(Date.now() / 1000)) : 3600;
        document.cookie = AUTH_COOKIE + '=' + session.access_token + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure;
      } else {
        document.cookie = AUTH_COOKIE + '=; Path=/; Max-Age=0; SameSite=Lax' + secure;
      }
    } catch (e) { /* ignora */ }
  }

  // Sem internet, cada consulta ao banco era tentada de novo 3 vezes
  // (1s + 2s + 4s) antes de desistir. Quando já se sabe que está sem
  // internet, a consulta desiste na hora e a página usa o que tem salvo.
  function semInternet() {
    return navigator.onLine === false || modoOffline;
  }
  function fetchSemEspera(fetchOriginal) {
    return function (url, init) {
      if (semInternet() && String(url).indexOf('/rest/v1/') !== -1) {
        var erro;
        try { erro = new DOMException('Sem internet', 'AbortError'); } catch (e) { erro = new Error('Sem internet'); erro.name = 'AbortError'; }
        return Promise.reject(erro);
      }
      return (fetchOriginal || fetch)(url, init);
    };
  }

  function patchClient(client) {
    var auth = client && client.auth;
    if (!auth || auth.__alfaOfflinePatched) return client;
    var original = auth.onAuthStateChange.bind(auth);
    // Registrado antes dos ouvintes da página, então o cookie já está
    // atualizado quando a página reage ao login.
    original(function (event, session) {
      if (session || event === 'SIGNED_OUT') syncAuthCookie(session);
      guardarReserva(session);
    });
    // "Sair" de verdade apaga também a cópia de reserva.
    if (typeof auth.signOut === 'function') {
      var originalSignOut = auth.signOut.bind(auth);
      auth.signOut = function () {
        try { localStorage.removeItem(BACKUP_KEY); } catch (e) { /* ignora */ }
        return originalSignOut.apply(null, arguments);
      };
    }
    // A internet voltou (ou a rede só estava lenta ao abrir): devolve a
    // sessão ao supabase-js, que renova o token.
    function tentarVoltar() {
      if (!modoOffline || navigator.onLine === false) return;
      ultimoTeste = null;
      supabaseReachable().then(function (online) {
        if (!online || !modoOffline) return;
        modoOffline = false;
        auth.getSession().catch(function () {});
      });
    }
    global.addEventListener('online', tentarVoltar);
    setInterval(tentarVoltar, 20000);
    auth.onAuthStateChange = function (callback) {
      return original(function (event, session) {
        if (event === 'INITIAL_SESSION' && !session) {
          var saved = storedSession();
          if (saved) {
            supabaseReachable().then(function (online) {
              if (online) callback(event, session);
              else {
                AlfaOffline.usingCachedSession = true;
                callback(event, saved);
              }
            });
            return;
          }
        }
        return callback(event, session);
      });
    };
    auth.__alfaOfflinePatched = true;
    return client;
  }

  if (global.supabase && typeof global.supabase.createClient === 'function' && !global.supabase.__alfaPatched) {
    var originalCreateClient = global.supabase.createClient;
    global.supabase.createClient = function (url, key, options) {
      options = options || {};
      var globalOpts = options.global || {};
      var headers = Object.assign({}, globalOpts.headers || {});
      headers['X-Client-Info'] = 'supabase-js-web alfa-disp=' + deviceId();
      var authOpts = Object.assign({ storage: authStorage }, options.auth || {});
      options = Object.assign({}, options, {
        auth: authOpts,
        global: Object.assign({}, globalOpts, { headers: headers, fetch: fetchSemEspera(globalOpts.fetch) })
      });
      return patchClient(originalCreateClient.call(this, url, key, options));
    };
    global.supabase.__alfaPatched = true;
  }

  // ===================================================================
  // 2. Listas sincronizadas (AlfaSync)
  //
  // localStorage[key]            -> a lista no formato que cada página já usa
  // localStorage[key + '__sync'] -> { id: { t: quando mudou, d: 1 se removido } }
  // dados_usuario (chave = key)  -> { items: { id: { t, d, v: item } } }
  //
  // idField: nome do campo que identifica o item (ex: '_qid'), ou null quando
  // o próprio item é o id (listas de ids, como favoritos).
  // ===================================================================
  var tableMissing = false;
  var lastClient = null;
  var lastUserId = null;
  var pushTimers = {};

  function idOf(item, idField) {
    return String(idField ? item[idField] : item);
  }

  function readList(key) {
    var v = lsGet(key, []);
    return Array.isArray(v) ? v : [];
  }

  function readMeta(key) {
    var v = lsGet(key + '__sync', {});
    return v && typeof v === 'object' ? v : {};
  }

  function localItems(key, idField) {
    var list = readList(key);
    var meta = readMeta(key);
    var items = {};
    list.forEach(function (item) {
      var id = idOf(item, idField);
      items[id] = { t: (meta[id] && meta[id].t) || 0, v: item };
    });
    Object.keys(meta).forEach(function (id) {
      if (meta[id].d && !items[id]) items[id] = { t: meta[id].t, d: 1 };
    });
    return { list: list, items: items };
  }

  // Junta duas versões item a item: vale a mudança mais recente de cada um.
  function mergeItems(a, b) {
    var out = {};
    Object.keys(a).forEach(function (id) { out[id] = a[id]; });
    Object.keys(b).forEach(function (id) {
      if (!out[id] || (b[id].t || 0) > (out[id].t || 0)) out[id] = b[id];
    });
    return out;
  }

  function sameItems(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(function (id) {
      return b[id] && (a[id].t || 0) === (b[id].t || 0) && !!a[id].d === !!b[id].d;
    });
  }

  function saveLocalFromItems(key, items, previousList, idField) {
    var meta = {};
    var list = [];
    var seen = {};
    // Mantém a ordem que já existia neste aparelho; itens novos vão pro fim.
    previousList.forEach(function (item) {
      var id = idOf(item, idField);
      if (items[id] && !items[id].d && !seen[id]) { list.push(items[id].v); seen[id] = true; }
    });
    Object.keys(items)
      .filter(function (id) { return !items[id].d && !seen[id]; })
      .sort(function (x, y) { return (items[x].t || 0) - (items[y].t || 0); })
      .forEach(function (id) { list.push(items[id].v); });
    Object.keys(items).forEach(function (id) {
      meta[id] = items[id].d ? { t: items[id].t, d: 1 } : { t: items[id].t || 0 };
    });
    lsSet(key, list);
    lsSet(key + '__sync', meta);
    return list;
  }

  function markPending(key, idField) {
    var pending = lsGet(PENDING_KEY, {});
    pending[key] = idField || null;
    lsSet(PENDING_KEY, pending);
  }
  function clearPending(key) {
    var pending = lsGet(PENDING_KEY, {});
    delete pending[key];
    lsSet(PENDING_KEY, pending);
  }

  function remember(sb, userId) {
    if (sb && userId) { lastClient = sb; lastUserId = userId; }
  }

  // Baixa a versão da nuvem, junta com a deste aparelho, salva o resultado
  // aqui e, se este aparelho tinha algo mais novo, envia de volta.
  function syncList(sb, userId, key, idField) {
    remember(sb, userId);
    var local = localItems(key, idField);
    if (!sb || !userId || tableMissing) return Promise.resolve(local.list);
    return withTimeout(
      sb.from(TABLE).select('valor').eq('user_id', userId).eq('chave', key).maybeSingle(), 8000
    ).then(function (res) {
      if (res.error) {
        if (/does not exist|schema cache|relation/i.test(res.error.message || '')) tableMissing = true;
        throw res.error;
      }
      var remote = (res.data && res.data.valor && res.data.valor.items) || {};
      var current = localItems(key, idField); // relê: pode ter mudado durante a consulta
      var merged = mergeItems(remote, current.items);
      var list = saveLocalFromItems(key, merged, current.list, idField);
      if (sameItems(merged, remote)) {
        clearPending(key);
        return list;
      }
      return sb.from(TABLE).upsert({
        user_id: userId, chave: key, valor: { items: merged }, atualizado_em: new Date().toISOString()
      }, { onConflict: 'user_id,chave' }).then(function (up) {
        if (up.error) throw up.error;
        clearPending(key);
        return list;
      });
    }).catch(function () {
      markPending(key, idField);
      return readList(key);
    });
  }

  // Substitui a lista local (mesma coisa que a página já fazia com
  // localStorage.setItem) registrando o que foi adicionado/removido, e agenda
  // o envio pra nuvem.
  function writeList(sb, user, key, list, idField) {
    var previous = localItems(key, idField);
    var meta = readMeta(key);
    var now = Date.now();
    var newIds = {};
    list.forEach(function (item) {
      var id = idOf(item, idField);
      newIds[id] = true;
      if (!previous.items[id] || previous.items[id].d) meta[id] = { t: now };
    });
    previous.list.forEach(function (item) {
      var id = idOf(item, idField);
      if (!newIds[id]) meta[id] = { t: now, d: 1 };
    });
    lsSet(key, list);
    lsSet(key + '__sync', meta);
    markPending(key, idField);
    var userId = user && user.id ? user.id : user;
    if (sb && userId) {
      remember(sb, userId);
      clearTimeout(pushTimers[key]);
      pushTimers[key] = setTimeout(function () { syncList(sb, userId, key, idField); }, 500);
    }
  }

  function flushPending() {
    if (!lastClient || !lastUserId) return;
    var pending = lsGet(PENDING_KEY, {});
    Object.keys(pending).forEach(function (key) {
      syncList(lastClient, lastUserId, key, pending[key]);
    });
  }
  global.addEventListener('online', function () { tableMissing = false; flushPending(); });

  // Valores simples (um objeto por chave), sem junção item a item.
  function getValue(sb, userId, key) {
    return withTimeout(sb.from(TABLE).select('valor').eq('user_id', userId).eq('chave', key).maybeSingle(), 6000)
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data ? res.data.valor : null;
      });
  }
  function setValue(sb, userId, key, valor) {
    return sb.from(TABLE).upsert({
      user_id: userId, chave: key, valor: valor, atualizado_em: new Date().toISOString()
    }, { onConflict: 'user_id,chave' }).then(function (res) {
      if (res.error) throw res.error;
    });
  }

  global.AlfaSync = {
    readList: readList,
    writeList: writeList,
    syncList: syncList,
    flushPending: flushPending,
    getValue: getValue,
    setValue: setValue
  };

  // ===================================================================
  // 3a. Reiniciar Cobertura do Banco
  //
  // Não apaga nada no banco: só guarda o momento do reinício (na nuvem, pra
  // valer em todos os aparelhos) e a Cobertura passa a contar apenas questões
  // respondidas depois disso. Neste aparelho, limpa o mapa local que só
  // serve à Cobertura (<prefixo>_answered_map); as respostas de cada matéria
  // continuam intactas.
  // ===================================================================
  var COBERTURA_KEY = 'cobertura_reiniciada_em';

  function coberturaLocalKey(userId) { return 'alfa_cobertura_reiniciada_em_' + userId; }

  // O início de um novo ciclo de prova (ver AlfaCiclo abaixo) também zera a Cobertura.
  function coberturaResetAt(userId) {
    return Math.max(Number(lsGet(coberturaLocalKey(userId), 0)) || 0, cicloInicio());
  }

  function clearLocalCoverage() {
    var prefixes = (global.AlfaGamification && AlfaGamification.STORAGE_PREFIX_BY_QUIZ) || {};
    Object.keys(prefixes).forEach(function (quizId) {
      try { localStorage.removeItem(prefixes[quizId] + '_answered_map'); } catch (e) {}
    });
  }

  // Roda ao abrir as páginas: se a Cobertura foi reiniciada em outro aparelho,
  // aplica aqui também. Sem internet, segue com o que já sabe.
  function applyCoverageReset(sb, userId) {
    if (!sb || !userId) return Promise.resolve();
    var propria = getValue(sb, userId, COBERTURA_KEY).then(function (valor) {
      var t = valor && Number(valor.t);
      if (t && t > (Number(lsGet(coberturaLocalKey(userId), 0)) || 0)) {
        clearLocalCoverage();
        lsSet(coberturaLocalKey(userId), t);
      }
    }).catch(function () {});
    return Promise.all([propria, applyCycle(sb, userId)]);
  }

  // ===================================================================
  // 3c. Ciclo da prova (AlfaCiclo)
  //
  // A data da prova fica na tabela `configuracoes` (chave 'prova'), editável
  // só pelo admin na página inicial. Quando o admin define uma nova data,
  // começa um novo ciclo: `ciclo_inicio` marca o momento, e ranking,
  // desempenho, conquistas, estatísticas e banco de questões passam a
  // considerar só o que foi feito depois dele. Nada é apagado no banco.
  // ===================================================================
  var CONFIG_CACHE_KEY = 'alfa_config_prova';

  function cachedConfig() {
    var c = lsGet(CONFIG_CACHE_KEY, null);
    return c && typeof c === 'object' ? c : null;
  }

  function loadConfig(sb) {
    if (!sb) return Promise.resolve(cachedConfig());
    return withTimeout(sb.from('configuracoes').select('valor').eq('chave', 'prova').maybeSingle(), 6000)
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data && res.data.valor) lsSet(CONFIG_CACHE_KEY, res.data.valor);
        return cachedConfig();
      })
      .catch(function () { return cachedConfig(); });
  }

  function cicloInicio() {
    var c = cachedConfig();
    return (c && c.ciclo_inicio && Date.parse(c.ciclo_inicio)) || 0;
  }

  function cicloInicioISO() {
    var t = cicloInicio();
    return t ? new Date(t).toISOString() : null;
  }

  // Acrescenta à consulta o filtro "só deste ciclo" (quando há um ciclo).
  function filtrarCiclo(query, coluna) {
    var iso = cicloInicioISO();
    return iso ? query.gte(coluna || 'criado_em', iso) : query;
  }

  function dataProva() {
    var c = cachedConfig();
    return c && c.data ? c.data : null;
  }

  function setDataProva(sb, data) {
    var valor = { data: data, ciclo_inicio: new Date().toISOString() };
    return sb.from('configuracoes').upsert({
      chave: 'prova', valor: valor, atualizado_em: new Date().toISOString()
    }, { onConflict: 'chave' }).then(function (res) {
      if (res.error) throw res.error;
      lsSet(CONFIG_CACHE_KEY, valor);
      return valor;
    });
  }

  // Neste aparelho: na primeira vez que vê um ciclo novo, limpa as respostas
  // salvas localmente de cada matéria (o banco de questões recomeça).
  function applyCycle(sb, userId) {
    return loadConfig(sb).then(function () {
      var inicio = cicloInicio();
      var chave = 'alfa_ciclo_aplicado_' + userId;
      if (!inicio || inicio <= (Number(lsGet(chave, 0)) || 0)) return;
      clearLocalCoverage();
      var prefixes = Object.assign({
        HISTORIA_NAVAL_FATOS_1: 'hist_naval_fatos1',
        PROVA_SIMULADA: 'prova_simulada'
      }, (global.AlfaGamification && AlfaGamification.STORAGE_PREFIX_BY_QUIZ) || {});
      Object.keys(prefixes).forEach(function (quizId) {
        ['_answers', '_discarded_options', '_elapsed_start', '_current_index', '_order'].forEach(function (suf) {
          try { localStorage.removeItem(prefixes[quizId] + suf); } catch (e) {}
        });
        try { localStorage.removeItem('alfa_progresso_pendente_' + quizId); } catch (e) {}
      });
      lsSet(chave, inicio);
    });
  }

  // Aviso único, por aparelho, de que um novo ciclo começou.
  function cicloPrecisaAviso(userId) {
    var inicio = cicloInicio();
    return !!inicio && inicio > (Number(lsGet('alfa_ciclo_avisado_' + userId, 0)) || 0);
  }
  function marcarCicloAvisado(userId) { lsSet('alfa_ciclo_avisado_' + userId, cicloInicio()); }

  global.AlfaCiclo = {
    loadConfig: loadConfig,
    inicio: cicloInicio,
    inicioISO: cicloInicioISO,
    filtrar: filtrarCiclo,
    dataProva: dataProva,
    setDataProva: setDataProva,
    applyCycle: applyCycle,
    precisaAviso: cicloPrecisaAviso,
    marcarAvisado: marcarCicloAvisado
  };

  function resetCoverage(sb, userId) {
    var t = Date.now();
    return setValue(sb, userId, COBERTURA_KEY, { t: t }).then(function () {
      clearLocalCoverage();
      lsSet(coberturaLocalKey(userId), t);
      return t;
    });
  }

  // ===================================================================
  // 3b. Baixar tudo pra usar offline
  //
  // Percorre o site a partir do index.html (seguindo os links .html), e
  // busca cada página, script, imagem, apostila e prova que encontrar. Como
  // tudo passa pelo service worker (sw.js), cada resposta fica salva no
  // cache do aparelho. Não depende de lista fixa: páginas e apostilas novas
  // entram sozinhas na próxima vez que rodar.
  // ===================================================================
  var LAST_DOWNLOAD_KEY = 'alfa_offline_baixado_em';
  var downloading = null;

  function sameOriginPath(raw, base) {
    try {
      var u = new URL(raw, base);
      if (u.origin !== location.origin) return null;
      return u.pathname.replace(/^\//, '') || 'index.html';
    } catch (e) { return null; }
  }

  function collectFromHtml(html, pageUrl, pages, assets) {
    var m;
    var attr = /(?:href|src)\s*=\s*["']([^"'#]+)["']/g;
    while ((m = attr.exec(html))) {
      var raw = m[1];
      if (/^(https?:)?\/\//.test(raw) || /^(mailto|tel|javascript|data):/.test(raw)) continue;
      var path = sameOriginPath(raw, pageUrl);
      if (!path) continue;
      if (/\.html$/.test(path)) pages[path] = true;
      else if (/\.(js|json|png|jpe?g|webp|svg|css)$/.test(path)) assets[path] = true;
    }
    var json = /["'`](content\/[A-Za-z0-9_\-\/]+\.json)["'`]/g;
    while ((m = json.exec(html))) assets[m[1]] = true;
    var slug = /apostila-leitura\.html\?slug=([a-z0-9_\-]+)/g;
    while ((m = slug.exec(html))) assets['content/apostila-' + m[1] + '.json'] = true;
    var links = /fetchApostilaLinks\(\s*'([^']+)'\s*\)/g;
    while ((m = links.exec(html))) assets['content/apostila-links-' + m[1] + '.json'] = true;
  }

  function downloadAll(onProgress) {
    if (downloading) return downloading;
    var report = typeof onProgress === 'function' ? onProgress : function () {};
    var pages = { 'index.html': true };
    var done = {};
    var assets = {};
    var failed = 0;

    function fetchOk(url) {
      return fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error(res.status);
        return res;
      });
    }

    function crawl() {
      var next = Object.keys(pages).filter(function (p) { return !done[p]; });
      if (!next.length) return Promise.resolve();
      return Promise.all(next.map(function (p) {
        done[p] = true;
        return fetchOk(p).then(function (res) { return res.text(); })
          .then(function (html) { collectFromHtml(html, new URL(p, location.href).href, pages, assets); })
          .catch(function () { failed++; });
      })).then(function () {
        report({ fase: 'paginas', feitos: Object.keys(done).length, total: Object.keys(pages).length });
        return crawl();
      });
    }

    downloading = crawl()
      .then(function () {
        // Provas anteriores: o índice diz quais arquivos existem.
        return fetchOk('content/provas/index.json').then(function (r) { return r.json(); }).then(function (lista) {
          assets['content/provas/index.json'] = true;
          (lista || []).forEach(function (p) { if (p && p.slug) assets['content/provas/' + p.slug + '.json'] = true; });
        }).catch(function () {});
      })
      .then(function () {
        var list = Object.keys(assets).filter(function (a) { return a !== 'sw.js'; });
        var count = 0;
        var queue = list.slice();
        function worker() {
          var item = queue.shift();
          if (!item) return Promise.resolve();
          return fetchOk(item).then(function (res) { return res.blob(); }).catch(function () { failed++; })
            .then(function () {
              count++;
              report({ fase: 'arquivos', feitos: count, total: list.length });
              return worker();
            });
        }
        return Promise.all([worker(), worker(), worker(), worker()]);
      })
      .then(function () {
        lsSet(LAST_DOWNLOAD_KEY, Date.now());
        var result = { paginas: Object.keys(pages).length, arquivos: Object.keys(assets).length, falhas: failed };
        downloading = null;
        return result;
      }, function (err) { downloading = null; throw err; });
    return downloading;
  }

  function lastDownloadAt() { return Number(lsGet(LAST_DOWNLOAD_KEY, 0)) || 0; }

  // Atualiza o cache offline em segundo plano, no máximo a cada 12h, sempre
  // que houver internet — assim o que você publicar de novo chega sozinho.
  function autoDownload() {
    if (!('serviceWorker' in navigator) || navigator.onLine === false) return;
    if (Date.now() - lastDownloadAt() < 12 * 60 * 60 * 1000) return;
    navigator.serviceWorker.ready.then(function () {
      setTimeout(function () { downloadAll().catch(function () {}); }, 5000);
    }).catch(function () {});
  }

  global.AlfaOffline = {
    usingCachedSession: false,
    downloadAll: downloadAll,
    autoDownload: autoDownload,
    lastDownloadAt: lastDownloadAt,
    coberturaResetAt: coberturaResetAt,
    applyCoverageReset: applyCoverageReset,
    resetCoverage: resetCoverage
  };

  // ===================================================================
  // 4. Proteção do conteúdo: marca d'água com o e-mail do aluno e
  //    bloqueio de copiar / botão direito nas páginas de estudo.
  //    (Não vale na página inicial, que é a página de vendas.)
  // ===================================================================
  var caminho = location.pathname.replace(/\/+$/, '');
  var ehInicial = caminho === '' || /\/index\.html$/.test(caminho);

  function ehCampoEditavel(el) {
    for (var n = el; n && n !== document; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      var tag = n.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable) return true;
    }
    return false;
  }

  // Administrador não vê a marca d'água (gamification.js avisa quem é).
  var ADMIN_KEY = 'alfa_admin_id';
  function ehAdmin(userId) {
    try { return !!userId && localStorage.getItem(ADMIN_KEY) === userId; } catch (e) { return false; }
  }
  function removerMarcaDagua() {
    var el = document.getElementById('alfa-marca-dagua');
    if (el) el.parentNode.removeChild(el);
  }
  global.AlfaMarcaDagua = {
    definirAdmin: function (userId, admin) {
      try {
        if (admin) localStorage.setItem(ADMIN_KEY, userId);
        else if (localStorage.getItem(ADMIN_KEY) === userId) localStorage.removeItem(ADMIN_KEY);
      } catch (e) { /* ignora */ }
      if (admin) removerMarcaDagua();
    }
  };

  // Mostra só o começo do e-mail (ex: fer•••@hotmail.com): o aluno se
  // reconhece na marca, sem expor o e-mail inteiro na tela.
  function mascararEmail(email) {
    var partes = String(email).split('@');
    var nome = partes[0] || '';
    var visivel = nome.slice(0, nome.length > 4 ? 3 : 1);
    return visivel + '\u2022\u2022\u2022' + (partes.length > 1 ? '@' + partes.slice(1).join('@') : '');
  }

  function aplicarMarcaDagua(email) {
    if (!email || document.getElementById('alfa-marca-dagua')) return;
    var texto = ('Aprovação Oficial · ' + mascararEmail(email)).replace(/[<>&"']/g, '');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="280">' +
      '<text x="240" y="140" text-anchor="middle" transform="rotate(-28 240 140)" ' +
      'font-family="Arial, sans-serif" font-size="13" fill="rgb(128,128,128)" fill-opacity="0.07">' +
      texto + '</text></svg>';
    var div = document.createElement('div');
    div.id = 'alfa-marca-dagua';
    div.setAttribute('aria-hidden', 'true');
    div.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;' +
      'background-image:url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '");' +
      'background-repeat:repeat;-webkit-print-color-adjust:exact;print-color-adjust:exact;';
    document.body.appendChild(div);
  }

  if (!ehInicial) {
    ['copy', 'cut', 'contextmenu', 'dragstart'].forEach(function (tipo) {
      document.addEventListener(tipo, function (e) {
        if (!ehCampoEditavel(e.target)) e.preventDefault();
      }, true);
    });
    // Na leitura de apostilas dá para selecionar (para marcar trechos),
    // só não dá para copiar.
    if (!/apostila-leitura\.html$/.test(caminho)) {
      var estilo = document.createElement('style');
      estilo.textContent = 'body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
        'input,textarea,select,[contenteditable],[contenteditable] *{-webkit-user-select:text;user-select:text}';
      (document.head || document.documentElement).appendChild(estilo);
    }
    var mostrar = function () {
      var s = storedSession();
      if (s && s.user && s.user.email && !ehAdmin(s.user.id)) aplicarMarcaDagua(s.user.email);
    };
    if (document.body) mostrar();
    else document.addEventListener('DOMContentLoaded', mostrar);
    // Primeiro login nesta página: a sessão só fica salva depois.
    global.addEventListener('storage', mostrar);
    setTimeout(mostrar, 3000);
  }
})(window);
