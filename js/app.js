'use strict';
// =============================================
// ESTADO GLOBAL
// =============================================
const S = {
  user: null, tela: 'home', loteria: null, bolao: null, grupoAtual: null,
  stack: [], ze_i: 0, ze_t: null, dtaps: 0, dtap_t: 0,
  charts: {}, resultados: [], cartela: null, statsF: null,
  cache: { boloes:[], grupos:[], vendas:[], pags:[], usuarios:[], grupoMembros:[], boloesParcelados:[], ctrl:{ bloqueado:false, msg:'', cliente:'Demo', licenca:'DEMO-2024', validade:'2025-12-31', logs:[] } },
};
const $ = id => document.getElementById(id);
const fmt$ = n => 'R$ ' + (n||0).toLocaleString('pt-BR',{minimumFractionDigits:2});

function fmtPremio(v, curto=false) {
  if (!v) return '';
  if (v >= 1e9) {
    const b = v/1e9, s = b%1===0 ? b.toFixed(0) : b.toFixed(1).replace('.',',');
    return curto ? `R$ ${s}Bi` : `R$ ${s} ${b>=2?'bilhões':'bilhão'}`;
  }
  if (v >= 1e6) {
    const m = v/1e6, s = m%1===0 ? m.toFixed(0) : m.toFixed(1).replace('.',',');
    return curto ? `R$ ${s}M` : `R$ ${s} ${m>=2?'milhões':'milhão'}`;
  }
  if (v >= 1e3) {
    const k = v/1e3, s = k%1===0 ? k.toFixed(0) : k.toFixed(1).replace('.',',');
    return curto ? `R$ ${s}mil` : `R$ ${s} mil`;
  }
  return fmt$(v);
}
const fmtN = n => (n||0).toLocaleString('pt-BR');
// Trevos da +Milionária — bolinhas de trevo (1-6) exibidas após as dezenas, quando existirem.
function trevosHTML(r) {
  if (!r || !Array.isArray(r.trevos) || !r.trevos.length) return '';
  return '<span class="trevo-lbl">🍀 trevos</span>' + r.trevos.map(t => '<span class="bola bola-trevo">' + String(t).padStart(2,'0') + '</span>').join('');
}
const uid  = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
// Normaliza telefone para só dígitos, garantindo DDI 55 (ex: 5561999999999)
function normalizarFone(raw) {
  let d = (raw||'').replace(/\D/g,'');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d;
  return d;
}
const WPP_SVG = (size=32) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#25d366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
const hoje = () => new Date().toLocaleDateString('pt-BR');

// "Sem nome" (ainda não identificado pelo bot) exibe como "Participante N" em vez do texto cru —
// numerado de forma estável (ordenado por id) dentro da MESMA lista/grupo, pra não confundir com
// gente que genuinamente digitou "Sem nome" em outro lugar. Nome real do banco não muda, só a exibição.
function nomeParaExibir(lista, m) {
  if (m.nome && m.nome.trim().toLowerCase()!=='sem nome') return m.nome;
  const semNome = (lista||[]).filter(x=>!x.nome || x.nome.trim().toLowerCase()==='sem nome').sort((a,b)=>a.id.localeCompare(b.id));
  const idx = semNome.findIndex(x=>x.id===m.id);
  return `Participante ${idx+1}`;
}

// =============================================
// TOAST (avisos flutuantes)
// =============================================
const TOAST = {
  show(msg, tipo='err') {
    let area = $('toast-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'toast-area';
      area.className = 'toast-area';
      document.body.appendChild(area);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(()=>el.remove(), 5000);
  },
};

// =============================================
// API backend — token JWT, retry automático e fila offline
// =============================================
const API_URL = 'https://api-loterias-taguacenter.onrender.com';
const TOKEN_KEY = 'ltr_token';
const FILA_KEY  = 'ltr_fila';

const _token = {
  get:   () => localStorage.getItem(TOKEN_KEY) || '',
  set:   t  => { if (t) localStorage.setItem(TOKEN_KEY, t); },
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

function _sessaoExpirada() {
  _token.clear();
  sessionStorage.removeItem('ltr_s');
  S.user = null;
  TOAST.show('Sessão expirada. Faça login novamente.', 'err');
  const shell=$('shell'), bloqueio=$('bloqueio'), login=$('tela-login');
  if (shell) shell.hidden = true;
  if (bloqueio) bloqueio.hidden = true;
  if (login) login.hidden = false;
}

// Faz a chamada com retry (1s, 3s, 8s) só pra falhas transitórias (rede/5xx).
// 401 nunca é retentado. 4xx (erro do próprio pedido) também não — repetir não muda o resultado.
async function _fetchComRetry(method, path, body) {
  const delays = [1000, 3000, 8000];
  for (let tentativa = 0; tentativa <= delays.length; tentativa++) {
    try {
      const headers = {};
      if (_token.get()) headers['Authorization'] = 'Bearer ' + _token.get();
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(API_URL+path, { method, headers, body: body!==undefined?JSON.stringify(body):undefined });
      const renovado = r.headers.get('X-Token-Renovado');
      if (renovado) _token.set(renovado);
      if (r.status === 401) {
        // 401 no login = senha errada (não desloga). Cliente nunca teve token, então um 401
        // (ex: replay de item da fila deixado por uma sessão de admin anterior no mesmo aparelho)
        // não deve derrubar a sessão dele.
        if (path !== '/api/auth/login' && S.user?.role !== 'cliente') _sessaoExpirada();
        return r;
      }
      if (r.ok || (r.status >= 400 && r.status < 500)) return r; // 4xx é definitivo — não adianta repetir
      throw new Error('HTTP ' + r.status); // 5xx ou similar — trata como falha transitória
    } catch (e) {
      if (tentativa === delays.length) return null; // esgotou as tentativas
      await new Promise(res=>setTimeout(res, delays[tentativa]));
    }
  }
}

function _filaLer()      { try { return JSON.parse(localStorage.getItem(FILA_KEY)||'[]'); } catch { return []; } }
function _filaSalvar(f)  { localStorage.setItem(FILA_KEY, JSON.stringify(f)); }
function _filaAdicionar(method, path, body) {
  const fila = _filaLer();
  fila.push({ method, path, body, id: uid() });
  _filaSalvar(fila);
}
async function _filaReprocessar() {
  const fila = _filaLer();
  if (!fila.length) return;
  const resultados = await Promise.all(fila.map(async item => {
    const r = await _fetchComRetry(item.method, item.path, item.body);
    return { item, ok: !!r && r.ok };
  }));
  const restantes = resultados.filter(x=>!x.ok).map(x=>x.item);
  _filaSalvar(restantes);
  const sincronizados = fila.length - restantes.length;
  if (sincronizados > 0) {
    TOAST.show(`✅ ${sincronizados} alteração${sincronizados!==1?'ões':''} sincronizada${sincronizados!==1?'s':''}!`, 'ok');
  }
}
window.addEventListener('online', _filaReprocessar);

// Escritas (post/put/del): se esgotar o retry, entra na fila offline e avisa (exceto o login — nunca guarda senha na fila)
async function _escrever(method, path, body) {
  // Já sabendo que está offline, não adianta gastar os 12s de retry — vai direto pra fila
  if (navigator.onLine === false) {
    if (path !== '/api/auth/login') {
      _filaAdicionar(method, path, body);
      TOAST.show('⚠️ Sem conexão — a alteração será enviada quando voltar', 'err');
    }
    return null;
  }
  const r = await _fetchComRetry(method, path, body);
  if (!r && path !== '/api/auth/login') {
    _filaAdicionar(method, path, body);
    TOAST.show('⚠️ Erro ao salvar — verifique a conexão', 'err');
  }
  return r;
}

const _api = {
  get: async p => {
    try {
      const headers = {};
      if (_token.get()) headers['Authorization'] = 'Bearer ' + _token.get();
      const r = await fetch(API_URL+p, { headers });
      return r.ok ? r.json() : null;
    } catch { return null; }
  },
  post: (p,b) => _escrever('POST', p, b),
  put:  (p,b) => _escrever('PUT', p, b),
  del:  p     => _escrever('DELETE', p),
};

async function carregarDados() {
  const [boloes,grupos,vendas,pags,usuarios,ctrl,grupoMembros,premiacoes,boloesParcelados] = await Promise.all([
    _api.get('/api/boloes'), _api.get('/api/grupos'), _api.get('/api/vendas'),
    _api.get('/api/pagamentos'), _api.get('/api/usuarios'), _api.get('/api/config'),
    _api.get('/api/grupo_membros'), _api.get('/api/premiacoes'), _api.get('/api/boloes-parcelados'),
  ]);
  // PostgreSQL retorna NUMERIC como string — converter para number
  if (Array.isArray(boloes))   S.cache.boloes   = boloes.map(b => ({
    ...b,
    valor_cota:  +b.valor_cota  || 0,
    cotas_total: +b.cotas_total || 0,
    concurso:    +b.concurso    || 0,
    membros: (b.membros||[]).map(m => ({ ...m, cotas: +m.cotas||0 })),
  }));
  if (Array.isArray(grupos))   S.cache.grupos   = grupos.map(g => ({ ...g, membros: +g.membros||0 }));
  if (Array.isArray(vendas))   S.cache.vendas   = vendas.map(v => ({ ...v, valor: +v.valor||0, cotas: +v.cotas||0 }));
  if (Array.isArray(pags))     S.cache.pags     = pags.map(p => ({ ...p, concurso: +p.concurso||0 }));
  if (Array.isArray(usuarios)) S.cache.usuarios = usuarios;
  if (ctrl && ctrl.id)         S.cache.ctrl     = ctrl;
  if (Array.isArray(grupoMembros)) S.cache.grupoMembros = grupoMembros;
  if (Array.isArray(premiacoes)) S.cache.premiacoes = premiacoes.map(p => ({ ...p, valor: +p.valor||0 }));
  if (Array.isArray(boloesParcelados)) S.cache.boloesParcelados = normalizarBoloesParcelados(boloesParcelados);
}

// PostgreSQL devolve NUMERIC como string — usado tanto no carregarDados() (login) quanto no
// polling da tela _anualDet (refletir comprovantes enviados por outros aparelhos sem reload).
function normalizarBoloesParcelados(arr) {
  return arr.map(b => ({
    ...b,
    valor_mensal: +b.valor_mensal || 0,
    duracao_meses: +b.duracao_meses || 12,
    valor_total: +b.valor_total || 0,
    participantes: (b.participantes||[]).map(p => ({
      ...p,
      mes_quitacao_previsto: p.mes_quitacao_previsto == null ? null : +p.mes_quitacao_previsto,
      pagamentos: (p.pagamentos||[]).map(pg => ({ ...pg, mes: +pg.mes||0, valor: +pg.valor||0 })),
    })),
  }));
}

// Um bolão pertence a um grupo só se o grupo_id bater (vínculo de verdade).
// Sem fallback por nome de propósito: se um grupo for apagado e outro recriado com o MESMO
// nome depois, comparar por texto reassociaria por engano um bolão órfão ao grupo novo e
// não-relacionado — exatamente o tipo de vínculo falso que essa coluna existe pra evitar.
// Bolões legados sem grupo_id (de antes dessa migração) foram corrigidos manualmente uma vez.
function bolaoDoGrupo(b, g) {
  return !!b.grupo_id && b.grupo_id === g.id;
}

// Nomes dos meses (índice 0 = janeiro) — rótulos da planilha do Bolão Anual e dos meses em aberto.
const MESES_NOMES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// =============================================
// DB (cache em memória + API)
// =============================================
const DB = {
  boloes: {
    list: ()  => S.cache.boloes || [],
    byLt: lt  => (S.cache.boloes||[]).filter(b=>b.loteria===lt),
    get:  id  => (S.cache.boloes||[]).find(b=>b.id===id),
    save: b   => { const l=S.cache.boloes; const i=l.findIndex(x=>x.id===b.id); i>=0?l[i]=b:l.push(b); _api.post('/api/boloes',b); },
    del:  id  => { S.cache.boloes=S.cache.boloes.filter(b=>b.id!==id); _api.del('/api/boloes/'+id); },
  },
  grupos: {
    list: ()  => S.cache.grupos || [],
    save: g   => { const l=S.cache.grupos; const i=l.findIndex(x=>x.id===g.id); i>=0?l[i]=g:l.push(g); _api.post('/api/grupos',g); },
    del:  id  => { S.cache.grupos=S.cache.grupos.filter(g=>g.id!==id); _api.del('/api/grupos/'+id); },
  },
  // Cadastro de apostadores do grupo — independente de bolão (ver bolaoDoGrupo acima: um bolão é
  // uma oferta pontual, o grupo é a lista permanente de quem pode aceitar comprar cota).
  grupoMembros: {
    // Só participantes ativos (quem saiu do grupo vira ativo=false, ver group-participants.update
    // no backend) — não aparece em contagens/listas, mas o registro fica no banco como histórico.
    list:    grupoId => (S.cache.grupoMembros||[]).filter(m=>m.grupo_id===grupoId && m.ativo!==false),
    listAll: ()       => (S.cache.grupoMembros||[]).filter(m=>m.ativo!==false),
    save:    m        => { const l=S.cache.grupoMembros; const i=l.findIndex(x=>x.id===m.id); i>=0?l[i]=m:l.push(m); _api.post('/api/grupo_membros',m); },
    del:     id        => { S.cache.grupoMembros=S.cache.grupoMembros.filter(m=>m.id!==id); _api.del('/api/grupo_membros/'+id); },
  },
  vendas: {
    list: ()  => S.cache.vendas || [],
    save: v   => { S.cache.vendas.push(v); _api.post('/api/vendas',v); },
  },
  pags: {
    list: ()  => S.cache.pags || [],
    save: p   => { const l=S.cache.pags; const i=l.findIndex(x=>x.id===p.id); i>=0?l[i]=p:l.push(p); _api.post('/api/pagamentos',p); },
    // Aprovar/rejeitar — vai por rota própria protegida por token (a de criação é pública, só cria 'pendente')
    setStatus: (id, status) => {
      const p = S.cache.pags.find(x=>x.id===id); if (p) p.status = status;
      _api.put(`/api/pagamentos/${id}/status`, { status });
    },
  },
  usuarios: {
    list: ()  => S.cache.usuarios || [],
    find: nm  => (S.cache.usuarios||[]).find(u=>u.nome.toLowerCase()===nm.toLowerCase()),
    save: u   => { const l=S.cache.usuarios; const i=l.findIndex(x=>x.id===u.id); i>=0?l[i]=u:l.push(u); _api.post('/api/usuarios',u); },
    del:  id  => { S.cache.usuarios=S.cache.usuarios.filter(u=>u.id!==id); _api.del('/api/usuarios/'+id); },
  },
  premiacoes: {
    list: ()  => S.cache.premiacoes || [],
    minhas: () => (S.cache.premiacoes||[]).filter(p => p.fone === S.user?.fone),
    save: p   => { S.cache.premiacoes.unshift(p); _api.post('/api/premiacoes',p); },
    // Confirmar é rota própria pública (o apostador não tem token) — a de criação é protegida (admin).
    confirmar: id => {
      const p = S.cache.premiacoes.find(x=>x.id===id); if (p) { p.confirmada=true; p.confirmada_em=new Date().toISOString(); }
      _api.put(`/api/premiacoes/${id}/confirmar`);
    },
    del:  id  => { S.cache.premiacoes=S.cache.premiacoes.filter(p=>p.id!==id); _api.del('/api/premiacoes/'+id); },
  },
  boloesParcelados: {
    list: ()  => S.cache.boloesParcelados || [],
    get:  id  => (S.cache.boloesParcelados||[]).find(b=>b.id===id),
    // Participação do cliente logado: participante (com o bolão embutido) em qualquer bolão parcelado ativo.
    minhaParticipacao: () => {
      for (const b of (S.cache.boloesParcelados||[])) {
        const p = (b.participantes||[]).find(x => x.fone === S.user?.fone && x.ativo !== false);
        if (p) return { bolao: b, participante: p };
      }
      return null;
    },
    save: b   => { S.cache.boloesParcelados.unshift({ ...b, participantes:[] }); _api.post('/api/boloes-parcelados', b); },
    del:  id  => { S.cache.boloesParcelados=S.cache.boloesParcelados.filter(b=>b.id!==id); _api.del('/api/boloes-parcelados/'+id); },
    salvarParticipante: p => {
      const b = S.cache.boloesParcelados.find(x=>x.id===p.bolao_parcelado_id);
      if (b) (b.participantes = b.participantes||[]).push({ ...p, pagamentos: [] });
      _api.post('/api/bolao-parcelado-participantes', p);
    },
    delParticipante: (bolaoId, id) => {
      const b = S.cache.boloesParcelados.find(x=>x.id===bolaoId);
      if (b) b.participantes = (b.participantes||[]).filter(p=>p.id!==id);
      _api.del('/api/bolao-parcelado-participantes/'+id);
    },
    declararQuitacao: (participanteId, mes) => {
      for (const b of (S.cache.boloesParcelados||[])) {
        const p = (b.participantes||[]).find(x=>x.id===participanteId);
        if (p) { p.mes_quitacao_previsto = mes; break; }
      }
      _api.put(`/api/bolao-parcelado-participantes/${participanteId}/quitacao`, { mes_quitacao_previsto: mes });
    },
    enviarComprovante: pg => {
      for (const b of (S.cache.boloesParcelados||[])) {
        const p = (b.participantes||[]).find(x=>x.id===pg.participante_id);
        if (p) {
          p.pagamentos = p.pagamentos || [];
          const i = p.pagamentos.findIndex(x=>x.mes===pg.mes);
          if (i>=0) p.pagamentos[i] = pg; else p.pagamentos.push(pg);
          break;
        }
      }
      _api.post('/api/bolao-parcelado-pagamentos', pg);
    },
    // Admin marca vários meses como pagos de uma vez (histórico anterior ao bolão entrar no app).
    marcarPagoLote: (participanteId, meses, valor) => {
      for (const b of (S.cache.boloesParcelados||[])) {
        const p = (b.participantes||[]).find(x=>x.id===participanteId);
        if (!p) continue;
        p.pagamentos = p.pagamentos || [];
        const agora = new Date().toISOString();
        meses.forEach(mes => {
          const i = p.pagamentos.findIndex(x=>x.mes===mes);
          const pg = { id: i>=0?p.pagamentos[i].id:uid(), participante_id:participanteId, mes, valor, status:'confirmado', enviado_em:agora, confirmado_em:agora };
          if (i>=0) p.pagamentos[i] = pg; else p.pagamentos.push(pg);
        });
        if (p.mes_quitacao_previsto && meses.includes(p.mes_quitacao_previsto)) { p.quitado = true; p.quitado_em = agora; }
        break;
      }
      _api.post('/api/bolao-parcelado-pagamentos/lote', { participante_id:participanteId, meses, valor });
    },
    // Confirmar/rejeitar é rota própria protegida (admin) — atualiza local e chama a rota de
    // status. Ao "ignorar" (rejeitado) com motivo, o backend avisa o apostador no WhatsApp sozinho.
    confirmarPagamento: (pagamentoId, status, motivo) => {
      for (const b of (S.cache.boloesParcelados||[])) {
        for (const p of (b.participantes||[])) {
          const pg = (p.pagamentos||[]).find(x=>x.id===pagamentoId);
          if (pg) {
            pg.status = status;
            pg.confirmado_em = status==='confirmado' ? new Date().toISOString() : null;
            pg.motivo_rejeicao = status==='rejeitado' ? (motivo||'') : null;
            if (p.mes_quitacao_previsto === pg.mes) {
              if (status==='confirmado') { p.quitado = true; p.quitado_em = new Date().toISOString(); }
              else if (p.quitado) { p.quitado = false; p.quitado_em = null; }
            }
          }
        }
      }
      _api.put(`/api/bolao-parcelado-pagamentos/${pagamentoId}/status`, { status, motivo });
    },
  },
  ctrl: {
    get: ()  => S.cache.ctrl || { bloqueado:false, msg:'', cliente:'Demo', licenca:'DEMO-2024', validade:'2025-12-31', logs:[] },
    set: c   => { S.cache.ctrl=c; _api.put('/api/config',c); },
    log: m   => { const c=DB.ctrl.get(); c.logs=[{m,t:Date.now()},...(c.logs||[])].slice(0,50); S.cache.ctrl=c; _api.post('/api/config/log',{m}); },
  },
};

// =============================================
// AUTH
// =============================================
const AUTH = {
  // Mapa {nomeNormalizado: fone} de apostadores que já entraram neste aparelho — permite pular o
  // campo telefone da segunda vez em diante, sem precisar de senha/token pra cliente.
  _apostadoresConhecidos() { try { return JSON.parse(localStorage.getItem('ltr_apostadores')||'{}'); } catch { return {}; } },
  _lembrarApostador(nome, fone) {
    const m = AUTH._apostadoresConhecidos();
    m[AUTH._normNome(nome)] = fone;
    localStorage.setItem('ltr_apostadores', JSON.stringify(m));
  },
  _normNome(nome) { return (nome||'').trim().toLowerCase().replace(/\s+/g,' '); },
  _nomeCompleto(nome) { return (nome||'').trim().split(/\s+/).filter(Boolean).length >= 2; },

  // Chamado a cada tecla no campo nome — mostra senha para admin/dev, telefone para cliente
  // (só na primeira vez neste aparelho; da segunda em diante o nome sozinho já basta).
  onNomeInput(v) {
    const nome = v.trim();
    const low = nome.toLowerCase();
    const isPriv = (low === 'admin' || low === 'dev');
    $('field-senha').hidden = !isPriv;
    const sub = $('login-sub');
    if (isPriv) {
      $('field-telefone').hidden = true;
      if (sub) sub.textContent = 'Digite a senha de administrador';
    } else if (!nome) {
      $('field-telefone').hidden = true;
      if (sub) sub.textContent = 'Digite seu nome para entrar';
    } else if (!AUTH._nomeCompleto(nome)) {
      $('field-telefone').hidden = true;
      if (sub) sub.textContent = 'Nome completo, por favor';
    } else {
      const conhecido = AUTH._apostadoresConhecidos()[AUTH._normNome(nome)];
      $('field-telefone').hidden = !!conhecido;
      if (sub) sub.textContent = conhecido ? 'Bem-vindo de volta! 👋' : 'Informe seu telefone (DDD) para continuar';
    }
    AUTH._atualizarBotaoEntrar();
  },

  onTelefoneInput() { AUTH._atualizarBotaoEntrar(); },

  _atualizarBotaoEntrar() {
    const btn = $('btn-entrar'); if (!btn) return;
    const nome = ($('inp-nome')?.value || '').trim();
    const low = nome.toLowerCase();
    if (low === 'admin' || low === 'dev') { btn.disabled = false; return; }
    if (!AUTH._nomeCompleto(nome)) { btn.disabled = true; return; }
    if (AUTH._apostadoresConhecidos()[AUTH._normNome(nome)]) { btn.disabled = false; return; }
    const digitos = ($('inp-telefone')?.value || '').replace(/\D/g, '');
    btn.disabled = digitos.length < 10;
  },

  // Chama o endpoint de login, guarda o token se der certo, e devolve o JSON mesmo em erro (401/429)
  async _checarSenha(login, senha) {
    const resp = await _api.post('/api/auth/login', { login, senha });
    if (!resp) return { ok:false, error:'Falha de conexão com o servidor.' };
    const data = await resp.json().catch(() => ({ ok:false, error:'Falha de conexão com o servidor.' }));
    if (data?.ok && data.token) _token.set(data.token);
    return data;
  },

  async entrar() {
    const nome = $('inp-nome').value.trim();
    const senha = $('inp-p').value;
    const low   = nome.toLowerCase();
    const err   = $('login-err');

    if (!nome) { err.hidden=false; err.textContent='Digite seu nome.'; return; }

    // Dev / Admin — senha validada no servidor
    if (low === 'dev' || low === 'admin') {
      err.hidden=false; err.style.color='#aaa'; err.textContent='⏳ Verificando...';
      const data = await AUTH._checarSenha(low, senha);
      err.style.color='';
      if (!data?.ok) { err.hidden=false; err.textContent = data?.error || 'Senha incorreta.'; return; }
      S.user = { login:low, role:data.role, nome:data.nome };
      AUTH._start(); return;
    }
    // Cliente — nome completo obrigatório; telefone só na primeira vez neste aparelho
    if (!AUTH._nomeCompleto(nome)) {
      err.hidden=false;
      err.textContent='Digite seu nome completo (nome e sobrenome).';
      $('inp-nome')?.focus();
      return;
    }
    let fone = AUTH._apostadoresConhecidos()[AUTH._normNome(nome)];
    if (!fone) {
      const digitado = ($('inp-telefone')?.value || '').trim();
      if (digitado.replace(/\D/g,'').length < 10) {
        err.hidden=false;
        err.textContent='Informe seu telefone com DDD para continuar.';
        $('inp-telefone')?.focus();
        return;
      }
      fone = normalizarFone(digitado);
    }
    AUTH._lembrarApostador(nome, fone);
    _api.post('/api/usuarios/registrar', { id:'ap_'+fone, nome, criado:hoje(), fone });
    S.user = { role:'cliente', nome, fone };
    AUTH._start();
  },

  async _start() {
    // Mostrar loading enquanto carrega dados do servidor
    const err = $('login-err');
    if (err) { err.hidden=false; err.style.color='#aaa'; err.textContent='⏳ Conectando ao servidor...'; }
    await carregarDados();
    _filaReprocessar(); // reenvia o que ficou pendente de uma sessão anterior offline
    if (err) { err.hidden=true; err.style.color=''; }

    // Modo manutenção: SÓ o dev continua entrando para ajustar o app — apostador E admin veem a
    // tela de manutenção até o dev colocar o app de volta no ar.
    if (S.user.role !== 'dev') {
      const c = DB.ctrl.get();
      if (c.bloqueado) {
        $('bl-msg').textContent = c.msg || 'Sistema temporariamente indisponível. Entre em contato com o suporte.';
        $('bloqueio').hidden = false;
        $('tela-login').hidden = true;
        return;
      }
    }
    sessionStorage.setItem('ltr_s', JSON.stringify(S.user));
    $('tela-login').hidden = true;
    $('bloqueio').hidden = true;
    $('shell').hidden = false;

    AUTH._aplicarPerfilUI();

    DB.ctrl.log('Login: ' + (S.user.nome||S.user.login));
    ZE.start();
    R.ir('home');
    R._verificarPremios();
    R._verificarPremiacaoCliente();
    RELAY.verificarPendentes();
    AUTH._iniciarPollingResultados();
  },

  // Enquanto o admin/dev estiver com o app aberto (aba visível), busca por resultados novos
  // a cada 60s — o aviso instantâneo "de verdade" já foi mandado no WhatsApp pessoal do lotérico
  // pelo backend; isso aqui só faz o popup aparecer sem precisar deslogar/logar de novo.
  _pollResultados: null,
  _iniciarPollingResultados() {
    if (AUTH._pollResultados) clearInterval(AUTH._pollResultados);
    if (!AUTH.isAdmin()) return;
    AUTH._pollResultados = setInterval(async () => {
      if (document.visibilityState !== 'visible' || !S.user) return;
      await carregarDados();
      R._verificarPremios();
      RELAY.verificarPendentes();
    }, 60000);
  },

  sair() {
    if (AUTH._pollResultados) { clearInterval(AUTH._pollResultados); AUTH._pollResultados = null; }
    sessionStorage.removeItem('ltr_s');
    _token.clear();
    S.user = null;
    S.devBackup = null;
    const sb = $('sim-badge'); if (sb) sb.hidden = true;
    S.stack = [];
    $('shell').hidden = true;
    $('nav-user').hidden = true;
    $('nav-admin').hidden = true;
    $('h-premio').hidden = true;
    $('tela-login').hidden = false;
    $('inp-nome').value = '';
    $('inp-p').value = '';
    if ($('inp-telefone')) $('inp-telefone').value = '';
    $('field-senha').hidden = true;
    $('field-telefone').hidden = true;
    if ($('btn-entrar')) $('btn-entrar').disabled = true;
    const sub = $('login-sub');
    if (sub) sub.textContent = 'Digite seu nome para entrar';
    Object.values(S.charts).forEach(c=>c?.destroy?.());
    S.charts = {};
    S._hLt = null;
    S._hRes = {};
    S._iaStats = {};
  },

  isAdmin: () => ['admin','dev'].includes(S.user?.role),

  // Mostra/esconde os botões exclusivos do dev na nav do admin (Cotas, Palpiteiro).
  _ajustarNavDev() {
    const ehDev = S.user?.role === 'dev';
    document.querySelectorAll('#nav-admin .nb-so-dev').forEach(b => b.hidden = !ehDev);
  },

  // Aplica badge, navs e ícones do header conforme o role atual de S.user.
  // Usado no login e também quando o dev troca de perfil pra testar (DEV.testarComo).
  _aplicarPerfilUI() {
    const r = S.user.role;
    const badge = $('h-badge');
    badge.className = `badge b-${r}`;
    badge.textContent = r==='dev'?'DEV':r==='admin'?'Admin':'Apostador';
    // O dev usa a nav do admin com os botões extras do apostador (Cotas, Palpiteiro),
    // pra poder operar/ajustar o app inteiro de qualquer perfil.
    const isAdmin = AUTH.isAdmin();
    $('nav-user').hidden  = isAdmin;
    $('nav-admin').hidden = !isAdmin;
    AUTH._ajustarNavDev();
    $('h-premio').hidden  = (r === 'admin'); // dev e apostador veem o 🏆
  },
};

// =============================================
// API CAIXA
// =============================================
const API = {
  _BASE: 'https://servicebus2.caixa.gov.br/portaldeloterias/api/',
  // Resultado pro uso geral (home, resultados, IA, histórico) — busca pelo NOSSO backend, que já
  // tem uma cadeia de 3 fontes confiável (guidi → loteriascaixa-api → Caixa direto). Os proxies
  // allorigins/corsproxy direto do navegador ficaram instáveis (allorigins caiu, corsproxy ficou
  // sujeito a rate-limit) e causavam fallback pro MOCK de 2024 em parte das loterias.
  async _buscarBruto(lt, conc='') {
    try {
      const r = await fetch(`${API_URL}/api/caixa/${lt}/${conc}`);
      if (!r.ok) return null;
      const data = await r.json();
      return (data && data.numero) ? data : null;
    } catch { return null; }
  },
  // Só pro RELAY (quando as 3 fontes do PRÓPRIO backend já falharam) — precisa buscar direto do
  // navegador via proxy, senão delegaria de volta pro mesmo backend que já não conseguiu.
  async _buscarBrutoViaProxy(lt, conc='') {
    const caixaUrl = API._BASE + lt + '/' + conc;
    const proxies = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(caixaUrl)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(caixaUrl)}`,
    ];
    for (const p of proxies) {
      try {
        const r = await Promise.race([
          fetch(p).then(r=>r.json()),
          new Promise((_,rej)=>setTimeout(()=>rej('to'),5000)),
        ]);
        const data = r.contents ? JSON.parse(r.contents) : r;
        if (data && data.numero) return data;
      } catch {}
    }
    return null;
  },
  async fetch(lt, conc='') {
    const data = await API._buscarBruto(lt, conc);
    return data ? API.parse(data) : null;
  },
  parse(r) {
    if (!r) return null;
    if (!r.listaDezenas) return null;
    return { numero:r.numero, data:r.dataApuracao, dezenas:r.listaDezenas,
      trevos:r.listaTrevos||[],
      acumulado:r.acumulado, ganhadores:r.listaRateioPremio?.[0]?.numeroDeGanhadores??0,
      premio:r.listaRateioPremio?.[0]?.valorPremio??0, prox:r.valorEstimadoProximoConcurso??0,
      dataProxConcurso:r.dataProximoConcurso||null, numProxConcurso:r.numeroConcursoProximo||null };
  },
  // Formato completo (todas as faixas de prêmio) usado pra retransmitir a conferência de um bolão pro backend.
  // Usa _buscarBrutoViaProxy (não _buscarBruto) — esse fluxo só roda quando o backend já tentou e falhou.
  async fetchParaConferencia(lt, conc) {
    const d = await API._buscarBrutoViaProxy(lt, conc);
    if (!d || !d.listaDezenas?.length) return null;
    return {
      concurso: d.numero,
      data: d.dataApuracao || null,
      dezenas: d.listaDezenas,
      premiacoes: (d.listaRateioPremio||[]).map(f => {
        const m = String(f.descricaoFaixa||'').match(/\d+/);
        return { acertos: m?parseInt(m[0],10):null, ganhadores: f.numeroDeGanhadores||0, premio: f.valorPremio||0 };
      }),
      acumulou: !!d.acumulado,
    };
  },
  async ultimos3(lt) {
    const u = await API.fetch(lt);
    if (u) {
      const [a,b] = await Promise.all([API.fetch(lt,u.numero-1),API.fetch(lt,u.numero-2)]);
      return { fonte:'api', dados:[u,a,b].filter(Boolean) };
    }
    return { fonte:'mock', dados:MOCK[lt]||[] };
  },
  async hist20(lt) {
    const u = await API.fetch(lt);
    if (!u) return MOCK[lt]||[];
    const ps = Array.from({length:19},(_,i)=>API.fetch(lt,u.numero-1-i));
    const rest = await Promise.all(ps);
    return [u,...rest].filter(Boolean);
  },
};

// =============================================
// RELAY DE CONFERÊNCIA — fallback final quando as 3 fontes do servidor falham
// =============================================
// Bolões marcados "aguardando_resultado" pelo cron (nenhuma fonte respondeu no servidor)
// são retentados aqui: o navegador do admin não tem o bloqueio de IP/país que o servidor
// tem, então busca o resultado com os mesmos proxies de sempre e retransmite pro backend conferir.
const RELAY = {
  async verificarPendentes() {
    if (!AUTH.isAdmin()) return;
    const pendentes = (S.cache.boloes||[]).filter(b => b.status === 'aguardando_resultado');
    if (!pendentes.length) return;
    let algumConferido = false;
    for (const b of pendentes) {
      try {
        const resultado = await API.fetchParaConferencia(b.loteria, b.concurso);
        if (!resultado || resultado.concurso !== b.concurso || !resultado.premiacoes.length) continue;
        const resp = await _api.post('/api/resultados/relay', { loteria: b.loteria, concurso: b.concurso, resultado });
        const d = resp ? await resp.json().catch(()=>null) : null;
        if (d?.ok && d.conferidos) algumConferido = true;
      } catch {}
    }
    if (algumConferido) {
      await carregarDados();
      R._verificarPremios();
    }
  },
};

// =============================================
// IA — ANÁLISE ESTATÍSTICA
// =============================================
const IA = {
  analisar(res) {
    const f={};
    res.forEach(r=>(r.dezenas||[]).forEach(d=>{ const n=parseInt(d); f[n]=(f[n]||0)+1; }));
    const s=Object.entries(f).map(([n,c])=>({n:parseInt(n),c})).sort((a,b)=>b.c-a.c);
    const top=Math.max(5,Math.ceil(s.length*.3));
    return { quentes:s.slice(0,top), frios:s.slice(-top).reverse(), total:res.length };
  },
};

// =============================================
// PALPITEIRO MASCOTE
// =============================================
const ZE = {
  _nt: null,

  start() {
    ZE.show(FRASES_ZE[0]);
    clearInterval(S.ze_t);
    S.ze_t = setInterval(()=>ZE.proximo(), 11000);
    ZE._iniciarNumeros();
  },

  _iniciarNumeros() {
    clearInterval(ZE._nt);
    ZE._trocarNum();
    // troca a cada half-cycle da animação (0.9s)
    ZE._nt = setInterval(ZE._trocarNum, 900);
  },

  _trocarNum() {
    const el = $('ze-num'); if(!el) return;
    const n = Math.floor(Math.random()*60)+1;
    el.style.opacity='0';
    setTimeout(()=>{ el.textContent=String(n).padStart(2,'0'); el.style.opacity='1'; },80);
  },

  proximo() {
    S.ze_i = (S.ze_i+1)%FRASES_ZE.length;
    ZE.show(FRASES_ZE[S.ze_i]);
  },

  show(txt) {
    const el=$('ze-txt'); if(!el) return; // bolha de fala sem lugar fixo desde que a bolinha mudou pro card Bolões Ativos
    el.textContent=txt; el.className='ze-fala on';
    clearTimeout(ZE._t);
    ZE._t=setTimeout(()=>el.classList.remove('on'),4000);
  },
};

// =============================================
// MODAL
// =============================================
const MODAL = {
  open(html) { $('m-body').innerHTML=html; $('modal').hidden=false; },
  close()    { $('modal').hidden=true; $('m-body').innerHTML=''; },
};

// =============================================
// ROUTER / RENDER
// =============================================
const R = {
  ir(tela, params={}, opts={}) {
    if(!opts.semPush && S.tela && S.tela!==tela) S.stack.push(S.tela);
    S.tela=tela;
    // Para o polling das cotas ao vivo ao sair da tela (o handler reinicia ao entrar)
    if(typeof COTAS!=='undefined' && tela!=='cotas' && tela!=='lotes') COTAS.parar();
    document.querySelectorAll('.view').forEach(v=>v.hidden=true);
    $(`view-${tela}`).hidden=false;
    // Atualiza botão ativo no nav correto
    const nav = AUTH.isAdmin() ? $('nav-admin') : $('nav-user');
    nav?.querySelectorAll('.nb').forEach(b=>b.classList.toggle('on',b.dataset.v===tela));
    // Seta de voltar aparece em qualquer tela que não seja a Início — inclusive nas alcançadas
    // pelos ícones das barras (ex: Cotas, Grupos), pra sempre dar um jeito de voltar sem precisar
    // tocar em ícone nenhum.
    $('btn-back').hidden = (tela === 'home');
    const fn=R['_'+tela];
    if(fn) fn(params);
  },
  voltar() { const t=S.stack.pop()||'home'; R.ir(t, {}, {semPush:true}); },

  // ---- HOME ----
  _home() {
    $('h-title').innerHTML='<img src="img/logo.png" alt="Lotérica Taguacenter" class="h-logo-img">';
    // Dev vê a Home COMPLETA do apostador (Bolões Ativos, resultados, planilha do Bolão Anual,
    // Palpiteiro) com os atalhos de gestão do admin embutidos — pra ajustar qualquer coisa
    // enxergando o app inteiro. Admin mantém a Home de gestão enxuta.
    if (S.user.role === 'admin') {
      R._homeAdmin();
    } else {
      R._homeUser();
    }
  },

  async _homeAdmin() {
    $('view-home').innerHTML=`
      <div style="margin-bottom:14px">
        <div style="font-size:1.15rem;font-weight:700">Olá, ${S.user.nome.split(' ')[0]}! 👋</div>
        <div class="muted tsm">Resultados ao vivo — gerencie os grupos na aba Grupos</div>
      </div>
      <div class="grid-lt">
        ${Object.values(LOTERIAS).map(lt=>{
          return`<div class="lt-card" style="background:linear-gradient(135deg,${lt.cor},${lt.cor2})${lt.corTexto?`;--lt-txt:${lt.corTexto};--lt-shadow:none`:''}" onclick="R._ltClick('${lt.id}')">
            <div id="ld-${lt.id}" class="lt-dados-live"><div class="lt-loading-dot"></div></div>
            <div class="lt-nome">${lt.nome}</div>
          </div>`;
        }).join('')}
      </div>
      ${R._anualHomeCard()}`;

    await Promise.allSettled(Object.values(LOTERIAS).map(async lt=>{
      const {dados}=await API.ultimos3(lt.id);
      const r=dados[0]; const el=$(`ld-${lt.id}`); if(!el) return;
      if(!r){el.innerHTML='';return;}
      const p=r.prox||r.premio||0;
      el.innerHTML=`${r.acumulado?'<span class="lt-acum">ACUMULADO</span>':''}
        ${p?`<div class="lt-premio">${fmtPremio(p)}</div>`:''}
        ${r.numProxConcurso?`<div class="lt-data-card">Conc. #${r.numProxConcurso}</div>`:''}
        ${r.dataProxConcurso?`<div class="lt-data-card">📅 ${r.dataProxConcurso}</div>`:''}`;
    }));
  },

  async _homeUser() {
    const nome = S.user.nome.split(' ')[0];
    const h = new Date().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    S._hLt = S._hLt || 'megasena';
    S._hRes = {};

    $('view-home').innerHTML = `
      <div class="ug-box">
        <div class="ug-nome">${saud}, <strong>${nome}</strong>! 👋</div>
      </div>

      <div id="boloes-ativos-card" class="boloes-ativos-card" onclick="R.ir('cotas')">
        <div class="bac-emoji">🧾</div>
        <div class="bac-info">
          <div class="bac-titulo">Comprar cotas de bolões ativos</div>
          <div class="bac-sub" id="bac-sub">Carregando…</div>
        </div>
        <span class="bac-seta">›</span>
      </div>
      <div id="minha-participacao"></div>

      <div class="sectt mb8">Loterias — ao vivo</div>
      <div class="grid-lt mb4">
        ${Object.values(LOTERIAS).map(lt=>`
          <div class="lt-card ${lt.id===S._hLt?'lt-sel':''}" id="ltc-${lt.id}"
               style="background:linear-gradient(135deg,${lt.cor},${lt.cor2})${lt.corTexto?`;--lt-txt:${lt.corTexto};--lt-shadow:none`:''}"
               onclick="R._hSel('${lt.id}')">
            <div id="ld-${lt.id}" class="lt-dados-live"><div class="lt-loading-dot"></div></div>
            <div class="lt-nome">${lt.nome}</div>
          </div>`).join('')}
      </div>

      <div id="home-anual-slot"></div>

      <div id="home-res"><div class="loading"><div class="spinner"></div> Carregando...</div></div>

      <div class="ia-aviso mt12" style="font-size:.7rem;margin-bottom:0">
        ⚠️ As análises são baseadas em histórico estatístico — não garantem resultados.
        Sorteios federais são aleatórios e auditados pela Caixa Econômica Federal.
        Jogue com responsabilidade e dentro do seu orçamento.
      </div>`;

    // Busca todas as loterias em paralelo
    await Promise.allSettled(Object.values(LOTERIAS).map(async lt => {
      const res = await API.ultimos3(lt.id);
      S._hRes[lt.id] = res;
      const r = res.dados[0];
      const el = $(`ld-${lt.id}`); if (!el) return;
      if (!r) { el.innerHTML = ''; return; }
      const p = r.prox || r.premio || 0;
      el.innerHTML = `
        ${r.acumulado ? '<span class="lt-acum">ACUM.</span>' : ''}
        ${p ? `<div class="lt-premio">${fmtPremio(p)}</div>` : ''}
        ${r.numProxConcurso ? `<div class="lt-data-card">Conc. #${r.numProxConcurso}</div>` : ''}
        ${r.dataProxConcurso ? `<div class="lt-data-card">📅 ${r.dataProxConcurso}</div>` : ''}`;
    }));

    R._hRender(S._hLt);
    R._renderBoloesAtivos();
    R._renderHomeAnual();
  },

  // Card faixa "Bolão Anual" — vai de um lado a outro do app (mesma estrutura do card Bolões
  // Ativos), exibido entre os números dos últimos concursos e o Palpiteiro. Aparece pra TODOS os
  // perfis: apostador acompanha os pagamentos do grupo e sobe comprovante (transparência);
  // admin/dev toca e cai direto na gestão (cadastrar bolão, incluir/remover participante,
  // configurar pagamentos, cadastrar grupos de WhatsApp).
  _anualHomeCard() {
    const bs = DB.boloesParcelados.list();
    let sub;
    if (AUTH.isAdmin()) {
      const parts = bs.reduce((s,b)=>s+(b.participantes||[]).length,0);
      sub = bs.length
        ? `${bs.length} bolão${bs.length>1?'ões':''} · ${parts} participante${parts!==1?'s':''} — toque para gerenciar`
        : 'Planilha vazia — toque para cadastrar bolões e grupos de WhatsApp';
    } else {
      const info = DB.boloesParcelados.minhaParticipacao();
      if (info) {
        const pagos = (info.participante.pagamentos||[]).filter(pg=>pg.status==='confirmado').length;
        sub = `${info.bolao.nome}: ${pagos}/${info.bolao.duracao_meses} meses pagos — toque para enviar comprovante`;
      } else {
        sub = 'Planilha aguardando dados dos grupos de WhatsApp';
      }
    }
    return `
      <div class="anual-home-card" onclick="R._anualCardClick()">
        <div class="bac-emoji">📅</div>
        <div class="bac-info">
          <div class="bac-titulo">Bolão Anual</div>
          <div class="bac-sub">${sub}</div>
        </div>
        <span class="bac-seta">›</span>
      </div>`;
  },
  _anualCardClick() {
    if (AUTH.isAdmin()) { R.ir('anual'); return; }
    // Apostador participante: abre direto as ações dele (enviar comprovante / declarar quitação).
    // Antes só rolava até a planilha — como o card fica logo abaixo dela, parecia que o toque
    // "não fazia nada" (a tela só se mexia um pouco).
    const info = DB.boloesParcelados.minhaParticipacao();
    if (info) { R._mMeuAnualAcao(); return; }
    // Não participante: leva até a planilha de acompanhamento na própria Home
    $('home-anual-slot')?.scrollIntoView({ behavior:'smooth', block:'start' });
  },

  // Planilha do Bolão Anual embutida na própria Home (entre a grade de loterias e os últimos
  // concursos, antes do Palpiteiro) — todos os participantes veem a mesma planilha (transparência
  // do grupo). Sempre visível: se o cliente ainda não participa de nenhum bolão parcelado, a
  // planilha aparece vazia, aguardando os dados virem dos grupos de WhatsApp. Tocar no próprio
  // nome abre as ações (anexar comprovante / declarar quitação).
  _renderHomeAnual() {
    const slot = $('home-anual-slot'); if (!slot) return;
    // Admin/dev na Home completa: não participa por telefone, então mostra a planilha de TODOS os
    // bolões parcelados com todos os participantes (mesma visão de transparência do apostador),
    // com atalho pra gestão — em vez de cair na tabela vazia por não ter participação própria.
    if (AUTH.isAdmin()) {
      const bs = DB.boloesParcelados.list();
      if (!bs.length) { slot.innerHTML = R._anualTabelaVazia(); return; }
      slot.innerHTML = bs.map(b => R._anualTabelaBolao(b, { gerenciar:true })).join('');
      return;
    }
    const info = DB.boloesParcelados.minhaParticipacao();
    if (info) {
      slot.innerHTML = R._anualTabelaBolao(info.bolao, { euId: info.participante.id });
      return;
    }
    // Apostador que (ainda) não participa: mesmo assim vê a planilha dos bolões do grupo
    // (transparência — só nomes, sem telefone), sem linha própria nem ações. Vazia só se
    // não existir nenhum bolão cadastrado.
    const bs = DB.boloesParcelados.list();
    if (!bs.length) { slot.innerHTML = R._anualTabelaVazia(); return; }
    slot.innerHTML = bs.map(b => R._anualTabelaBolao(b)).join('');
  },
  // Planilha de um bolão parcelado (usada na Home dos 3 perfis):
  // - gerenciar:true → botão "Gerenciar ›" no título (admin/dev)
  // - euId → destaca a linha do próprio apostador com as ações de comprovante/quitação
  _anualTabelaBolao(b, { gerenciar=false, euId=null } = {}) {
    const parts = b.participantes||[];
    const meses = Array.from({length:b.duracao_meses}, (_,i)=>i+1);
    return `
      <div class="sectt mb8 mt16 fxb">
        <span>📅 ${b.nome} — acompanhamento</span>
        ${gerenciar?`<button class="btn btn-o btn-sm" onclick="R._irAnualDet('${b.id}')">Gerenciar ›</button>`:''}
      </div>
      <div class="anual-tbl-wrap mb16">
        <table class="anual-tbl">
          <thead><tr><th>Participante</th>${meses.map(m=>`<th>${MESES_NOMES[m-1].slice(0,3)}</th>`).join('')}</tr></thead>
          <tbody>
            ${parts.length ? parts.map(pp => `
              <tr class="${pp.id===euId?'anual-tbl-eu':''}">
                <td ${pp.id===euId?'style="cursor:pointer" onclick="R._mMeuAnualAcao()"':''}>${pp.nome}${pp.id===euId?' <span class="txs muted">(você — toque p/ anexar)</span>':''}</td>
                ${meses.map(m=>{ const c=R._anualCelula(b,pp,m); return `<td class="${c.cls}" title="${c.titulo}">${c.icon}</td>`; }).join('')}
              </tr>`).join('')
            : `<tr><td colspan="${meses.length+1}" class="tc muted" style="padding:18px 10px;white-space:normal">⏳ ${gerenciar?'Sem participantes ainda — toque em "Gerenciar" pra importar do grupo.':'Sem participantes ainda — aguardando dados dos grupos de WhatsApp.'}</td></tr>`}
          </tbody>
        </table>
      </div>`;
  },
  // Planilha vazia (estrutura de 12 meses) — mostrada enquanto não chegam os dados dos grupos de
  // WhatsApp, tanto na Home do apostador quanto na tela de gestão do admin/dev.
  _anualTabelaVazia(botoesAdmin) {
    return `
      <div class="sectt mb8 mt16">📅 Bolão Anual — acompanhamento</div>
      <div class="anual-tbl-wrap mb16">
        <table class="anual-tbl">
          <thead><tr><th>Participante</th>${MESES_NOMES.map(m=>`<th>${m.slice(0,3)}</th>`).join('')}</tr></thead>
          <tbody><tr><td colspan="13" class="tc muted" style="padding:18px 10px;white-space:normal">
            ⏳ Planilha vazia — aguardando dados dos grupos de WhatsApp.
            ${botoesAdmin ? `<div class="mt8">
              <button class="btn btn-p btn-sm" onclick="R._mNovoAnual()">📅 Cadastrar bolão</button>
              <button class="btn btn-o btn-sm" onclick="R.ir('whatsapp')">📱 Cadastrar grupos de WhatsApp</button>
            </div>` : ''}
          </td></tr></tbody>
        </table>
      </div>`;
  },
  // Modal com as ações do próprio apostador — meses em aberto (anexar comprovante) e quitação.
  _mMeuAnualAcao() {
    const info = DB.boloesParcelados.minhaParticipacao();
    if (!info) return;
    const { bolao:b, participante:p } = info;
    const meses = Array.from({length:b.duracao_meses}, (_,i)=>i+1);
    const pagos = (p.pagamentos||[]).filter(pg=>pg.status==='confirmado').length;

    // "Em aberto" = mês corrente (ainda não venceu, mas já pode pagar) OU mês já vencido — os dois
    // casos que o usuário pode quitar agora. Mês futuro não aparece aqui (ainda não chegou a vez).
    const agora = new Date();
    const mesAtual = (b.ano === agora.getFullYear() && agora.getMonth()+1 <= b.duracao_meses) ? agora.getMonth()+1 : null;
    const abertos = p.quitado ? [] : meses.filter(m => {
      const pg = (p.pagamentos||[]).find(x=>x.mes===m);
      if (pg?.status==='confirmado') return false;
      return R._anualMesPassou(b, m) || m === mesAtual;
    });

    MODAL.open(`
      <div class="m-title">📅 ${b.nome}</div>
      <div class="txs muted mb12">${fmt$(b.valor_mensal)}/mês × ${b.duracao_meses} = ${fmt$(b.valor_total)} · ${pagos}/${b.duracao_meses} meses pagos${p.quitado?' · 💰 Quitado':''}</div>
      ${abertos.length ? abertos.map(m => {
        const pg = (p.pagamentos||[]).find(x=>x.mes===m);
        const pendente = pg?.status==='pendente', rejeitado = pg?.status==='rejeitado';
        return `<div class="card mb8">
          <div class="fxb">
            <div style="font-weight:700">${MESES_NOMES[m-1]}${m===mesAtual?' <span class="txs muted">(mês corrente)</span>':''}</div>
            ${pendente?'<span class="badge b-pend">⏳ Aguardando confirmação</span>':''}
            ${rejeitado?'<span class="badge" style="background:var(--red);color:#fff">⚠️ Verifique seu WhatsApp</span>':''}
          </div>
          ${rejeitado && pg?.motivo_rejeicao ? `<div class="txs mt4" style="color:var(--red)">${pg.motivo_rejeicao}</div>` : ''}
          <button class="btn ${pendente||rejeitado?'btn-o':'btn-p'} btn-f mt8" onclick="MODAL.close();R._mCompAnualMes(${m})">📎 ${pendente||rejeitado?'Reenviar':'Anexar'} comprovante</button>
        </div>`;
      }).join('') : '<p class="txs muted">Nenhum mês em aberto no momento.</p>'}
      ${!p.quitado && !p.mes_quitacao_previsto
        ? `<button class="btn btn-o btn-f mt8" onclick="MODAL.close();R._mQuitacaoAnual()">💰 Declarar quitação</button>`
        : (!p.quitado ? `<div class="txs muted tc mt8">Quitação prevista para ${MESES_NOMES[p.mes_quitacao_previsto-1]}.</div>` : '')}
    `);
  },
  _mCompAnualMes(mes) {
    MODAL.open(`
      <div class="m-title">📎 Comprovante — ${MESES_NOMES[mes-1]}</div>
      <div class="fg"><label>Comprovante</label><input id="ca-file" type="file" accept="image/*" onchange="R._prevCompAnual(this)"></div>
      <img id="ca-th" style="display:none;width:100%;border-radius:8px;margin:8px 0">
      <button class="btn btn-p btn-f" onclick="R._envCompAnualMes(${mes})">Enviar</button>`);
  },
  _prevCompAnual(input) {
    const f=input.files?.[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=e=>{const img=$('ca-th');img.src=e.target.result;img.style.display='block';};
    rd.readAsDataURL(f);
  },
  _envCompAnualMes(mes) {
    const info = DB.boloesParcelados.minhaParticipacao();
    if (!info) return;
    const { bolao:b, participante:p } = info;
    DB.boloesParcelados.enviarComprovante({ id:uid(), participante_id:p.id, mes, valor:b.valor_mensal, comprovante:$('ca-th')?.src||null, status:'pendente', enviado_em:new Date().toISOString() });
    MODAL.close();
    R._renderHomeAnual();
    TOAST.show('📎 Comprovante enviado! Aguarde confirmação.', 'ok');
  },
  _mQuitacaoAnual() {
    const info = DB.boloesParcelados.minhaParticipacao();
    if (!info) return;
    const { bolao:b } = info;
    const meses = Array.from({length:b.duracao_meses}, (_,i)=>i+1);
    MODAL.open(`
      <div class="m-title">💰 Declarar quitação</div>
      <p class="txs muted mb8">Escolha em qual mês você pretende pagar o valor total (${fmt$(b.valor_total)}) de uma vez.</p>
      <div class="fg"><select id="ca-mes-quit">${meses.map(m=>`<option value="${m}">${MESES_NOMES[m-1]}</option>`).join('')}</select></div>
      <button class="btn btn-p btn-f" onclick="R._salvarQuitacaoAnual()">Confirmar</button>`);
  },
  _salvarQuitacaoAnual() {
    const info = DB.boloesParcelados.minhaParticipacao();
    if (!info) return;
    const mes = +$('ca-mes-quit').value;
    DB.boloesParcelados.declararQuitacao(info.participante.id, mes);
    MODAL.close();
    R._renderHomeAnual();
    TOAST.show('💰 Quitação declarada! Envie o comprovante desse mês quando for pagar.', 'ok');
  },

  async _renderBoloesAtivos() {
    const lotes = await COTAS._carregar();
    if (S.tela !== 'home') return; // usuário já navegou pra outra tela enquanto carregava
    const ativos = lotes.filter(l => COTAS._ativo(l));
    const sub = $('bac-sub');
    const bola = '<span class="bac-bola"><span class="ze-bola"><span class="ze-num" id="ze-num">13</span></span></span>';
    if (sub) sub.innerHTML = (ativos.length
      ? ativos.length + ' bolão' + (ativos.length>1?'ões':'') + ' com cotas abertas agora!'
      : 'Nenhum bolão ativo no momento — toque para conferir.') + bola;

    let minha = null, loteMinha = null;
    for (const l of ativos) { const c = COTAS._minhaCota(l); if (c) { minha = c; loteMinha = l; break; } }
    const part = $('minha-participacao'); if (!part) return;
    if (minha) {
      const statusTxt = { reservada:'⏳ aguardando pagamento', comprovante:'📎 aguardando confirmação', paga:'✅ pago', rejeitada:'⚠️ comprovante recusado — reenvie' }[minha.status] || '';
      part.className = 'minha-participacao';
      part.onclick = () => R.ir('cotas');
      part.innerHTML = '🧾 Você tem a cota #' + minha.numero + ' em <strong>' + COTAS._esc(loteMinha.nome) + '</strong> — ' + statusTxt;
    } else {
      part.className = 'sem-participacao';
      part.onclick = () => R.ir('cotas');
      part.innerHTML = 'Participe dos nossos bolões! 🍀 Toque em "Comprar cotas de bolões ativos" acima e escolha sua cota.';
    }
  },

  _hSel(ltId) {
    S._hLt = ltId;
    document.querySelectorAll('.lt-card').forEach(c => c.classList.remove('lt-sel'));
    $(`ltc-${ltId}`)?.classList.add('lt-sel');
    R._hRender(ltId);
  },

  _hRender(ltId) {
    const el = $('home-res'); if (!el) return;
    const res = S._hRes?.[ltId];
    if (!res) { el.innerHTML = '<div class="loading"><div class="spinner"></div></div>'; return; }
    const {dados, fonte} = res;
    const lt = LOTERIAS[ltId];
    const r = dados[0];
    if (!r) { el.innerHTML = '<div class="empty"><p>Sem dados disponíveis.</p></div>'; return; }

    const {quentes, frios, total} = IA.analisar(dados);
    const mockBadge = fonte==='mock' ? '<span class="badge b-pend txs" style="margin-left:6px">📦 dados locais</span>' : '';

    el.innerHTML = `
      <div class="divider"></div>
      <div class="sectt mb8">Último resultado — ${lt.emoji} ${lt.nome} ${mockBadge}</div>
      <div class="res-card" style="border-left:4px solid ${lt.cor}">
        <div class="res-top">
          <span>Concurso #${r.numero||r.concurso||'—'}</span>
          <span>${r.data||'—'}</span>
        </div>
        <div class="bolas">
          ${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}${trevosHTML(r)}
        </div>
        <div class="hres-info">
          ${r.acumulado
            ? `<span class="badge b-acum">🔁 Acumulado</span>`
            : `<span class="txs muted">${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}</span>`}
          ${r.premio ? `<span class="hres-val" style="color:${lt.cor}">${fmtPremio(r.premio)}</span>` : ''}
        </div>
        ${r.prox ? `
        <div class="hres-prox">
          <span class="txs muted">${r.numProxConcurso?`Concurso #${r.numProxConcurso} — `:''}Próximo estimado:</span>
          <span class="txs fw7" style="color:${lt.cor}">${fmtPremio(r.prox)}</span>
          ${r.dataProxConcurso ? `<span class="txs muted">· 📅 ${r.dataProxConcurso}</span>` : ''}
        </div>` : ''}
      </div>

      <div class="divider"></div>
      <div class="sectt mb8">📊 Números — últimos ${total} concursos</div>
      <div class="ia-sec">
        <h4>🔥 Mais frequentes</h4>
        <div class="bolas">
          ${quentes.slice(0,8).map(q=>`
            <div class="tc">
              <span class="bola bola-q">${String(q.n).padStart(2,'0')}</span>
              <div class="txs muted mt8">${q.c}x</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="ia-sec">
        <h4>🧊 Menos frequentes</h4>
        <div class="bolas">
          ${frios.slice(0,8).map(q=>`
            <div class="tc">
              <span class="bola bola-f">${String(q.n).padStart(2,'0')}</span>
              <div class="txs muted mt8">${q.c}x</div>
            </div>`).join('')}
        </div>
      </div>

      ${R._anualHomeCard()}

      ${AUTH.isAdmin() ? `
      <button class="btn btn-o btn-f mt4" onclick="R._ltClick('${ltId}')">
        🎲 Gerenciar bolões de ${lt.nome}
      </button>` : ''}

      <button class="btn btn-p btn-f mt4 mb4" onclick="R._iaClick('${ltId}')">
        <img src="img/ze-loteca.png" class="ze-btn-ico" alt="Palpiteiro"> Quer que o Palpiteiro te ajude a escolher os números?
      </button>`;
  },

  _ltClick(lt){S.loteria=lt; R.ir('boloes');},
  _iaClick(lt){S.loteria=lt; R.ir('ia');},
  _cotas(){ COTAS.entrarCliente(); },
  _lotes(){ COTAS.entrarAdmin(); },

  // ---- PALPITEIRO — ESTATÍSTICAS E GERADOR ----
  async _ia(params={}) {
    $('h-title').innerHTML='<img src="img/logo.png" alt="Lotérica Taguacenter" class="h-logo-img">';
    const ltId = S.loteria || 'megasena';
    const lt   = LOTERIAS[ltId];
    S._iaStats = S._iaStats || {};

    $('view-ia').innerHTML=`
      <div class="ze-card">
        <div class="ze-card-title">🎯 Palpiteiro te ajuda</div>
        <div class="ze-card-msg">"Consulte estatísticas, números quentes e frios, e deixa o Palpiteiro gerar seu jogo com inteligência — mas lembre: sorteio é sorteio, vai na fé! 🍀"</div>
      </div>
      <div class="fg mb12">
        <label>Escolha a loteria</label>
        <select id="ia-sel" onchange="R._iaTrocar(this.value)">
          ${Object.values(LOTERIAS).map(x=>`<option value="${x.id}" ${x.id===ltId?'selected':''}>${x.emoji} ${x.nome}</option>`).join('')}
        </select>
      </div>
      <div id="ia-res"><div class="loading"><div class="spinner"></div> Analisando...</div></div>`;

    await R._iaCarregar(lt);
  },

  _iaTrocar(ltId) {
    S.loteria = ltId;
    R._iaCarregar(LOTERIAS[ltId]);
  },

  async _iaCarregar(lt) {
    const el = $('ia-res'); if (!el) return;
    el.innerHTML=`<div class="loading"><div class="spinner"></div> Buscando dados de ${lt.nome}...</div>`;
    const {fonte,dados} = await API.ultimos3(lt.id);
    let hist = dados;
    if (hist.length < 8) {
      hist = await API.hist20(lt.id);
      if (!hist.length) hist = MOCK[lt.id]||dados;
    }
    const {quentes,frios,total} = IA.analisar(hist);

    // Salva para o gerador usar
    S._iaStats = S._iaStats || {};
    S._iaStats[lt.id] = { quentes, frios, lt };

    const badge = fonte==='mock'?'<span class="badge b-pend txs" style="margin-left:6px">📦 Dados locais</span>':'';
    const jogoInicial = R._iaGerar(lt.id, quentes, frios);

    el.innerHTML=`
      <!-- GERADOR DE JOGO -->
      <div class="jogo-card" style="border-color:${lt.cor}40">
        <div class="jogo-header">
          <div>
            <div class="jogo-titulo">🎲 Palpiteiro gera seu jogo</div>
            <div class="jogo-sub">Mistura inteligente de números 🔥 quentes + números 🧊 frios + aleatórios</div>
          </div>
          <span class="jogo-lt">${lt.emoji} ${lt.nome}</span>
        </div>
        <div class="bolas jogo-bolas" id="jogo-bolas">
          ${jogoInicial.map(n=>`<span class="bola" style="background:${lt.cor};box-shadow:0 2px 8px ${lt.cor}66">${n}</span>`).join('')}
        </div>
        <button class="btn btn-p btn-f jogo-btn" onclick="R._iaNovoJogo('${lt.id}')">
          🔄 Gerar novo jogo
        </button>
      </div>

      <div class="ia-aviso">⚠️ <strong>Aviso:</strong> Sorteios são aleatórios e auditados pela Caixa. Esta análise é estatística histórica (${total} concursos) — não garante resultados. Jogue com responsabilidade.</div>

      <div class="ia-sec">
        <h4>🔥 Números Quentes <span class="txs muted">(mais frequentes)</span>${badge}</h4>
        <div class="bolas">${quentes.map(q=>`<div class="tc"><span class="bola bola-q">${String(q.n).padStart(2,'0')}</span><div class="txs muted mt8">${q.c}x</div></div>`).join('')}</div>
      </div>
      <div class="ia-sec">
        <h4>🧊 Números Frios <span class="txs muted">(menos frequentes)</span></h4>
        <div class="bolas">${frios.map(q=>`<div class="tc"><span class="bola bola-f">${String(q.n).padStart(2,'0')}</span><div class="txs muted mt8">${q.c}x</div></div>`).join('')}</div>
      </div>
      <div class="divider"></div>
      <div class="sectt mb8">Últimos resultados — ${lt.nome}</div>
      ${dados.slice(0,3).map(r=>`
        <div class="res-card">
          <div class="res-top"><span>Concurso #${r.numero||r.concurso||'—'}</span><span>${r.data||'—'}</span></div>
          <div class="bolas">${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}${trevosHTML(r)}</div>
          <div class="fxb txs muted mt8">
            <span>${r.acumulado?'<span class="badge b-acum">Acumulado!</span>':`${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}`}</span>
            <span>${r.premio?fmtPremio(r.premio):''}</span>
          </div>
        </div>`).join('')}
      <p class="txs muted tc" style="margin-top:12px">Análise: ${total} concursos · ${hoje()}</p>`;
  },

  // Gera jogo misturando quentes, frios e aleatórios
  _iaGerar(ltId, quentes, frios) {
    const lt = LOTERIAS[ltId];
    const stats = S._iaStats?.[ltId];
    const q = quentes || stats?.quentes || [];
    const f = frios   || stats?.frios   || [];
    const nDez = lt.dezenas;
    const sel  = new Set();

    const addFrom = (arr, qtd) => {
      const sh = [...arr].sort(()=>Math.random()-.5);
      for (let i=0; i<sh.length && sel.size < qtd; i++) sel.add(sh[i].n);
    };

    // ~40% quentes, ~20% frios, resto aleatório
    addFrom(q, Math.ceil(nDez * .4));
    addFrom(f, Math.ceil(nDez * .6));
    for (let t=0; sel.size < nDez && t<5000; t++)
      sel.add(Math.floor(Math.random()*lt.max)+1);

    return [...sel].sort((a,b)=>a-b).map(n=>String(n).padStart(2,'0'));
  },

  // Botão "Gerar novo jogo" — atualiza só as bolas com animação
  _iaNovoJogo(ltId) {
    const lt = LOTERIAS[ltId];
    const el = $('jogo-bolas'); if (!el) return;
    el.classList.add('jogo-flip');
    setTimeout(() => {
      const nums = R._iaGerar(ltId);
      el.innerHTML = nums.map(n=>`<span class="bola" style="background:${lt.cor};box-shadow:0 2px 8px ${lt.cor}66">${n}</span>`).join('');
      el.classList.remove('jogo-flip');
    }, 200);
  },

  // ---- BOLÕES ----
  _boloes() {
    const lt=LOTERIAS[S.loteria];
    if(!lt){R.ir('home');return;}
    $('h-title').textContent=lt.nome;
    const bs=DB.boloes.byLt(lt.id), admin=AUTH.isAdmin();
    let h=`<div class="bl-header">
      <div class="bl-icon" style="background:${lt.cor}25;color:${lt.cor}">${lt.emoji}</div>
      <div><div style="font-weight:700">${lt.nome}</div><div class="muted txs">R$ ${lt.preco.toFixed(2)}/jogo</div></div>
      ${admin?`<button class="btn btn-p btn-sm" style="margin-left:auto" onclick="R._mNovoBolao()">+ Novo</button>`:''}
    </div>`;
    if(!bs.length){h+=`<div class="empty"><div class="ei">${lt.emoji}</div><p>Nenhum bolão cadastrado.</p></div>`;}
    else h+=bs.map(b=>{
      const pg=b.membros.filter(m=>m.pago).length;
      return`<div class="card cc" style="border-left:4px solid ${lt.cor};position:relative" onclick="R._bClick('${b.id}')">
        <div class="bl-nome">${b.nome}</div>
        <div class="bl-meta">Concurso #${b.concurso} · ${b.membros.length} membros</div>
        <div class="bl-row">
          <span class="muted tsm">${b.cotas_total} cotas · ${fmt$(b.cotas_total*b.valor_cota)}</span>
          ${b.status==='conferido'
            ? (b.resultado?.premiado
                ? `<span class="badge" style="background:rgba(245,158,11,.2);color:var(--gold)">🎉 Premiado</span>`
                : `<span class="badge b-pend">Conferido</span>`)
            : b.status==='aguardando_resultado'
            ? `<span class="badge b-pend" title="As fontes automáticas ainda não confirmaram — abra o app logado como admin pra tentar de novo">⏳ Aguardando resultado</span>`
            : `<span class="badge b-${b.status==='ativo'?'ativo':'pend'}">${b.status}</span>`}
        </div>
        <div class="bl-row mt8"><span class="txs muted">${pg}/${b.membros.length} pagos</span><span class="txs muted">${b.numeros.length} jogo${b.numeros.length!==1?'s':''}</span></div>
        ${admin?`<button class="btn-ico bl-del-btn" title="Excluir bolão" onclick="event.stopPropagation();R._delBolao('${b.id}','${b.nome.replace(/'/g,"\\'")}')">🗑️</button>`:''}
      </div>`;
    }).join('');
    $('view-boloes').innerHTML=h;
  },
  _bClick(id){S.bolao=id; R.ir('bolao');},
  // Popup pro admin/dev avisando de bolões premiados na conferência automática (visto = localStorage por navegador)
  _verificarPremios() {
    if (!AUTH.isAdmin()) return;
    let vistos;
    try { vistos = new Set(JSON.parse(localStorage.getItem('premiosVistos')||'[]')); } catch { vistos = new Set(); }
    const novos = (S.cache.boloes||[]).filter(b => b.status==='conferido' && b.resultado?.premiado && !vistos.has(b.id));
    if (!novos.length) return;
    MODAL.open(`
      <div class="m-title">🎉 Bolão${novos.length>1?'ões':''} premiado${novos.length>1?'s':''}!</div>
      ${novos.map(b=>{
        const lt=LOTERIAS[b.loteria];
        return `<div class="card mb12" style="border-left:4px solid var(--gold)">
          <div style="font-weight:700">${lt?.emoji||''} ${b.nome}</div>
          <div class="txs muted">${lt?.nome||b.loteria} · Concurso #${b.concurso}</div>
          <div class="mt8">Prêmio total: <strong>${fmt$(b.resultado.premioTotal)}</strong></div>
          <div class="txs muted">${fmt$(b.resultado.rateioPorCota)} por cota</div>
        </div>`;
      }).join('')}
      <button class="btn btn-p btn-f mt8" onclick='R._fecharPremios(${JSON.stringify(novos.map(b=>b.id))})'>Fechar</button>
    `);
  },
  _fecharPremios(ids) {
    let vistos;
    try { vistos = new Set(JSON.parse(localStorage.getItem('premiosVistos')||'[]')); } catch { vistos = new Set(); }
    ids.forEach(id=>vistos.add(id));
    localStorage.setItem('premiosVistos', JSON.stringify([...vistos].slice(-500)));
    MODAL.close();
  },
  // Fogos de artifício automáticos pro apostador quando o admin cadastra uma premiação — só cliente
  // (diferente de _verificarPremios acima, que é admin-only). Uma premiação por vez; ao confirmar,
  // mostra a próxima pendente se houver mais.
  _verificarPremiacaoCliente() {
    if (AUTH.isAdmin()) return;
    const pendente = DB.premiacoes.minhas().find(p => !p.confirmada);
    $('h-premio')?.classList.toggle('h-premio-pend', !!pendente);
    if (!pendente) { MODAL.close(); return; }
    MODAL.open(`
      <div class="fogos">${Array.from({length:10}).map((_,i)=>`<span class="fogos-particula" style="--a:${i*36}deg;--c:${['var(--gold)','var(--primary)','var(--red)','#fff'][i%4]}"></span>`).join('')}</div>
      <div class="tc">
        <div style="font-size:2.4rem">🎉</div>
        <div class="m-title" style="margin-bottom:6px">Confirme sua premiação!</div>
        <div style="font-size:1.6rem;font-weight:800;color:var(--gold)">${fmt$(pendente.valor)}</div>
        ${pendente.mensagem?`<div class="txs muted mt8">${COTAS._esc(pendente.mensagem)}</div>`:''}
        <button class="btn btn-p btn-f mt16" onclick="R._confirmarPremiacao('${pendente.id}');R._verificarPremiacaoCliente();">Confirmar 🎉</button>
      </div>
    `);
  },
  _delBolao(id, nome) {
    if(!confirm(`Excluir o bolão "${nome}"?\n\nTodos os membros e pagamentos vinculados também serão removidos. Esta ação não pode ser desfeita.`)) return;
    DB.boloes.del(id); R._boloes();
  },

  // ---- GRUPOS DE BOLÕES (acompanhamento: quem aceitou, pagou ou está pendente) ----
  // Nem todo mundo do grupo aceita a cota quando o lotérico oferece — por isso a navegação
  // principal é por GRUPO (quem topou participar de quê), não mais por loteria.
  //
  // Status de cada membro, cruzando membros[].pago com a tabela de comprovantes (pagamentos):
  //   'pago'      — m.pago === true (admin confirmou o pagamento)
  //   'aprovacao' — tem comprovante enviado (pagamentos.status='pendente') mas admin ainda não confirmou
  //   'pendente'  — aceitou a cota mas ainda não mandou comprovante nem foi marcado como pago
  _statusMembro(b, m) {
    if (m.pago) return 'pago';
    const comprovante = (S.cache.pags||[]).find(p =>
      p.bolao_id===b.id && (p.membro||'').trim().toLowerCase()===m.nome.trim().toLowerCase() && p.status==='pendente'
    );
    return comprovante ? 'aprovacao' : 'pendente';
  },

  _grupos() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Grupos de Bolões';
    const gs=DB.grupos.list();
    if (!gs.length) {
      $('view-grupos').innerHTML=`<div class="empty"><div class="ei">${WPP_SVG(52)}</div><p>Nenhum grupo cadastrado.</p><p class="txs muted mt8">Cadastre em Admin → WhatsApp.</p></div>`;
      return;
    }
    $('view-grupos').innerHTML = gs.map(g=>{
      const boloesGrupo = DB.boloes.list().filter(b=>bolaoDoGrupo(b,g));
      const membrosUnicos = {};
      // Se a pessoa está em mais de um bolão do grupo, mantém sempre o status "menos resolvido"
      // (pendente esconde aprovação, aprovação esconde pago) — senão um bolão já pago escondia
      // um comprovante aguardando aprovação em outro bolão do mesmo grupo.
      const PRIORIDADE = { pendente:2, aprovacao:1, pago:0 };
      boloesGrupo.forEach(b=>(b.membros||[]).forEach(m=>{
        const k=m.nome.trim().toLowerCase();
        const st=R._statusMembro(b,m);
        if (!membrosUnicos[k] || PRIORIDADE[st]>PRIORIDADE[membrosUnicos[k]]) membrosUnicos[k]=st;
      }));
      const total=Object.keys(membrosUnicos).length;
      const pagos=Object.values(membrosUnicos).filter(s=>s==='pago').length;
      const aprovacao=Object.values(membrosUnicos).filter(s=>s==='aprovacao').length;
      const pendentes=Object.values(membrosUnicos).filter(s=>s==='pendente').length;
      return `<div class="card cc mb12" onclick="R._irGrupoDet('${g.id}')">
        <div class="fxb mb8">
          <div style="font-weight:700">${g.nome} ${g.jid?'<span class="badge txs" style="background:var(--primary);color:#fff;font-size:.6rem">Bot ✓</span>':''}</div>
          <span class="txs muted">${boloesGrupo.length===1?'1 bolão':`${boloesGrupo.length} bolões`}</span>
        </div>
        ${total?`
        <div class="fxb txs">
          <span style="color:var(--primary)">${pagos} pago${pagos!==1?'s':''}</span>
          ${aprovacao?`<span style="color:var(--gold)">${aprovacao} aguardando aprovação</span>`:''}
          <span class="muted">${pendentes} pendente${pendentes!==1?'s':''}</span>
        </div>
        <div class="txs muted mt4">${total} aceitaram participar</div>`
        :`<div class="txs muted">Ninguém aceitou participar ainda.</div>`}
      </div>`;
    }).join('');
  },

  // Guarda qual grupo abrir e navega — a própria R.ir() cuida do stack/histórico de "voltar"
  _irGrupoDet(grupoId) { S.grupoAtual=grupoId; R.ir('grupoDet'); },

  // Handler de tela (chamado pelo roteador via R.ir('grupoDet')) — lê o grupo de S.grupoAtual,
  // igual ao padrão de _bolao() lendo S.bolao.
  _grupoDet() {
    const g=DB.grupos.list().find(x=>x.id===S.grupoAtual);
    if (!g) { R.ir('grupos'); return; }
    $('h-title').textContent=g.nome;
    const boloesGrupo=DB.boloes.list().filter(b=>bolaoDoGrupo(b,g));
    const roster=DB.grupoMembros.list(g.id);

    let html=`<div class="fxb mb12"><div class="sectt">Apostadores do grupo</div>
      <div class="fx" style="gap:6px;flex-wrap:wrap">
        ${g.jid?`<button class="btn btn-o btn-sm" onclick="R._importarRosterAuto('${g.id}')">⬇️ Importar</button>`:''}
        <button class="btn btn-o btn-sm" onclick="R._mAddRosterManual('${g.id}')">➕ Adicionar</button>
        <button class="btn btn-o btn-sm" onclick="R._mImportarRoster('${g.id}')">📋 Colar lista</button>
      </div></div>`;
    if (!roster.length) {
      html+=`<div class="empty"><div class="ei">👥</div><p>Nenhum apostador cadastrado neste grupo ainda.</p>
        <p class="txs muted mt8">Esse cadastro é permanente — não depende de ter um bolão ativo agora.</p></div>`;
    } else {
      html+=roster.map(m=>{
        const semNome = !m.nome || m.nome.trim().toLowerCase()==='sem nome';
        return `<div class="lr">
          <div><div style="font-weight:500">${nomeParaExibir(roster,m)} ${m.wpp_jid?'<span class="txs muted" title="Importado automaticamente do WhatsApp">🤖</span>':''}
            ${semNome?'<span class="badge txs" style="background:var(--border);color:var(--muted);margin-left:4px">aguardando identificação</span>':''}</div>
          <div class="txs muted">${m.fone||'<em>sem telefone</em>'}</div></div>
          <div class="fx" style="gap:6px">
            <button class="btn btn-o btn-sm" onclick="R._mEditRoster('${m.id}')">✏️</button>
            <button class="btn btn-o btn-sm" onclick="R._delRoster('${m.id}')">🗑️</button>
          </div>
        </div>`;
      }).join('');
    }

    html+=`<div class="divider"></div><div class="sectt mb12">Bolões do grupo</div>`;
    if (!boloesGrupo.length) {
      html+=`<div class="empty"><div class="ei">🎲</div><p>Nenhum bolão vinculado a este grupo ainda.</p></div>`;
    } else {
      html+=boloesGrupo.map(b=>{
        const lt=LOTERIAS[b.loteria];
        return `<div class="card cc mb12" style="border-left:4px solid ${lt?.cor||'#666'}" onclick="R._bClick('${b.id}')">
          <div class="bl-nome">${lt?.emoji||''} ${b.nome}</div>
          <div class="bl-meta">${lt?.nome||b.loteria} · Concurso #${b.concurso} · ${(b.membros||[]).length} aceitaram</div>
          <div class="bl-row mt8"><span class="muted tsm">${b.cotas_total} cotas · ${fmt$(b.cotas_total*b.valor_cota)}</span>
          <span class="badge b-${b.status==='ativo'?'ativo':'pend'}">${b.status}</span></div>
        </div>`;
      }).join('');
    }

    html+=`<div class="divider"></div><div class="sectt mb12">Participantes</div>`;
    const linhas=[];
    boloesGrupo.forEach(b=>(b.membros||[]).forEach((m,i)=>linhas.push({b,m,i})));
    if (!linhas.length) {
      html+=`<div class="empty"><div class="ei">👥</div><p>Ninguém aceitou participar ainda.</p></div>`;
    } else {
      html+=linhas.map(({b,m,i})=>{
        const st=R._statusMembro(b,m);
        const rotulo = st==='pago' ? 'Pago ✓' : st==='aprovacao' ? 'Aguardando aprovação' : 'Pendente';
        const cor = st==='pago' ? 'b-pago' : st==='aprovacao' ? 'b-pend' : 'b-pend';
        return `<div class="lr">
          <div><div style="font-weight:500">${m.nome}</div><div class="txs muted">${b.nome} · ${m.cotas} cota${m.cotas!==1?'s':''} · ${fmt$(m.cotas*b.valor_cota)}</div></div>
          <button class="btn btn-o btn-sm" onclick="R._togglePagDeGrupo('${b.id}',${i})" ${st==='aprovacao'?'title="Tem comprovante aguardando aprovação em Admin → Pagamentos"':''}><span class="badge ${cor}" style="margin-right:4px">${rotulo}</span></button>
        </div>`;
      }).join('');
    }
    $('view-grupoDet').innerHTML=html;
  },
  // Toggle pago chamado a partir da tela de grupo — recarrega a mesma tela de grupo, não a de bolão
  _togglePagDeGrupo(bid,idx) {
    const b=DB.boloes.get(bid); if(!b) return;
    b.membros[idx].pago=!b.membros[idx].pago;
    DB.boloes.save(b);
    R._grupoDet();
  },

  // ---- CADASTRO DE APOSTADORES DO GRUPO (independente de bolão) ----
  _mAddRosterManual(grupoId) {
    MODAL.open(`<div class="m-title">➕ Adicionar apostador</div>
      <div class="fg"><label>Nome</label><input id="rmn" type="text" placeholder="Nome completo"></div>
      <div class="fg"><label>Telefone (opcional)</label><input id="rmf" type="text" placeholder="+55 61 99999-9999"></div>
      <input type="hidden" id="rmg" value="${grupoId}">
      <button class="btn btn-p btn-f" onclick="R._saveRosterManual()">Salvar</button>`);
  },
  _mEditRoster(id) {
    const m=(S.cache.grupoMembros||[]).find(x=>x.id===id); if(!m) return;
    const semNome = !m.nome || m.nome.trim().toLowerCase()==='sem nome';
    MODAL.open(`<div class="m-title">✏️ Editar apostador</div>
      <div class="fg"><label>Nome</label><input id="rmn" type="text" value="${semNome?'':m.nome}" placeholder="${semNome?'Ainda não identificado — digite o nome':''}"></div>
      <div class="fg"><label>Telefone (opcional)</label><input id="rmf" type="text" value="${m.fone||''}"></div>
      <input type="hidden" id="rmg" value="${m.grupo_id}">
      <input type="hidden" id="rmid" value="${m.id}">
      <button class="btn btn-p btn-f" onclick="R._saveRosterManual()">Salvar</button>`);
  },
  _saveRosterManual() {
    const nomeInput=$('rmn')?.value?.trim();
    const idPrevio=$('rmid')?.value;
    const grupoId=$('rmg').value;
    const fone=normalizarFone($('rmf')?.value||'');
    const existente=idPrevio && (S.cache.grupoMembros||[]).find(x=>x.id===idPrevio);
    if(!nomeInput && !existente){alert('Informe o nome.');return;} // editar sem digitar preserva "Sem nome"/placeholder
    const nome = nomeInput || (existente?existente.nome:'Sem nome');

    // Ao ADICIONAR (não editar) com um telefone que já bate com alguém importado automaticamente
    // no mesmo grupo (mesmo wpp_jid ou mesmo telefone já resolvido), atualiza esse registro em
    // vez de criar um duplicado — a pessoa já existe no cadastro, só ainda não tinha nome.
    let alvo = existente;
    if (!alvo && fone) {
      const candidatoJid = fone+'@s.whatsapp.net';
      alvo = (S.cache.grupoMembros||[]).find(x=>x.grupo_id===grupoId && (x.wpp_jid===candidatoJid || (x.fone && x.fone===fone)));
    }

    DB.grupoMembros.save({
      id: alvo?alvo.id:uid(), grupo_id:grupoId, nome, fone: fone||(alvo?.fone||''),
      wpp_jid: alvo?.wpp_jid||'',
      criado: alvo?alvo.criado:hoje(), // preserva a data original ao editar/vincular
    });
    MODAL.close(); R._grupoDet();
    if (alvo && !existente) TOAST.show('✅ Vinculado a um participante já importado do WhatsApp — não foi duplicado.', 'ok');
  },
  _delRoster(id) {
    if(!confirm('Remover este apostador do cadastro do grupo?')) return;
    DB.grupoMembros.del(id); R._grupoDet();
  },
  // Importação automática via bot (groupMetadata) — participante novo entra como "Sem nome" até
  // mandar uma mensagem no grupo (o nome é preenchido sozinho a partir do pushName nesse momento).
  async _importarRosterAuto(grupoId) {
    const r = await _api.post(`/api/grupos/${grupoId}/importar`, {});
    if (!r) { alert('Erro de conexão.'); return; }
    const d = await r.json().catch(()=>({ok:false}));
    if (!d.ok) { alert(d.error||'Erro ao importar participantes.'); return; }
    const atualizados = await _api.get('/api/grupo_membros');
    if (Array.isArray(atualizados)) S.cache.grupoMembros = atualizados;
    R._grupoDet();
    TOAST.show(`✅ ${d.importacao?.novos||0} novo${d.importacao?.novos===1?'':'s'} de ${d.importacao?.total||0} participantes do grupo.`, 'ok');
  },
  _mImportarRoster(grupoId, textoPrevio) {
    const g=DB.grupos.list().find(x=>x.id===grupoId); if(!g) return;
    R._colarRoster={grupoId};
    MODAL.open(`
      <div class="m-title">📋 Colar lista — ${g.nome}</div>
      <div class="fg">
        <label>Cole a lista de participantes copiada do WhatsApp (um por linha)</label>
        <textarea id="imp-roster-texto" rows="8" placeholder="Ex:&#10;João Silva: +55 61 99999-9999&#10;Maria +5561988887777&#10;+55 61 97777-6666">${textoPrevio||''}</textarea>
      </div>
      <button class="btn btn-p btn-f mt8" onclick="R._analisarRosterColado()">🔍 Analisar lista</button>
      <button class="btn btn-o btn-f mt8" onclick="MODAL.close()">Cancelar</button>
    `);
  },
  _analisarRosterColado() {
    const texto=$('imp-roster-texto')?.value||'';
    const parsed=R._parseLinhasWA(texto);
    if(!parsed.length){alert('Nenhum apostador reconhecido no texto colado.');return;}
    R._colarRoster={grupoId:R._colarRoster?.grupoId, texto, parsed};
    MODAL.open(`
      <div class="m-title">📋 ${parsed.length} apostador${parsed.length!==1?'es':''} encontrado${parsed.length!==1?'s':''}</div>
      <p class="muted txs mb12">Confira e desmarque quem não deve ser cadastrado:</p>
      <div style="max-height:45vh;overflow-y:auto">
        ${parsed.map((p,i)=>`
          <div class="fr mb8" style="align-items:center;gap:8px">
            <input type="checkbox" id="ric-${i}" checked>
            <div style="flex:1">
              <input type="text" id="rin-${i}" value="${(p.nome||'').replace(/"/g,'&quot;')}" placeholder="Nome"
                     style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text);margin-bottom:4px">
              <input type="text" id="rif-${i}" value="${p.fone||''}" placeholder="Telefone (opcional)"
                     style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text)">
            </div>
          </div>`).join('')}
      </div>
      <button class="btn btn-p btn-f mt12" onclick="R._salvarRosterColado()">✅ Salvar todos</button>
      <button class="btn btn-o btn-f mt8" onclick="R._mImportarRoster(R._colarRoster.grupoId, R._colarRoster.texto)">◀ Voltar</button>
    `);
  },
  _salvarRosterColado() {
    const {grupoId, parsed} = R._colarRoster||{};
    if(!grupoId||!parsed) return;
    const existentes=DB.grupoMembros.list(grupoId);
    const fonesExistentes=new Set(existentes.map(m=>normalizarFone(m.fone)).filter(Boolean));
    let salvos=0;
    parsed.forEach((p,i)=>{
      if(!$(`ric-${i}`)?.checked) return;
      const nome=$(`rin-${i}`)?.value?.trim()||'Sem nome';
      const fone=normalizarFone($(`rif-${i}`)?.value||'');
      if(fone && fonesExistentes.has(fone)) return; // já cadastrado
      DB.grupoMembros.save({id:uid(), grupo_id:grupoId, nome, fone, criado:hoje()});
      if(fone) fonesExistentes.add(fone);
      salvos++;
    });
    R._colarRoster=null;
    MODAL.close();
    R._grupoDet();
    TOAST.show(`✅ ${salvos} apostador${salvos!==1?'es':''} cadastrado${salvos!==1?'s':''}.`, 'ok');
  },

  // ---- BOLÃO DETALHE ----
  async _bolao() {
    const b=DB.boloes.get(S.bolao);
    if(!b){R.ir('boloes');return;}
    const lt=LOTERIAS[b.loteria];
    $('h-title').textContent=b.nome;
    const res = b.resultado;
    const acertadas = res ? new Set(b.numeros.flat().filter(n=>res.dezenas.includes(n))) : new Set();
    $('view-bolao').innerHTML=`
      <div class="card mb12">
        <div class="fxb">
          <div><div style="font-weight:700">${b.nome}</div><div class="muted txs">Concurso #${b.concurso}</div></div>
          <div style="text-align:right"><div style="font-weight:700;color:${lt.cor}">${lt.nome} ${lt.emoji}</div><div class="muted txs">${b.membros.length} membros</div></div>
        </div>
        <div class="divider"></div>
        <div class="sectt">Jogos do bolão</div>
        ${b.numeros.map((ns,i)=>`<div class="mb8"><div class="txs muted mb8">Jogo ${i+1}${res?` · ${res.jogos[i]?.acertos??0} acerto${(res.jogos[i]?.acertos??0)!==1?'s':''}`:''}</div><div class="bolas">${ns.map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}${trevosHTML(r)}</div></div>`).join('')}
      </div>
      ${res?`
      <div class="card mb12" style="border:2px solid ${res.premiado?'var(--gold)':'var(--border)'}">
        <div class="sectt mb8">🎯 Resultado — Concurso #${b.concurso}</div>
        <div class="bolas">${res.dezenas.map(n=>`<span class="bola${acertadas.has(n)?' bola-hit':''}" style="${acertadas.has(n)?'':`background:${lt.cor}`}">${n}</span>`).join('')}</div>
        <div class="txs muted mt8 mb8">Sorteio em ${res.dataApuracao||'—'} · Maior acerto: ${res.maiorAcerto}${res.fonte?` · fonte: ${res.fonte}`:''}</div>
        ${res.premiado
          ? `<div class="ia-aviso" style="border-color:var(--gold);color:var(--gold)">🎉 <strong>Premiado!</strong> Prêmio total ${fmt$(res.premioTotal)} — ${fmt$(res.rateioPorCota)} por cota.</div>`
          : `<div class="txs muted">Não foi dessa vez — próximo bolão já disponível!</div>`}
        ${res.avisoGrupoAgendadoPara ? `<div class="txs muted mt8">${res.avisoGrupoEnviado
              ? '✅ Grupo já avisado.'
              : `⏳ Grupo será avisado às ${new Date(res.avisoGrupoAgendadoPara).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} (você já sabe antes deles).`}</div>` : ''}
      </div>`:''}
      <div class="tabs">
        <button class="tab on" onclick="R._tab('resultados',this)">📋 Resultados</button>
        <button class="tab" onclick="R._tab('ia',this)">🤖 IA</button>
        <button class="tab" onclick="R._tab('membros',this)">👥 Membros</button>
      </div>
      <div id="tab-c"><div class="loading"><div class="spinner"></div> Buscando resultados...</div></div>`;
    const {fonte,dados} = await API.ultimos3(b.loteria);
    S.resultados=dados;
    R._tRes(dados,lt, fonte==='mock'?'<span class="badge b-pend txs">📦 Dados locais</span>':'');
  },

  _tab(aba,btn) {
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    const b=DB.boloes.get(S.bolao), lt=LOTERIAS[b?.loteria];
    if(aba==='resultados') R._tRes(S.resultados||[],lt,'');
    else if(aba==='ia')    R._tIA(S.resultados||[],lt);
    else                   R._tMem(b);
  },

  _tRes(dados,lt,badge) {
    $('tab-c').innerHTML=`
      <div class="fxb mb12"><div class="sectt">Últimos 3 sorteios</div>${badge}</div>
      ${dados.slice(0,3).map((r,i)=>`
        <div class="res-card">
          <div class="res-top"><span>Concurso #${r.numero||r.concurso||'—'}</span><span>${r.data||'—'}</span></div>
          <div class="bolas">${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}${trevosHTML(r)}</div>
          <div class="fxb txs muted mt8">
            <span>${r.acumulado?'<span class="badge b-acum">Acumulado!</span>':`${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}`}</span>
            <span>${r.premio?fmtPremio(r.premio):''}</span>
          </div>
          ${i===0&&(r.prox||r.numProxConcurso||r.dataProxConcurso)?`
          <div class="fxb txs muted mt4">
            <span>${r.numProxConcurso?`Próximo concurso #${r.numProxConcurso}`:'Próximo concurso'}${r.dataProxConcurso?` · 📅 ${r.dataProxConcurso}`:''}</span>
            <span style="color:${lt.cor};font-weight:700">${r.prox?fmtPremio(r.prox):''}</span>
          </div>`:''}
        </div>`).join('')}`;
  },

  async _tIA(dados,lt) {
    let res=dados;
    if(res.length<8){
      $('tab-c').innerHTML=`<div class="loading"><div class="spinner"></div> Analisando histórico...</div>`;
      const h=await API.hist20(lt.id);
      res=h.length?h:MOCK[lt.id]||dados;
    }
    const {quentes,frios,total}=IA.analisar(res);
    $('tab-c').innerHTML=`
      <div class="ia-aviso">⚠️ <strong>Aviso:</strong> Sorteios são aleatórios e auditados pela Caixa. Esta análise é apenas estatística baseada em ${total} concursos anteriores — não garante resultados. Jogue com responsabilidade.</div>
      <div class="ia-sec">
        <h4>🔥 Números Quentes <span class="txs muted">(mais frequentes)</span></h4>
        <div class="bolas">${quentes.map(q=>`<div class="tc"><span class="bola bola-q">${String(q.n).padStart(2,'0')}</span><div class="txs muted mt8">${q.c}x</div></div>`).join('')}</div>
      </div>
      <div class="ia-sec">
        <h4>🧊 Números Frios <span class="txs muted">(menos frequentes)</span></h4>
        <div class="bolas">${frios.map(q=>`<div class="tc"><span class="bola bola-f">${String(q.n).padStart(2,'0')}</span><div class="txs muted mt8">${q.c}x</div></div>`).join('')}</div>
      </div>
      <p class="txs muted tc">Análise: ${total} concursos · ${hoje()}</p>`;
  },

  _tMem(b) {
    const pg=b.membros.filter(m=>m.pago).length;
    const tot=b.membros.reduce((s,m)=>s+(m.pago?m.cotas*b.valor_cota:0),0);
    $('tab-c').innerHTML=`
      <div class="fxb mb12"><span class="tsm">${pg}/${b.membros.length} confirmados</span><span class="tsm" style="color:var(--primary)">${fmt$(tot)}</span></div>
      ${b.membros.map((m,i)=>`
        <div class="lr">
          <div><div style="font-weight:500">${m.nome}</div><div class="txs muted">${m.cotas} cota${m.cotas!==1?'s':''} · ${fmt$(m.cotas*b.valor_cota)}</div></div>
          ${AUTH.isAdmin()?`<button class="btn btn-o btn-sm" onclick="R._togglePag('${b.id}',${i})">${m.pago?'Pago ✓':'Pendente'}</button>`:
          `<span class="badge ${m.pago?'b-pago':'b-pend'}">${m.pago?'Pago':'Pendente'}</span>`}
        </div>`).join('')}
      <div class="mt16"><button class="btn btn-o btn-f" onclick="R._mComp('${b.id}')">📎 Enviar comprovante</button></div>`;
  },

  _togglePag(bid,idx) {
    const b=DB.boloes.get(bid); if(!b) return;
    b.membros[idx].pago=!b.membros[idx].pago;
    DB.boloes.save(b); R._tMem(b);
  },

  // ---- RESULTADOS (geral) ----
  async _resultados() {
    $('h-title').textContent='Resultados';
    $('view-resultados').innerHTML=`<div class="loading"><div class="spinner"></div> Buscando...</div>`;
    const ps=Object.values(LOTERIAS).map(async lt=>({lt,r:(await API.ultimos3(lt.id)).dados[0]}));
    const data=await Promise.all(ps);
    $('view-resultados').innerHTML=`<div style="margin-bottom:14px;font-size:1.1rem;font-weight:700">Últimos Resultados</div>`+
      data.map(({lt,r})=>!r?'':
        `<div class="card mb12" style="border-left:4px solid ${lt.cor}">
          <div class="fxb mb8"><div style="font-weight:700">${lt.emoji} ${lt.nome}</div><div class="txs muted">Conc. #${r.numero||'—'} · ${r.data||'—'}</div></div>
          <div class="bolas">${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}${trevosHTML(r)}</div>
          <div class="fxb txs muted mt8">
            <span>${r.acumulado?'🔴 Acumulado':`${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}`}</span>
          </div>
          ${(r.prox||r.numProxConcurso||r.dataProxConcurso)?`
          <div class="fxb txs muted mt4">
            <span>${r.numProxConcurso?`Próximo concurso #${r.numProxConcurso}`:'Próximo concurso'}${r.dataProxConcurso?` · 📅 ${r.dataProxConcurso}`:''}</span>
            <span style="color:${lt.cor};font-weight:700">${r.prox?fmtPremio(r.prox):''}</span>
          </div>`:''}
        </div>`).join('');
  },

  // ---- ADMIN ----
  _admin() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Administração';
    const vs=DB.vendas.list(), bs=DB.boloes.list();
    const tot=vs.reduce((s,v)=>s+(v.valor||0),0);
    const tm=vs.length?tot/vs.length:0;
    // Apostadores = membros únicos dos bolões ATUAIS (não o histórico de vendas, que pode ter
    // nomes de bolões já apagados e ficar "descolado" do que existe hoje de verdade) + cadastro
    // de apostadores dos grupos (gente que ainda não comprou cota nenhuma, mas já está na lista
    // permanente do grupo — ver "Apostadores do grupo").
    const apostadoresUnicos=new Set();
    bs.forEach(b=>(b.membros||[]).forEach(m=>apostadoresUnicos.add(m.nome.trim().toLowerCase())));
    // "Sem nome" é um placeholder, não um nome real — usar como chave de dedup colapsaria todo
    // mundo sem nome identificado num "apostador" só. Quem tem telefone usa o telefone como chave
    // (identificador de verdade); sem telefone e sem nome real, usa o id (nunca colide).
    DB.grupoMembros.listAll().forEach(m=>{
      const temNomeReal = m.nome && m.nome.trim().toLowerCase()!=='sem nome';
      const chave = temNomeReal ? m.nome.trim().toLowerCase() : (m.fone ? 'fone:'+m.fone : 'gm:'+m.id);
      apostadoresUnicos.add(chave);
    });
    // Grupo sem NENHUM cadastro individual ainda (nem bolão, nem "Apostadores do grupo") — soma
    // a estimativa que o lotérico já digitou em "Nº de membros" ao cadastrar o grupo, senão o
    // total fica menor do que ele sabe que é na prática. Assim que alguém cadastrar os nomes/
    // telefones de verdade, essa estimativa é substituída automaticamente pela contagem real
    // (o grupo passa a ter `temIndividual`, e para de somar aqui).
    let estimativaSemCadastro=0;
    DB.grupos.list().forEach(g=>{
      const temIndividual = DB.grupoMembros.list(g.id).length>0
        || bs.some(b=>bolaoDoGrupo(b,g) && (b.membros||[]).length>0);
      if (!temIndividual) estimativaSemCadastro += (g.membros||0);
    });
    const aps=apostadoresUnicos.size + estimativaSemCadastro;
    const isdev=S.user.role==='dev';
    const qtUsr=DB.usuarios.list().length;
    $('view-admin').innerHTML=`
      <div class="stat-row">
        <div class="stat-card"><div class="sv">${fmt$(tot)}</div><div class="sl">Total Vendido</div></div>
        <div class="stat-card"><div class="sv">${bs.length}</div><div class="sl">Bolões</div></div>
        <div class="stat-card"><div class="sv">${DB.grupos.list().length}</div><div class="sl">Grupos</div></div>
        <div class="stat-card"><div class="sv">${aps}</div><div class="sl">Apostadores</div></div>
        <div class="stat-card"><div class="sv">${fmt$(tm)}</div><div class="sl">Ticket Médio</div></div>
      </div>
      <div class="amenu">
        <div class="amenu-c" onclick="R.ir('whatsapp')"><span class="amenu-i">${WPP_SVG(38)}</span><div class="amenu-n">WhatsApp</div></div>
        <div class="amenu-c" onclick="R.ir('stats')"><span class="amenu-i">📊</span><div class="amenu-n">Estatísticas</div></div>
        <div class="amenu-c" onclick="R.ir('pagamentos')"><span class="amenu-i">💳</span><div class="amenu-n">Pagamentos</div></div>
        <div class="amenu-c" style="border-color:var(--gold)" onclick="R.ir('lotes')"><span class="amenu-i">🧾</span><div class="amenu-n">Cotas ao Vivo</div></div>
        <div class="amenu-c" onclick="R.ir('boloes')"><span class="amenu-i">🎲</span><div class="amenu-n">Bolões</div></div>
        <div class="amenu-c" onclick="R.ir('usuarios')"><span class="amenu-i">👥</span><div class="amenu-n">Usuários <span style="font-size:.65rem;background:var(--primary);color:#000;border-radius:10px;padding:1px 5px;margin-left:2px">${qtUsr}</span></div></div>
        <div class="amenu-c" onclick="R.ir('premiacao')"><span class="amenu-i">🏆</span><div class="amenu-n">Premiação</div></div>
        <div class="amenu-c" onclick="R.ir('anual')"><span class="amenu-i">📅</span><div class="amenu-n">Bolão Anual</div></div>
        ${isdev?`<div class="amenu-c" style="border-color:var(--red)" onclick="R.ir('controle')"><span class="amenu-i">🔒</span><div class="amenu-n" style="color:var(--red)">Controle Dev</div></div>`:''}
      </div>
      ${TEMA.renderSeletor()}`;
  },

  // ---- USUÁRIOS (admin) — integrado com bolões e WhatsApp ----
  _usuarios() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Apostadores';

    // Coleta todos apostadores únicos de bolões
    const mapa = {};
    S.cache.boloes.forEach(b => {
      (b.membros||[]).forEach(m => {
        const k = m.nome.trim().toLowerCase();
        if (!mapa[k]) mapa[k] = { nome: m.nome, fone: m.fone||'', grupos: [], noApp: false, emBolao:false, emGrupo:false };
        mapa[k].emBolao = true;
        if (b.grupo && !mapa[k].grupos.includes(b.grupo)) mapa[k].grupos.push(b.grupo);
        if (m.fone && !mapa[k].fone) mapa[k].fone = m.fone;
      });
    });

    // Cadastro de apostadores dos grupos — gente que já está na lista permanente do grupo mas
    // ainda não comprou cota em nenhum bolão (ver "Apostadores do grupo" na tela de Grupos).
    // "Sem nome" é placeholder, não identificador real — dedup usa telefone ou id nesse caso,
    // senão todo mundo sem nome identificado colapsaria num "apostador" só.
    DB.grupoMembros.listAll().forEach(m => {
      const temNomeReal = m.nome && m.nome.trim().toLowerCase()!=='sem nome';
      const k = temNomeReal ? m.nome.trim().toLowerCase() : (m.fone?'fone:'+m.fone:'gm:'+m.id);
      const gNome = DB.grupos.list().find(g=>g.id===m.grupo_id)?.nome || '';
      if (!mapa[k]) mapa[k] = { nome:m.nome, fone:m.fone||'', grupos:[], noApp:false, emBolao:false, emGrupo:false };
      mapa[k].emGrupo = true;
      if (gNome && !mapa[k].grupos.includes(gNome)) mapa[k].grupos.push(gNome);
      if (m.fone && !mapa[k].fone) mapa[k].fone = m.fone;
    });

    // Marca quem já está registrado no app
    DB.usuarios.list().forEach(u => {
      const k = u.nome.trim().toLowerCase();
      if (mapa[k]) { mapa[k].noApp=true; mapa[k]._id=u.id; mapa[k].ativo=u.ativo; if(!mapa[k].fone) mapa[k].fone=u.fone||''; }
      else mapa[k] = { nome:u.nome, fone:u.fone||'', grupos:[], noApp:true, _id:u.id, ativo:u.ativo, emBolao:false, emGrupo:false };
    });

    const todos = Object.values(mapa).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
    // Banco de clientes de verdade = quem entrou no app com nome+telefone (ou foi liberado pelo
    // admin) — é o único grupo com telefone confiável o suficiente pra divulgação futura. O resto
    // (só bolão/só grupo) fica separado, mais abaixo.
    const clientes = todos.filter(t=>t.noApp);
    const soContato = todos.filter(t=>!t.noApp);
    const comFone = clientes.filter(t=>t.fone).length;

    $('view-usuarios').innerHTML=`
      <div class="fxb mb12">
        <div class="sectt">Apostadores (${todos.length})</div>
        <button class="btn btn-p btn-sm" onclick="R._mNovoUser()">+ Adicionar</button>
      </div>

      <div class="fxb mb8">
        <div class="sectt">📱 Banco de clientes (${clientes.length})</div>
        ${comFone ? `<button class="btn btn-o btn-sm" onclick="R._copiarTelefonesClientes()">📋 Copiar telefones</button>` : ''}
      </div>
      <div class="txs muted mb8">Quem já entrou no app com nome + telefone — base confiável pra divulgação futura (WhatsApp, promoções, sorteios).</div>
      <div class="card mb16">
        ${!clientes.length
          ? '<div class="empty"><div class="ei">📱</div><p>Ninguém entrou no app ainda com nome + telefone.</p></div>'
          : clientes.map(t=>`
          <div class="user-card">
            <div class="user-avatar" style="background:var(--primary)">${t.nome[0].toUpperCase()}</div>
            <div class="user-info">
              <div class="user-nome">${t.nome}
                <span class="badge txs" style="background:${t.ativo?'var(--primary)':'var(--red)'};color:#fff;margin-left:6px">${t.ativo?'Ativo':'Inativo'}</span>
              </div>
              <div class="user-meta txs muted">${t.fone?`📱 ${t.fone}`:'sem telefone'}${t.grupos.length?` · ${t.grupos.join(', ')}`:''}</div>
            </div>
            <div class="user-acts">
              <button class="btn btn-o btn-sm" onclick="R._toggleUser('${t._id}')">${t.ativo?'Desativar':'Ativar'}</button>
              <button class="btn btn-d btn-sm" onclick="R._delUser('${t._id}')">✕</button>
            </div>
          </div>`).join('')}
      </div>

      ${soContato.length ? `
      <div class="fxb mb8">
        <div class="sectt">Só em bolões/grupos (${soContato.length})</div>
      </div>
      <div class="ia-aviso mb12">
        ⚠️ Ainda sem acesso ao app — não entraram com nome + telefone, então não fazem parte do banco de clientes.
        <br><button class="btn btn-p btn-sm mt8" onclick="R._registrarTodos()">✅ Registrar todos no app</button>
      </div>
      <div class="card">
        ${soContato.map(t=>`
          <div class="user-card">
            <div class="user-avatar" style="background:var(--border);color:var(--text)">${t.nome[0].toUpperCase()}</div>
            <div class="user-info">
              <div class="user-nome">${t.nome}
                <span class="badge txs" style="background:var(--border);color:var(--muted);margin-left:6px">${t.emBolao?'Só bolão':'Só grupo'}</span>
              </div>
              <div class="user-meta txs muted">${t.fone?`📱 ${t.fone}`:''}${t.grupos.length?` · ${t.grupos.join(', ')}`:''}</div>
            </div>
            <div class="user-acts">
              <button class="btn btn-p btn-sm" onclick="R._registrarNaApp('${t.nome.replace(/'/g,"\\'").replace(/"/g,'\\"')}','${t.fone||''}')">Dar acesso</button>
            </div>
          </div>`).join('')}
      </div>` : ''}`;
  },
  _copiarTelefonesClientes() {
    const fones = (DB.usuarios.list()||[]).filter(u=>u.fone).map(u=>u.fone);
    if (!fones.length) { TOAST.show('Nenhum telefone pra copiar.', 'err'); return; }
    navigator.clipboard.writeText(fones.join(', '))
      .then(()=>TOAST.show(`📋 ${fones.length} telefone${fones.length>1?'s':''} copiado${fones.length>1?'s':''}!`, 'ok'))
      .catch(()=>TOAST.show('Não deu pra copiar — copie manualmente.', 'err'));
  },

  _mNovoUser() {
    MODAL.open(`<div class="m-title">👤 Novo Apostador</div>
      <div class="fg"><label>Nome completo</label><input id="mun" type="text" placeholder="Ex: João Silva" autocomplete="off"></div>
      <div class="fg"><label>Telefone (opcional)</label><input id="mutel" type="tel" placeholder="61999887766"></div>
      <button class="btn btn-p btn-f" onclick="R._saveUser()">Cadastrar</button>`);
  },
  _saveUser() {
    const nome = $('mun')?.value?.trim();
    if (!nome) { alert('Informe o nome.'); return; }
    if (DB.usuarios.find(nome)) { alert('Já existe um usuário com esse nome.'); return; }
    const fone = $('mutel')?.value?.trim()||'';
    DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje(), fone });
    MODAL.close(); R._usuarios();
  },
  _toggleUser(id) {
    const us=DB.usuarios.list(), i=us.findIndex(u=>u.id===id);
    if(i<0) return;
    us[i].ativo=!us[i].ativo;
    DB.usuarios.save(us[i]); R._usuarios();
  },
  _delUser(id) {
    if(!confirm('Remover usuário?')) return;
    DB.usuarios.del(id); R._usuarios();
  },
  _registrarNaApp(nome, fone) {
    if (DB.usuarios.find(nome)) { alert('Já registrado.'); return; }
    DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje(), fone:fone||'' });
    R._usuarios();
  },
  _registrarTodos() {
    const mapa = {};
    S.cache.boloes.forEach(b => (b.membros||[]).forEach(m => { mapa[m.nome.trim().toLowerCase()] = { nome:m.nome, fone:m.fone||'' }; }));
    // Cadastro de apostadores dos grupos entra também — exceto "Sem nome" (placeholder de quem
    // ainda não foi identificado; não dá pra registrar no app sem um nome de verdade, e várias
    // pessoas com o mesmo "Sem nome" colidiriam no cadastro de usuários).
    DB.grupoMembros.listAll().forEach(m => {
      if (!m.nome || m.nome.trim().toLowerCase()==='sem nome') return;
      const k = m.nome.trim().toLowerCase();
      if (!mapa[k]) mapa[k] = { nome:m.nome, fone:m.fone||'' };
      else if (!mapa[k].fone) mapa[k].fone = m.fone||'';
    });
    const novos = Object.values(mapa).filter(n => !DB.usuarios.find(n.nome));
    if (!novos.length) { alert('Todos já estão registrados!'); return; }
    if (!confirm(`Registrar ${novos.length} apostador${novos.length>1?'es':''} no app?`)) return;
    novos.forEach(n => DB.usuarios.save({ id:uid(), nome:n.nome, ativo:true, criado:hoje(), fone:n.fone }));
    R._usuarios();
  },

  // ---- PREMIAÇÃO (admin) ----
  _premiacao() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Premiação';
    const lista = DB.premiacoes.list();
    $('view-premiacao').innerHTML = `
      <div class="fxb mb12">
        <div class="sectt">Premiações (${lista.length})</div>
        <button class="btn btn-p btn-sm" onclick="R._mNovaPremiacao()">+ Nova</button>
      </div>
      <div class="card">
        ${!lista.length
          ? '<div class="empty"><div class="ei">🏆</div><p>Nenhuma premiação cadastrada ainda.</p></div>'
          : lista.map(p=>`
          <div class="user-card">
            <div class="user-avatar" style="background:${p.confirmada?'var(--primary)':'var(--gold)'}">🏆</div>
            <div class="user-info">
              <div class="user-nome">${p.nome}
                <span class="badge txs" style="background:${p.confirmada?'var(--primary)':'var(--gold)'};color:#000;margin-left:6px">${p.confirmada?'✅ Confirmada':'⏳ Pendente'}</span>
              </div>
              <div class="user-meta txs muted">📱 ${p.fone} · ${fmt$(p.valor)}${p.mensagem?' · '+p.mensagem:''}</div>
            </div>
            <div class="user-acts"><button class="btn btn-d btn-sm" onclick="R._delPremiacao('${p.id}')">✕</button></div>
          </div>`).join('')}
      </div>`;
  },
  _mNovaPremiacao() {
    const dl = DB.usuarios.list().map(u=>`<option value="${u.nome}">`).join('');
    MODAL.open(`
      <div class="m-title">🏆 Nova premiação</div>
      <div class="fg mb8">
        <label>Nome completo do apostador</label>
        <input id="pr-nome" list="dl-apostadores" placeholder="Nome completo" oninput="R._premAutoFone(this.value)">
        <datalist id="dl-apostadores">${dl}</datalist>
      </div>
      <div class="fg mb8"><label>Telefone (DDD)</label><input id="pr-fone" type="tel" placeholder="(61) 99999-9999"></div>
      <div class="fg mb8"><label>Valor do prêmio (R$)</label><input id="pr-valor" type="number" step="0.01" placeholder="0,00"></div>
      <div class="fg mb8"><label>Mensagem (opcional)</label><input id="pr-msg" placeholder="Ex: Acertou 4 dezenas na Lotofácil"></div>
      <button class="btn btn-p btn-f mt8" onclick="R._salvarPremiacao()">🏆 Cadastrar premiação</button>
      <div class="txs muted mt8">Se a pessoa ainda não abriu o app, a premiação fica pendente até ela entrar com esse nome + telefone pela primeira vez.</div>
    `);
  },
  _premAutoFone(nome) {
    const u = DB.usuarios.find((nome||'').trim());
    if (u && u.fone) $('pr-fone').value = u.fone;
  },
  _salvarPremiacao() {
    const nome = $('pr-nome').value.trim();
    const foneDigitado = $('pr-fone').value.trim();
    const valor = +$('pr-valor').value || 0;
    const mensagem = $('pr-msg').value.trim();
    if (!nome) { TOAST.show('Informe o nome do apostador.', 'err'); return; }
    if (foneDigitado.replace(/\D/g,'').length < 10) { TOAST.show('Informe um telefone válido com DDD.', 'err'); return; }
    if (valor <= 0) { TOAST.show('Informe o valor do prêmio.', 'err'); return; }
    const fone = normalizarFone(foneDigitado);
    DB.premiacoes.save({ id:uid(), nome, fone, valor, mensagem, confirmada:false, criado:hoje() });
    MODAL.close();
    R._premiacao();
    TOAST.show('🏆 Premiação cadastrada!', 'ok');
  },
  _delPremiacao(id) {
    if (!confirm('Excluir essa premiação?')) return;
    DB.premiacoes.del(id);
    R._premiacao();
  },

  // ---- BOLÃO ANUAL/PARCELADO (admin) ----
  _anual() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Bolão Anual';
    const lista = DB.boloesParcelados.list();
    $('view-anual').innerHTML = `
      <div class="fxb mb12" style="flex-wrap:wrap;gap:6px">
        <div class="sectt">Bolões parcelados (${lista.length})</div>
        <div class="fx" style="gap:6px">
          <button class="btn btn-o btn-sm" onclick="R.ir('whatsapp')">📱 Grupos WhatsApp</button>
          <button class="btn btn-p btn-sm" onclick="R._mNovoAnual()">+ Novo</button>
        </div>
      </div>
      ${!lista.length ? R._anualTabelaVazia(true) : `
      <div class="card">
        ${lista.map(b=>{
            const n=(b.participantes||[]).length;
            return `<div class="user-card" style="cursor:pointer" onclick="R._irAnualDet('${b.id}')">
              <div class="user-avatar" style="background:var(--gold)">📅</div>
              <div class="user-info">
                <div class="user-nome">${b.nome}</div>
                <div class="user-meta txs muted">${b.ano} · ${fmt$(b.valor_mensal)}/mês × ${b.duracao_meses} · ${n} participante${n!==1?'s':''}</div>
              </div>
              <div class="user-acts"><button class="btn btn-d btn-sm" onclick="event.stopPropagation();R._delAnual('${b.id}')">✕</button></div>
            </div>`;
          }).join('')}
      </div>`}`;
  },
  _mNovoAnual() {
    MODAL.open(`
      <div class="m-title">📅 Novo Bolão Anual</div>
      <div class="fg"><label>Nome</label><input id="an-nome" placeholder="Ex: Mega da Virada 2027"></div>
      <div class="fr">
        <div class="fg"><label>Ano</label><input id="an-ano" type="number" value="${new Date().getFullYear()}"></div>
        <div class="fg"><label>Duração (meses)</label><input id="an-dur" type="number" value="12" oninput="R._anCalcTotal()"></div>
      </div>
      <div class="fr">
        <div class="fg"><label>Valor mensal (R$)</label><input id="an-mensal" type="number" step="0.01" placeholder="85.00" oninput="R._anCalcTotal()"></div>
        <div class="fg"><label>Valor total (R$)</label><input id="an-total" type="number" step="0.01" placeholder="1020.00"></div>
      </div>
      <button class="btn btn-p btn-f mt8" onclick="R._salvarAnual()">📅 Cadastrar bolão</button>
      <div class="txs muted mt8">Valor total calculado automaticamente (mensal × duração) — editável se precisar ajustar arredondamento.</div>
    `);
  },
  _anCalcTotal() {
    const mensal = +$('an-mensal')?.value || 0, dur = +$('an-dur')?.value || 0;
    if ($('an-total')) $('an-total').value = (mensal*dur).toFixed(2);
  },
  _salvarAnual() {
    const nome = $('an-nome').value.trim();
    const ano = +$('an-ano').value || new Date().getFullYear();
    const dur = +$('an-dur').value || 12;
    const mensal = +$('an-mensal').value || 0;
    const total = +$('an-total').value || (mensal*dur);
    if (!nome) { TOAST.show('Informe o nome do bolão.', 'err'); return; }
    DB.boloesParcelados.save({ id:uid(), nome, ano, valor_mensal:mensal, duracao_meses:dur, valor_total:total, status:'ativo', criado:hoje() });
    MODAL.close();
    R._anual();
    TOAST.show('📅 Bolão cadastrado!', 'ok');
  },
  _delAnual(id) {
    if (!confirm('Excluir esse bolão e todos os participantes/pagamentos?')) return;
    DB.boloesParcelados.del(id);
    R._anual();
  },

  _irAnualDet(id) { S.anualAtual=id; R.ir('anualDet'); },

  // Um mês "passou" se o ano do bolão já ficou pra trás, ou é o ano atual e o mês já ficou pra
  // trás — usado tanto pra classificar inadimplência quanto pra colorir a planilha.
  _anualMesPassou(b, m) {
    const agora = new Date();
    return b.ano < agora.getFullYear() || (b.ano === agora.getFullYear() && m < agora.getMonth()+1);
  },
  // Meses já vencidos e ainda sem pagamento confirmado — base tanto do status quanto da lista
  // explícita de inadimplentes (nome + meses), que precisa aparecer sem depender de hover.
  _anualMesesEmAtraso(b, p) {
    if (p.quitado) return [];
    const atraso = [];
    for (let m=1; m<=b.duracao_meses; m++) {
      if (!R._anualMesPassou(b, m)) continue;
      const pg = (p.pagamentos||[]).find(x=>x.mes===m);
      if (!pg || pg.status!=='confirmado') atraso.push(m);
    }
    return atraso;
  },
  _anualStatusParticipante(b, p) {
    if (p.quitado) return 'quitado';
    return R._anualMesesEmAtraso(b, p).length ? 'inadimplente' : 'em_dia';
  },
  _anualCelula(b, p, m) {
    if (p.quitado) return { icon:'💰', cls:'cel-quitado', titulo:'Quitado' };
    const pg = (p.pagamentos||[]).find(x=>x.mes===m);
    if (pg?.status==='confirmado') return { icon:'✅', cls:'cel-pago', titulo:'Pago', id:pg.id };
    if (pg?.status==='pendente')   return { icon:'⏳', cls:'cel-pend', titulo:'Comprovante recebido — pendente de confirmação', id:pg.id };
    if (pg?.status==='rejeitado')  return { icon:'🔴', cls:'cel-atraso', titulo:'Comprovante ignorado — verifique o WhatsApp', id:pg.id };
    if (R._anualMesPassou(b, m))   return { icon:'🔴', cls:'cel-atraso', titulo:'Inadimplente' };
    return { icon:'—', cls:'cel-futuro', titulo:'Ainda não venceu' };
  },
  // Entra na tela e liga o polling — refaz a busca em /api/boloes-parcelados periodicamente pra
  // planilha refletir sozinha comprovantes enviados por outro aparelho, sem precisar recarregar.
  _anualDet() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    R._renderAnualDet();
    R._anualPoll();
  },
  async _anualPoll() {
    if (S.tela !== 'anualDet') return; // parou sozinho ao sair da tela
    try {
      const dados = await _api.get('/api/boloes-parcelados');
      if (Array.isArray(dados) && S.tela === 'anualDet') {
        // Só re-renderiza (e recria os gráficos) se os dados desse bolão realmente mudaram —
        // senão o Chart.js reanima as barras do zero a cada poll mesmo sem nada novo, dando a
        // impressão de gráfico "balançando" sozinho a cada 4s.
        const antes = JSON.stringify(DB.boloesParcelados.get(S.anualAtual));
        S.cache.boloesParcelados = normalizarBoloesParcelados(dados);
        const depois = JSON.stringify(DB.boloesParcelados.get(S.anualAtual));
        if (depois !== antes) R._renderAnualDet();
      }
    } catch {}
    if (S.tela === 'anualDet') setTimeout(() => R._anualPoll(), 4000);
  },
  _renderAnualDet() {
    const b = DB.boloesParcelados.get(S.anualAtual);
    if (!b) { R.ir('anual'); return; }
    $('h-title').textContent = b.nome;
    const parts = b.participantes||[];
    const meses = Array.from({length:b.duracao_meses}, (_,i)=>i+1);

    const qtd = { quitado:0, em_dia:0, inadimplente:0 };
    const inadimplentes = [];
    parts.forEach(p => {
      const status = R._anualStatusParticipante(b,p);
      qtd[status]++;
      if (status==='inadimplente') inadimplentes.push({ nome:p.nome, meses:R._anualMesesEmAtraso(b,p) });
    });
    const arrecadado = parts.reduce((s,p)=>s+(p.pagamentos||[]).filter(pg=>pg.status==='confirmado').reduce((s2,pg)=>s2+(pg.valor||0),0), 0);
    const esperado = b.valor_total * parts.length;

    // Arrecadado/esperado só do mês corrente — só faz sentido se o bolão está rodando no ano de
    // hoje; quem já quitou não deve mais mensalidade nenhuma, não entra no "esperado do mês".
    const agora = new Date();
    const mesAtual = agora.getMonth()+1;
    const mesEmVigor = b.ano === agora.getFullYear() && mesAtual >= 1 && mesAtual <= b.duracao_meses;
    const naoQuitados = parts.filter(p=>!p.quitado).length;
    const esperadoMes = mesEmVigor ? b.valor_mensal * naoQuitados : 0;
    const arrecadadoMes = mesEmVigor ? parts.reduce((s,p)=>s+(p.pagamentos||[]).filter(pg=>pg.mes===mesAtual && pg.status==='confirmado').reduce((s2,pg)=>s2+(pg.valor||0),0), 0) : 0;

    $('view-anualDet').innerHTML = `
      <div class="stat-row">
        <div class="stat-card"><div class="sv">${fmt$(arrecadado)}</div><div class="sl">Arrecadado (total)</div></div>
        <div class="stat-card"><div class="sv">${fmt$(esperado)}</div><div class="sl">Esperado (total)</div></div>
        <div class="stat-card"><div class="sv">${parts.length}</div><div class="sl">Participantes</div></div>
      </div>
      ${mesEmVigor ? `
      <div class="stat-row mt8">
        <div class="stat-card"><div class="sv">${fmt$(arrecadadoMes)}</div><div class="sl">Arrecadado (${MESES_NOMES[mesAtual-1]})</div></div>
        <div class="stat-card"><div class="sv">${fmt$(esperadoMes)}</div><div class="sl">Esperado (${MESES_NOMES[mesAtual-1]})</div></div>
      </div>` : ''}
      <div class="fxb mb8 mt12" style="flex-wrap:wrap;gap:6px">
        <div class="sectt">Planilha (${b.ano})</div>
        <div class="fx" style="gap:6px">
          <button class="btn btn-o btn-sm" onclick="R._mImportarGrupoAnual()">📱 Importar do grupo</button>
          <button class="btn btn-p btn-sm" onclick="R._mNovoParticipanteAnual()">+ Participante</button>
        </div>
      </div>
      <div class="anual-tbl-wrap">
        <table class="anual-tbl">
          <thead><tr><th>Participante</th>${meses.map(m=>`<th>${MESES_NOMES[m-1].slice(0,3)}</th>`).join('')}<th></th></tr></thead>
          <tbody>
            ${!parts.length ? `<tr><td colspan="${meses.length+2}" class="tc muted" style="padding:20px 0">Nenhum participante cadastrado.</td></tr>` : parts.map(p => `
              <tr>
                <td>${p.nome}<div class="txs muted">${p.fone}</div></td>
                ${meses.map(m => { const c=R._anualCelula(b,p,m); return `<td class="${c.cls}" title="${c.titulo}" ${c.id?`onclick="R._verPagAnual('${c.id}')"`:''}>${c.icon}</td>`; }).join('')}
                <td style="white-space:nowrap"><button class="btn-ico" title="Marcar meses pagos" onclick="R._mMarcarLoteAnual('${p.id}')">📅</button><button class="btn-ico" title="Remover" onclick="R._delParticipanteAnual('${p.id}')">✕</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="sectt mb8 mt16">Situação dos participantes</div>
      <div class="chart-w"><canvas id="chart-anual-status"></canvas></div>
      ${inadimplentes.length ? `
      <div class="card mb16" style="border-color:var(--red)">
        <div class="sectt mb8" style="color:var(--red)">⚠️ Inadimplentes (${inadimplentes.length})</div>
        ${inadimplentes.map(i=>`
          <div class="lr">
            <div style="font-weight:600">${i.nome}</div>
            <div class="txs" style="color:var(--red);text-align:right">${i.meses.map(m=>MESES_NOMES[m-1].slice(0,3)).join(', ')}</div>
          </div>`).join('')}
      </div>` : ''}
      <div class="sectt mb8 mt16">Arrecadado × Esperado</div>
      <div class="chart-w"><canvas id="chart-anual-prog"></canvas></div>`;

    setTimeout(() => {
      ['anualStatus','anualProgresso'].forEach(k=>{ S.charts[k]?.destroy?.(); delete S.charts[k]; });
      const ctx1 = $('chart-anual-status');
      if (ctx1) S.charts.anualStatus = new Chart(ctx1, { type:'bar', data:{
        labels:['Quitados','Em dia','Inadimplentes'],
        datasets:[{ data:[qtd.quitado, qtd.em_dia, qtd.inadimplente], backgroundColor:['#f59e0bcc','#10b981cc','#ef4444cc'], borderRadius:6 }]
      }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ x:{ticks:{color:'#94a3b8'},grid:{display:false}}, y:{ticks:{color:'#94a3b8',stepSize:1},grid:{color:'#334155'}} } } });
      const ctx2 = $('chart-anual-prog');
      const labels2 = mesEmVigor ? ['Arrecadado (total)','Esperado (total)',`Arrecadado (${MESES_NOMES[mesAtual-1].slice(0,3)})`,`Esperado (${MESES_NOMES[mesAtual-1].slice(0,3)})`] : ['Arrecadado','Esperado'];
      const dados2  = mesEmVigor ? [arrecadado, esperado, arrecadadoMes, esperadoMes] : [arrecadado, esperado];
      const cores2  = mesEmVigor ? ['#10b981cc','#334155cc','#10b981cc','#334155cc'] : ['#10b981cc','#334155cc'];
      if (ctx2) S.charts.anualProgresso = new Chart(ctx2, { type:'bar', data:{
        labels:labels2,
        datasets:[{ data:dados2, backgroundColor:cores2, borderRadius:6 }]
      }, options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ x:{ticks:{color:'#94a3b8',font:{size:9}},grid:{display:false}}, y:{ticks:{color:'#94a3b8',callback:v=>'R$'+(v>=1000?(v/1000).toFixed(0)+'k':v)},grid:{color:'#334155'}} } } });
    }, 60);
  },
  _mNovoParticipanteAnual() {
    const dl = DB.usuarios.list().map(u=>`<option value="${u.nome}">`).join('');
    MODAL.open(`
      <div class="m-title">👤 Novo participante</div>
      <div class="fg"><label>Nome completo</label><input id="ap-nome" list="dl-ap-anual" placeholder="Nome completo" oninput="R._anAutoFone(this.value)">
      <datalist id="dl-ap-anual">${dl}</datalist></div>
      <div class="fg"><label>Telefone (DDD)</label><input id="ap-fone" type="tel" placeholder="(61) 99999-9999"></div>
      <button class="btn btn-p btn-f mt8" onclick="R._salvarParticipanteAnual()">Adicionar</button>
    `);
  },
  _anAutoFone(nome) {
    const u = DB.usuarios.find((nome||'').trim());
    if (u && u.fone) $('ap-fone').value = u.fone;
  },
  _salvarParticipanteAnual() {
    const nome = $('ap-nome').value.trim();
    const foneDigitado = $('ap-fone').value.trim();
    if (!nome) { TOAST.show('Informe o nome.', 'err'); return; }
    if (foneDigitado.replace(/\D/g,'').length < 10) { TOAST.show('Informe um telefone válido com DDD.', 'err'); return; }
    DB.boloesParcelados.salvarParticipante({ id:uid(), bolao_parcelado_id:S.anualAtual, nome, fone:normalizarFone(foneDigitado) });
    MODAL.close();
    R._renderAnualDet();
    TOAST.show('👤 Participante adicionado!', 'ok');
  },
  _delParticipanteAnual(id) {
    if (!confirm('Remover esse participante e todo o histórico de pagamentos dele?')) return;
    DB.boloesParcelados.delParticipante(S.anualAtual, id);
    R._renderAnualDet();
  },

  // Importa participantes já cadastrados no "Apostadores do grupo" (grupo_membros) — evita
  // cadastrar manual um por um quando o bolão já reaproveita a galera de um grupo existente.
  _mImportarGrupoAnual() {
    const grupos = DB.grupos.list();
    MODAL.open(`
      <div class="m-title">📱 Importar participantes do grupo</div>
      ${!grupos.length ? '<p class="txs muted">Nenhum grupo cadastrado ainda.</p>' : `
      <div class="fg"><label>Grupo</label>
        <select id="ig-grupo" onchange="R._carregarRosterGrupoAnual(this.value)">
          <option value="">Selecionar...</option>
          ${grupos.map(g=>`<option value="${g.id}">${g.nome}</option>`).join('')}
        </select>
      </div>
      <div id="ig-lista"></div>`}
    `);
  },
  _carregarRosterGrupoAnual(grupoId) {
    const el = $('ig-lista'); if (!el) return;
    if (!grupoId) { el.innerHTML=''; return; }
    const b = DB.boloesParcelados.get(S.anualAtual);
    const jaTem = new Set((b.participantes||[]).map(p=>p.fone));
    const roster = DB.grupoMembros.list(grupoId).filter(m=>m.nome && m.nome.trim().toLowerCase()!=='sem nome');
    if (!roster.length) { el.innerHTML = '<p class="txs muted mt8">Nenhum apostador identificado nesse grupo ainda.</p>'; return; }
    el.innerHTML = `
      <p class="txs muted mt8 mb4">${roster.length} apostador${roster.length>1?'es':''} — desmarque quem não participa deste bolão:</p>
      <div style="max-height:40vh;overflow-y:auto">
        ${roster.map(m=>{
          const jaEsta = jaTem.has(normalizarFone(m.fone||''));
          return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;${jaEsta?'opacity:.45':''}">
            <input type="checkbox" class="igm" data-nome="${m.nome.replace(/"/g,'&quot;')}" data-fone="${m.fone||''}" ${jaEsta?'disabled':'checked'}>
            <span>${m.nome}${jaEsta?' <span class="txs muted">(já participa)</span>':''}</span>
          </label>`;
        }).join('')}
      </div>
      <button class="btn btn-p btn-f mt12" onclick="R._importarSelecionadosAnual()">Importar selecionados</button>`;
  },
  _importarSelecionadosAnual() {
    const checks = Array.from(document.querySelectorAll('.igm:checked'));
    if (!checks.length) { TOAST.show('Selecione ao menos um apostador.', 'err'); return; }
    let semFone = 0;
    checks.forEach(c => {
      const nome = c.dataset.nome, fone = c.dataset.fone;
      if (!fone || fone.replace(/\D/g,'').length < 10) { semFone++; return; }
      DB.boloesParcelados.salvarParticipante({ id:uid(), bolao_parcelado_id:S.anualAtual, nome, fone:normalizarFone(fone) });
    });
    const importados = checks.length - semFone;
    MODAL.close();
    R._renderAnualDet();
    TOAST.show(`👤 ${importados} participante${importados!==1?'s':''} importado${importados!==1?'s':''}!${semFone?` (${semFone} sem telefone válido, ignorado${semFone>1?'s':''})`:''}`, importados?'ok':'err');
  },

  // Marca vários meses como pagos de uma vez — pro bolão que já estava em andamento antes de
  // entrar no app (pagamentos presenciais/anteriores), sem precisar clicar mês a mês.
  _mMarcarLoteAnual(participanteId) {
    const b = DB.boloesParcelados.get(S.anualAtual);
    const p = (b.participantes||[]).find(x=>x.id===participanteId);
    if (!p) return;
    const meses = Array.from({length:b.duracao_meses}, (_,i)=>i+1);
    MODAL.open(`
      <div class="m-title">📅 Marcar meses pagos — ${p.nome}</div>
      <p class="txs muted mb8">Selecione os meses já pagos (ex: presencialmente, antes de usar o app).</p>
      <div class="fg" style="display:flex;flex-wrap:wrap;gap:10px">
        ${meses.map(m=>`<label style="display:flex;align-items:center;gap:4px">
          <input type="checkbox" class="mlm" value="${m}" ${(p.pagamentos||[]).some(pg=>pg.mes===m&&pg.status==='confirmado')?'checked':''}>
          ${MESES_NOMES[m-1].slice(0,3)}</label>`).join('')}
      </div>
      <button class="btn btn-p btn-f mt8" onclick="R._salvarLoteAnual('${participanteId}')">Marcar como pagos</button>`);
  },
  _salvarLoteAnual(participanteId) {
    const b = DB.boloesParcelados.get(S.anualAtual);
    const meses = Array.from(document.querySelectorAll('.mlm:checked')).map(el=>+el.value);
    if (!meses.length) { TOAST.show('Selecione ao menos um mês.', 'err'); return; }
    DB.boloesParcelados.marcarPagoLote(participanteId, meses, b.valor_mensal);
    MODAL.close();
    R._renderAnualDet();
    TOAST.show(`✓ ${meses.length} mês${meses.length>1?'es':''} marcado${meses.length>1?'s':''} como pago${meses.length>1?'s':''}!`, 'ok');
  },
  _verPagAnual(id) {
    const b = DB.boloesParcelados.get(S.anualAtual);
    let pg=null, part=null;
    for (const p of (b?.participantes||[])) { const f=(p.pagamentos||[]).find(x=>x.id===id); if (f) { pg=f; part=p; break; } }
    if (!pg) return;
    const statusTxt = { pendente:'comprovante recebido — pendente de confirmação', confirmado:'pago', rejeitado:'comprovante ignorado' }[pg.status] || pg.status;
    MODAL.open(`
      <div class="m-title">📎 ${part.nome} — ${MESES_NOMES[pg.mes-1]}</div>
      ${pg.comprovante ? `<img src="${pg.comprovante}" style="width:100%;border-radius:8px;margin-bottom:10px">` : '<p class="txs muted">Sem imagem anexada.</p>'}
      <div class="txs muted mb8">${fmt$(pg.valor)} · status: ${statusTxt}</div>
      ${pg.status==='rejeitado' && pg.motivo_rejeicao ? `<div class="txs mb8" style="color:var(--red)">Motivo enviado ao apostador: "${pg.motivo_rejeicao}"</div>` : ''}
      ${pg.status!=='confirmado' ? `<button class="btn btn-p btn-f mb8" onclick="R._confirmarPagAnual('${id}','confirmado')">✓ Comprovante correto — marcar como pago</button>` : ''}
      ${pg.status!=='rejeitado' ? `<button class="btn btn-d btn-f mb8" onclick="R._mIgnorarPagAnual('${id}')">🚫 Comprovante ignorado</button>` : ''}
      ${pg.status!=='pendente' ? `<button class="btn btn-o btn-f" onclick="R._confirmarPagAnual('${id}','pendente')">↩️ Reverter para pendente</button>` : ''}
    `);
  },
  // Comprovante ignorado exige uma justificativa curta — enviada automaticamente pro WhatsApp do
  // apostador (backend monta a mensagem final com o texto padrão de "regularize e reenvie").
  _mIgnorarPagAnual(id) {
    MODAL.open(`
      <div class="m-title">🚫 Comprovante ignorado</div>
      <p class="txs muted mb8">Explique rapidamente o motivo — o apostador recebe essa mensagem automaticamente no WhatsApp dele.</p>
      <div class="fg"><textarea id="ig-motivo" maxlength="200" placeholder="Ex: comprovante ilegível, valor errado, mês não bate..."></textarea></div>
      <button class="btn btn-d btn-f" onclick="R._confirmarIgnorarPagAnual('${id}')">Enviar e avisar no WhatsApp</button>
    `);
  },
  _confirmarIgnorarPagAnual(id) {
    const motivo = $('ig-motivo')?.value?.trim() || '';
    DB.boloesParcelados.confirmarPagamento(id, 'rejeitado', motivo);
    MODAL.close();
    R._renderAnualDet();
    TOAST.show('🚫 Comprovante ignorado — apostador avisado no WhatsApp.', 'err');
  },
  _confirmarPagAnual(id, status) {
    DB.boloesParcelados.confirmarPagamento(id, status);
    MODAL.close();
    R._renderAnualDet();
    const msgs = { confirmado:'✓ Pagamento confirmado!', pendente:'↩️ Revertido para pendente.' };
    TOAST.show(msgs[status], 'ok');
  },

  async _importarWA(grupoId, jid) {
    MODAL.open(`<div class="m-title">📱 Importar do WhatsApp</div><div class="loading mt16"><div class="spinner"></div></div><p class="tc muted mt8">Buscando participantes...</p>`);
    try {
      const r = await fetch(API_URL + `/api/wpp/participantes/${encodeURIComponent(jid)}`);
      const d = await r.json();
      if (!d.ok) {
        MODAL.open(`<div class="m-title">❌ Erro</div><p class="tc muted">${d.error}</p><button class="btn btn-p btn-f mt12" onclick="MODAL.close()">Fechar</button>`);
        return;
      }
      const parts = d.participantes;
      MODAL.open(`
        <div class="m-title">📱 ${d.nome} — ${parts.length} participantes</div>
        <p class="muted txs mb12">Preencha o nome de cada participante e selecione quem importar:</p>
        <div style="max-height:50vh;overflow-y:auto">
          ${parts.map((p,i)=>`
            <div class="fr mb8" style="align-items:center;gap:8px">
              <input type="checkbox" id="pi-${i}" checked>
              <div style="flex:1">
                <input type="text" id="pn-${i}" placeholder="Nome do apostador"
                       style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text);margin-bottom:4px">
                <input type="tel" id="pf-${i}" value="${p.foneOculto?'':p.fone}" placeholder="Telefone (opcional)"
                       style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text)">
              </div>
            </div>`).join('')}
        </div>
        <button class="btn btn-p btn-f mt12" onclick="R._salvarImportados(${JSON.stringify(parts).replace(/</g,'&lt;').replace(/>/g,'&gt;')})">✅ Importar selecionados</button>
        <button class="btn btn-o btn-f mt8" onclick="MODAL.close()">Cancelar</button>
      `);
    } catch(e) {
      MODAL.open(`<div class="m-title">❌ Erro</div><p class="tc muted">${e.message}</p><button class="btn btn-p btn-f mt12" onclick="MODAL.close()">Fechar</button>`);
    }
  },
  _salvarImportados(parts) {
    let ok=0, dup=0;
    parts.forEach((p,i) => {
      if (!document.getElementById(`pi-${i}`)?.checked) return;
      const nome = document.getElementById(`pn-${i}`)?.value?.trim();
      if (!nome) return;
      if (DB.usuarios.find(nome)) { dup++; return; }
      const fone = document.getElementById(`pf-${i}`)?.value?.trim()||'';
      DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje(), fone });
      ok++;
    });
    MODAL.close();
    alert(`${ok} apostador${ok!==1?'es':''} importado${ok!==1?'s':''}!${dup?` (${dup} já existia${dup!==1?'m':''})`:''}`);
    R._usuarios();
  },

  // ---- IMPORTAR MEMBROS POR COLAGEM (WhatsApp) ----
  // Reconhece linhas como "Nome: +55 61 99999-9999", "Nome +5561999999999",
  // "+55 61 9999-9999" (sem nome) ou "Nome" (sem fone). Ignora vazias, "Você" e emojis soltos.
  // \b do regex não funciona bem com "ê", então checa manualmente o caractere seguinte.
  _ehVoceOuYou(linha) {
    const low = linha.toLowerCase();
    // 'tú' aparece quando o WhatsApp do aparelho está em espanhol (chip espanhol usado pelo bot)
    for (const pref of ['você', 'voce', 'you', 'tú']) {
      if (low.startsWith(pref)) {
        const prox = low.charAt(pref.length);
        if (!prox || !/[a-z]/i.test(prox)) return true;
      }
    }
    return false;
  },
  _parseLinhasWA(texto) {
    const foneRe = /(\+?\d[\d\s\-().]{6,}\d)/;
    const vistos = new Set();
    const out = [];
    (texto||'').split(/\r?\n/).forEach(linhaBruta => {
      const linha = linhaBruta.trim();
      if (!linha) return;
      if (R._ehVoceOuYou(linha)) return;

      const m = linha.match(foneRe);
      let nome = '', fone = '';
      if (m) {
        fone = normalizarFone(m[1]);
        nome = (linha.slice(0, m.index) + linha.slice(m.index + m[1].length))
          .trim().replace(/[:\-–]+$/,'').trim();
        if (!nome) nome = 'Sem nome';
      } else {
        if (!/[a-zA-ZÀ-ÿ]/.test(linha)) return; // emoji/símbolo solto
        nome = linha;
      }
      if (fone) {
        if (vistos.has(fone)) return; // duplicado (mesmo fone)
        vistos.add(fone);
      }
      out.push({ nome, fone });
    });
    return out;
  },
  _mImportarColar(grupoId, textoPrevio, bolaoIdPrevio) {
    const g = DB.grupos.list().find(x=>x.id===grupoId); if (!g) return;
    const boloes = DB.boloes.list().filter(b=>bolaoDoGrupo(b,g));
    if (!boloes.length) {
      MODAL.open(`<div class="m-title">📋 Importar membros</div>
        <p class="muted txs">Nenhum bolão cadastrado para o grupo <strong>${g.nome}</strong>. Crie um bolão vinculado a este grupo primeiro.</p>
        <button class="btn btn-o btn-f mt12" onclick="MODAL.close()">Fechar</button>`);
      return;
    }
    R._colar = { grupoId };
    MODAL.open(`
      <div class="m-title">📋 Importar membros — ${g.nome}</div>
      <div class="fg">
        <label>Bolão de destino</label>
        <select id="imp-bolao">
          ${boloes.map(b=>`<option value="${b.id}" ${b.id===bolaoIdPrevio?'selected':''}>${LOTERIAS[b.loteria]?.emoji||''} ${b.nome} (concurso ${b.concurso||'-'})</option>`).join('')}
        </select>
      </div>
      <div class="fg">
        <label>Cole a lista de membros copiada do WhatsApp</label>
        <textarea id="imp-texto" rows="8" placeholder="Ex:&#10;João Silva: +55 61 99999-9999&#10;Maria +5561988887777&#10;+55 61 97777-6666">${textoPrevio||''}</textarea>
      </div>
      <button class="btn btn-p btn-f mt8" onclick="R._analisarColados()">🔍 Analisar lista</button>
      <button class="btn btn-o btn-f mt8" onclick="MODAL.close()">Cancelar</button>
    `);
  },
  _analisarColados() {
    const bolaoId = $('imp-bolao')?.value;
    const texto = $('imp-texto')?.value || '';
    const parsed = R._parseLinhasWA(texto);
    if (!parsed.length) { alert('Nenhum membro reconhecido no texto colado.'); return; }
    R._colar = { grupoId: R._colar?.grupoId, bolaoId, texto, parsed };
    const bolao = DB.boloes.get(bolaoId);
    MODAL.open(`
      <div class="m-title">📋 ${parsed.length} membro${parsed.length!==1?'s':''} encontrado${parsed.length!==1?'s':''}</div>
      <p class="muted txs mb12">Confira e desmarque quem não deve ser importado para <strong>${bolao?.nome||''}</strong>:</p>
      <div style="max-height:45vh;overflow-y:auto">
        ${parsed.map((p,i)=>`
          <div class="fr mb8" style="align-items:center;gap:8px">
            <input type="checkbox" id="ic-${i}" checked>
            <div style="flex:1">
              <input type="text" id="in-${i}" value="${(p.nome||'').replace(/"/g,'&quot;')}" placeholder="Nome"
                     style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text);margin-bottom:4px">
              <input type="text" id="if-${i}" value="${p.fone||''}" placeholder="Telefone (opcional)"
                     style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text)">
            </div>
          </div>`).join('')}
      </div>
      <button class="btn btn-p btn-f mt12" onclick="R._salvarColados()">✅ Salvar todos</button>
      <button class="btn btn-o btn-f mt8" onclick="R._voltarImportarColar()">◀ Voltar</button>
    `);
  },
  _voltarImportarColar() {
    const c = R._colar||{};
    R._mImportarColar(c.grupoId, c.texto, c.bolaoId);
  },
  _salvarColados() {
    const c = R._colar; if (!c) return;
    const bolao = DB.boloes.get(c.bolaoId);
    if (!bolao) { alert('Bolão não encontrado.'); MODAL.close(); return; }
    const existentes = bolao.membros || [];
    const fonesExistentes = new Set(existentes.map(m=>normalizarFone(m.fone)).filter(Boolean));
    const nomesExistentes = new Set(existentes.map(m=>m.nome.trim().toLowerCase()));
    const novos = [];
    let dup = 0;
    c.parsed.forEach((p,i) => {
      if (!$(`ic-${i}`)?.checked) return;
      const nome = $(`in-${i}`)?.value?.trim();
      if (!nome) return;
      const fone = normalizarFone($(`if-${i}`)?.value || '');
      if (fone && fonesExistentes.has(fone)) { dup++; return; }
      if (!fone && nomesExistentes.has(nome.toLowerCase())) { dup++; return; }
      if (fone) fonesExistentes.add(fone);
      nomesExistentes.add(nome.toLowerCase());
      novos.push({ nome, fone, cotas:1, pago:false });
    });
    if (!novos.length) {
      MODAL.close();
      alert(dup ? `Nenhum membro novo — ${dup} já estava cadastrado no bolão.` : 'Nenhum membro selecionado.');
      return;
    }
    bolao.membros = [...existentes, ...novos];
    DB.boloes.save(bolao);
    MODAL.close();
    alert(`${novos.length} membro${novos.length!==1?'s':''} importado${novos.length!==1?'s':''}!${dup?` (${dup} duplicado${dup!==1?'s':''} ignorado${dup!==1?'s':''})`:''}`);
    R._colar = null;
    R._whatsapp();
  },

  // ---- WHATSAPP ----
  _whatsapp() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='WhatsApp';
    const gs=DB.grupos.list();
    $('view-whatsapp').innerHTML=`
      <div class="sectt mb12">Grupos cadastrados</div>
      <div id="lista-grp">
        ${gs.length?gs.map(g=>{
          const ns=new Set();
          S.cache.boloes.filter(b=>bolaoDoGrupo(b,g)).forEach(b=>(b.membros||[]).forEach(m=>ns.add(m.nome.trim().toLowerCase())));
          const cnt = ns.size || g.membros;
          return `
          <div class="grp-card">
            <div style="flex:1">
              <div class="grp-nome">${g.nome} ${g.jid?'<span class="badge txs" style="background:var(--primary);color:#fff;font-size:.6rem">Bot ✓</span>':''}</div>
              <div class="grp-meta">${cnt} apostador${cnt!==1?'es':''}</div>
            </div>
            <div class="grp-acts">
              <button class="btn btn-o btn-sm" onclick="R._mImportarColar('${g.id}')">📋 Importar membros</button>
              ${g.jid?`<button class="btn btn-o btn-sm" onclick="R._importarWA('${g.id}','${g.jid}')">📱 Importar</button>`:''}
              <button class="btn-ico" onclick="R._mEditGrp('${g.id}')">✏️</button>
              <button class="btn-ico" onclick="R._delGrp('${g.id}')">🗑️</button>
            </div>
          </div>`;
        }).join('')
          :`<div class="empty"><div class="ei">${WPP_SVG(52)}</div><p>Nenhum grupo cadastrado.</p></div>`}
      </div>
      <button class="btn btn-o btn-f mt12 mb16" onclick="R._mNovoGrp()">+ Adicionar Grupo</button>
      <div class="divider"></div>
      <div class="fxb mb8">
        <div class="sectt">Cadastro Automático</div>
        <span id="cad-badge"></span>
      </div>
      <div id="cad-status"></div>
      <div class="ia-aviso mt8 mb16">💡 O bot envia uma mensagem nos grupos e cadastra automaticamente quem responder com o nome.</div>
      <div class="divider"></div>
      <div class="sectt mb8">Cartela do bolão</div>
      <div id="cartela-zone" class="cartela-drop${S.cartela?' has-file':''}"
           ondragover="CARTELA.dragOver(event)" ondragleave="CARTELA.dragLeave(event)" ondrop="CARTELA.drop(event)"
           onclick="$('cartela-inp').click()">
        <input type="file" id="cartela-inp" accept="image/*,video/*,.pdf" style="display:none" onchange="CARTELA.load(this.files[0])">
        ${S.cartela
          ? `${S.cartela.tipo==='img'
               ? `<img src="${S.cartela.url}" class="cartela-prev">`
               : S.cartela.tipo==='video'
               ? `<video src="${S.cartela.url}" class="cartela-prev" controls></video>`
               : `<div class="cartela-pdf-ico">📄</div>`}
             <div class="cartela-nome">${S.cartela.nome}</div>
             <div class="cartela-acts" onclick="event.stopPropagation()">
               <button class="btn btn-o btn-sm" onclick="CARTELA.download()">⬇ Baixar</button>
               <button class="btn btn-d btn-sm" onclick="CARTELA.clear()">✕ Remover</button>
             </div>`
          : `<div class="cartela-ico">📎</div>
             <div class="cartela-msg">Arraste a cartela aqui<br><span class="txs muted">ou toque para selecionar</span></div>
             <div class="txs muted mt8">Imagem · Vídeo · PDF</div>`}
      </div>
      <div class="divider"></div>
      <div class="sectt mb12">Criar mensagem</div>
      <div class="fg">
        <label>Loteria</label>
        <div class="wlt-wrap">
          <select id="wlt" onchange="WPP.aoTrocarLt(this.value)">
            ${Object.values(LOTERIAS).map(lt=>`<option value="${lt.id}">${lt.emoji} ${lt.nome}</option>`).join('')}
          </select>
          <span id="wlt-spin" class="wlt-loading" hidden>⏳</span>
        </div>
      </div>
      <div class="fr">
        <div class="fg">
          <label>Prêmio estimado (R$) <span id="wprx-badge" class="txs" style="color:var(--primary)"></span></label>
          <input id="wpremio" type="text" placeholder="Buscando da Caixa..." oninput="WPP.update()">
        </div>
        <div class="fg">
          <label>Data do próximo sorteio</label>
          <input id="wdata" type="date" oninput="WPP.update()">
        </div>
        <div class="fg">
          <label>Cotas disponíveis</label>
          <input id="wcotas" type="number" placeholder="10" oninput="WPP.update()">
        </div>
      </div>
      <div class="fg mt8">
        <label>Frase de incentivo</label>
        <select id="wfrase-modo" onchange="WPP._onModoFrase(this.value)" style="margin-bottom:8px">
          <option value="auto">🔄 Automático (muda a cada envio)</option>
          <option value="custom">✏️ Personalizado</option>
        </select>
        <textarea id="wfrase-txt" rows="2" placeholder="Digite sua frase de incentivo..."
                  style="display:none" oninput="WPP.update()"></textarea>
      </div>
      <div class="sectt mb8">Preview da mensagem</div>
      <div class="wpp-prev" id="wprev">Selecione a loteria para gerar a mensagem...</div>
      <button class="btn btn-p btn-f mt8" onclick="WPP.copy()">📋 Copiar mensagem</button>

      <div class="divider"></div>
      <div class="sectt mb8" style="display:flex;align-items:center;justify-content:space-between">
        Destinatários
        <span id="bot-badge" class="badge txs" style="font-size:.65rem">${BOT._badgeHtml(BOT._status)}</span>
      </div>
      <div class="dest-tabs mb12">
        <button class="dtab on" onclick="WPP.setDest('todos',this)">🌐 Todos</button>
        <button class="dtab" onclick="WPP.setDest('grupos',this)">📋 Grupos</button>
        <button class="dtab" onclick="WPP.setDest('pessoa',this)">👤 Participantes</button>
      </div>
      <div id="dest-body"></div>
      <button class="btn btn-g btn-f mt8" onclick="WPP.send()">📤 Enviar</button>
      <div class="ia-aviso mt12">💡 ${S.cartela?'A cartela será baixada automaticamente para você anexar.':'Carregue a cartela acima para enviá-la junto.'}</div>`;
    WPP.aoTrocarLt($('wlt')?.value || 'megasena');
    WPP.setDest(WPP._dest, document.querySelector('.dtab.on'));
    WPP._atualizarCadastroStatus(); // carrega status do cadastro automático
  },

  _mNovoGrp() {
    MODAL.open(`<div class="m-title">➕ Novo Grupo</div>
      <div class="fg"><label>Nome do grupo</label><input id="mgn" type="text" placeholder="Grupo da Firma"></div>
      <div class="fg"><label>Link de convite WhatsApp</label><input id="mgl" type="text" placeholder="https://chat.whatsapp.com/..."></div>
      <div class="fg"><label>Nº de membros</label><input id="mgm" type="number" placeholder="45"></div>
      <button class="btn btn-p btn-f" onclick="R._saveGrp()">Salvar</button>`);
  },
  _mEditGrp(id) {
    const g=DB.grupos.list().find(x=>x.id===id); if(!g) return;
    MODAL.open(`<div class="m-title">✏️ Editar Grupo</div>
      <div class="fg"><label>Nome</label><input id="mgn" value="${g.nome}"></div>
      <div class="fg"><label>Link</label><input id="mgl" value="${g.link||''}"></div>
      <div class="fg"><label>Membros</label><input id="mgm" type="number" value="${g.membros}"></div>
      <input type="hidden" id="mgid" value="${g.id}">
      <button class="btn btn-p btn-f" onclick="R._saveGrp()">Salvar</button>`);
  },
  _saveGrp() {
    const id=$('mgid')?.value||uid(), nome=$('mgn').value.trim();
    if(!nome){alert('Informe o nome.');return;}
    DB.grupos.save({id,nome,link:$('mgl').value.trim(),membros:parseInt($('mgm').value)||0,ativo:true});
    MODAL.close(); R._whatsapp();
  },
  _delGrp(id){
    const g = DB.grupos.list().find(x=>x.id===id); if(!g) return;
    const vinculados = DB.boloes.list().filter(b=>bolaoDoGrupo(b,g));
    const aviso = vinculados.length
      ? `Este grupo tem ${vinculados.length===1?'1 bolão':`${vinculados.length} bolões`} vinculado${vinculados.length!==1?'s':''}: ${vinculados.map(b=>b.nome).join(', ')}.\n\nOs bolões continuam existindo, mas perdem o vínculo com o grupo. Remover mesmo assim?`
      : 'Remover grupo?';
    if(!confirm(aviso))return;
    DB.grupos.del(id); R._whatsapp();
  },

  // ---- STATS ----
  _stats() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Estatísticas';
    if(!S.statsF) S.statsF = { periodo:'30d', vizPor:'cliente', de:'', ate:'' };
    const f = S.statsF;
    const hoje = new Date().toISOString().split('T')[0];
    $('view-stats').innerHTML=`
      <div class="sf-box">
        <div class="sectt mb12">Filtros</div>

        <div class="fg">
          <label>Período</label>
          <div class="pbtns">
            <button class="pbtn${f.periodo==='7d'?' on':''}"    onclick="R._sfPeriodo('7d',this)">7 dias</button>
            <button class="pbtn${f.periodo==='15d'?' on':''}"   onclick="R._sfPeriodo('15d',this)">15 dias</button>
            <button class="pbtn${f.periodo==='30d'?' on':''}"   onclick="R._sfPeriodo('30d',this)">30 dias</button>
            <button class="pbtn${f.periodo==='tudo'?' on':''}"  onclick="R._sfPeriodo('tudo',this)">Tudo</button>
            <button class="pbtn${f.periodo==='custom'?' on':''}" onclick="R._sfPeriodo('custom',this)">Personalizado</button>
          </div>
        </div>

        <div id="sf-custom" class="fr" ${f.periodo==='custom'?'':'style="display:none"'}>
          <div class="fg"><label>De</label><input type="date" id="sf-de" value="${f.de||''}" onchange="S.statsF.de=this.value"></div>
          <div class="fg"><label>Até</label><input type="date" id="sf-ate" value="${f.ate||hoje}" onchange="S.statsF.ate=this.value"></div>
        </div>

        <div class="fg mt8">
          <label>Visualizar por</label>
          <div class="pbtns">
            <button class="pbtn${f.vizPor==='cliente'?' on':''}" onclick="R._sfVizPor('cliente',this)">👤 Por cliente</button>
            <button class="pbtn${f.vizPor==='grupo'?' on':''}"   onclick="R._sfVizPor('grupo',this)">${WPP_SVG(15)} Por grupo</button>
            <button class="pbtn${f.vizPor==='loteria'?' on':''}" onclick="R._sfVizPor('loteria',this)">🎰 Por loteria</button>
          </div>
        </div>

        <button class="btn btn-p btn-f mt12" onclick="R._sfRender()">🔍 Ver estatísticas</button>
      </div>
      <div id="sf-res"></div>`;
  },

  _sfPeriodo(p, btn) {
    document.querySelectorAll('.pbtn[onclick*="_sfPeriodo"]').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    S.statsF.periodo = p;
    const el = $('sf-custom');
    if(el) el.style.display = p==='custom' ? 'grid' : 'none';
  },

  _sfVizPor(v, btn) {
    document.querySelectorAll('.pbtn[onclick*="_sfVizPor"]').forEach(b=>b.classList.remove('on'));
    btn.classList.add('on');
    S.statsF.vizPor = v;
  },

  _sfRender() {
    const f = S.statsF;
    const hoje = new Date(); hoje.setHours(23,59,59,999);
    let de = new Date(0), ate = new Date(hoje);
    switch(f.periodo) {
      case '7d':   de=new Date(); de.setDate(de.getDate()-7);  break;
      case '15d':  de=new Date(); de.setDate(de.getDate()-15); break;
      case '30d':  de=new Date(); de.setDate(de.getDate()-30); break;
      case 'tudo': de=new Date(0); break;
      case 'custom':
        if($('sf-de')?.value)  { S.statsF.de=$('sf-de').value;  de=new Date($('sf-de').value); }
        if($('sf-ate')?.value) { S.statsF.ate=$('sf-ate').value; ate=new Date($('sf-ate').value+'T23:59:59'); }
        break;
    }

    const parseDt = s => { const p=s?.split('/'); return p?.length===3?new Date(+p[2],+p[1]-1,+p[0]):null; };
    const vs = DB.vendas.list().filter(v=>{ const d=parseDt(v.data); return d&&d>=de&&d<=ate; });
    const el = $('sf-res');

    if(!vs.length) {
      el.innerHTML='<div class="divider"></div><div class="empty"><div class="ei">📊</div><p>Nenhuma venda no período selecionado.</p></div>';
      return;
    }

    Object.values(S.charts).forEach(c=>c?.destroy?.()); S.charts={};

    const total=vs.reduce((s,v)=>s+(v.valor||0),0);
    const tmedio=total/vs.length;
    const nCli=new Set(vs.map(v=>v.membro)).size;
    const labels = {'7d':'últimos 7 dias','15d':'últimos 15 dias','30d':'últimos 30 dias','tudo':'todo o período','custom':'período selecionado'};
    const pLabel = labels[f.periodo]||'';

    // Dados para o gráfico + ranking conforme visão
    let chartLabels=[], chartData=[], chartColors=[], rankHtml='';

    if(f.vizPor==='cliente') {
      const rm={};
      vs.forEach(v=>{if(!rm[v.membro])rm[v.membro]={t:0,c:0}; rm[v.membro].t+=v.valor||0; rm[v.membro].c++;});
      const rank=Object.entries(rm).sort((a,b)=>b[1].t-a[1].t);
      chartLabels=rank.slice(0,8).map(([n])=>n.split(' ')[0]);
      chartData=rank.slice(0,8).map(([,d])=>d.t);
      chartColors=rank.slice(0,8).map((_,i)=>`hsl(${160+i*22},60%,45%)`);
      rankHtml=`<div class="sectt mt16 mb8">👤 Todos os clientes</div><div class="card">
        ${rank.map(([nome,d],i)=>`<div class="rank-item">
          <div class="rank-pos ${i===0?'rp-1':i===1?'rp-2':i===2?'rp-3':''}">${i+1}</div>
          <div style="flex:1"><div style="font-weight:500;font-size:.88rem">${nome}</div>
          <div class="txs muted">${d.c} aposta${d.c!==1?'s':''}</div></div>
          <div style="font-weight:700;color:var(--primary)">${fmt$(d.t)}</div>
        </div>`).join('')}</div>`;

    } else if(f.vizPor==='grupo') {
      const bs=DB.boloes.list(), gs=DB.grupos.list(), gm={};
      vs.forEach(v=>{ const b=bs.find(x=>x.id===v.bolao_id); const gn=b?.grupo||'Sem grupo';
        if(!gm[gn])gm[gn]={t:0,c:0,membros:0}; gm[gn].t+=v.valor||0; gm[gn].c++; });
      gs.forEach(g=>{if(gm[g.nome])gm[g.nome].membros=g.membros;});
      const rank=Object.entries(gm).sort((a,b)=>b[1].t-a[1].t);
      chartLabels=rank.map(([n])=>n.split(' ').slice(0,2).join(' '));
      chartData=rank.map(([,d])=>d.t);
      chartColors=rank.map((_,i)=>`hsl(${140+i*30},55%,42%)`);
      rankHtml=`<div class="sectt mt16 mb8">${WPP_SVG(14)} Grupos</div><div class="card">
        ${rank.map(([nome,d],i)=>`<div class="rank-item">
          <div class="rank-pos ${i===0?'rp-1':i===1?'rp-2':i===2?'rp-3':''}">${i+1}</div>
          <div style="flex:1"><div style="font-weight:500;font-size:.88rem">${nome}</div>
          <div class="txs muted">${d.membros?`${d.membros} membros · `:''}${d.c} venda${d.c!==1?'s':''}</div></div>
          <div style="font-weight:700;color:var(--primary)">${fmt$(d.t)}</div>
        </div>`).join('')}</div>`;

    } else {
      const lm={}; Object.keys(LOTERIAS).forEach(k=>lm[k]=0);
      vs.forEach(v=>{lm[v.loteria]=(lm[v.loteria]||0)+(v.valor||0);});
      chartLabels=Object.keys(lm).map(k=>LOTERIAS[k].nome);
      chartData=Object.values(lm);
      chartColors=Object.keys(lm).map(k=>LOTERIAS[k].cor+'cc');
      rankHtml=`<div class="sectt mt16 mb8">🎰 Detalhes por loteria</div><div class="card">
        ${Object.entries(lm).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
          <div class="lr"><div>${LOTERIAS[k].emoji} ${LOTERIAS[k].nome}</div><div style="font-weight:600">${fmt$(v)}</div></div>`
        ).join('')}</div>`;
    }

    el.innerHTML=`
      <div class="divider"></div>
      <div class="stat-row">
        <div class="stat-card"><div class="sv">${fmt$(total)}</div><div class="sl">Total — ${pLabel}</div></div>
        <div class="stat-card"><div class="sv">${vs.length}</div><div class="sl">Vendas</div></div>
        <div class="stat-card"><div class="sv">${nCli}</div><div class="sl">Clientes</div></div>
        <div class="stat-card"><div class="sv">${fmt$(tmedio)}</div><div class="sl">Ticket médio</div></div>
      </div>
      <div class="sectt mb8">Gráfico — ${f.vizPor==='cliente'?'top clientes':f.vizPor==='grupo'?'por grupo':'por loteria'}</div>
      <div class="chart-w"><canvas id="chart-lt"></canvas></div>
      ${rankHtml}`;

    setTimeout(()=>{
      const ctx=$('chart-lt'); if(!ctx) return;
      if(S.charts.lt) S.charts.lt.destroy();
      S.charts.lt=new Chart(ctx,{type:'bar',data:{
        labels:chartLabels,
        datasets:[{label:'R$',data:chartData,backgroundColor:chartColors,borderColor:chartColors.map(c=>c.replace('cc','ff')),borderWidth:2,borderRadius:6}]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{legend:{display:false}},
          scales:{x:{ticks:{color:'#94a3b8',font:{size:9}},grid:{display:false}},
                  y:{ticks:{color:'#94a3b8',callback:v=>'R$'+(v>=1000?(v/1000).toFixed(0)+'k':v)},grid:{color:'#334155'}}}}});
    },60);
  },

  // ---- PAGAMENTOS (por grupo) ----
  _pagamentos() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Comprovantes';
    const ps=DB.pags.list(), bs=DB.boloes.list(), gs=DB.grupos.list();

    // Agrupar pagamentos por grupo → bolão
    const byGrupo={};
    ps.forEach(p=>{
      const b=bs.find(x=>x.id===p.bolao_id);
      const gNome=b?.grupo||'Sem grupo';
      if(!byGrupo[gNome]) byGrupo[gNome]=[];
      byGrupo[gNome].push({...p, _bolao:b});
    });

    let html='';
    if(!ps.length){
      html='<div class="empty"><div class="ei">📄</div><p>Nenhum comprovante enviado ainda.</p></div>';
    } else {
      Object.entries(byGrupo).forEach(([gNome,pags])=>{
        html+=`<div class="sectt mb8 mt16">${WPP_SVG(14)} ${gNome}</div>`;
        pags.forEach(p=>{
          html+=`<div class="pag-c">
            <div class="pag-h">
              <div><div class="pag-nm">${p.membro}</div><div class="txs muted">${p._bolao?.nome||'—'} · Conc. #${p.concurso} · ${p.data||'—'}</div></div>
              <span class="badge b-${p.status}">${p.status}</span>
            </div>
            ${p.img?`<img class="comp-img" src="${p.img}" alt="Comprovante">`:''}
            <div class="fx fxg8 mt8">
              ${p.status!=='aprovado'?`<button class="btn btn-p btn-sm" onclick="R._aPag('${p.id}')">✓ Aprovar</button>`:''}
              ${p.status!=='rejeitado'?`<button class="btn btn-d btn-sm" onclick="R._rPag('${p.id}')">✗ Rejeitar</button>`:''}
            </div>
          </div>`;
        });
      });
    }
    $('view-pagamentos').innerHTML=`<div class="sectt mb4">Comprovantes por grupo</div>${html}`;
  },
  _aPag(id){ DB.pags.setStatus(id,'aprovado'); R._pagamentos(); },
  _rPag(id){ DB.pags.setStatus(id,'rejeitado'); R._pagamentos(); },

  _mComp(bid) {
    const b=DB.boloes.get(bid);
    MODAL.open(`<div class="m-title">📎 Enviar Comprovante</div>
      <div class="fg"><label>Seu nome</label><input id="mpn" type="text" placeholder="Nome completo"></div>
      <div class="fg"><label>Nº do concurso</label><input id="mpc" type="number" value="${b?.concurso||''}"></div>
      <div class="fg"><label>Imagem do comprovante</label><input id="mpf" type="file" accept="image/*" onchange="R._prevComp(this)"></div>
      <img id="mpth" style="display:none;width:100%;border-radius:8px;margin:8px 0">
      <button class="btn btn-p btn-f" onclick="R._envComp('${bid}')">Enviar</button>`);
  },
  _prevComp(input){
    const f=input.files?.[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=e=>{const img=$('mpth');img.src=e.target.result;img.style.display='block';};
    rd.readAsDataURL(f);
  },
  _envComp(bid){
    const nome=$('mpn')?.value?.trim();
    if(!nome){alert('Informe seu nome.');return;}
    DB.pags.save({id:uid(),bolao_id:bid,membro:nome,concurso:parseInt($('mpc')?.value)||0,
      img:$('mpth')?.src||null,data:hoje(),status:'pendente'});
    MODAL.close(); alert('Comprovante enviado! Aguarde confirmação.');
  },

  // ---- MODAL NOVO BOLÃO ----
  _mNovoBolao() {
    const lt=LOTERIAS[S.loteria];
    MODAL.open(`<div class="m-title">➕ Novo Bolão — ${lt.nome}</div>
      <div class="fg"><label>Nome do bolão</label><input id="mbn" type="text" placeholder="Bolão do Escritório"></div>
      <div class="fg"><label>Grupo WhatsApp</label>
        <select id="mbg"><option value="">Selecionar...</option>
        ${DB.grupos.list().map(g=>`<option value="${g.id}">${g.nome}</option>`).join('')}</select>
        ${!DB.grupos.list().length?'<div class="txs muted mt4">Nenhum grupo cadastrado ainda — cadastre um em Admin → WhatsApp antes, ou crie o bolão sem grupo por enquanto.</div>':''}
      </div>
      <div class="fr">
        <div class="fg"><label>Nº do concurso</label><input id="mbc" type="number" placeholder="2780"></div>
        <div class="fg"><label>Total de cotas</label><input id="mbq" type="number" placeholder="10"></div>
      </div>
      <div class="fg"><label>Valor por cota (R$)</label><input id="mbv" type="number" step="0.01" placeholder="30.00"></div>
      <div class="fg"><label>Números (ex: 04,11,23,38,51,59)</label><input id="mbnum" type="text" placeholder="04,11,23,38,51,59"></div>
      <button class="btn btn-p btn-f" onclick="R._saveBolao()">Criar Bolão</button>`);
  },
  _saveBolao() {
    const nome=$('mbn')?.value?.trim(); if(!nome){alert('Informe o nome.');return;}
    const nums=($('mbnum')?.value?.trim()||'').split(',').map(n=>n.trim().padStart(2,'0')).filter(Boolean);
    const grupoId=$('mbg')?.value||null;
    const grupoNome=grupoId?(DB.grupos.list().find(g=>g.id===grupoId)?.nome||''):'';
    DB.boloes.save({id:uid(),loteria:S.loteria,nome,grupo:grupoNome,grupo_id:grupoId,
      cotas_total:parseInt($('mbq')?.value)||10,valor_cota:parseFloat($('mbv')?.value)||0,
      concurso:parseInt($('mbc')?.value)||0,status:'ativo',membros:[],
      numeros:nums.length?[nums]:[],criado:hoje()});
    MODAL.close(); R.ir('boloes');
  },

  // ---- PREMIAÇÃO (cliente) ----
  _premios() {
    if (S.user.role === 'admin') { R.ir('home'); return; } // dev pode abrir (visão do apostador)
    $('h-title').textContent='Premiação';
    const minhas = DB.premiacoes.minhas().sort((a,b)=>(b.criado||'').localeCompare(a.criado||''));
    $('view-premios').innerHTML = `
      <div class="tc mb16">
        <div style="font-size:2.6rem">🏆</div>
        <div style="font-size:1.1rem;font-weight:700;margin-top:6px">${COTAS._esc(S.user.nome)}</div>
        <div class="muted txs mt4">📱 ${COTAS._esc(S.user.fone||'—')}</div>
      </div>
      ${!minhas.length
        ? '<div class="empty"><div class="ei">🏆</div><p>Nenhuma premiação por aqui ainda.</p><p class="txs muted">Quando você ganhar algum prêmio, ele aparece nesta tela.</p></div>'
        : minhas.map(p=>`
        <div class="lote-card">
          <div class="fxb">
            <div><div class="lote-nome">${fmt$(p.valor)}</div><div class="muted txs">${p.mensagem?COTAS._esc(p.mensagem):'Premiação'} · ${p.criado||''}</div></div>
            ${p.confirmada
              ? '<span class="badge txs" style="background:var(--primary);color:#000">✅ Confirmada</span>'
              : `<button class="btn btn-p btn-sm" onclick="R._confirmarPremiacao('${p.id}')">Confirmar 🎉</button>`}
          </div>
        </div>`).join('')}`;
  },
  _confirmarPremiacao(id) {
    DB.premiacoes.confirmar(id);
    if (S.tela === 'premios') R._premios(); // só re-renderiza a tela de premiações se for ela que está aberta
    $('h-premio')?.classList.toggle('h-premio-pend', DB.premiacoes.minhas().some(p=>!p.confirmada));
    TOAST.show('🎉 Premiação confirmada!', 'ok');
  },

  // ---- PERFIL ----
  _perfil() {
    $('h-title').textContent='Minha Conta';
    const u=S.user;
    const isAdm=AUTH.isAdmin();
    const bolAtivos=DB.boloes.list().filter(b=>b.status==='ativo').length;
    $('view-perfil').innerHTML=`
      <div class="tc" style="padding:28px 0">
        <div style="font-size:3rem;margin-bottom:10px">${isAdm?'🛠️':'🎰'}</div>
        <div style="font-size:1.15rem;font-weight:700">${u.nome}</div>
        <div class="muted tsm mt8">${u.role==='admin'?'Administrador':u.role==='dev'?'Desenvolvedor':'Apostador'}</div>
        <span class="badge b-${u.role} mt8" style="display:inline-block">${u.role==='admin'?'Admin':u.role==='dev'?'Dev':'Apostador'}</span>
      </div>
      <div class="divider"></div>
      ${isAdm?`<div class="lr"><span class="muted">Bolões ativos</span><span>${bolAtivos}</span></div>
        <div class="lr"><span class="muted">Usuários registrados</span><span>${DB.usuarios.list().length}</span></div>`
        :`<div class="lr"><span class="muted">Bolões disponíveis</span><span>${bolAtivos}</span></div>`}
      <div class="lr"><span class="muted">Versão</span><span>v${APP.versao}</span></div>
      <div class="mt16"><button class="btn btn-d btn-f" onclick="AUTH.sair()">Sair do app</button></div>`;
  },

  // ---- CONTROLE DEV ----
  _controle() {
    if(S.user?.role!=='dev'){R.ir('home');return;}
    $('h-title').textContent='🔒 Controle Dev';
    const c=DB.ctrl.get();
    $('view-controle').innerHTML=`
      <div class="dev-panel">
        <h3>⚙️ Licença</h3>
        <div class="dev-row"><span class="dev-lbl">Cliente</span><span>${c.cliente}</span></div>
        <div class="dev-row"><span class="dev-lbl">Código</span><span>${c.licenca}</span></div>
        <div class="dev-row"><span class="dev-lbl">Validade</span><span>${c.validade}</span></div>
        <div class="dev-row"><span class="dev-lbl">Status</span><span style="color:${c.bloqueado?'var(--red)':'var(--primary)'}">${c.bloqueado?'🛠️ EM MANUTENÇÃO':'🟢 NO AR'}</span></div>
      </div>
      <div class="dev-panel">
        <h3>🛠️ Modo Manutenção</h3>
        <p class="txs muted mb8">Em manutenção, <strong>só você (dev) opera o app</strong> —
        apostadores e admin veem a tela de manutenção até você colocar o app de volta no ar.
        Você continua com acesso total nos dois modos: dá pra ajustar tudo com o app online ou
        em manutenção.</p>
        <div class="dev-row">
          <span class="dev-lbl">Tela de manutenção (apostadores e admin)</span>
          <label class="sw"><input type="checkbox" ${c.bloqueado?'checked':''} onchange="DEV.block(this.checked)"><span class="sl2"></span></label>
        </div>
        <div class="fg mt12"><label>Mensagem da tela de manutenção</label><textarea id="dev-msg" rows="2">${c.msg||'Sistema temporariamente indisponível. Entre em contato com o suporte.'}</textarea></div>
        <button class="btn btn-p btn-sm" onclick="DEV.saveMsg()">Salvar mensagem</button>
      </div>
      <div class="dev-panel">
        <h3>🧪 Testar como</h3>
        <p class="txs muted mb8">Veja o app exatamente como o <strong>admin</strong> ou um
        <strong>apostador</strong> veem — funciona até em manutenção (a tela de manutenção não
        bloqueia você). Pra voltar, toque na faixa amarela "Testando como..." na parte de baixo.</p>
        <div class="fr">
          <button class="btn btn-o btn-sm" onclick="DEV.testarComo('admin')">🛠️ Como Admin</button>
          <button class="btn btn-o btn-sm" onclick="DEV.testarComo('cliente')">🎰 Como Apostador</button>
        </div>
      </div>
      <div class="dev-panel">
        <h3>🔔 Aviso Instantâneo de Resultado</h3>
        <p class="txs muted mb8">Seu WhatsApp pessoal — recebe o resultado de cada bolão assim que o
        sistema confere, <strong>5 minutos antes</strong> do grupo. Precisa do bot conectado.</p>
        <div class="fg"><label>Seu número (com DDD)</label><input id="dev-fone" placeholder="61999999999" value="${c.admin_fone||''}"></div>
        <button class="btn btn-p btn-sm" onclick="DEV.saveFoneAdmin()">Salvar número</button>
      </div>
      <div class="dev-panel">
        <h3>📋 Editar Licença</h3>
        <div class="fr">
          <div class="fg"><label>Cliente</label><input id="dev-cli" value="${c.cliente}"></div>
          <div class="fg"><label>Validade</label><input id="dev-val" type="date" value="${c.validade}"></div>
        </div>
        <div class="fg"><label>Código de licença</label><input id="dev-lic" value="${c.licenca}"></div>
        <button class="btn btn-p btn-sm" onclick="DEV.saveLic()">Atualizar licença</button>
      </div>
      <div class="dev-panel">
        <h3>📝 Log (últimos acessos)</h3>
        ${(c.logs||[]).slice(0,10).map(l=>`<div class="dev-row"><span class="dev-lbl">${new Date(l.t).toLocaleString('pt-BR')}</span><span class="txs">${l.m}</span></div>`).join('')||'<p class="muted tsm">Sem registros.</p>'}
      </div>
      <div id="bot-wrap" class="mt4"><div class="loading"><div class="spinner"></div> Verificando bot...</div></div>
      <button class="btn btn-d btn-f mt16" onclick="DEV.reset()">⚠️ Limpar todos os dados</button>`;
    BOT.renderPainel().then(h => {
      const el = $('bot-wrap');
      if (el) el.innerHTML = h;
      if (BOT._status === 'aguardando_qr' || BOT._status === 'conectando') BOT._iniciarPolling();
    });
  },
};

// =============================================
// BOT WHATSAPP
// =============================================
const BOT = {
  _status: 'desconectado',
  _qr: null,
  _timer: null,

  async verificarStatus() {
    try {
      const r = await fetch(API_URL + '/api/wpp/status');
      const d = await r.json();
      BOT._status = d.status;
      BOT._qr = d.qr;
      return d;
    } catch { return { status: 'desconectado', qr: null }; }
  },

  async conectar() {
    botStatusEl('🟡 Conectando...');
    await _api.post('/api/wpp/conectar');
    BOT._iniciarPolling();
  },

  async desconectar() {
    if (!confirm('Desconectar o bot do WhatsApp? Precisará escanear o QR novamente para reconectar.')) return;
    await _api.post('/api/wpp/desconectar');
    BOT._status = 'desconectado'; BOT._qr = null;
    BOT._pararPolling();
    R._controle();
  },

  async listarGrupos() {
    try {
      const r = await fetch(API_URL + '/api/wpp/grupos-bot');
      return await r.json();
    } catch { return { ok: false, grupos: [] }; }
  },

  async vincularGrupo(grupoId, jid) {
    const r = await _api.put(`/api/grupos/${grupoId}/jid`, { jid });
    const g = S.cache.grupos.find(x => x.id === grupoId);
    if (g) g.jid = jid;
    // Vincular já dispara a importação automática dos participantes no backend — atualiza o
    // cache local pra refletir sem precisar de outro login/reload.
    if (jid && r) {
      const d = await r.json().catch(()=>null);
      const atualizados = await _api.get('/api/grupo_membros');
      if (Array.isArray(atualizados)) S.cache.grupoMembros = atualizados;
      if (d?.importacao) TOAST.show(`✅ ${d.importacao.novos} novo${d.importacao.novos===1?'':'s'} de ${d.importacao.total} participantes importados do grupo.`, 'ok');
    }
  },

  async enviarGrupos(grupos, mensagem, broadcast=false) {
    const targets = grupos.map(g => g.jid).filter(Boolean);
    if (!targets.length) return { ok: false, error: 'sem_jid' };
    const r = await _api.post('/api/wpp/enviar', { targets, mensagem, broadcast });
    if (!r) return { ok: false, error: 'Falha de conexão.' };
    return await r.json().catch(() => ({ ok: false, error: 'Resposta inválida.' }));
  },

  _iniciarPolling() {
    BOT._pararPolling();
    BOT._timer = setInterval(async () => {
      const d = await BOT.verificarStatus();
      BOT._atualizarUI(d);
      if (d.status === 'conectado') BOT._pararPolling();
    }, 3500);
  },

  _pararPolling() {
    if (BOT._timer) { clearInterval(BOT._timer); BOT._timer = null; }
  },

  _atualizarUI(d) {
    const badge = $('bot-badge');
    if (badge) badge.innerHTML = BOT._badgeHtml(d.status);
    const qrEl = $('bot-qr-img');
    if (qrEl) { if (d.qr) qrEl.src = d.qr; qrEl.hidden = !d.qr; }
    const stEl = $('bot-status-txt');
    if (stEl) stEl.innerHTML = BOT._statusHtml(d.status);
    if ($('bot-btn-conectar')) $('bot-btn-conectar').hidden = (d.status !== 'desconectado');
    if ($('bot-btn-descon'))   $('bot-btn-descon').hidden   = (d.status !== 'conectado');
    if ($('bot-aviso-qr'))     $('bot-aviso-qr').hidden     = (d.status !== 'aguardando_qr');
  },

  _badgeHtml(s) {
    return { conectado: '🟢 Bot ativo', aguardando_qr: '🟡 Scan QR', conectando: '🟡 Conectando...', desconectado: '🔴 Bot off' }[s] || '⚫';
  },
  _statusHtml(s) {
    return {
      conectado:     '<span style="color:var(--primary)">🟢 Conectado</span>',
      aguardando_qr: '<span style="color:#f59e0b">🟡 Escaneie o QR Code abaixo</span>',
      conectando:    '<span style="color:#f59e0b">🟡 Conectando...</span>',
      desconectado:  '<span style="color:var(--red)">🔴 Desconectado</span>',
    }[s] || '<span class="muted">—</span>';
  },

  async renderPainel() {
    const d = await BOT.verificarStatus();
    const gruposDB = DB.grupos.list();
    const botGrps = d.status === 'conectado' ? (await BOT.listarGrupos()).grupos || [] : [];

    const vinculacoes = gruposDB.length ? `
      <div class="dev-panel mt12">
        <h3>🔗 Vincular Grupos</h3>
        <p class="muted txs mb12">Adicione o número do bot em cada grupo WhatsApp, depois selecione abaixo para vincular:</p>
        ${gruposDB.map(gDB => `
          <div class="card mb8" style="padding:12px">
            <div style="font-weight:600;margin-bottom:4px">${gDB.nome}</div>
            <div class="txs muted mb8">${gDB.jid ? `✅ Vinculado` : '⚪ Não vinculado'}</div>
            <select onchange="BOT.vincularGrupo('${gDB.id}',this.value).then(()=>BOT.renderPainel().then(h=>{$('bot-wrap').innerHTML=h;}))"
                    style="width:100%;font-size:.8rem;padding:6px;border-radius:8px;background:var(--card);color:var(--text);border:1px solid var(--border)">
              <option value="">— Selecionar grupo do bot —</option>
              ${botGrps.map(gb => `<option value="${gb.jid}" ${gDB.jid===gb.jid?'selected':''}>${gb.nome} (${gb.membros} membros)</option>`).join('')}
            </select>
          </div>`).join('')}
      </div>` : '';

    return `
      <div class="dev-panel">
        <h3>🤖 WhatsApp Bot</h3>
        <div class="dev-row">
          <span class="dev-lbl">Status</span>
          <span id="bot-status-txt">${BOT._statusHtml(d.status)}</span>
        </div>
        <div id="bot-aviso-qr" class="ia-aviso mt8" ${d.status !== 'aguardando_qr' ? 'hidden' : ''}>
          Abra o WhatsApp no chip → <strong>Dispositivos vinculados</strong> → <strong>Vincular dispositivo</strong> → aponte a câmera para o QR abaixo.
        </div>
        ${d.qr ? `<div class="tc mt12"><img id="bot-qr-img" src="${d.qr}" style="width:220px;height:220px;border-radius:12px;background:#fff;padding:8px"></div>`
                : `<img id="bot-qr-img" src="" hidden>`}
        <div class="fx fxg8 mt12">
          <button id="bot-btn-conectar" class="btn btn-p" style="flex:1" ${d.status !== 'desconectado' ? 'hidden' : ''}
                  onclick="BOT.conectar()">Conectar Bot</button>
          <button id="bot-btn-descon" class="btn btn-d" style="flex:1" ${d.status !== 'conectado' ? 'hidden' : ''}
                  onclick="BOT.desconectar()">Desconectar</button>
        </div>
        ${(d.status==='aguardando_qr'||d.status==='conectando') ? '<p class="muted txs tc mt8">Atualizando a cada 3,5s...</p>' : ''}
      </div>
      ${vinculacoes}`;
  },
};
function botStatusEl(t) { const e=$('bot-status-txt'); if(e) e.innerHTML=t; }

// =============================================
// WHATSAPP MANAGER
// =============================================
const WPP = {
  _msg: '',
  _fraseIdx: 0,
  FRASES: [
    'Participe do nosso bolão e multiplique suas chances!',
    'Não perca essa oportunidade — vagas limitadas!',
    'Sorte grande está chegando. Você vai estar dentro? 🍀',
    'Uma cota, muitas chances de ganhar o prêmio!',
    'Junte-se ao grupo e dispute o prêmio junto conosco!',
    'A sorte favorece quem tenta. Entre já!',
    'Bolão fechado, prêmio perto. Reserve sua cota agora!',
    'Multiplique suas chances jogando com a turma! 🎰',
    'Quem não joga, não ganha. Garanta sua cota!',
    'Venha fazer parte do bolão e torcer junto! 🎉',
  ],

  _getFrase() {
    const modo = $('wfrase-modo')?.value || 'auto';
    if(modo === 'custom') return $('wfrase-txt')?.value?.trim() || WPP.FRASES[0];
    return WPP.FRASES[WPP._fraseIdx % WPP.FRASES.length];
  },
  _rotacionarFrase() {
    if(($('wfrase-modo')?.value || 'auto') !== 'auto') return;
    WPP._fraseIdx = (WPP._fraseIdx + 1) % WPP.FRASES.length;
    WPP.update();
  },
  _onModoFrase(modo) {
    const txt = $('wfrase-txt');
    if(txt) txt.style.display = modo==='custom' ? 'block' : 'none';
    WPP.update();
  },

  async aoTrocarLt(ltId) {
    S.loteria = ltId;
    const spin = $('wlt-spin');
    if(spin) spin.hidden = false;
    const badge = $('wprx-badge');
    if(badge) badge.textContent = 'buscando...';
    const {dados, fonte} = await API.ultimos3(ltId);
    if(spin) spin.hidden = true;
    const r = dados[0];
    if(r) {
      const inp = $('wpremio');
      if(inp) { const v=r.prox||r.premio||0; inp.value = v ? Number(v).toLocaleString('pt-BR') : ''; }
      const inpD = $('wdata');
      if(inpD && r.dataProxConcurso) {
        const pts = r.dataProxConcurso.split('/');
        if(pts.length===3) inpD.value = `${pts[2]}-${pts[1]}-${pts[0]}`;
      }
      if(badge) badge.textContent = fonte==='api' ? '✓ Caixa' : '📦 local';
      if(r.acumulado && badge) badge.textContent += ' · ACUMULADO';
    }
    WPP.update();
  },

  update() {
    const lt=LOTERIAS[$('wlt')?.value]; if(!lt) return;
    const premio=parseFloat(($('wpremio')?.value||'').replace(/\./g,'').replace(',','.'))||0;
    const dataV=$('wdata')?.value;
    const dtFmt=dataV?new Date(dataV+'T12:00').toLocaleDateString('pt-BR'):'—';
    const cotas=parseInt($('wcotas')?.value)||0;
    const pfmt=premio>0?fmtPremio(premio):'—';
    const frase=WPP._getFrase();
    WPP._msg=`🎰 *${lt.nome}* — Bolão Especial! 🍀\n\n💰 Prêmio estimado: *${pfmt}*\n📅 Sorteio: *${dtFmt}*\n${cotas?`🧾 Cotas disponíveis: *${cotas}*\n`:''}\n✅ ${frase}\n📲 Confirme respondendo essa mensagem.\n\n_Jogue com responsabilidade. Sorteios são aleatórios e auditados pela Caixa._\n\n🍀 Lotérica Taguacenter — Seu parceiro de bolões`;
    const p=$('wprev'); if(p) p.textContent=WPP._msg;
  },
  copy() {
    if(!WPP._msg){alert('Preencha os campos.');return;}
    navigator.clipboard?.writeText(WPP._msg).then(()=>{ alert('Mensagem copiada!'); WPP._rotacionarFrase(); }).catch(()=>{
      const ta=document.createElement('textarea'); ta.value=WPP._msg;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); alert('Mensagem copiada!'); WPP._rotacionarFrase();
    });
  },
  // ---- ESTADO DE DESTINO ----
  _dest: 'todos',   // 'todos' | 'grupos' | 'pessoa'
  _selGrupos: [],
  _selParts: [],
  _volantePago: false,
  _passo: 0, _grupos: [],

  // ---- SELETOR DE DESTINATÁRIOS ----
  setDest(tipo, btn) {
    WPP._dest = tipo;
    document.querySelectorAll('.dtab').forEach(b=>b.classList.remove('on'));
    if(btn) btn.classList.add('on');
    const el = $('dest-body'); if(!el) return;

    if(tipo==='todos') {
      const gs = DB.grupos.list().filter(g=>g.ativo);
      el.innerHTML = gs.length
        ? `<div class="ia-aviso">Enviará para <strong>${gs.length} grupo${gs.length!==1?'s':''}</strong>: ${gs.map(g=>g.nome).join(', ')}</div>`
        : `<div class="ia-aviso">Nenhum grupo cadastrado.</div>`;

    } else if(tipo==='grupos') {
      const gs = DB.grupos.list().filter(g=>g.ativo);
      if(!gs.length){ el.innerHTML='<div class="ia-aviso">Nenhum grupo cadastrado.</div>'; return; }
      el.innerHTML = `<div class="dest-lista">${gs.map(g=>`
        <label class="dest-item">
          <input type="checkbox" value="${g.id}" ${WPP._selGrupos.includes(g.id)?'checked':''}
                 onchange="WPP._toggleGrupo('${g.id}',this.checked)">
          <div class="dest-info">
            <div class="dest-nome">${g.nome}</div>
            <div class="dest-sub txs muted">${(()=>{
              const s=new Set();
              S.cache.boloes.filter(b=>bolaoDoGrupo(b,g)).forEach(b=>(b.membros||[]).forEach(m=>s.add(m.nome.trim().toLowerCase())));
              DB.grupoMembros.list(g.id).forEach(m=>{
                const temNome = m.nome && m.nome.trim().toLowerCase()!=='sem nome';
                s.add(temNome ? m.nome.trim().toLowerCase() : (m.fone?'fone:'+m.fone:'gm:'+m.id));
              });
              const c=s.size||g.membros;
              return c+' apostador'+(c!==1?'es':'');
            })()}</div>
          </div>
        </label>`).join('')}</div>`;

    } else { // pessoa
      WPP._renderPessoaTab();
    }
  },

  _toggleGrupo(id, on) {
    WPP._selGrupos = on ? [...WPP._selGrupos, id] : WPP._selGrupos.filter(x=>x!==id);
  },

  // ---- ABA PARTICIPANTE: escolhe 1 grupo, lista vem só de grupo_membros (importação automática) ----
  _grupoSelecionado: null,

  _renderPessoaTab() {
    const el = $('dest-body'); if(!el) return;
    const gs = DB.grupos.list();
    if (!gs.length) {
      el.innerHTML = `<div class="ia-aviso">Nenhum grupo cadastrado ainda — cadastre em Admin → WhatsApp.</div>`;
      return;
    }
    if (!WPP._grupoSelecionado) {
      el.innerHTML = `
        <p class="muted txs mb8">Selecione um grupo pra ver os participantes (importados automaticamente):</p>
        <div class="dest-lista">${gs.map(g=>{
          const n=DB.grupoMembros.list(g.id).length;
          return `<div class="dest-item" style="cursor:pointer" onclick="WPP._selecionarGrupoParticipantes('${g.id}')">
            <div class="dest-info">
              <div class="dest-nome">${g.nome}</div>
              <div class="dest-sub txs muted">${n} apostador${n!==1?'es':''} cadastrado${n!==1?'s':''}</div>
            </div>
          </div>`;
        }).join('')}</div>`;
      return;
    }
    WPP._renderParts('');
  },

  _selecionarGrupoParticipantes(grupoId) {
    WPP._grupoSelecionado = grupoId;
    WPP._selParts = [];
    WPP._renderPessoaTab();
  },

  _renderParts(filtro='') {
    const el = $('dest-body'); if(!el) return;
    const g = DB.grupos.list().find(x=>x.id===WPP._grupoSelecionado);
    if (!g) { WPP._renderPessoaTab(); return; }

    // Renderiza o shell (cabeçalho + input + lista + volante pago) apenas uma vez — evita perda de foco
    if (!document.getElementById('dest-parts-lista')) {
      el.innerHTML = `
        <div class="fxb mb8">
          <button class="btn btn-o btn-sm" onclick="WPP._grupoSelecionado=null;WPP._renderPessoaTab()">◀ Trocar grupo</button>
          <div class="txs muted">${g.nome}</div>
        </div>
        <input id="dest-parts-busca" class="fg" type="text" placeholder="🔍 Buscar participante..."
               style="margin-bottom:10px" oninput="WPP._renderParts(this.value)">
        <div id="dest-parts-lista" class="dest-lista"></div>
        <label class="dest-item mt8" style="border-top:1px solid var(--border);padding-top:12px">
          <input type="checkbox" ${WPP._volantePago?'checked':''} onchange="WPP._volantePago=this.checked">
          <div class="dest-info">
            <div class="dest-nome">✅ Enviar como "Volante Pago"</div>
            <div class="dest-sub txs muted">Troca a mensagem para confirmação de pagamento</div>
          </div>
        </label>`;
    }

    // Atualiza só a lista (sem recriar o input, senão perde o foco a cada letra digitada)
    const todos = DB.grupoMembros.list(g.id);
    const parts = todos.filter(p => !filtro || p.nome.toLowerCase().includes(filtro.toLowerCase()));

    let listaHtml;
    if (!todos.length) {
      listaHtml = `<div style="padding:16px;text-align:center">
        <div class="muted mb8">Nenhum apostador cadastrado neste grupo ainda.</div>
        <button class="btn btn-p btn-sm" onclick="R._importarRosterAuto('${g.id}').then(()=>WPP._renderParts(''))">⬇️ Importar do WhatsApp</button>
      </div>`;
    } else if (!parts.length) {
      listaHtml = `<div class="muted tsm tc" style="padding:16px">Nenhum participante encontrado.</div>`;
    } else {
      listaHtml = parts.map(p=>{
        const semNome = !p.nome || p.nome.trim().toLowerCase()==='sem nome';
        return `<label class="dest-item">
          <input type="checkbox" ${WPP._selParts.find(x=>x.id===p.id)?'checked':''}
                 onchange="WPP._togglePart(${JSON.stringify(p).replace(/"/g,"'")},this.checked)">
          <div class="dest-info">
            <div class="dest-nome">${nomeParaExibir(todos,p)} ${p.wpp_jid?'<span title="Importado automaticamente">🤖</span>':''}
              ${semNome?'<span class="badge txs" style="background:var(--border);color:var(--muted);margin-left:4px">aguardando identificação</span>':''}</div>
            <div class="dest-sub txs muted">${p.fone||'sem telefone — DM vai pelo WhatsApp (LID)'}</div>
          </div>
        </label>`;
      }).join('');
    }
    document.getElementById('dest-parts-lista').innerHTML = listaHtml;
  },

  // ---- CADASTRO AUTOMÁTICO ----
  _cadTimer: null,

  async _atualizarCadastroStatus() {
    const badge = document.getElementById('cad-badge');
    const statusEl = document.getElementById('cad-status');
    if (!badge || !statusEl) return;

    try {
      const r = await fetch(API_URL + '/api/wpp/status-cadastro');
      const d = await r.json();
      const ativo = d.ok && d.ativos?.length > 0;

      if (ativo) {
        badge.innerHTML = `<span style="color:var(--primary);font-weight:700">🟢 ATIVO</span>`;
        statusEl.innerHTML = `
          <div class="card" style="border:1px solid var(--primary)">
            <div class="fxb mb8">
              <div><b>${d.novos} novo${d.novos!==1?'s':''} cadastrado${d.novos!==1?'s':''}</b> desde o início</div>
              <button class="btn btn-d btn-sm" onclick="WPP._encerrarCadastro()">⏹ Encerrar</button>
            </div>
            <div class="txs muted">Grupos ativos: ${d.ativos.map(a=>a.jid.split('@')[0]).join(', ')}</div>
            <div class="ia-aviso mt8">👥 Quem responder no grupo com o nome completo é cadastrado automaticamente!</div>
          </div>`;
        // Polling a cada 8s para atualizar contagem
        clearInterval(WPP._cadTimer);
        WPP._cadTimer = setInterval(() => WPP._atualizarCadastroStatus(), 8000);
      } else {
        clearInterval(WPP._cadTimer);
        badge.innerHTML = `<span class="muted txs">inativo</span>`;
        const gs = DB.grupos.list().filter(g=>g.jid);
        statusEl.innerHTML = gs.length
          ? `<button class="btn btn-p btn-f" onclick="WPP._iniciarCadastroAuto()">📋 Iniciar cadastro automático</button>`
          : `<div class="ia-aviso">⚠️ Vincule o bot aos grupos primeiro (ícone Bot ✓ nos grupos acima).</div>`;
      }
    } catch (e) {
      statusEl.innerHTML = `<button class="btn btn-p btn-f" onclick="WPP._iniciarCadastroAuto()">📋 Iniciar cadastro automático</button>`;
    }
  },

  _iniciarCadastroAuto() {
    const gs = DB.grupos.list().filter(g=>g.jid);
    if (!gs.length) { alert('Nenhum grupo tem o bot vinculado ainda.'); return; }
    const checks = gs.map((g,i)=>`
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
        <input type="checkbox" id="cg-${i}" checked>
        <span>${g.nome}</span>
      </label>`).join('');
    MODAL.open(`
      <div class="m-title">📋 Cadastro Automático</div>
      <p class="muted txs mb12">O bot enviará uma mensagem nos grupos selecionados. Cada pessoa que responder com o nome será cadastrada automaticamente.</p>
      <div class="fg mb8"><label>Grupos</label>${checks}</div>
      <div class="fg">
        <label>Mensagem (opcional)</label>
        <textarea id="cad-msg" rows="4" placeholder="Deixe em branco para usar a mensagem padrão..."
                  style="width:100%;padding:8px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text)"></textarea>
      </div>
      <div class="ia-aviso mt8 mb12">👆 Mensagem padrão: <em>"Responda com seu nome completo para se cadastrar"</em></div>
      <button class="btn btn-p btn-f" onclick="WPP._enviarCadastro(${JSON.stringify(gs.map((_,i)=>i))})">🚀 Enviar e ativar</button>
      <button class="btn btn-o btn-f mt8" onclick="MODAL.close()">Cancelar</button>
    `);
  },

  async _enviarCadastro(indices) {
    const gs = DB.grupos.list().filter(g=>g.jid);
    const selecionados = indices
      .filter(i => document.getElementById(`cg-${i}`)?.checked)
      .map(i => gs[i]).filter(Boolean);
    if (!selecionados.length) { alert('Selecione ao menos um grupo.'); return; }
    const mensagem = document.getElementById('cad-msg')?.value?.trim() || '';
    MODAL.close();
    MODAL.open(`<div class="m-title">🚀 Ativando cadastro...</div><div class="loading mt16"><div class="spinner"></div></div>`);
    const r = await _api.post('/api/wpp/iniciar-cadastro', { grupos: selecionados, mensagem: mensagem || undefined });
    MODAL.close();
    if (!r) { alert('Erro de conexão.'); return; }
    const d = await r.json().catch(() => ({ ok: false }));
    if (!d.ok) { alert('Erro: ' + (d.error||'Tente novamente.')); return; }
    alert(`✅ Cadastro automático ativado!\n\nMensagem enviada para ${selecionados.length} grupo${selecionados.length>1?'s':''}.\nQuem responder com o nome será cadastrado automaticamente.`);
    WPP._atualizarCadastroStatus();
  },

  async _encerrarCadastro() {
    if (!confirm('Encerrar o cadastro automático?\nO bot enviará uma mensagem de encerramento nos grupos.')) return;
    const r = await _api.post('/api/wpp/encerrar-cadastro');
    if (!r || !r.ok) { alert('Erro ao encerrar cadastro. Tente novamente.'); return; }
    clearInterval(WPP._cadTimer);
    WPP._atualizarCadastroStatus();
  },

  _togglePart(p, on) {
    WPP._selParts = on
      ? [...WPP._selParts.filter(x=>x.id!==p.id), p]
      : WPP._selParts.filter(x=>x.id!==p.id);
  },

  _copiarMsg(msg) {
    if(!msg) return;
    navigator.clipboard?.writeText(msg).catch(()=>{
      const ta=document.createElement('textarea'); ta.value=msg;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
    });
  },

  _msgPago(nome, grupoNome) {
    const lt = LOTERIAS[$('wlt')?.value] || {};
    return `✅ *Pagamento confirmado!*\n\nOlá, *${nome}*! 🎉\n\nSeu pagamento foi confirmado para o bolão.\n🎰 Loteria: *${lt.nome||'—'}*\n📋 Grupo: *${grupoNome||'—'}*\n\nSegue em anexo o seu volante do bolão. Boa sorte! 🍀\n\n_Lotérica Taguacenter — Seu parceiro de bolões_ 🍀`;
  },

  // ---- ENVIO ----
  async send() {
    if(!WPP._msg){ alert('Preencha os campos.'); return; }

    if(WPP._dest==='todos') {
      const gs = DB.grupos.list().filter(g=>g.ativo);
      if(!gs.length){ alert('Nenhum grupo cadastrado.'); return; }
      if(BOT._status==='conectado'){ WPP._enviarViaBot(gs, true); return; }
      WPP._grupos=gs; WPP._passo=0; WPP._step(); return;
    }

    if(WPP._dest==='grupos') {
      const todos = DB.grupos.list().filter(g=>g.ativo);
      const gs = WPP._selGrupos.length
        ? todos.filter(g=>WPP._selGrupos.includes(g.id))
        : todos;
      if(!gs.length){ alert('Selecione ao menos um grupo.'); return; }
      if(BOT._status==='conectado'){ WPP._enviarViaBot(gs, false); return; }
      WPP._grupos=gs; WPP._passo=0; WPP._step(); return;
    }

    // Envio por participante — DM automático via bot, usando wpp_jid (nunca exige telefone)
    if(!WPP._selParts.length){ alert('Selecione ao menos um participante.'); return; }
    if(BOT._status!=='conectado'){ alert('Bot não conectado — conecte em Painel Dev → WhatsApp Bot pra mandar DM.'); return; }
    WPP._enviarPartesBot();
  },

  async _enviarViaBot(gs, broadcast=false) {
    const semJid = gs.filter(g => !g.jid);
    const comJid = gs.filter(g =>  g.jid);

    if (!comJid.length) {
      const ok = confirm(
        `⚠️ Nenhum grupo está vinculado ao bot ainda.\n\n` +
        `Configure em: Painel Dev → WhatsApp Bot → Vincular Grupos.\n\n` +
        `Deseja enviar manualmente agora?`
      );
      if (ok) { WPP._grupos=gs; WPP._passo=0; WPP._step(); }
      return;
    }

    const segPorGrupo = broadcast ? 12 : 3; // broadcast usa delay maior (8-15s) contra bloqueio
    MODAL.open(`
      <div class="m-title">🤖 Enviando via Bot</div>
      <div class="loading mt16 mb8"><div class="spinner"></div></div>
      <p class="tc muted">Enviando para <strong>${comJid.length}</strong> grupo${comJid.length!==1?'s':''}...</p>
      <p class="tc txs muted">Aguarde ~${comJid.length * segPorGrupo}s (intervalo de segurança entre envios)</p>
      ${semJid.length ? `<div class="ia-aviso mt12">⚠️ ${semJid.length} grupo${semJid.length>1?'s':''} sem vínculo ignorados: ${semJid.map(g=>g.nome).join(', ')}</div>` : ''}
    `);

    const res = await BOT.enviarGrupos(comJid, WPP._msg, broadcast);

    if (!res.ok) {
      MODAL.open(`
        <div class="m-title">❌ Erro no envio</div>
        <p class="tc muted mt8">${res.error || 'Falha na comunicação com o bot.'}</p>
        <button class="btn btn-p btn-f mt16" onclick="MODAL.close()">Fechar</button>
      `);
      return;
    }

    const ok  = (res.resultados||[]).filter(r=>r.ok).length;
    const err = (res.resultados||[]).filter(r=>!r.ok).length;
    WPP._rotacionarFrase();

    MODAL.open(`
      <div class="m-title">✅ Envio Concluído!</div>
      <div class="tc" style="font-size:2.8rem;margin:12px 0">🎉</div>
      <p class="tc" style="font-size:1.1rem"><strong>${ok}</strong> grupo${ok!==1?'s':''} receberam a mensagem</p>
      ${err ? `<p class="tc muted txs mt4">${err} falha${err>1?'s':''} de envio</p>` : ''}
      <button class="btn btn-p btn-f mt16" onclick="MODAL.close()">Fechar</button>
    `);
  },

  // DM automático via bot — usa wpp_jid quando existe (funciona mesmo com número oculto/LID);
  // se o participante não tem wpp_jid (cadastro manual antigo), cai pro telefone normalizado.
  // Nunca abre link manual do WhatsApp nem exige telefone: sem os dois, o participante é ignorado.
  async _enviarPartesBot() {
    const parts = WPP._selParts;
    const gNome = DB.grupos.list().find(g=>g.id===WPP._grupoSelecionado)?.nome || '';
    const enviaveis = parts.filter(p=>p.wpp_jid || p.fone);
    const semDestino = parts.filter(p=>!p.wpp_jid && !p.fone);
    if(!enviaveis.length){ alert('Nenhum participante selecionado tem WhatsApp identificável.'); return; }

    MODAL.open(`
      <div class="m-title">🤖 Enviando via Bot</div>
      <div class="loading mt16 mb8"><div class="spinner"></div></div>
      <p class="tc muted">Enviando para <strong>${enviaveis.length}</strong> participante${enviaveis.length!==1?'s':''}...</p>
      ${semDestino.length?`<div class="ia-aviso mt12">⚠️ ${semDestino.length} sem WhatsApp identificável, ignorado${semDestino.length!==1?'s':''}: ${semDestino.map(p=>p.nome).join(', ')}</div>`:''}
    `);

    let ok=0, falha=0;
    for (const p of enviaveis) {
      const jid = p.wpp_jid || `${normalizarFone(p.fone)}@s.whatsapp.net`;
      const msg = WPP._volantePago ? WPP._msgPago(p.nome, gNome) : WPP._msg;
      const res = await BOT.enviarGrupos([{jid}], msg);
      if (res.ok && res.resultados?.[0]?.ok) ok++; else falha++;
    }
    WPP._rotacionarFrase();

    MODAL.open(`
      <div class="m-title">✅ Envio Concluído!</div>
      <div class="tc" style="font-size:2.8rem;margin:12px 0">🎉</div>
      <p class="tc" style="font-size:1.1rem"><strong>${ok}</strong> participante${ok!==1?'s':''} recebeu${ok!==1?'ram':''} a mensagem</p>
      ${falha?`<p class="tc muted txs mt4">${falha} falha${falha>1?'s':''} de envio</p>`:''}
      <button class="btn btn-p btn-f mt16" onclick="MODAL.close()">Fechar</button>
    `);
  },

  _step() {
    const gs=WPP._grupos, i=WPP._passo;
    if(i>=gs.length){ MODAL.close(); WPP._rotacionarFrase(); return; }
    const g=gs[i];
    const enc=encodeURIComponent(WPP._msg);
    const link=g.link?.includes('chat.whatsapp.com')?g.link:`https://wa.me/?text=${enc}`;
    const pct=((i/gs.length)*100).toFixed(0);
    const tc=S.cartela;

    if(tc) setTimeout(()=>CARTELA.download(), 400);
    setTimeout(()=>WPP._copiarMsg(WPP._msg), 500);

    MODAL.open(`
      <div class="m-title">📤 Envio para grupos</div>
      <div class="pap-prog"><div class="pap-fill" style="width:${pct}%"></div></div>
      <div class="pap-info">Grupo ${i+1} de ${gs.length}</div>
      <div class="pap-grp">${g.nome}</div>
      <div class="pap-membros txs muted mb16">${g.membros} membros</div>
      ${tc?`<div class="ia-aviso mb12">⬇️ <strong>${tc.nome}</strong> baixado — anexe no WhatsApp após abrir o grupo.</div>`:''}
      <div class="ia-aviso mb12" style="background:#1a3a1a;border-color:#25d366">📋 Mensagem <strong>copiada automaticamente</strong> — só colar no WhatsApp.</div>
      <a class="btn btn-g btn-f mb12" href="${link}" target="_blank" rel="noopener" onclick="WPP._copiarMsg(WPP._msg)">${WPP_SVG(20)} Abrir grupo no WhatsApp</a>
      <div class="pap-msg-box mb16">${WPP._msg.replace(/\n/g,'<br>')}</div>
      <div class="fx fxg8">
        ${i>0?`<button class="btn btn-o" style="flex:1" onclick="WPP._passo--;WPP._step()">← Anterior</button>`:''}
        <button class="btn btn-p" style="flex:1" onclick="WPP._passo++;WPP._step()">
          ${i<gs.length-1?'Próximo grupo →':'✅ Concluir'}
        </button>
      </div>`);
  },
};

// =============================================
// CARTELA DO BOLÃO
// =============================================
const CARTELA = {
  dragOver(e) { e.preventDefault(); $('cartela-zone')?.classList.add('drag-over'); },
  dragLeave(e) { $('cartela-zone')?.classList.remove('drag-over'); },
  drop(e) {
    e.preventDefault();
    $('cartela-zone')?.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) CARTELA.load(f);
  },
  load(f) {
    if (!f) return;
    const tipo = f.type === 'application/pdf' ? 'pdf' : f.type.startsWith('video/') ? 'video' : 'img';
    const rd = new FileReader();
    rd.onload = ev => {
      S.cartela = { url: ev.target.result, nome: f.name, tipo };
      R._whatsapp();
    };
    rd.readAsDataURL(f);
  },
  clear() { S.cartela = null; R._whatsapp(); },
  download() {
    if (!S.cartela) return;
    const a = document.createElement('a');
    a.href = S.cartela.url; a.download = S.cartela.nome; a.click();
  },
};

// =============================================
// COTAS AO VIVO — bolão relâmpago (cronômetro + reserva + comprovante)
// Admin cria um lote de N cotas com contador regressivo (5/10/15/30 min), o bot divulga nos grupos,
// o cliente escolhe a cota, reserva com o nome e anexa o comprovante. Contador X/N ao vivo, aviso de
// 50% e mensagem de esgotado (essas duas o backend também posta no grupo via bot). Ver server.js.
// =============================================
const COTAS = {
  _timer: null, _tickN: 0, _prevVend: {}, _busy: false,

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); },
  // O prazo agora é por RESERVA individual (cota.expira_em), não mais um prazo único do lote inteiro.
  _restanteMsCota(c) { return c.expira_em ? new Date(c.expira_em).getTime() - Date.now() : null; },
  _fmtMMSS(ms) { if (ms < 0) ms = 0; const s = Math.floor(ms/1000); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); },
  _vendidas(l) { return (l.cotas||[]).filter(c => c.status==='comprovante' || c.status==='paga').length; },
  _ativo(l) { return l.status==='ativo'; },

  // Cliente nao tem login/token — guarda a cota que ele reservou (por lote) no aparelho dele.
  _minhas() { try { return JSON.parse(localStorage.getItem('ltr_minhas_cotas')||'{}'); } catch { return {}; } },
  _guardarMinha(loteId, cotaId) { const m = this._minhas(); m[loteId] = cotaId; localStorage.setItem('ltr_minhas_cotas', JSON.stringify(m)); },
  _minhaCota(l) {
    const id = this._minhas()[l.id];
    let c = (l.cotas||[]).find(x => x.id === id);
    if (c && c.status === 'livre') c = null; // reserva expirou e foi liberada — não é mais "minha"
    if (!c) { const nm = (S.user?.nome||'').trim().toLowerCase(); c = (l.cotas||[]).find(x => x.status!=='livre' && x.nome && x.nome.trim().toLowerCase()===nm); }
    return c || null;
  },
  _acharCota(id) { for (const l of (S._lotesCache||[])) { const c = (l.cotas||[]).find(x => x.id===id); if (c) return c; } return null; },

  async _carregar() {
    const l = await _api.get('/api/lotes');
    if (Array.isArray(l)) S._lotesCache = l.map(x => ({ ...x, valor_cota:+x.valor_cota||0, total_cotas:+x.total_cotas||0 }));
    return S._lotesCache || [];
  },

  parar() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
  iniciar(modo) { this.parar(); this._tickN = 0; this._timer = setInterval(() => this._tick(modo), 1000); },
  async _tick(modo) {
    (S._lotesCache||[]).forEach(l => (l.cotas||[]).forEach(c => {
      if (c.status !== 'reservada' || !c.expira_em) return;
      const el = $('cd-cota-'+c.id); if (!el) return;
      const ms = this._restanteMsCota(c);
      el.textContent = this._fmtMMSS(ms);
      if (ms<=0) el.classList.add('cd-fim');
    }));
    this._tickN++;
    if (this._tickN % 3 === 0 && !this._busy && $('modal').hidden) {
      if (S.tela !== (modo==='admin' ? 'lotes' : 'cotas')) { this.parar(); return; }
      await this._carregar();
      if (modo === 'admin') { this._detectarVendas(); this._renderAdmin(); }
      else this._renderCliente();
    }
  },
  _detectarVendas() {
    (S._lotesCache||[]).forEach(l => {
      const v = this._vendidas(l), p = this._prevVend[l.id];
      if (p != null && v > p) TOAST.show('🔔 Nova venda! ' + l.nome + ': ' + v + '/' + l.total_cotas, 'ok');
      this._prevVend[l.id] = v;
    });
  },

  // ---- ADMIN ----
  async entrarAdmin() {
    if (!AUTH.isAdmin()) { R.ir('home'); return; }
    $('h-title').textContent = 'Cotas ao Vivo';
    $('view-lotes').innerHTML = '<div class="loading"><div class="spinner"></div> Carregando lotes...</div>';
    await this._carregar(); this._prevVend = {}; this._detectarVendas(); this._renderAdmin();
    this.iniciar('admin');
  },
  _renderAdmin() {
    const lotes = S._lotesCache || [];
    const ativos = lotes.filter(l => this._ativo(l));
    const outros = lotes.filter(l => !this._ativo(l));
    $('view-lotes').innerHTML =
      '<button class="btn btn-p btn-f mb12" onclick="COTAS.modalNovo()">🧾 Novo lote relâmpago</button>' +
      (lotes.length ? '' : '<div class="empty"><div style="font-size:2.2rem">🧾</div><p>Nenhum lote criado ainda.</p><p class="txs muted">Crie um lote de cotas com contador regressivo e divulgue nos grupos num toque.</p></div>') +
      (ativos.length ? '<div class="sectt mb8">🔴 Ao vivo</div>' : '') +
      ativos.map(l => this._cardAdmin(l)).join('') +
      (outros.length ? '<div class="sectt mt12 mb8">Encerrados / esgotados</div>' : '') +
      outros.map(l => this._cardAdmin(l)).join('');
  },
  _cardAdmin(l) {
    const v = this._vendidas(l), total = l.total_cotas;
    const reservadas = (l.cotas||[]).filter(c => c.status==='reservada').length;
    const pct = total ? Math.round(v/total*100) : 0;
    const ativo = this._ativo(l), lt = LOTERIAS[l.loteria];
    const statusTxt = ({ esgotado:'esgotado', encerrado:'encerrado' })[l.status] || (ativo ? 'aberto' : 'encerrado');
    return '<div class="lote-card">' +
      '<div class="fxb">' +
        '<div><div class="lote-nome">' + this._esc(l.nome) + '</div><div class="muted txs">' + (lt?lt.emoji+' '+lt.nome:'') + ' · Conc. #' + (l.concurso||'—') + ' · ' + fmt$(l.valor_cota) + '/cota</div></div>' +
        '<div class="txs muted" style="text-align:right">' + statusTxt + '<br>⏳ ' + l.duracao_min + ' min por reserva</div>' +
      '</div>' +
      '<div class="lote-bar"><div class="lote-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="fxb txs mb8"><span class="fw7">' + v + '/' + total + ' vendidas</span><span class="muted">' + reservadas + ' aguardando comprovante</span></div>' +
      '<div class="cota-grid">' + (l.cotas||[]).map(c => this._cotaAdmin(c)).join('') + '</div>' +
      '<div class="fxb mt8">' +
        (ativo ? '<button class="btn btn-o btn-sm" onclick="COTAS.encerrar(\'' + l.id + '\')">⏹️ Encerrar agora</button>' : '<span></span>') +
        '<button class="btn btn-d btn-sm" onclick="COTAS.excluir(\'' + l.id + '\')">🗑️ Excluir</button>' +
      '</div>' +
    '</div>';
  },
  _cotaAdmin(c) {
    const cls = ({ livre:'ct-livre', reservada:'ct-res', comprovante:'ct-comp', paga:'ct-paga', rejeitada:'ct-res' })[c.status] || '';
    const badge = ({ livre:'Livre', reservada:'⏳ Pendente', comprovante:'📎 Enviado', paga:'✅ Pago', rejeitada:'⚠️ Recusado' })[c.status];
    let acoes = '';
    if (c.status==='comprovante') acoes = '<button class="ct-b" title="Ver comprovante" onclick="COTAS.verComprovante(\'' + c.id + '\')">👁️</button><button class="ct-b ok" title="Confirmar pago" onclick="COTAS.confirmar(\'' + c.id + '\')">✅</button><button class="ct-b" title="Recusar comprovante" onclick="COTAS.rejeitar(\'' + c.id + '\')">❌</button><button class="ct-b" title="Liberar" onclick="COTAS.liberar(\'' + c.id + '\')">↩️</button>';
    else if (c.status==='reservada') acoes = '<button class="ct-b" title="Liberar" onclick="COTAS.liberar(\'' + c.id + '\')">↩️</button>';
    else if (c.status==='rejeitada') acoes = '<button class="ct-b" title="Ver comprovante recusado" onclick="COTAS.verComprovante(\'' + c.id + '\')">👁️</button><button class="ct-b ok" title="Aceitar mesmo assim" onclick="COTAS.confirmar(\'' + c.id + '\')">✅</button><button class="ct-b" title="Liberar" onclick="COTAS.liberar(\'' + c.id + '\')">↩️</button>';
    else if (c.status==='paga') acoes = '<button class="ct-b" title="Ver comprovante" onclick="COTAS.verComprovante(\'' + c.id + '\')">👁️</button><button class="ct-b" title="Liberar" onclick="COTAS.liberar(\'' + c.id + '\')">↩️</button>';
    const nome = c.nome ? this._esc(c.nome) : '<span class="muted">livre</span>';
    const cd = (c.status==='reservada' && c.expira_em) ? '<div class="cota-cd" id="cd-cota-' + c.id + '">' + this._fmtMMSS(this._restanteMsCota(c)) + '</div>' : '';
    return '<div class="cota ' + cls + '"><div class="cota-num">#' + c.numero + '</div><div class="cota-nome">' + nome + '</div><div class="cota-badge">' + badge + '</div>' + cd + '<div class="cota-acoes">' + acoes + '</div></div>';
  },
  verComprovante(id) {
    const c = this._acharCota(id);
    if (!c || !c.comprovante) { TOAST.show('Sem comprovante anexado.', 'err'); return; }
    MODAL.open('<div class="sectt mb8">Comprovante — ' + this._esc(c.nome) + ' (cota #' + c.numero + ')</div><img src="' + c.comprovante + '" style="width:100%;border-radius:10px" alt="comprovante">');
  },
  async confirmar(id) { await _api.put('/api/cotas/' + id + '/confirmar'); await this._carregar(); this._renderAdmin(); TOAST.show('✅ Pagamento confirmado.', 'ok'); },
  async rejeitar(id) {
    if (!confirm('Recusar esse comprovante? O apostador verá "pendente — entre em contato com o administrador" e poderá reenviar outro.')) return;
    await _api.put('/api/cotas/' + id + '/rejeitar');
    await this._carregar(); this._renderAdmin();
    TOAST.show('❌ Comprovante recusado — a cota continua com o apostador até ele reenviar.', 'ok');
  },
  async liberar(id) { if (!confirm('Liberar essa cota de volta pra venda?')) return; await _api.put('/api/cotas/' + id + '/liberar'); await this._carregar(); this._renderAdmin(); },
  async encerrar(id) { if (!confirm('Encerrar o lote agora?')) return; await _api.put('/api/lotes/' + id + '/encerrar'); await this._carregar(); this._renderAdmin(); },
  async excluir(id) { if (!confirm('Excluir o lote e todas as cotas? Não dá pra desfazer.')) return; await _api.del('/api/lotes/' + id); await this._carregar(); this._renderAdmin(); },

  modalNovo() {
    const bs = DB.boloes.list();
    const grupos = DB.grupos.list().filter(g => g.ativo !== false);
    const optBolao = bs.length
      ? '<div class="fg mb8"><label>Puxar de um bolão (opcional)</label><select id="lt-bolao" onchange="COTAS._prefill(this.value)"><option value="">— preencher manual —</option>' +
        bs.map(b => '<option value="' + b.id + '">' + this._esc(b.nome) + ' · ' + (LOTERIAS[b.loteria]?.nome||b.loteria) + '</option>').join('') + '</select></div>'
      : '';
    const optLot = Object.values(LOTERIAS).map(x => '<option value="' + x.id + '">' + x.emoji + ' ' + x.nome + '</option>').join('');
    const durRow = [5,10,15,30].map((d,i) => '<label class="dur-opt"><input type="radio" name="lt-dur" value="' + d + '" ' + (i===1?'checked':'') + '><span>' + d + ' min</span></label>').join('');
    const grpRows = grupos.length
      ? grupos.map(g => '<label class="grp-check"><input type="checkbox" class="lt-grp" value="' + g.id + '" ' + (g.jid?'checked':'') + '><span>' + this._esc(g.nome) + ' ' + (g.jid ? '<span class="badge txs" style="background:var(--primary);color:#000">Bot ✓</span>' : '<span class="txs muted">(sem bot — não recebe automático)</span>') + '</span></label>').join('')
      : '<div class="txs muted">Nenhum grupo cadastrado.</div>';
    MODAL.open(
      '<div class="sectt mb8">🧾 Novo lote relâmpago</div>' +
      optBolao +
      '<div class="fg mb8"><label>Nome do bolão</label><input id="lt-nome" placeholder="Ex: Mega Acumulada 300 mi"></div>' +
      '<div class="fxb" style="gap:8px">' +
        '<div class="fg mb8" style="flex:1"><label>Loteria</label><select id="lt-lot">' + optLot + '</select></div>' +
        '<div class="fg mb8" style="width:96px"><label>Concurso</label><input id="lt-conc" type="number" placeholder="0"></div>' +
      '</div>' +
      '<div class="fxb" style="gap:8px">' +
        '<div class="fg mb8" style="flex:1"><label>Qtd. de cotas</label><input id="lt-qtd" type="number" value="10" min="1" max="200"></div>' +
        '<div class="fg mb8" style="flex:1"><label>Valor da cota (R$)</label><input id="lt-valor" type="number" step="0.01" placeholder="0,00"></div>' +
      '</div>' +
      '<div class="fg mb8"><label>⏳ Prazo pra pagar após reservar</label><div class="dur-row">' + durRow + '</div></div>' +
      '<div class="fg mb8"><label>📢 Divulgar nos grupos</label>' + grpRows + '</div>' +
      '<button class="btn btn-p btn-f mt8" onclick="COTAS.criar()">🚀 Abrir cotas e divulgar</button>' +
      '<div class="txs muted mt8">As mensagens de "50% vendido" e "esgotado" saem sozinhas nos grupos pelo bot.</div>'
    );
  },
  _prefill(id) {
    const b = DB.boloes.get(id); if (!b) return;
    $('lt-nome').value = b.nome||''; $('lt-lot').value = b.loteria||'megasena';
    $('lt-conc').value = b.concurso||''; $('lt-valor').value = b.valor_cota||'';
    if (b.cotas_total) $('lt-qtd').value = b.cotas_total;
  },
  async criar() {
    const nome = $('lt-nome').value.trim();
    const loteria = $('lt-lot').value;
    const concurso = +$('lt-conc').value || 0;
    const total_cotas = +$('lt-qtd').value || 0;
    const valor_cota = +$('lt-valor').value || 0;
    const duracao_min = +(document.querySelector('input[name=lt-dur]:checked')?.value) || 10;
    if (!nome) { TOAST.show('Dê um nome ao bolão.', 'err'); return; }
    if (total_cotas < 1 || total_cotas > 200) { TOAST.show('Qtd. de cotas deve ser de 1 a 200.', 'err'); return; }
    const grupos = [...document.querySelectorAll('.lt-grp:checked')].map(ch => { const g = DB.grupos.list().find(x => x.id===ch.value); return g ? { nome:g.nome, jid:g.jid||'' } : null; }).filter(Boolean);
    const id = uid();
    const r = await _api.post('/api/lotes', { id, loteria, nome, concurso, total_cotas, valor_cota, duracao_min, grupos });
    if (!r) { TOAST.show('Erro ao criar o lote — verifique a conexão.', 'err'); return; }
    if (!r.ok) { TOAST.show('Servidor recusou (' + r.status + '). O backend com o módulo de cotas ainda não foi publicado — faça o deploy do server.js.', 'err'); return; }
    MODAL.close();
    await this._carregar(); this._prevVend = {}; this._detectarVendas(); this._renderAdmin();
    const data = await r.json().catch(() => ({}));
    const aviso = data.aviso;
    if (aviso && aviso.ok) { const ok = (aviso.resultados||[]).filter(x => x.ok).length; TOAST.show('🚀 Lote aberto! Divulgado em ' + ok + ' grupo(s).', 'ok'); }
    else if (aviso && aviso.motivo==='bot_desconectado') TOAST.show('Lote criado, mas o bot do WhatsApp está desconectado — divulgue manualmente.', 'err');
    else if (aviso && aviso.motivo==='sem_grupos') TOAST.show('🚀 Lote aberto! (nenhum grupo selecionado)', 'ok');
    else TOAST.show('🚀 Lote aberto!', 'ok');
  },

  // ---- CLIENTE ----
  async entrarCliente() {
    $('h-title').textContent = 'Cotas ao Vivo';
    $('view-cotas').innerHTML = '<div class="loading"><div class="spinner"></div> Carregando cotas...</div>';
    await this._carregar(); this._renderCliente();
    this.iniciar('cliente');
  },
  _renderCliente() {
    const lotes = (S._lotesCache||[]).filter(l => this._ativo(l));
    const el = $('view-cotas'); if (!el) return;
    if (!lotes.length) { el.innerHTML = '<div class="empty" style="margin-top:40px"><div style="font-size:2.6rem">🧾</div><p>Nenhuma cota aberta agora.</p><p class="txs muted">Quando o lotérico abrir um bolão relâmpago, ele aparece aqui e no grupo do WhatsApp. Fique de olho!</p></div>'; return; }
    el.innerHTML = lotes.map(l => this._cardCliente(l)).join('');
  },
  _cardCliente(l) {
    const v = this._vendidas(l), total = l.total_cotas, pct = total ? Math.round(v/total*100) : 0;
    const lt = LOTERIAS[l.loteria], minha = this._minhaCota(l);
    const metade = v >= Math.ceil(total/2) && v < total;
    return '<div class="lote-card">' +
      '<div class="fxb">' +
        '<div><div class="lote-nome">' + this._esc(l.nome) + '</div><div class="muted txs">' + (lt?lt.emoji+' '+lt.nome:'') + ' · ' + fmt$(l.valor_cota) + '/cota</div></div>' +
        '<div class="txs muted" style="text-align:right">⏳ ' + l.duracao_min + ' min<br>por reserva</div>' +
      '</div>' +
      '<div class="cota-msg">👉 Escolha sua cota — depois de reservar você tem ' + l.duracao_min + ' min pra pagar!</div>' +
      '<div class="lote-bar"><div class="lote-bar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="fxb txs mb8"><span class="fw7">' + v + '/' + total + ' vendidas</span>' + (minha ? '<span class="badge txs" style="background:var(--primary);color:#000">Sua cota: #' + minha.numero + '</span>' : '') + '</div>' +
      (metade ? '<div class="cota-hot">🔥 Corra! Já vendemos ' + v + '/' + total + ' — não fique de fora!</div>' : '') +
      '<div class="cota-grid">' + (l.cotas||[]).map(c => this._cotaCliente(l, c, minha)).join('') + '</div>' +
    '</div>';
  },
  _cotaCliente(l, c, minha) {
    if (minha && minha.id === c.id) {
      if (c.status==='reservada') {
        const cd = c.expira_em ? '<div class="cota-cd" id="cd-cota-' + c.id + '">' + this._fmtMMSS(this._restanteMsCota(c)) + '</div>' : '';
        return '<div class="cota ct-minha"><div class="cota-num">#' + c.numero + '</div><div class="cota-nome">Você</div>' + cd + '<button class="btn btn-p btn-sm cota-anexar" onclick="COTAS.anexar(\'' + c.id + '\')">📎 Anexar comprovante</button></div>';
      }
      if (c.status==='comprovante') return '<div class="cota ct-minha"><div class="cota-num">#' + c.numero + '</div><div class="cota-nome">Você</div><div class="cota-badge">📎 Comprovante enviado ✓ — aguardando confirmação</div></div>';
      if (c.status==='rejeitada') return '<div class="cota ct-minha"><div class="cota-num">#' + c.numero + '</div><div class="cota-nome">Você</div><div class="cota-badge" style="color:var(--red)">⚠️ Pendente — entre em contato com o administrador</div><button class="btn btn-p btn-sm cota-anexar" onclick="COTAS.anexar(\'' + c.id + '\')">📎 Reenviar comprovante</button></div>';
      if (c.status==='paga') return '<div class="cota ct-minha"><div class="cota-num">#' + c.numero + '</div><div class="cota-nome">Você</div><div class="cota-badge">✅ Pago</div></div>';
    }
    if (c.status==='livre') return '<div class="cota ct-livre"><div class="cota-num">#' + c.numero + '</div><button class="btn btn-o btn-sm" onclick="COTAS.reservar(\'' + l.id + '\',\'' + c.id + '\')">Escolher</button></div>';
    const nm = c.nome ? this._esc(c.nome.split(' ')[0]) : '—';
    const pago = c.status==='comprovante' || c.status==='paga';
    const cd = (c.status==='reservada' && c.expira_em) ? '<div class="cota-cd" id="cd-cota-' + c.id + '">' + this._fmtMMSS(this._restanteMsCota(c)) + '</div>' : '';
    return '<div class="cota ' + (pago?'ct-paga':'ct-res') + '"><div class="cota-num">#' + c.numero + '</div><div class="cota-nome">' + nm + '</div>' + cd + '<div class="cota-badge">' + (pago?'✅ Vendida':'⏳ Reservada') + '</div></div>';
  },
  reservar(loteId, cotaId) {
    MODAL.open(
      '<div class="sectt mb8">🧾 Reservar cota</div>' +
      '<div class="fg mb8"><label>Seu nome</label><input id="rsv-nome" value="' + this._esc(S.user?.nome||'') + '" placeholder="Seu nome"></div>' +
      '<div class="fg mb8"><label>WhatsApp (opcional)</label><input id="rsv-fone" placeholder="(61) 9...."></div>' +
      '<button class="btn btn-p btn-f" onclick="COTAS._confirmarReserva(\'' + loteId + '\',\'' + cotaId + '\')">Reservar minha cota</button>' +
      '<div class="txs muted mt8">Depois de pagar, volte aqui e anexe o comprovante na sua cota.</div>'
    );
  },
  async _confirmarReserva(loteId, cotaId) {
    const nome = $('rsv-nome').value.trim(), fone = $('rsv-fone').value.trim();
    if (!nome) { TOAST.show('Digite seu nome.', 'err'); return; }
    const r = await _api.post('/api/cotas/' + cotaId + '/reservar', { nome, fone });
    if (!r) { TOAST.show('Erro de conexão. Tente de novo.', 'err'); return; }
    const data = await r.json().catch(() => ({}));
    if (!data.ok) { TOAST.show(data.error||'Essa cota já foi reservada. Escolha outra.', 'err'); MODAL.close(); await this._carregar(); this._renderCliente(); return; }
    this._guardarMinha(loteId, cotaId);
    if (S.user) S.user.nome = nome;
    MODAL.close();
    await this._carregar(); this._renderCliente();
    TOAST.show('✅ Cota reservada! Agora pague e anexe o comprovante.', 'ok');
  },
  anexar(cotaId) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = async ev => {
        this._busy = true;
        const r = await _api.post('/api/cotas/' + cotaId + '/comprovante', { img: ev.target.result });
        this._busy = false;
        if (!r) { TOAST.show('Erro ao enviar. Tente de novo.', 'err'); return; }
        const data = await r.json().catch(() => ({}));
        if (!data.ok) { TOAST.show(data.error||'Reserve a cota antes de anexar.', 'err'); return; }
        await this._carregar(); this._renderCliente();
        TOAST.show('✅ Comprovante enviado! Aguarde a confirmação do lotérico.', 'ok');
      };
      rd.readAsDataURL(f);
    };
    inp.click();
  },
};

// =============================================
// DEV CONTROL
// =============================================
const DEV = {
  tap() {
    const now=Date.now();
    if(now-S.dtap_t>5000){S.dtaps=0;S.dtap_t=now;}
    S.dtaps++;
    if(S.dtaps>=7){S.dtaps=0; DEV._ask();}
  },
  async _ask() {
    const pw=prompt('🔒 Acesso restrito. Senha:');
    if(pw===null) return;
    const data = await AUTH._checarSenha('dev', pw);
    if(data?.ok){
      S.user={login:'dev',role:'dev',nome:'Desenvolvedor'};
      sessionStorage.setItem('ltr_s',JSON.stringify(S.user));
      AUTH._aplicarPerfilUI();
      R.ir('controle');
    } else alert(data?.error || 'Senha incorreta.');
  },
  // ---- Testar como admin/apostador (simulação de perfil do dev) ----
  // Mesmo em manutenção o dev pode "vestir" outro perfil pra conferir como o app aparece
  // pro admin e pro apostador — sem deslogar e sem tirar o app da manutenção. A troca é só
  // em memória (o sessionStorage continua com o dev), então um F5 volta direto pro dev.
  testarComo(role) {
    if (S.user?.role!=='dev' || S.devBackup) return;
    if (role==='admin') { DEV._iniciarSimulacao({ role:'admin', nome:'Administrador' }); return; }
    MODAL.open(`
      <div class="m-title">🧪 Testar como apostador</div>
      <p class="txs muted mb8">Preencha com o nome/telefone de um apostador de verdade pra ver as
      premiações, o bolão anual e as cotas DELE — ou deixe como está pra um apostador genérico.</p>
      <div class="fg mb8"><label>Nome</label><input id="sim-nome" value="Apostador Teste"></div>
      <div class="fg mb8"><label>Telefone (opcional — com DDD)</label><input id="sim-fone" placeholder="61999999999"></div>
      <button class="btn btn-p btn-f" onclick="DEV._simApostador()">Entrar na visão do apostador</button>`);
  },
  _simApostador() {
    const nome=$('sim-nome').value.trim()||'Apostador Teste';
    const fone=$('sim-fone').value.trim();
    MODAL.close();
    DEV._iniciarSimulacao({ role:'cliente', nome, fone: fone?normalizarFone(fone):'' });
  },
  _iniciarSimulacao(user) {
    S.devBackup = S.user;
    S.user = user;
    S.stack = [];
    AUTH._aplicarPerfilUI();
    const b=$('sim-badge');
    b.hidden=false;
    b.textContent=`🧪 Testando como ${user.role==='admin'?'Admin':'Apostador'} — toque p/ voltar ao Dev`;
    R.ir('home');
    if (user.role==='cliente') R._verificarPremiacaoCliente();
  },
  voltarDev() {
    if (!S.devBackup) return;
    S.user = S.devBackup; S.devBackup = null;
    S.stack = [];
    $('sim-badge').hidden = true;
    AUTH._aplicarPerfilUI();
    R.ir('controle');
    TOAST.show('🔒 De volta ao perfil Desenvolvedor.', 'ok');
  },

  block(v) {
    const c=DB.ctrl.get(); c.bloqueado=v; DB.ctrl.set(c);
    DB.ctrl.log(`App ${v?'em MANUTENÇÃO (só o dev opera)':'de volta ao ar'}`);
    // Quem liga a manutenção é o dev — ele continua dentro do app, ajustando o que precisar;
    // a tela de manutenção aparece para apostadores E admin no próximo acesso.
    TOAST.show(v
      ? '🛠️ Manutenção LIGADA — apostadores e admin veem a tela de manutenção; só você (dev) segue operando.'
      : '🟢 App de volta ao ar para todo mundo (apostadores e admin).', 'ok');
    R._controle();
  },
  saveMsg() {
    const c=DB.ctrl.get(); c.msg=$('dev-msg')?.value?.trim()||''; DB.ctrl.set(c); alert('Mensagem salva!');
  },
  saveFoneAdmin() {
    const bruto = $('dev-fone')?.value||'';
    const fone = normalizarFone(bruto);
    // Celular BR com DDI: 13 dígitos (5561999999999). Fixo: 12. Fora disso, o número digitado
    // provavelmente está incompleto/errado e o aviso instantâneo vai falhar silenciosamente.
    if (fone && fone.length!==12 && fone.length!==13) {
      if (!confirm(`"${bruto}" não parece um número completo com DDD (ficou "${fone}"). Salvar assim mesmo?`)) return;
    }
    const c=DB.ctrl.get(); c.admin_fone=fone; DB.ctrl.set(c);
    alert(c.admin_fone ? 'Número salvo! Você passa a receber o resultado 5 min antes do grupo.' : 'Número removido — só o grupo vai receber o resultado.');
  },
  saveLic() {
    const c=DB.ctrl.get();
    c.cliente=$('dev-cli')?.value?.trim()||c.cliente;
    c.validade=$('dev-val')?.value||c.validade;
    c.licenca=$('dev-lic')?.value?.trim()||c.licenca;
    DB.ctrl.set(c); DB.ctrl.log('Licença atualizada'); alert('Salvo!'); R._controle();
  },
  async reset() {
    if(!confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) return;
    const c = DB.ctrl.get();
    await Promise.all([
      ...S.cache.boloes.map(b=>_api.del('/api/boloes/'+b.id)),
      ...S.cache.grupos.map(g=>_api.del('/api/grupos/'+g.id)),
      ...S.cache.usuarios.map(u=>_api.del('/api/usuarios/'+u.id)),
    ]);
    S.cache.boloes=[]; S.cache.grupos=[]; S.cache.vendas=[]; S.cache.pags=[]; S.cache.usuarios=[];
    DB.ctrl.set(c); DB.ctrl.log('Dados resetados'); location.reload();
  },
  _btaps: 0, _bt_t: 0,
  blTap() {
    const now=Date.now();
    if(now-DEV._bt_t>5000) DEV._btaps=0;
    DEV._bt_t=now; DEV._btaps++;
    if(DEV._btaps>=7){ DEV._btaps=0; DEV._unblockAsk(); }
  },
  async _unblockAsk() {
    const pw=prompt('🔒 Senha de desbloqueio:');
    if(pw===null) return;
    const data = await AUTH._checarSenha('dev', pw);
    if(data?.ok){
      const c=DB.ctrl.get(); c.bloqueado=false; DB.ctrl.set(c);
      DB.ctrl.log('Desbloqueado via tela de manutenção');
      $('bloqueio').hidden=true;
      DEV._continuar();
    } else alert(data?.error || 'Senha incorreta.');
  },
  _continuar() {
    setTimeout(()=>{
      $('splash').classList.add('hide');
      setTimeout(()=>{
        $('splash').style.display='none';
        const sess=sessionStorage.getItem('ltr_s');
        if(sess){S.user=JSON.parse(sess); AUTH._start();}
        else $('tela-login').hidden=false;
      },400);
    },300);
  },
  check() {
    const c=DB.ctrl.get();
    if(S.user?.role==='dev') return false; // só o dev nunca fica preso na manutenção
    if(c.bloqueado && !S.cache.boloes.length){
      c.bloqueado=false; DB.ctrl.set(c); return false;
    }
    if(c.bloqueado){
      $('bloqueio').hidden=false;
      $('bl-msg').textContent=c.msg||'Sistema temporariamente indisponível.';
      return true;
    }
    return false;
  },
};

// =============================================
// TEMA — sistema de temas sazonais
// =============================================
const TEMA = {
  _key: 'ltr_tema',
  _partsAtivas: [],
  _fogosTimer: null,

  atual() { return localStorage.getItem(this._key) || 'padrao'; },

  aplicar(id) {
    const t = TEMAS[id] || TEMAS.padrao;
    document.body.setAttribute('data-tema', t.id);
    localStorage.setItem(this._key, t.id);
    this._pararParticulas();
    this._pararFogos();
    this._atualizarFaixa(t);
    if (t.decos.length) this._iniciarParticulas(t);
    if (t.fogos) this._iniciarFogos(t.fogos, t.cores);
    this._atualizarMetaColor(t.cores.bg2);
    if (S.user?.role) R.ir('admin');
  },

  carregar() {
    const t = TEMAS[this.atual()] || TEMAS.padrao;
    document.body.setAttribute('data-tema', t.id);
    this._atualizarFaixa(t);
    this._atualizarMetaColor(t.cores.bg2);
    if (t.decos.length) this._iniciarParticulas(t);
    if (t.fogos) this._iniciarFogos(t.fogos, t.cores);
  },

  _atualizarMetaColor(cor) {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', cor);
  },

  _atualizarFaixa(t) {
    const el = document.getElementById('faixa-tema');
    if (!el) return;
    if (t.id === 'padrao') {
      el.hidden = true;
      document.body.classList.remove('tem-faixa');
      return;
    }
    el.innerHTML = `
      <span class="ft-emoji">${t.emoji}</span>
      <span class="ft-nome">${t.nome}</span>
      <span class="ft-sep">·</span>
      <span class="ft-desc">${t.desc}</span>`;
    el.style.background  = `linear-gradient(90deg, ${t.cores.bg3} 0%, ${t.cores.bg2} 40%, ${t.cores.bg2} 60%, ${t.cores.bg3} 100%)`;
    el.style.color       = t.cores.primary;
    el.hidden = false;
    document.body.classList.add('tem-faixa');
    this._posicionarBarbante();
  },

  // O barbante (São João) precisa ficar logo abaixo do header+faixa-tema — como a altura desses
  // dois varia (com/sem botão de voltar, texto quebrando em telas estreitas), calcula na hora em
  // vez de usar um valor fixo em px (senão sobrepõe a faixa, como aconteceu na primeira versão).
  _posicionarBarbante() {
    const bb = document.getElementById('deco-barbante');
    if (!bb) return;
    const faixa = document.getElementById('faixa-tema');
    const header = document.getElementById('header');
    const ref = (faixa && !faixa.hidden) ? faixa : header;
    if (ref) bb.style.top = ref.getBoundingClientRect().bottom + 'px';
  },

  _iniciarParticulas(t) {
    const zona = document.getElementById('deco-tema');
    if (!zona) return;
    zona.innerHTML = '';
    this._partsAtivas = [];
    const { decos, id } = t;
    // neve/pétalas usam animação de queda; outros sobem
    const usaQueda  = ['natal','maes','pascoa'].includes(id);
    const anims     = usaQueda ? ['anim-d','anim-d','anim-c'] : ['anim-a','anim-a','anim-b','anim-c'];
    const qt        = 14; // reduzido de 35 — tema mais leve, menos "papagaiado"
    const tamanhos  = ['.9rem','1.1rem','1.4rem','1.7rem','2rem'];
    const duracoes  = usaQueda
      ? [10,12,14,16,18,20]
      : [5,6,7,8,9,10,11];
    for (let i = 0; i < qt; i++) {
      const el = document.createElement('span');
      const anim = anims[i % anims.length];
      el.className = `deco-p ${anim}`;
      el.textContent = decos[i % decos.length];
      el.style.left   = (Math.random() * 96 + 1) + '%';
      el.style.fontSize = tamanhos[Math.floor(Math.random() * tamanhos.length)];
      el.style.animationDuration = duracoes[Math.floor(Math.random() * duracoes.length)] + 's';
      el.style.animationDelay    = (Math.random() * 12) + 's';
      if (usaQueda) el.style.bottom = 'auto';
      zona.appendChild(el);
      this._partsAtivas.push(el);
    }
  },

  _pararParticulas() {
    const zona = document.getElementById('deco-tema');
    if (zona) zona.innerHTML = '';
    this._partsAtivas = [];
  },

  // Fogos de artifício discretos: sobe um ponto brilhante, estoura em partículas radiais e, às
  // vezes, revela um texto ("Feliz 2027"/"Feliz Natal") — usado por Mega da Virada e Natal.
  _iniciarFogos(texto, cores) {
    this._pararFogos();
    const paleta = [cores.primary, cores.gold, '#ffffff'];
    const disparar = () => {
      const zona = document.getElementById('deco-fogos');
      if (!zona) return;
      const x = Math.random() * 70 + 15; // 15%-85% da largura
      const altoPx = Math.random() * 120 + 140;
      const cor = paleta[Math.floor(Math.random() * paleta.length)];

      const subida = document.createElement('span');
      subida.className = 'fogo-subida';
      subida.style.left = x + '%';
      subida.style.setProperty('--c', cor);
      subida.style.setProperty('--alt', '-' + altoPx + 'px');
      zona.appendChild(subida);

      setTimeout(() => {
        subida.remove();
        const zona2 = document.getElementById('deco-fogos');
        if (!zona2) return;
        const burst = document.createElement('span');
        burst.className = 'fogo-burst';
        burst.style.left = x + '%';
        burst.style.bottom = `calc(8% + ${altoPx}px)`;
        const n = 10;
        for (let i = 0; i < n; i++) {
          const p = document.createElement('span');
          p.className = 'fp';
          p.style.setProperty('--c', cor);
          p.style.setProperty('--a', (i * (360 / n)) + 'deg');
          burst.appendChild(p);
        }
        zona2.appendChild(burst);
        if (Math.random() < .35) {
          const txt = document.createElement('span');
          txt.className = 'fogo-texto';
          txt.textContent = texto;
          txt.style.left = x + '%';
          txt.style.bottom = `calc(8% + ${altoPx}px)`;
          txt.style.setProperty('--c', cor);
          zona2.appendChild(txt);
          setTimeout(() => txt.remove(), 2500);
        }
        setTimeout(() => burst.remove(), 1100);
      }, 1100);
    };
    disparar();
    this._fogosTimer = setInterval(disparar, 5500 + Math.random() * 3000);
  },
  _pararFogos() {
    if (this._fogosTimer) clearInterval(this._fogosTimer);
    this._fogosTimer = null;
    const zona = document.getElementById('deco-fogos');
    if (zona) zona.innerHTML = '';
  },

  renderSeletor() {
    const atual = this.atual();
    return `
      <div class="divider mt12 mb12"></div>
      <div class="fxb mb10">
        <div class="sectt">🎨 Tema Visual</div>
        <div class="txs muted">${TEMAS[atual]?.emoji || '🎰'} ${TEMAS[atual]?.nome || 'Padrão'}</div>
      </div>
      <div class="tema-grid">
        ${Object.values(TEMAS).map(t => `
          <div class="tema-card${t.id === atual ? ' ativo' : ''}" onclick="TEMA.aplicar('${t.id}')">
            <span class="tema-card-emoji">${t.emoji}</span>
            <div class="tema-card-nome">${t.nome}</div>
            <div class="tema-card-desc">${t.desc}</div>
            <div class="tema-card-cores">
              <span class="tema-dot" style="background:${t.cores.bg2}"></span>
              <span class="tema-dot" style="background:${t.cores.primary}"></span>
              <span class="tema-dot" style="background:${t.cores.gold}"></span>
            </div>
          </div>`).join('')}
      </div>`;
  },
};

// =============================================
// INICIALIZAÇÃO
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  TEMA.carregar();
  window.addEventListener('resize', () => TEMA._posicionarBarbante());
  setTimeout(()=>{
    $('splash').classList.add('hide');
    setTimeout(()=>{
      $('splash').style.display='none';
      const sess=sessionStorage.getItem('ltr_s');
      if(sess){ S.user=JSON.parse(sess); AUTH._start(); }
      else { $('tela-login').hidden=false; }
    },400);
  },2000);
  $('inp-p')?.addEventListener('keypress', e=>{ if(e.key==='Enter') AUTH.entrar(); });
  $('inp-nome')?.addEventListener('keypress', e=>{ if(e.key==='Enter') AUTH.entrar(); });
});
