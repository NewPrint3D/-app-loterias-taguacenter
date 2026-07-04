'use strict';
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Render fica atrás de proxy — necessário para req.ip correto
// X-Token-Renovado precisa estar exposto, senão o navegador não deixa o front ler o header
app.use(cors({ exposedHeaders: ['X-Token-Renovado'] }));
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---- HEALTH ----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// =============================================
// JWT — expira em 1h sem uso, com renovação deslizante
// =============================================
// JWT_SECRET vem de env var no Render. Fallback fixo só pra não travar o dev local
// (não regenerar aleatório aqui — isso invalidaria todas as sessões a cada restart do servidor).
const JWT_SECRET = process.env.JWT_SECRET || 'apploterias-taguacenter-dev-secret-local';
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET não definido — usando fallback fixo. Configure a env var no Render (senão qualquer um que veja este código pode forjar tokens de admin).');
}
const JWT_EXPIRES_IN = '1h';
const assinarToken = role => jwt.sign({ role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

// Rotas de escrita usadas por quem não tem login (cliente sem senha) — ficam de fora do gate.
// Toda rota pública nova precisa ser adicionada aqui E comentada no próprio app.post/put dela.
const ROTAS_ESCRITA_PUBLICAS = new Set(['/api/auth/login', '/api/pagamentos', '/api/config/log']);

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) return next();
  if (ROTAS_ESCRITA_PUBLICAS.has(req.path)) return next();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'Sessão expirada. Faça login novamente.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    res.setHeader('X-Token-Renovado', assinarToken(payload.role)); // renovação deslizante
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Sessão expirada. Faça login novamente.' });
  }
});

// ---- AUTH (admin / dev) ----
// Hashes vêm de env vars no Render (ADMIN_SENHA_HASH / DEV_SENHA_HASH).
// Fallback local só para não quebrar o dev local — gerar hash: bcrypt.hashSync('senha', 10)
const _loginHashes = {
  admin: process.env.ADMIN_SENHA_HASH || bcrypt.hashSync('admin123', 10),
  dev:   process.env.DEV_SENHA_HASH   || bcrypt.hashSync('dev@zeloteca2024', 10),
};
const _loginNomes = { admin: 'Administrador', dev: 'Desenvolvedor' };
const _loginTentativas = new Map(); // ip -> { falhas, bloqueadoAte }

app.post('/api/auth/login', async (req, res) => {
  const { login, senha } = req.body || {};
  const ip = req.ip;
  const agora = Date.now();
  const t = _loginTentativas.get(ip);
  if (t?.bloqueadoAte > agora) {
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const hash = _loginHashes[login];
  if (!hash || typeof senha !== 'string') {
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }
  const valido = await bcrypt.compare(senha, hash);
  if (!valido) {
    const falhas = (t?.falhas || 0) + 1;
    _loginTentativas.set(ip, { falhas, bloqueadoAte: falhas >= 5 ? agora + 5 * 60 * 1000 : 0 });
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }
  _loginTentativas.delete(ip);
  res.json({ ok: true, role: login, nome: _loginNomes[login], token: assinarToken(login) });
});

// Headers de navegador — a Caixa bloqueia (403) requisições sem eles vindas de servidor
const CAIXA_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Referer': 'https://loterias.caixa.gov.br/Paginas/Mega-Sena.aspx',
  'Origin': 'https://loterias.caixa.gov.br',
};

// ---- PROXY CAIXA (evita CORS no frontend) ----
app.get('/api/caixa/:loteria/:concurso?', async (req, res) => {
  const { loteria, concurso } = req.params;
  const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${loteria}/${concurso || ''}`;
  try {
    const r = await fetch(url, { headers: CAIXA_HEADERS });
    if (!r.ok) { res.status(r.status).json({ error: 'Caixa retornou ' + r.status }); return; }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- GRUPOS ----
app.get('/api/grupos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM grupos ORDER BY nome');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/grupos', async (req, res) => {
  const { id, nome, link, membros, ativo, jid } = req.body;
  try {
    await pool.query(
      `INSERT INTO grupos(id,nome,link,membros,ativo,jid) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET nome=$2,link=$3,membros=$4,ativo=$5,jid=$6`,
      [id, nome, link||'', membros||0, ativo!==false, jid||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/grupos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM grupos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- BOLÕES ----
app.get('/api/boloes', async (req, res) => {
  try {
    const boloes = await pool.query('SELECT * FROM boloes ORDER BY criado DESC');
    const membros = await pool.query('SELECT * FROM membros');
    const rows = boloes.rows.map(b => ({
      ...b,
      numeros: typeof b.numeros === 'string' ? JSON.parse(b.numeros || '[]') : (b.numeros || []),
      resultado: typeof b.resultado === 'string' ? JSON.parse(b.resultado) : (b.resultado || null),
      membros: membros.rows
        .filter(m => m.bolao_id === b.id)
        .map(m => ({ nome: m.nome, fone: m.fone, cotas: m.cotas, pago: m.pago, _id: m.id }))
    }));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/boloes', async (req, res) => {
  const { id, loteria, nome, grupo, cotas_total, valor_cota, concurso, status, numeros, criado, membros } = req.body;
  try {
    await pool.query(
      `INSERT INTO boloes(id,loteria,nome,grupo,cotas_total,valor_cota,concurso,status,numeros,criado)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT(id) DO UPDATE SET loteria=$2,nome=$3,grupo=$4,cotas_total=$5,valor_cota=$6,concurso=$7,
         status=CASE WHEN boloes.status='conferido' AND $8='ativo' THEN boloes.status ELSE $8 END,
         numeros=$9,criado=$10`,
      [id, loteria, nome, grupo||'', cotas_total||10, valor_cota||0, concurso||0, status||'ativo', JSON.stringify(numeros||[]), criado||'']
    );
    if (Array.isArray(membros)) {
      await pool.query('DELETE FROM membros WHERE bolao_id=$1', [id]);
      for (const m of membros) {
        await pool.query(
          'INSERT INTO membros(id,bolao_id,nome,fone,cotas,pago) VALUES($1,$2,$3,$4,$5,$6)',
          [m._id || crypto.randomUUID(), id, m.nome, m.fone||'', m.cotas||1, m.pago||false]
        );
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/boloes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM boloes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- VENDAS ----
app.get('/api/vendas', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM vendas ORDER BY data DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vendas', async (req, res) => {
  const { id, bolao_id, loteria, membro, cotas, valor, data } = req.body;
  try {
    await pool.query(
      'INSERT INTO vendas(id,bolao_id,loteria,membro,cotas,valor,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, bolao_id, loteria, membro, cotas||1, valor||0, data||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- PAGAMENTOS ----
app.get('/api/pagamentos', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM pagamentos ORDER BY data DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rota pública (cliente sem login envia comprovante) — só cria, sempre como 'pendente'.
// Nunca aceita status do corpo da requisição: sem isso, qualquer um poderia aprovar
// o próprio pagamento (ou de outro) reenviando o mesmo id com status='aprovado'.
app.post('/api/pagamentos', async (req, res) => {
  const { id, bolao_id, membro, concurso, img, data } = req.body;
  try {
    await pool.query(
      `INSERT INTO pagamentos(id,bolao_id,membro,concurso,img,data,status) VALUES($1,$2,$3,$4,$5,$6,'pendente')
       ON CONFLICT(id) DO NOTHING`,
      [id, bolao_id, membro, concurso||0, img||null, data||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aprovar/rejeitar comprovante — ação de admin, exige token (não está em ROTAS_ESCRITA_PUBLICAS)
app.put('/api/pagamentos/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pendente','aprovado','rejeitado'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  try {
    await pool.query('UPDATE pagamentos SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- USUÁRIOS ----
app.get('/api/usuarios', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM usuarios ORDER BY nome');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios', async (req, res) => {
  const { id, nome, ativo, criado } = req.body;
  try {
    await pool.query(
      `INSERT INTO usuarios(id,nome,ativo,criado) VALUES($1,$2,$3,$4)
       ON CONFLICT(id) DO UPDATE SET nome=$2,ativo=$3`,
      [id, nome, ativo!==false, criado||'']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- CONFIG ----
app.get('/api/config', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM config WHERE id=1');
    const row = r.rows[0] || {};
    if (row.logs && typeof row.logs === 'string') row.logs = JSON.parse(row.logs || '[]');
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/config', async (req, res) => {
  const { bloqueado, msg, cliente, licenca, validade } = req.body;
  try {
    await pool.query(
      `INSERT INTO config(id,bloqueado,msg,cliente,licenca,validade,logs) VALUES(1,$1,$2,$3,$4,$5,'[]')
       ON CONFLICT(id) DO UPDATE SET bloqueado=$1,msg=$2,cliente=$3,licenca=$4,validade=$5`,
      [bloqueado||false, msg||'', cliente||'Demo', licenca||'DEMO-2024', validade||'2025-12-31']
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pública (em ROTAS_ESCRITA_PUBLICAS) — disparada em todo login, inclusive cliente sem token
app.post('/api/config/log', async (req, res) => {
  const { m } = req.body;
  try {
    await pool.query(`INSERT INTO config(id,bloqueado,msg,cliente,licenca,validade,logs) VALUES(1,false,'','Demo','DEMO-2024','2025-12-31','[]') ON CONFLICT(id) DO NOTHING`);
    const c = await pool.query('SELECT logs FROM config WHERE id=1');
    const logs = (c.rows[0]?.logs || []);
    logs.unshift({ m, t: Date.now() });
    await pool.query('UPDATE config SET logs=$1 WHERE id=1', [JSON.stringify(logs.slice(0,50))]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================
// WHATSAPP BOT (Baileys)
// =============================================
let botSock   = null;
let botStatus = 'desconectado'; // desconectado | conectando | aguardando_qr | conectado
let botQr     = null;

let _pinoLog;
try { _pinoLog = require('pino')({ level: 'silent' }); } catch { _pinoLog = undefined; }

// Migração: coluna jid nos grupos
pool.query(`ALTER TABLE grupos ADD COLUMN IF NOT EXISTS jid TEXT DEFAULT ''`).catch(() => {});

// Tabelas persistentes
pool.query(`CREATE TABLE IF NOT EXISTS wpp_auth (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`).catch(() => {});
pool.query(`CREATE TABLE IF NOT EXISTS wpp_cadastros (
  jid TEXT PRIMARY KEY,
  ativo BOOLEAN DEFAULT true,
  mensagem TEXT,
  iniciado TIMESTAMPTZ DEFAULT NOW()
)`).catch(() => {});

async function pgAuthState() {
  await pool.query(`CREATE TABLE IF NOT EXISTS wpp_auth (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`);
  const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

  const read = async key => {
    const r = await pool.query('SELECT valor FROM wpp_auth WHERE chave=$1', [key]);
    if (!r.rows[0]) return null;
    try { return JSON.parse(r.rows[0].valor, BufferJSON.reviver); } catch { return null; }
  };
  const write = async (key, data) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await pool.query(`INSERT INTO wpp_auth(chave,valor) VALUES($1,$2) ON CONFLICT(chave) DO UPDATE SET valor=$2`, [key, json]);
  };
  const remove = async key => pool.query('DELETE FROM wpp_auth WHERE chave=$1', [key]);

  const creds = await read('creds') || initAuthCreds();
  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data = {};
        await Promise.all(ids.map(async id => {
          const v = await read(`k_${type}_${id}`);
          if (v != null) data[id] = v;
        }));
        return data;
      },
      set: async data => {
        await Promise.all(Object.entries(data).flatMap(([cat, items]) =>
          Object.entries(items).map(([id, v]) =>
            v != null ? write(`k_${cat}_${id}`, v) : remove(`k_${cat}_${id}`)
          )
        ));
      }
    }
  };
  return { state, saveCreds: () => write('creds', state.creds) };
}

async function conectarBot() {
  try {
    const {
      default: makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
    } = require('@whiskeysockets/baileys');
    const QR = require('qrcode');

    botStatus = 'conectando';
    const { state, saveCreds } = await pgAuthState();
    const { version } = await fetchLatestBaileysVersion();

    botSock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, _pinoLog),
      },
      logger: _pinoLog,
      printQRInTerminal: false,
      browser: ['Loterias Bot', 'Chrome', '1.0'],
      connectTimeoutMs: 60000,
      generateHighQualityLinkPreview: false,
    });

    botSock.ev.on('creds.update', saveCreds);

    // ---- LISTENER: cadastro automático por mensagem no grupo ----
    botSock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (msg.key.fromMe) continue;
          const groupJid = msg.key.remoteJid;
          if (!groupJid?.endsWith('@g.us')) continue; // só grupos

          // Verifica se este grupo está com cadastro ativo
          const cad = await pool.query(
            'SELECT 1 FROM wpp_cadastros WHERE jid=$1 AND ativo=true', [groupJid]
          );
          if (!cad.rows.length) continue;

          // Extrai texto da mensagem
          const texto = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            ''
          ).trim();

          if (!texto || texto.length < 3) continue;

          // Valida que parece um nome (letras, acentos, espaços — 3 a 60 chars)
          const eNome = /^[a-zA-ZÀ-ÿ\s]{3,60}$/.test(texto);
          const senderJid = msg.key.participant || groupJid;
          const fone = senderJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');

          if (!eNome) {
            await botSock.sendMessage(groupJid, {
              text: `❌ Para se cadastrar, responda apenas com seu *nome completo*.\nExemplo: _João Silva_`,
              mentions: [senderJid],
            });
            continue;
          }

          const nome = texto.replace(/\s+/g, ' ');

          // Verifica se já cadastrado pelo telefone (campo fone em membros) ou pelo nome em usuarios
          const { rows: exU } = await pool.query(
            `SELECT nome FROM usuarios WHERE LOWER(nome)=LOWER($1)`, [nome]
          );
          if (exU.length) {
            await botSock.sendMessage(groupJid, {
              text: `✅ *${exU[0].nome}*, você já está cadastrado! Pode participar dos bolões da Lotérica Taguacenter. 🎰`,
              mentions: [senderJid],
            });
            continue;
          }

          // Cadastra
          const novoId = crypto.randomUUID();
          const hoje = new Date().toISOString().split('T')[0];
          await pool.query(
            `INSERT INTO usuarios(id, nome, ativo, criado) VALUES($1,$2,true,$3)`,
            [novoId, nome, hoje]
          );

          await botSock.sendMessage(groupJid, {
            text: `🎉 *${nome}*, você foi cadastrado com sucesso!\n\nBem-vindo aos bolões da *Lotérica Taguacenter*! 🎰\nAcompanhe os resultados pelo nosso app.`,
            mentions: [senderJid],
          });
          console.log(`Cadastro automático: ${nome} (${fone}) no grupo ${groupJid}`);
        } catch (e) {
          console.error('Erro no cadastro automático:', e.message);
        }
      }
    });

    botSock.ev.on('connection.update', async upd => {
      const { connection, lastDisconnect, qr } = upd;
      if (qr) {
        botQr = await QR.toDataURL(qr);
        botStatus = 'aguardando_qr';
        console.log('Bot: QR gerado');
      }
      if (connection === 'open') {
        botStatus = 'conectado';
        botQr = null;
        console.log('Bot WhatsApp conectado!');
      }
      if (connection === 'close') {
        const { DisconnectReason: DR } = require('@whiskeysockets/baileys');
        const cod = lastDisconnect?.error?.output?.statusCode;
        botSock = null; botStatus = 'desconectado'; botQr = null;
        if (cod !== DR.loggedOut) {
          console.log('Bot: reconectando em 5s...');
          setTimeout(conectarBot, 5000);
        } else {
          console.log('Bot: deslogado — removendo credenciais');
          await pool.query('DELETE FROM wpp_auth');
        }
      }
    });
  } catch (e) {
    console.error('Bot: erro ao conectar —', e.message);
    botStatus = 'desconectado';
  }
}

// Reconecta automaticamente se houver credenciais salvas
setTimeout(async () => {
  try {
    const r = await pool.query(`SELECT 1 FROM wpp_auth WHERE chave='creds' LIMIT 1`);
    if (r.rows.length) { console.log('Credenciais WPP encontradas. Reconectando...'); conectarBot(); }
  } catch { /* tabela ainda não existe */ }
}, 3000);

// ---- ROTAS WPP BOT ----

app.get('/api/wpp/status', (req, res) => {
  res.json({ status: botStatus, qr: botQr });
});

app.get('/api/wpp/qr', (req, res) => {
  if (!botQr) {
    return res.send(`<html><body style="background:#0d1117;color:#fff;font-family:sans-serif;text-align:center;padding:40px">
      <h2>Status: ${botStatus}</h2>
      <p>QR ainda não disponível. Aguarde e <a href="/api/wpp/qr" style="color:#4ade80">recarregue</a>.</p>
    </body></html>`);
  }
  res.send(`<html><body style="background:#0d1117;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0">
    <p style="color:#fff;font-family:sans-serif;margin-bottom:16px;font-size:1.1rem">📱 WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
    <img src="${botQr}" style="width:280px;height:280px;border-radius:12px;background:#fff;padding:8px">
    <p style="color:#888;font-family:sans-serif;font-size:12px;margin-top:16px">
      Status: ${botStatus} · <a href="/api/wpp/qr" style="color:#4ade80">Atualizar QR</a>
    </p>
  </body></html>`);
});

app.post('/api/wpp/conectar', (req, res) => {
  if (botStatus === 'conectado') return res.json({ ok: true, msg: 'Já conectado' });
  if (botStatus === 'conectando' || botStatus === 'aguardando_qr')
    return res.json({ ok: true, msg: 'Aguardando conexão' });
  conectarBot();
  res.json({ ok: true, msg: 'Iniciando...' });
});

app.post('/api/wpp/desconectar', async (req, res) => {
  try {
    if (botSock) { await botSock.logout().catch(() => {}); botSock = null; }
    botStatus = 'desconectado'; botQr = null;
    await pool.query('DELETE FROM wpp_auth');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wpp/participantes/:jid', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ ok: false, error: 'Bot não conectado. Conecte o bot no Painel Dev.' });
  try {
    const jid = decodeURIComponent(req.params.jid);
    const meta = await botSock.groupMetadata(jid);
    const participantes = meta.participants.map(p => ({
      jid: p.id,
      fone: p.id.replace('@s.whatsapp.net', '').replace(/\D/g, ''),
      admin: !!(p.admin),
    }));
    res.json({ ok: true, nome: meta.subject, participantes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/wpp/grupos-bot', async (req, res) => {
  if (!botSock || botStatus !== 'conectado') return res.json({ ok: false, grupos: [] });
  try {
    const mapa = await botSock.groupFetchAllParticipating();
    const grupos = Object.entries(mapa).map(([jid, g]) => ({
      jid, nome: g.subject, membros: g.participants?.length || 0,
    }));
    res.json({ ok: true, grupos });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.put('/api/grupos/:id/jid', async (req, res) => {
  try {
    await pool.query('UPDATE grupos SET jid=$1 WHERE id=$2', [req.body.jid || '', req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wpp/enviar', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ error: 'Bot não conectado' });
  const { targets, mensagem, imagem } = req.body;
  if (!Array.isArray(targets) || !targets.length || !mensagem)
    return res.status(400).json({ error: 'Parâmetros inválidos' });

  const resultados = [];
  for (const jid of targets) {
    try {
      if (imagem) {
        const b64 = imagem.includes(',') ? imagem.split(',')[1] : imagem;
        await botSock.sendMessage(jid, { image: Buffer.from(b64, 'base64'), caption: mensagem });
      } else {
        await botSock.sendMessage(jid, { text: mensagem });
      }
      resultados.push({ jid, ok: true });
      console.log('Bot enviou para', jid);
    } catch (e) {
      console.error('Bot: falha em', jid, e.message);
      resultados.push({ jid, ok: false, erro: e.message });
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  res.json({ ok: true, resultados });
});

// ---- CADASTRO AUTOMÁTICO ----

app.post('/api/wpp/iniciar-cadastro', async (req, res) => {
  if (!botSock || botStatus !== 'conectado')
    return res.status(503).json({ ok: false, error: 'Bot não conectado' });
  const { grupos, mensagem } = req.body;
  if (!Array.isArray(grupos) || !grupos.length)
    return res.status(400).json({ ok: false, error: 'Informe ao menos um grupo' });

  const msg = mensagem ||
    '👋 Olá! Para participar dos nossos bolões, responda *esta mensagem* com seu *nome completo*.\n\n' +
    'Exemplo: _João da Silva_\n\n' +
    'Você será cadastrado automaticamente! 🎰';

  const erros = [];
  for (const g of grupos) {
    try {
      await pool.query(
        `INSERT INTO wpp_cadastros(jid, ativo, mensagem) VALUES($1, true, $2)
         ON CONFLICT(jid) DO UPDATE SET ativo=true, mensagem=$2, iniciado=NOW()`,
        [g.jid, msg]
      );
      await botSock.sendMessage(g.jid, { text: msg });
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      erros.push(g.nome + ': ' + e.message);
    }
  }
  res.json({ ok: true, erros });
});

app.get('/api/wpp/status-cadastro', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT jid, ativo, mensagem, iniciado FROM wpp_cadastros WHERE ativo=true`
    );
    // Conta quantos usuarios foram cadastrados desde o início do cadastro mais recente
    const desde = rows.length ? rows.reduce((min, r) =>
      new Date(r.iniciado) < new Date(min) ? r.iniciado : min, rows[0].iniciado
    ) : null;
    let novos = 0;
    if (desde) {
      const r2 = await pool.query(
        `SELECT COUNT(*) FROM usuarios WHERE criado >= $1::date`, [desde]
      );
      novos = parseInt(r2.rows[0].count, 10);
    }
    res.json({ ok: true, ativos: rows, novos });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/wpp/encerrar-cadastro', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE wpp_cadastros SET ativo=false WHERE ativo=true RETURNING jid`
    );
    // Envia mensagem de encerramento para cada grupo
    if (botSock && botStatus === 'conectado') {
      for (const r of rows) {
        try {
          await botSock.sendMessage(r.jid, {
            text: '✅ Cadastro encerrado! Obrigado a todos que se cadastraram. Acompanhe os bolões pelo nosso app. 🎉'
          });
          await new Promise(x => setTimeout(x, 1500));
        } catch {}
      }
    }
    res.json({ ok: true, encerrados: rows.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// =============================================
// CONFERÊNCIA AUTOMÁTICA DE RESULTADOS
// =============================================
const cron = require('node-cron');

pool.query(`ALTER TABLE boloes ADD COLUMN IF NOT EXISTS resultado JSONB`).catch(() => {});

const NOMES_LOTERIA = {
  megasena: 'Mega-Sena', quina: 'Quina', lotofacil: 'Lotofácil', lotomania: 'Lotomania',
  timemania: 'Timemania', duplasena: 'Dupla Sena', diadesorte: 'Dia de Sorte',
};

const CAIXA_TIMEOUT_MS = 10000;

// Busca direto da Caixa (com headers de navegador); cai pros proxies se a Caixa bloquear (403)
async function buscarResultadoCaixa(loteria, concurso) {
  const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${loteria}/${concurso}`;
  try {
    const r = await fetch(url, { headers: CAIXA_HEADERS, signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS) });
    if (r.ok) return await r.json();
  } catch {}
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  ];
  for (const p of proxies) {
    try {
      const r = await fetch(p, { signal: AbortSignal.timeout(CAIXA_TIMEOUT_MS) });
      if (!r.ok) continue;
      const j = await r.json();
      const data = j.contents ? JSON.parse(j.contents) : j;
      if (data && data.numero) return data;
    } catch {}
  }
  return null;
}

// Confere cada jogo do bolão contra as dezenas sorteadas e calcula prêmio pela faixa real da Caixa
function conferirJogos(numeros, dezenasSorteadas, faixas) {
  const set = new Set(dezenasSorteadas);
  const jogos = numeros.map(jogo => {
    const acertos = jogo.filter(n => set.has(n)).length;
    const faixa = faixas.find(f => f.acertos === acertos);
    const premio = faixa && faixa.valorPremio > 0 ? faixa.valorPremio : 0;
    return { numeros: jogo, acertos, premio };
  });
  const maiorAcerto = jogos.reduce((m, j) => Math.max(m, j.acertos), 0);
  const premioTotal = jogos.reduce((s, j) => s + j.premio, 0);
  return { jogos, maiorAcerto, premioTotal, premiado: premioTotal > 0 };
}

async function enviarResultadoWhatsApp(b, resultado) {
  if (!botSock || botStatus !== 'conectado') return;
  try {
    const g = await pool.query('SELECT jid FROM grupos WHERE nome=$1', [b.grupo]);
    const jid = g.rows[0]?.jid;
    if (!jid) return;
    const nomeLt = NOMES_LOTERIA[b.loteria] || b.loteria;
    const fmtMoeda = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const msg = resultado.premiado
      ? `🎉 PREMIADO! Bolão ${b.nome} acertou ${resultado.maiorAcerto} pontos na ${nomeLt}! Prêmio total: R$ ${fmtMoeda(resultado.premioTotal)} — R$ ${fmtMoeda(resultado.rateioPorCota)} por cota. Procure a lotérica!`
      : `📊 Resultado ${nomeLt} concurso ${b.concurso}: ${resultado.dezenas.join(' - ')}. Nosso bolão fez ${resultado.maiorAcerto} acertos. Não foi dessa vez — próximo bolão já disponível! 🍀`;
    await botSock.sendMessage(jid, { text: msg });
  } catch (e) {
    console.error('Conferência: falha ao enviar mensagem —', e.message);
  }
}

async function conferirUmBolao(b) {
  try {
    const dados = await buscarResultadoCaixa(b.loteria, b.concurso);
    // dados.numero !== concurso: a Caixa às vezes devolve o último concurso conhecido
    // em vez de erro quando o concurso pedido ainda não foi apurado
    if (!dados || !dados.listaDezenas || dados.numero !== b.concurso) {
      console.log(`Conferência: concurso ${b.concurso} de ${b.loteria} ainda não apurado — tenta na próxima execução.`);
      return;
    }
    // Sem faixas de rateio a apuração está incompleta — não dá pra saber se premiou. Tenta de novo depois.
    if (!Array.isArray(dados.listaRateioPremio) || !dados.listaRateioPremio.length) {
      console.log(`Conferência: concurso ${b.concurso} de ${b.loteria} sem rateio de prêmios ainda — tenta na próxima execução.`);
      return;
    }
    const faixas = dados.listaRateioPremio.map(f => {
      const m = String(f.descricaoFaixa || '').match(/\d+/);
      return { acertos: m ? parseInt(m[0], 10) : null, valorPremio: f.valorPremio || 0 };
    });
    const numeros = typeof b.numeros === 'string' ? JSON.parse(b.numeros || '[]') : (b.numeros || []);
    const { jogos, maiorAcerto, premioTotal, premiado } = conferirJogos(numeros, dados.listaDezenas, faixas);
    const resultado = {
      dezenas: dados.listaDezenas,
      dataApuracao: dados.dataApuracao || null,
      jogos, maiorAcerto, premioTotal, premiado,
      rateioPorCota: premiado ? Math.round((premioTotal / (b.cotas_total || 1)) * 100) / 100 : 0,
      conferidoEm: new Date().toISOString(),
    };

    // status só muda de 'ativo' pra 'conferido' se ainda estiver 'ativo' — evita processar
    // duas vezes o mesmo bolão caso duas execuções (cron + gatilho manual) se sobreponham
    const upd = await pool.query(
      `UPDATE boloes SET resultado=$1, status='conferido' WHERE id=$2 AND status='ativo'`,
      [JSON.stringify(resultado), b.id]
    );
    if (!upd.rowCount) return; // outra execução já conferiu este bolão nesse meio-tempo
    console.log(`Conferência: bolão "${b.nome}" conferido — ${maiorAcerto} acertos, premiado=${premiado}`);
    await enviarResultadoWhatsApp(b, resultado);
  } catch (e) {
    console.error(`Conferência: erro no bolão ${b.id} —`, e.message);
  }
}

let _conferenciaRodando = false;
async function conferirBoloes() {
  if (_conferenciaRodando) {
    console.log('Conferência: já em andamento, ignorando chamada concorrente.');
    return;
  }
  _conferenciaRodando = true;
  console.log('Conferência: iniciando verificação de resultados...');
  try {
    const boloes = (await pool.query(`SELECT * FROM boloes WHERE status = 'ativo'`)).rows;
    await Promise.allSettled(boloes.map(conferirUmBolao));
  } catch (e) {
    console.error('Conferência: erro ao buscar bolões —', e.message);
  } finally {
    _conferenciaRodando = false;
    console.log('Conferência: finalizada.');
  }
}

// Todo dia às 21h e 22h (horário de Brasília)
cron.schedule('0 21 * * *', conferirBoloes, { timezone: 'America/Sao_Paulo' });
cron.schedule('0 22 * * *', conferirBoloes, { timezone: 'America/Sao_Paulo' });

// Gatilho manual — força a conferência sem esperar o cron (retry manual, testes)
app.post('/api/boloes/conferir', async (req, res) => {
  try { await conferirBoloes(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
