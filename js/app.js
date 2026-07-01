'use strict';
// =============================================
// ESTADO GLOBAL
// =============================================
const S = {
  user: null, tela: 'home', loteria: null, bolao: null,
  stack: [], ze_i: 0, ze_t: null, dtaps: 0, dtap_t: 0,
  charts: {}, resultados: [], cartela: null, statsF: null,
  cache: { boloes:[], grupos:[], vendas:[], pags:[], usuarios:[], ctrl:{ bloqueado:false, msg:'', cliente:'Demo', licenca:'DEMO-2024', validade:'2025-12-31', logs:[] } },
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
const uid  = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const WPP_SVG = (size=32) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#25d366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
const hoje = () => new Date().toLocaleDateString('pt-BR');

// =============================================
// API backend
// =============================================
const API_URL = 'https://api-loterias-taguacenter.onrender.com';
const _api = {
  get:  p    => fetch(API_URL+p).then(r=>r.ok?r.json():null).catch(()=>null),
  post: (p,b) => fetch(API_URL+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).catch(()=>null),
  put:  (p,b) => fetch(API_URL+p,{method:'PUT', headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).catch(()=>null),
  del:  p    => fetch(API_URL+p,{method:'DELETE'}).catch(()=>null),
};

async function carregarDados() {
  const [boloes,grupos,vendas,pags,usuarios,ctrl] = await Promise.all([
    _api.get('/api/boloes'), _api.get('/api/grupos'), _api.get('/api/vendas'),
    _api.get('/api/pagamentos'), _api.get('/api/usuarios'), _api.get('/api/config'),
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
}

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
  vendas: {
    list: ()  => S.cache.vendas || [],
    save: v   => { S.cache.vendas.push(v); _api.post('/api/vendas',v); },
  },
  pags: {
    list: ()  => S.cache.pags || [],
    save: p   => { const l=S.cache.pags; const i=l.findIndex(x=>x.id===p.id); i>=0?l[i]=p:l.push(p); _api.post('/api/pagamentos',p); },
  },
  usuarios: {
    list: ()  => S.cache.usuarios || [],
    find: nm  => (S.cache.usuarios||[]).find(u=>u.nome.toLowerCase()===nm.toLowerCase()),
    save: u   => { const l=S.cache.usuarios; const i=l.findIndex(x=>x.id===u.id); i>=0?l[i]=u:l.push(u); _api.post('/api/usuarios',u); },
    del:  id  => { S.cache.usuarios=S.cache.usuarios.filter(u=>u.id!==id); _api.del('/api/usuarios/'+id); },
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
  // Chamado a cada tecla no campo nome — mostra grupo para cliente, senha para admin/dev
  onNomeInput(v) {
    const low = v.trim().toLowerCase();
    const isPriv = (low === 'admin' || low === 'dev');
    $('field-senha').hidden = !isPriv;
    $('field-grupo').hidden = isPriv || !v.trim();
    const sub = $('login-sub');
    if (sub) sub.textContent = isPriv
      ? 'Digite a senha de administrador'
      : v.trim() ? 'Informe o nome do seu grupo de bolão' : 'Digite seu nome para entrar';
  },

  entrar() {
    const nome = $('inp-nome').value.trim();
    const senha = $('inp-p').value;
    const low   = nome.toLowerCase();
    const err   = $('login-err');

    if (!nome) { err.hidden=false; err.textContent='Digite seu nome.'; return; }

    // Dev
    if (low === 'dev' && senha === atob(APP._dk)) {
      S.user = { login:'dev', role:'dev', nome:'Desenvolvedor' };
      AUTH._start(); return;
    }
    // Admin
    if (low === 'admin') {
      if (senha !== CREDS.admin.senha) {
        err.hidden=false; err.textContent='Senha incorreta.'; return;
      }
      S.user = { login:'admin', role:'admin', nome:'Administrador' };
      AUTH._start(); return;
    }
    // Cliente — nome + grupo obrigatórios
    const grupo = ($('inp-grupo')?.value || '').trim();
    if (!grupo) {
      err.hidden=false;
      err.textContent='Informe o nome do seu grupo de bolão para continuar.';
      $('inp-grupo')?.focus();
      return;
    }
    S.user = { role:'cliente', nome, grupo };
    AUTH._start();
  },

  async _start() {
    // Mostrar loading enquanto carrega dados do servidor
    const err = $('login-err');
    if (err) { err.hidden=false; err.style.color='#aaa'; err.textContent='⏳ Conectando ao servidor...'; }
    await carregarDados();
    if (err) { err.hidden=true; err.style.color=''; }

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

    const r = S.user.role;
    const badge = $('h-badge');
    badge.className = `badge b-${r}`;
    badge.textContent = r==='dev'?'DEV':r==='admin'?'Admin':'Apostador';

    // Exibe nav correto
    const isAdmin = AUTH.isAdmin();
    $('nav-user').hidden  = isAdmin;
    $('nav-admin').hidden = !isAdmin;

    DB.ctrl.log('Login: ' + (S.user.nome||S.user.login));
    SEED.init();
    ZE.start();
    R.ir('home');
  },

  sair() {
    sessionStorage.removeItem('ltr_s');
    S.user = null;
    $('shell').hidden = true;
    $('nav-user').hidden = true;
    $('nav-admin').hidden = true;
    $('tela-login').hidden = false;
    $('inp-nome').value = '';
    $('inp-p').value = '';
    if ($('inp-grupo')) $('inp-grupo').value = '';
    $('field-senha').hidden = true;
    $('field-grupo').hidden = true;
    const sub = $('login-sub');
    if (sub) sub.textContent = 'Digite seu nome para entrar';
    Object.values(S.charts).forEach(c=>c?.destroy?.());
    S.charts = {};
    S._hLt = null;
    S._hRes = {};
    S._iaStats = {};
  },

  isAdmin: () => ['admin','dev'].includes(S.user?.role),
};

// =============================================
// SEED (dados demo)
// =============================================
const SEED = {
  init() {
    // Não rodar SEED se o banco já tem qualquer dado (produção)
    if (S.cache.boloes.length || S.cache.usuarios.length || S.cache.grupos.length) return;
    // Usuários demo
    if (!DB.usuarios.list().length) {
      [
        { id:uid(), nome:'João Silva',   ativo:true,  criado:hoje() },
        { id:uid(), nome:'Maria Santos', ativo:true,  criado:hoje() },
        { id:uid(), nome:'Pedro Lima',   ativo:true,  criado:hoje() },
        { id:uid(), nome:'Ana Costa',    ativo:false, criado:hoje() },
      ].forEach(u => DB.usuarios.save(u));
    }

    if (DB.boloes.list().length > 0) return;
    const bids = [uid(),uid(),uid()];
    const bs = [
      { id:bids[0], loteria:'megasena', nome:'Bolão do Escritório', grupo:'Grupo Firma Alpha',
        cotas_total:10, valor_cota:30, concurso:2780, status:'ativo',
        membros:[{nome:'João Silva',fone:'61999991111',cotas:2,pago:true},{nome:'Maria Santos',fone:'61988882222',cotas:1,pago:true},{nome:'Pedro Lima',fone:'61977773333',cotas:2,pago:false},{nome:'Ana Costa',fone:'61966664444',cotas:1,pago:true}],
        numeros:[['04','11','23','38','51','59'],['07','14','22','33','47','55']], criado:hoje() },
      { id:bids[1], loteria:'quina', nome:'Bolão Família', grupo:'Família Silva',
        cotas_total:8, valor_cota:20, concurso:6328, status:'ativo',
        membros:[{nome:'Roberto Silva',fone:'61955555555',cotas:3,pago:true},{nome:'Carla Menezes',fone:'61944446666',cotas:2,pago:false},{nome:'Tiago Rocha',fone:'61933337777',cotas:3,pago:true}],
        numeros:[['08','17','32','55','78']], criado:hoje() },
      { id:bids[2], loteria:'lotofacil', nome:'Bolão dos Amigos', grupo:'Turma da Churrasqueira',
        cotas_total:12, valor_cota:15, concurso:3218, status:'ativo',
        membros:[{nome:'Lucas Pereira',fone:'61922228888',cotas:2,pago:true},{nome:'Fernanda Dias',fone:'61911119999',cotas:1,pago:true},{nome:'Marcelo Faria',fone:'61900000000',cotas:3,pago:true}],
        numeros:[['01','02','05','07','09','11','14','16','18','19','20','22','23','24','25']], criado:hoje() },
    ];
    const gs = [
      {id:uid(),nome:'Grupo Firma Alpha',link:'https://chat.whatsapp.com/exemplo1',membros:45,ativo:true},
      {id:uid(),nome:'Família Silva',link:'https://chat.whatsapp.com/exemplo2',membros:22,ativo:true},
      {id:uid(),nome:'Turma da Churrasqueira',link:'https://chat.whatsapp.com/exemplo3',membros:18,ativo:true},
    ];
    bs.forEach(b=>DB.boloes.save(b));
    gs.forEach(g=>DB.grupos.save(g));
    const lts=['megasena','quina','lotofacil'];
    const nms=['João Silva','Maria Santos','Pedro Lima','Ana Costa','Roberto Silva','Carla Menezes','Tiago Rocha','Lucas Pereira'];
    for(let i=0;i<50;i++){
      const d=new Date(); d.setDate(d.getDate()-Math.floor(Math.random()*30));
      const lt=lts[Math.floor(Math.random()*3)];
      const cotas=Math.floor(Math.random()*3)+1;
      const vBase=lt==='megasena'?30:lt==='quina'?20:15;
      DB.vendas.save({id:uid(),bolao_id:bids[Math.floor(Math.random()*3)],loteria:lt,
        membro:nms[Math.floor(Math.random()*8)],cotas,valor:cotas*vBase,data:d.toLocaleDateString('pt-BR')});
    }
  },
};

// =============================================
// API CAIXA
// =============================================
const API = {
  _BASE: 'https://servicebus2.caixa.gov.br/portaldeloterias/api/',
  async fetch(lt, conc='') {
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
        const parsed = API.parse(data);
        if (parsed) return parsed;
      } catch {}
    }
    return null;
  },
  parse(r) {
    if (!r||!r.listaDezenas) return null;
    return { numero:r.numero, data:r.dataApuracao, dezenas:r.listaDezenas,
      acumulado:r.acumulado, ganhadores:r.listaRateioPremio?.[0]?.numeroDeGanhadores??0,
      premio:r.listaRateioPremio?.[0]?.valorPremio??0, prox:r.valorEstimadoProximoConcurso??0,
      dataProxConcurso:r.dataProximoConcurso||null, numProxConcurso:r.numeroConcursoProximo||null };
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
// ZÉ LOTECA MASCOTE
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
    const el=$('ze-txt');
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
  ir(tela, params={}) {
    if(S.tela&&S.tela!==tela) S.stack.push(S.tela);
    S.tela=tela;
    document.querySelectorAll('.view').forEach(v=>v.hidden=true);
    $(`view-${tela}`).hidden=false;
    // Atualiza botão ativo no nav correto
    const nav = AUTH.isAdmin() ? $('nav-admin') : $('nav-user');
    nav?.querySelectorAll('.nb').forEach(b=>b.classList.toggle('on',b.dataset.v===tela));
    const noBack=['home','admin','resultados','perfil','controle','ia'];
    $('btn-back').hidden=noBack.includes(tela);
    const fn=R['_'+tela];
    if(fn) fn(params);
  },
  voltar() { R.ir(S.stack.pop()||'home'); },

  // ---- HOME ----
  _home() {
    $('h-title').innerHTML='<img src="img/logo.png" alt="Lotérica Taguacenter" class="h-logo-img">';
    if (AUTH.isAdmin()) {
      R._homeAdmin();
    } else {
      R._homeUser();
    }
  },

  async _homeAdmin() {
    const bs=DB.boloes.list();
    $('view-home').innerHTML=`
      <div style="margin-bottom:14px">
        <div style="font-size:1.15rem;font-weight:700">Olá, ${S.user.nome.split(' ')[0]}! 👋</div>
        <div class="muted tsm">Escolha a loteria para gerenciar os bolões</div>
      </div>
      <div class="grid-lt">
        ${Object.values(LOTERIAS).map(lt=>{
          const cnt=bs.filter(b=>b.loteria===lt.id&&b.status==='ativo').length;
          return`<div class="lt-card" style="background:linear-gradient(135deg,${lt.cor},${lt.cor2})" onclick="R._ltClick('${lt.id}')">
            <span class="lt-emoji">${lt.emoji}</span>
            <div id="ld-${lt.id}" class="lt-dados-live"><div class="lt-loading-dot"></div></div>
            <div class="lt-nome">${lt.nome}</div>
            <div class="lt-dias">${lt.dias}</div>
            <div class="lt-cnt">${cnt} ${cnt!==1?'bolões':'bolão'} ativo${cnt!==1?'s':''}</div>
          </div>`;
        }).join('')}
      </div>`;

    await Promise.allSettled(Object.values(LOTERIAS).map(async lt=>{
      const {dados}=await API.ultimos3(lt.id);
      const r=dados[0]; const el=$(`ld-${lt.id}`); if(!el) return;
      if(!r){el.innerHTML='';return;}
      const p=r.prox||r.premio||0;
      el.innerHTML=`${r.acumulado?'<span class="lt-acum">ACUMULADO</span>':''}
        ${p?`<div class="lt-premio">${fmtPremio(p)}</div>`:''}
        ${r.dataProxConcurso?`<div class="lt-data-card">📅 ${r.dataProxConcurso}</div>`:''}`;
    }));
  },

  async _homeUser() {
    const nome = S.user.nome.split(' ')[0];
    const grupo = S.user.grupo || '';
    const h = new Date().getHours();
    const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    S._hLt = S._hLt || 'megasena';
    S._hRes = {};

    // Busca o grupo cadastrado pelo admin que bate com o nome informado
    const grpMatch = DB.grupos.list().find(g =>
      g.ativo && g.nome.toLowerCase().includes(grupo.toLowerCase())
    ) || DB.grupos.list().find(g =>
      g.ativo && grupo.toLowerCase().includes(g.nome.toLowerCase())
    );
    const wppLink = grpMatch?.link || null;

    $('view-home').innerHTML = `
      <div class="ug-box">
        <div class="ug-nome">${saud}, <strong>${nome}</strong>! 👋</div>
        ${grupo ? `<div class="ug-grupo">📋 ${grupo}</div>` : ''}
      </div>

      ${wppLink ? `
      <a class="ug-wpp" href="${wppLink}" target="_blank" rel="noopener">
        ${WPP_SVG(22)}
        <div class="ug-wpp-info">
          <div class="ug-wpp-titulo">Entrar no grupo do WhatsApp</div>
          <div class="ug-wpp-sub">${grpMatch.nome}</div>
        </div>
        <span class="ug-wpp-seta">›</span>
      </a>` : grupo ? `
      <div class="ug-wpp-off">
        ${WPP_SVG(18)}
        <span>Grupo "<strong>${grupo}</strong>" — link ainda não cadastrado pelo administrador</span>
      </div>` : ''}

      <div class="sectt mb8">Loterias — ao vivo</div>
      <div class="grid-lt mb4">
        ${Object.values(LOTERIAS).map(lt=>`
          <div class="lt-card ${lt.id===S._hLt?'lt-sel':''}" id="ltc-${lt.id}"
               style="background:linear-gradient(135deg,${lt.cor},${lt.cor2})"
               onclick="R._hSel('${lt.id}')">
            <span class="lt-emoji">${lt.emoji}</span>
            <div id="ld-${lt.id}" class="lt-dados-live"><div class="lt-loading-dot"></div></div>
            <div class="lt-nome">${lt.nome}</div>
            <div class="lt-dias">${lt.dias}</div>
          </div>`).join('')}
      </div>

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
        ${r.dataProxConcurso ? `<div class="lt-data-card">📅 ${r.dataProxConcurso}</div>` : ''}`;
    }));

    R._hRender(S._hLt);
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
          ${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}
        </div>
        <div class="hres-info">
          ${r.acumulado
            ? `<span class="badge b-acum">🔁 Acumulado</span>`
            : `<span class="txs muted">${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}</span>`}
          ${r.premio ? `<span class="hres-val" style="color:${lt.cor}">${fmtPremio(r.premio)}</span>` : ''}
        </div>
        ${r.prox ? `
        <div class="hres-prox">
          <span class="txs muted">Próximo estimado:</span>
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

      <button class="btn btn-p btn-f mt4 mb4" onclick="R._iaClick('${ltId}')">
        <img src="img/ze-loteca.png" class="ze-btn-ico" alt="Zé Loteca"> Quer que o Zé Loteca te ajude a escolher os números?
      </button>`;
  },

  _ltClick(lt){S.loteria=lt; R.ir('boloes');},
  _iaClick(lt){S.loteria=lt; R.ir('ia');},

  // ---- ZÉ LOTECA — ESTATÍSTICAS E GERADOR ----
  async _ia(params={}) {
    $('h-title').innerHTML='<img src="img/logo.png" alt="Lotérica Taguacenter" class="h-logo-img">';
    const ltId = S.loteria || 'megasena';
    const lt   = LOTERIAS[ltId];
    S._iaStats = S._iaStats || {};

    $('view-ia').innerHTML=`
      <div class="ze-card">
        <div class="ze-card-title">🎯 Zé Loteca te ajuda</div>
        <div class="ze-card-msg">"Consulte estatísticas, números quentes e frios, e deixa o Zé gerar seu jogo com inteligência — mas lembre: sorteio é sorteio, vai na fé! 🍀"</div>
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
            <div class="jogo-titulo">🎲 Zé Loteca gera seu jogo</div>
            <div class="jogo-sub">Mistura inteligente de 🔥 quentes + 🧊 frios + aleatórios</div>
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
          <div class="bolas">${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}</div>
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
      <div><div style="font-weight:700">${lt.nome}</div><div class="muted txs">${lt.dias} · R$ ${lt.preco.toFixed(2)}/jogo</div></div>
      ${admin?`<button class="btn btn-p btn-sm" style="margin-left:auto" onclick="R._mNovoBolao()">+ Novo</button>`:''}
    </div>`;
    if(!bs.length){h+=`<div class="empty"><div class="ei">${lt.emoji}</div><p>Nenhum bolão ativo.</p></div>`;}
    else h+=bs.map(b=>{
      const pg=b.membros.filter(m=>m.pago).length;
      return`<div class="card cc" style="border-left:4px solid ${lt.cor};position:relative" onclick="R._bClick('${b.id}')">
        <div class="bl-nome">${b.nome}</div>
        <div class="bl-meta">Concurso #${b.concurso} · ${b.membros.length} membros</div>
        <div class="bl-row">
          <span class="muted tsm">${b.cotas_total} cotas · ${fmt$(b.cotas_total*b.valor_cota)}</span>
          <span class="badge b-${b.status==='ativo'?'ativo':'pend'}">${b.status}</span>
        </div>
        <div class="bl-row mt8"><span class="txs muted">${pg}/${b.membros.length} pagos</span><span class="txs muted">${b.numeros.length} jogo${b.numeros.length!==1?'s':''}</span></div>
        ${admin?`<button class="btn-ico bl-del-btn" title="Excluir bolão" onclick="event.stopPropagation();R._delBolao('${b.id}','${b.nome.replace(/'/g,"\\'")}')">🗑️</button>`:''}
      </div>`;
    }).join('');
    $('view-boloes').innerHTML=h;
  },
  _bClick(id){S.bolao=id; R.ir('bolao');},
  _delBolao(id, nome) {
    if(!confirm(`Excluir o bolão "${nome}"?\n\nTodos os membros e pagamentos vinculados também serão removidos. Esta ação não pode ser desfeita.`)) return;
    DB.boloes.del(id); R._boloes();
  },

  // ---- BOLÃO DETALHE ----
  async _bolao() {
    const b=DB.boloes.get(S.bolao);
    if(!b){R.ir('boloes');return;}
    const lt=LOTERIAS[b.loteria];
    $('h-title').textContent=b.nome;
    $('view-bolao').innerHTML=`
      <div class="card mb12">
        <div class="fxb">
          <div><div style="font-weight:700">${b.nome}</div><div class="muted txs">Concurso #${b.concurso}</div></div>
          <div style="text-align:right"><div style="font-weight:700;color:${lt.cor}">${lt.nome} ${lt.emoji}</div><div class="muted txs">${b.membros.length} membros</div></div>
        </div>
        <div class="divider"></div>
        <div class="sectt">Jogos do bolão</div>
        ${b.numeros.map((ns,i)=>`<div class="mb8"><div class="txs muted mb8">Jogo ${i+1}</div><div class="bolas">${ns.map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}</div></div>`).join('')}
      </div>
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
      ${dados.slice(0,3).map(r=>`
        <div class="res-card">
          <div class="res-top"><span>Concurso #${r.numero||r.concurso||'—'}</span><span>${r.data||'—'}</span></div>
          <div class="bolas">${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}</div>
          <div class="fxb txs muted mt8">
            <span>${r.acumulado?'<span class="badge b-acum">Acumulado!</span>':`${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}`}</span>
            <span>${r.premio?fmtPremio(r.premio):''}</span>
          </div>
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
          <div class="bolas">${(r.dezenas||[]).map(n=>`<span class="bola" style="background:${lt.cor}">${n}</span>`).join('')}</div>
          <div class="fxb txs muted mt8">
            <span>${r.acumulado?'🔴 Acumulado':`${r.ganhadores??0} ganhador${r.ganhadores!==1?'es':''}`}</span>
            <span>${r.prox?`Próximo: ${fmtPremio(r.prox)}`:''}</span>
          </div>
        </div>`).join('');
  },

  // ---- ADMIN ----
  _admin() {
    if(!AUTH.isAdmin()){R.ir('home');return;}
    $('h-title').textContent='Administração';
    const vs=DB.vendas.list(), bs=DB.boloes.list();
    const tot=vs.reduce((s,v)=>s+(v.valor||0),0);
    const tm=vs.length?tot/vs.length:0;
    const aps=new Set(vs.map(v=>v.membro)).size;
    const isdev=S.user.role==='dev';
    const qtUsr=DB.usuarios.list().length;
    $('view-admin').innerHTML=`
      <div class="stat-row">
        <div class="stat-card"><div class="sv">${fmt$(tot)}</div><div class="sl">Total Vendido</div></div>
        <div class="stat-card"><div class="sv">${bs.length}</div><div class="sl">Bolões</div></div>
        <div class="stat-card"><div class="sv">${aps}</div><div class="sl">Apostadores</div></div>
        <div class="stat-card"><div class="sv">${fmt$(tm)}</div><div class="sl">Ticket Médio</div></div>
      </div>
      <div class="amenu">
        <div class="amenu-c" onclick="R.ir('whatsapp')"><span class="amenu-i">${WPP_SVG(38)}</span><div class="amenu-n">WhatsApp</div></div>
        <div class="amenu-c" onclick="R.ir('stats')"><span class="amenu-i">📊</span><div class="amenu-n">Estatísticas</div></div>
        <div class="amenu-c" onclick="R.ir('pagamentos')"><span class="amenu-i">💳</span><div class="amenu-n">Pagamentos</div></div>
        <div class="amenu-c" onclick="R.ir('boloes')"><span class="amenu-i">🎲</span><div class="amenu-n">Bolões</div></div>
        <div class="amenu-c" onclick="R.ir('usuarios')"><span class="amenu-i">👥</span><div class="amenu-n">Usuários <span style="font-size:.65rem;background:var(--primary);color:#000;border-radius:10px;padding:1px 5px;margin-left:2px">${qtUsr}</span></div></div>
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
        if (!mapa[k]) mapa[k] = { nome: m.nome, fone: m.fone||'', grupos: [], noApp: false };
        if (b.grupo && !mapa[k].grupos.includes(b.grupo)) mapa[k].grupos.push(b.grupo);
        if (m.fone && !mapa[k].fone) mapa[k].fone = m.fone;
      });
    });

    // Marca quem já está registrado no app
    DB.usuarios.list().forEach(u => {
      const k = u.nome.trim().toLowerCase();
      if (mapa[k]) { mapa[k].noApp=true; mapa[k]._id=u.id; mapa[k].ativo=u.ativo; }
      else mapa[k] = { nome:u.nome, fone:'', grupos:[], noApp:true, _id:u.id, ativo:u.ativo };
    });

    const todos = Object.values(mapa).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
    const soBolao = todos.filter(t=>!t.noApp);

    $('view-usuarios').innerHTML=`
      <div class="fxb mb12">
        <div class="sectt">Apostadores (${todos.length})</div>
        <button class="btn btn-p btn-sm" onclick="R._mNovoUser()">+ Adicionar</button>
      </div>
      ${soBolao.length ? `<div class="ia-aviso mb12">
        ⚠️ <strong>${soBolao.length}</strong> apostador${soBolao.length>1?'es':''} em bolões sem acesso ao app.
        <br><button class="btn btn-p btn-sm mt8" onclick="R._registrarTodos()">✅ Registrar todos no app</button>
      </div>` : ''}
      <div class="card">
        ${!todos.length
          ? '<div class="empty"><div class="ei">👥</div><p>Nenhum apostador encontrado.</p></div>'
          : todos.map(t=>`
          <div class="user-card">
            <div class="user-avatar" style="background:${t.noApp?'var(--primary)':'var(--border);color:var(--text)'}">${t.nome[0].toUpperCase()}</div>
            <div class="user-info">
              <div class="user-nome">${t.nome}
                ${t.noApp
                  ? `<span class="badge txs" style="background:${t.ativo?'var(--primary)':'var(--red)'};color:#fff;margin-left:6px">${t.ativo?'App ✓':'Inativo'}</span>`
                  : `<span class="badge txs" style="background:var(--border);color:var(--muted);margin-left:6px">Só bolão</span>`}
              </div>
              <div class="user-meta txs muted">
                ${t.fone?`📱 ${t.fone}`:''}${t.grupos.length?` · ${t.grupos.join(', ')}`:''}</div>
            </div>
            <div class="user-acts">
              ${t.noApp
                ? `<button class="btn btn-o btn-sm" onclick="R._toggleUser('${t._id}')">${t.ativo?'Desativar':'Ativar'}</button>
                   <button class="btn btn-d btn-sm" onclick="R._delUser('${t._id}')">✕</button>`
                : `<button class="btn btn-p btn-sm" onclick="R._registrarNaApp('${t.nome.replace(/'/g,"\\'").replace(/"/g,'\\"')}','${t.fone||''}')">Dar acesso</button>`}
            </div>
          </div>`).join('')}
      </div>
      <div class="ia-aviso mt12">💡 <strong>App ✓</strong> = pode entrar no app digitando o nome. <strong>Só bolão</strong> = participa de bolões mas ainda não tem acesso. Clique "Dar acesso" para liberar.</div>`;
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
    DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje() });
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
    DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje() });
    R._usuarios();
  },
  _registrarTodos() {
    const mapa = {};
    S.cache.boloes.forEach(b => (b.membros||[]).forEach(m => { mapa[m.nome.trim().toLowerCase()] = m.nome; }));
    const novos = Object.values(mapa).filter(n => !DB.usuarios.find(n));
    if (!novos.length) { alert('Todos já estão registrados!'); return; }
    if (!confirm(`Registrar ${novos.length} apostador${novos.length>1?'es':''} no app?`)) return;
    novos.forEach(nome => DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje() }));
    R._usuarios();
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
                       style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text)">
                <div class="txs muted">📱 +${p.fone}</div>
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
      DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje() });
      ok++;
    });
    MODAL.close();
    alert(`${ok} apostador${ok!==1?'es':''} importado${ok!==1?'s':''}!${dup?` (${dup} já existia${dup!==1?'m':''})`:''}`);
    R._usuarios();
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
          S.cache.boloes.filter(b=>b.grupo===g.nome).forEach(b=>(b.membros||[]).forEach(m=>ns.add(m.nome.trim().toLowerCase())));
          const cnt = ns.size || g.membros;
          return `
          <div class="grp-card">
            <div style="flex:1">
              <div class="grp-nome">${g.nome} ${g.jid?'<span class="badge txs" style="background:var(--primary);color:#fff;font-size:.6rem">Bot ✓</span>':''}</div>
              <div class="grp-meta">${cnt} apostador${cnt!==1?'es':''}</div>
            </div>
            <div class="grp-acts">
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
        <button class="dtab" onclick="WPP.setDest('pessoa',this)">👤 Participante</button>
      </div>
      <div id="dest-body"></div>
      <button class="btn btn-g btn-f mt8" onclick="WPP.send()">📤 Enviar</button>
      <div class="ia-aviso mt12">💡 ${S.cartela?'A cartela será baixada automaticamente para você anexar.':'Carregue a cartela acima para enviá-la junto.'}</div>`;
    WPP.aoTrocarLt($('wlt')?.value || 'megasena');
    WPP.setDest(WPP._dest, document.querySelector('.dtab.on'));
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
  _delGrp(id){if(!confirm('Remover grupo?'))return; DB.grupos.del(id); R._whatsapp();},

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
  _aPag(id){const p=DB.pags.list().find(x=>x.id===id);if(!p)return; p.status='aprovado'; DB.pags.save(p); R._pagamentos();},
  _rPag(id){const p=DB.pags.list().find(x=>x.id===id);if(!p)return; p.status='rejeitado'; DB.pags.save(p); R._pagamentos();},

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
        ${DB.grupos.list().map(g=>`<option value="${g.nome}">${g.nome}</option>`).join('')}</select>
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
    DB.boloes.save({id:uid(),loteria:S.loteria,nome,grupo:$('mbg')?.value||'',
      cotas_total:parseInt($('mbq')?.value)||10,valor_cota:parseFloat($('mbv')?.value)||0,
      concurso:parseInt($('mbc')?.value)||0,status:'ativo',membros:[],
      numeros:nums.length?[nums]:[],criado:hoje()});
    MODAL.close(); R.ir('boloes');
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
        <div class="dev-row"><span class="dev-lbl">Status</span><span style="color:${c.bloqueado?'var(--red)':'var(--primary)'}">${c.bloqueado?'🔴 BLOQUEADO':'🟢 ATIVO'}</span></div>
      </div>
      <div class="dev-panel">
        <h3>🔒 Controle de Acesso</h3>
        <div class="dev-row">
          <span class="dev-lbl">Bloquear App</span>
          <label class="sw"><input type="checkbox" ${c.bloqueado?'checked':''} onchange="DEV.block(this.checked)"><span class="sl2"></span></label>
        </div>
        <div class="fg mt12"><label>Mensagem de bloqueio</label><textarea id="dev-msg" rows="2">${c.msg||'Sistema temporariamente indisponível. Entre em contato com o suporte.'}</textarea></div>
        <button class="btn btn-p btn-sm" onclick="DEV.saveMsg()">Salvar mensagem</button>
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
    await fetch(API_URL + '/api/wpp/conectar', { method: 'POST' });
    BOT._iniciarPolling();
  },

  async desconectar() {
    if (!confirm('Desconectar o bot do WhatsApp? Precisará escanear o QR novamente para reconectar.')) return;
    await fetch(API_URL + '/api/wpp/desconectar', { method: 'POST' });
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
    await fetch(API_URL + `/api/grupos/${grupoId}/jid`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid }),
    });
    const g = S.cache.grupos.find(x => x.id === grupoId);
    if (g) g.jid = jid;
  },

  async enviarGrupos(grupos, mensagem) {
    const targets = grupos.map(g => g.jid).filter(Boolean);
    if (!targets.length) return { ok: false, error: 'sem_jid' };
    try {
      const r = await fetch(API_URL + '/api/wpp/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, mensagem }),
      });
      return await r.json();
    } catch (e) { return { ok: false, error: e.message }; }
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
    WPP._msg=`🎰 *${lt.nome}* — Bolão Especial! 🍀\n\n💰 Prêmio estimado: *${pfmt}*\n📅 Sorteio: *${dtFmt}*\n${cotas?`🎟️ Cotas disponíveis: *${cotas}*\n`:''}\n✅ ${frase}\n📲 Confirme respondendo essa mensagem.\n\n_Jogue com responsabilidade. Sorteios são aleatórios e auditados pela Caixa._\n\n🍀 Lotérica Taguacenter — Seu parceiro de bolões`;
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
  _selGrupos: [],   // ids dos grupos selecionados
  _selParts: [],    // objetos {nome, fone, grupo, pago} selecionados
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
            <div class="dest-sub txs muted">${(()=>{const s=new Set();S.cache.boloes.filter(b=>b.grupo===g.nome).forEach(b=>(b.membros||[]).forEach(m=>s.add(m.nome.trim().toLowerCase())));const c=s.size||g.membros;return c+' apostador'+(c!==1?'es':'');})()}</div>
          </div>
        </label>`).join('')}</div>`;

    } else { // pessoa
      WPP._renderParts('');
    }
  },

  _toggleGrupo(id, on) {
    WPP._selGrupos = on ? [...WPP._selGrupos, id] : WPP._selGrupos.filter(x=>x!==id);
  },

  _getParticipantes() {
    const mapa = {};
    // Membros dos bolões (com fone, grupo, pago)
    S.cache.boloes.forEach(b => {
      (b.membros||[]).forEach(m => {
        const k = m.nome.trim().toLowerCase();
        if(!mapa[k]) mapa[k] = { nome:m.nome, fone:m.fone||'', grupos:[], pago:!!m.pago };
        if(b.grupo && !mapa[k].grupos.includes(b.grupo)) mapa[k].grupos.push(b.grupo);
        if(m.fone && !mapa[k].fone) mapa[k].fone = m.fone;
        if(m.pago) mapa[k].pago = true;
      });
    });
    // Apostadores registrados no app (mesmo sem bolão)
    DB.usuarios.list().forEach(u => {
      const k = u.nome.trim().toLowerCase();
      if(!mapa[k]) mapa[k] = { nome:u.nome, fone:'', grupos:[], pago:false };
    });
    return Object.values(mapa).sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
  },

  _renderParts(filtro='') {
    const el = $('dest-body'); if(!el) return;

    // Renderiza o shell (input + lista + volante pago) apenas uma vez — evita perda de foco
    if (!document.getElementById('dest-parts-lista')) {
      el.innerHTML = `
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

    // Atualiza só a lista (sem recriar o input)
    const todos = WPP._getParticipantes();
    const parts = todos.filter(p => !filtro || p.nome.toLowerCase().includes(filtro.toLowerCase()));
    const gruposComJid = DB.grupos.list().filter(g=>g.jid);

    let listaHtml;
    if (!todos.length) {
      // Nenhum participante cadastrado ainda
      listaHtml = `<div style="padding:16px;text-align:center">
        <div class="muted mb8">Nenhum participante cadastrado.</div>
        ${gruposComJid.length && BOT._status==='conectado'
          ? `<button class="btn btn-p btn-sm" onclick="WPP._importarTodosGrupos()">
               📱 Importar dos grupos WhatsApp
             </button>`
          : `<div class="txs muted">Adicione participantes em Admin → Apostadores.</div>`}
      </div>`;
    } else if (!parts.length) {
      listaHtml = `<div class="muted tsm tc" style="padding:16px">Nenhum participante encontrado.</div>`;
    } else {
      listaHtml = parts.map(p=>`
        <label class="dest-item ${p.pago?'part-pago':''}">
          <input type="checkbox" ${WPP._selParts.find(x=>x.nome===p.nome)?'checked':''}
                 onchange="WPP._togglePart(${JSON.stringify(p).replace(/"/g,"'")},this.checked)">
          <div class="dest-info">
            <div class="dest-nome">${p.nome} ${p.pago?'<span class="badge b-pago txs">Pago ✓</span>':''}</div>
            <div class="dest-sub txs muted">${p.grupos.join(' · ')||'—'} ${p.fone?'· '+p.fone:''}</div>
          </div>
        </label>`).join('');
    }
    document.getElementById('dest-parts-lista').innerHTML = listaHtml;
  },

  async _importarTodosGrupos() {
    const gs = DB.grupos.list().filter(g=>g.jid);
    if (!gs.length) return;
    MODAL.open(`<div class="m-title">📱 Buscando participantes...</div><div class="loading mt16"><div class="spinner"></div></div><p class="tc muted mt8">Consultando ${gs.length} grupo${gs.length>1?'s':''}...</p>`);

    // Busca todos os grupos em paralelo
    const resultados = await Promise.all(gs.map(async g => {
      try {
        const r = await fetch(API_URL+`/api/wpp/participantes/${encodeURIComponent(g.jid)}`);
        const d = await r.json();
        return d.ok ? { grupo: g.nome, parts: d.participantes } : { grupo: g.nome, erro: d.error };
      } catch(e) { return { grupo: g.nome, erro: e.message }; }
    }));

    // Agrupa todos os participantes únicos (por fone)
    const mapaFone = {};
    resultados.forEach(res => {
      if (res.erro) return;
      res.parts.forEach(p => {
        if (!mapaFone[p.fone]) mapaFone[p.fone] = { fone: p.fone, grupos: [] };
        if (!mapaFone[p.fone].grupos.includes(res.grupo)) mapaFone[p.fone].grupos.push(res.grupo);
      });
    });

    const todos = Object.values(mapaFone);
    const erros = resultados.filter(r=>r.erro);

    if (!todos.length) {
      MODAL.open(`<div class="m-title">⚠️ Sem participantes</div>
        <p class="tc muted">${erros.length ? 'Erro: '+erros.map(e=>e.grupo+': '+e.erro).join('<br>') : 'Nenhum participante encontrado nos grupos.'}</p>
        <button class="btn btn-p btn-f mt12" onclick="MODAL.close()">Fechar</button>`);
      return;
    }

    MODAL.open(`
      <div class="m-title">📱 Participantes dos grupos (${todos.length})</div>
      <p class="muted txs mb12">Preencha o nome de cada participante. Deixe em branco para pular.</p>
      <div style="max-height:55vh;overflow-y:auto">
        ${todos.map((p,i)=>`
          <div class="fr mb8" style="align-items:center;gap:8px">
            <input type="checkbox" id="wpi-${i}" checked>
            <div style="flex:1">
              <input type="text" id="wpn-${i}" placeholder="Nome do participante"
                     style="width:100%;padding:6px 10px;border-radius:8px;background:var(--input);border:1px solid var(--border);color:var(--text)">
              <div class="txs muted">📱 +${p.fone} · ${p.grupos.join(', ')}</div>
            </div>
          </div>`).join('')}
      </div>
      ${erros.length ? `<div class="txs" style="color:var(--red);margin-top:8px">⚠️ Erro em: ${erros.map(e=>e.grupo).join(', ')}</div>` : ''}
      <button class="btn btn-p btn-f mt12" onclick="WPP._salvarImportadosWPP(${JSON.stringify(todos).replace(/</g,'&lt;')})">✅ Cadastrar selecionados</button>
      <button class="btn btn-o btn-f mt8" onclick="MODAL.close()">Cancelar</button>
    `);
  },

  _salvarImportadosWPP(todos) {
    let ok=0, dup=0;
    todos.forEach((p,i) => {
      if (!document.getElementById(`wpi-${i}`)?.checked) return;
      const nome = document.getElementById(`wpn-${i}`)?.value?.trim();
      if (!nome) return;
      if (DB.usuarios.find(nome)) { dup++; return; }
      DB.usuarios.save({ id:uid(), nome, ativo:true, criado:hoje() });
      ok++;
    });
    MODAL.close();
    alert(`${ok} participante${ok!==1?'s':''} cadastrado${ok!==1?'s':''}!${dup?` (${dup} já existia${dup!==1?'m':''})`:''}`);
    WPP._renderParts('');
  },

  _togglePart(p, on) {
    WPP._selParts = on
      ? [...WPP._selParts.filter(x=>x.nome!==p.nome), p]
      : WPP._selParts.filter(x=>x.nome!==p.nome);
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
      if(BOT._status==='conectado'){ WPP._enviarViaBot(gs); return; }
      WPP._grupos=gs; WPP._passo=0; WPP._step(); return;
    }

    if(WPP._dest==='grupos') {
      const todos = DB.grupos.list().filter(g=>g.ativo);
      const gs = WPP._selGrupos.length
        ? todos.filter(g=>WPP._selGrupos.includes(g.id))
        : todos;
      if(!gs.length){ alert('Selecione ao menos um grupo.'); return; }
      if(BOT._status==='conectado'){ WPP._enviarViaBot(gs); return; }
      WPP._grupos=gs; WPP._passo=0; WPP._step(); return;
    }

    // Envio por participante (sempre manual — mais pessoal)
    if(!WPP._selParts.length){ alert('Selecione ao menos um participante.'); return; }
    WPP._enviarPartes(0);
  },

  async _enviarViaBot(gs) {
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

    MODAL.open(`
      <div class="m-title">🤖 Enviando via Bot</div>
      <div class="loading mt16 mb8"><div class="spinner"></div></div>
      <p class="tc muted">Enviando para <strong>${comJid.length}</strong> grupo${comJid.length!==1?'s':''}...</p>
      <p class="tc txs muted">Aguarde ~${comJid.length * 3}s (intervalo de segurança entre envios)</p>
      ${semJid.length ? `<div class="ia-aviso mt12">⚠️ ${semJid.length} grupo${semJid.length>1?'s':''} sem vínculo ignorados: ${semJid.map(g=>g.nome).join(', ')}</div>` : ''}
    `);

    const res = await BOT.enviarGrupos(comJid, WPP._msg);

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

  _enviarPartes(i) {
    const parts = WPP._selParts;
    if(i >= parts.length){ MODAL.close(); return; }
    const p = parts[i];
    const msg = WPP._volantePago ? WPP._msgPago(p.nome, p.grupos[0]) : WPP._msg;
    const enc = encodeURIComponent(msg);
    const foneNum = p.fone?.replace(/\D/g,'');
    const link = foneNum ? `https://wa.me/55${foneNum}?text=${enc}` : null;
    const tc = S.cartela;
    const pct = ((i/parts.length)*100).toFixed(0);

    if(tc) setTimeout(()=>CARTELA.download(), 400);

    MODAL.open(`
      <div class="m-title">📤 Envio por participante</div>
      <div class="pap-prog"><div class="pap-fill" style="width:${pct}%"></div></div>
      <div class="pap-info">Participante ${i+1} de ${parts.length}</div>
      <div class="pap-grp">${p.nome} ${p.pago?'<span class="badge b-pago">Pago ✓</span>':''}</div>
      <div class="pap-membros txs muted mb16">${p.grupos.join(' · ')||'—'} ${p.fone?'· '+p.fone:''}</div>
      ${tc?`<div class="ia-aviso mb12">⬇️ <strong>${tc.nome}</strong> baixado automaticamente — anexe no WhatsApp.</div>`:''}
      ${link
        ?`<a class="btn btn-g btn-f mb12" href="${link}" target="_blank" rel="noopener">${WPP_SVG(20)} Abrir conversa no WhatsApp</a>`
        :`<div class="ia-aviso mb12">⚠️ Participante sem número cadastrado. Adicione o telefone no bolão.</div>`}
      <div class="pap-msg-box mb16">${msg.replace(/\n/g,'<br>')}</div>
      <div class="fx fxg8">
        ${i>0?`<button class="btn btn-o" style="flex:1" onclick="WPP._enviarPartes(${i-1})">← Anterior</button>`:''}
        <button class="btn btn-p" style="flex:1" onclick="WPP._enviarPartes(${i+1})">
          ${i<parts.length-1?'Próximo →':'✅ Concluir'}
        </button>
      </div>`);
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
// DEV CONTROL
// =============================================
const DEV = {
  tap() {
    const now=Date.now();
    if(now-S.dtap_t>5000){S.dtaps=0;S.dtap_t=now;}
    S.dtaps++;
    if(S.dtaps>=7){S.dtaps=0; DEV._ask();}
  },
  _ask() {
    const pw=prompt('🔒 Acesso restrito. Senha:');
    if(pw===atob(APP._dk)){
      S.user={login:'dev',role:'dev',nome:'Desenvolvedor'};
      sessionStorage.setItem('ltr_s',JSON.stringify(S.user));
      const b=$('h-badge'); b.className='badge b-dev'; b.textContent='DEV';
      $('nav-user').hidden=true;
      $('nav-admin').hidden=false;
      R.ir('controle');
    } else if(pw!==null) alert('Senha incorreta.');
  },
  block(v) {
    const c=DB.ctrl.get(); c.bloqueado=v; DB.ctrl.set(c);
    DB.ctrl.log(`App ${v?'BLOQUEADO':'desbloqueado'}`);
    $('bloqueio').hidden=!v;
    if(v){$('bl-msg').textContent=c.msg||'Sistema temporariamente indisponível.';}
  },
  saveMsg() {
    const c=DB.ctrl.get(); c.msg=$('dev-msg')?.value?.trim()||''; DB.ctrl.set(c); alert('Mensagem salva!');
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
  _unblockAsk() {
    const pw=prompt('🔒 Senha de desbloqueio:');
    if(pw===atob(APP._dk)){
      const c=DB.ctrl.get(); c.bloqueado=false; DB.ctrl.set(c);
      DB.ctrl.log('Desbloqueado via tela de manutenção');
      $('bloqueio').hidden=true;
      DEV._continuar();
    } else if(pw!==null) alert('Senha incorreta.');
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

  atual() { return localStorage.getItem(this._key) || 'padrao'; },

  aplicar(id) {
    const t = TEMAS[id] || TEMAS.padrao;
    document.body.setAttribute('data-tema', t.id);
    localStorage.setItem(this._key, t.id);
    this._pararParticulas();
    this._atualizarFaixa(t);
    if (t.decos.length) this._iniciarParticulas(t);
    this._atualizarMetaColor(t.cores.bg2);
    if (S.user?.role) R.ir('admin');
  },

  carregar() {
    const t = TEMAS[this.atual()] || TEMAS.padrao;
    document.body.setAttribute('data-tema', t.id);
    this._atualizarFaixa(t);
    this._atualizarMetaColor(t.cores.bg2);
    if (t.decos.length) this._iniciarParticulas(t);
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
    const qt        = 35;
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
