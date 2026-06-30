'use strict';
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---- HEALTH ----
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- PROXY CAIXA (evita CORS no frontend) ----
app.get('/api/caixa/:loteria/:concurso?', async (req, res) => {
  const { loteria, concurso } = req.params;
  const url = `https://servicebus2.caixa.gov.br/portaldeloterias/api/${loteria}/${concurso || ''}`;
  try {
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://loterias.caixa.gov.br/Paginas/Mega-Sena.aspx',
        'Origin': 'https://loterias.caixa.gov.br',
      }
    });
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
       ON CONFLICT(id) DO UPDATE SET loteria=$2,nome=$3,grupo=$4,cotas_total=$5,valor_cota=$6,concurso=$7,status=$8,numeros=$9,criado=$10`,
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

app.post('/api/pagamentos', async (req, res) => {
  const { id, bolao_id, membro, concurso, img, data, status } = req.body;
  try {
    await pool.query(
      `INSERT INTO pagamentos(id,bolao_id,membro,concurso,img,data,status) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET status=$7`,
      [id, bolao_id, membro, concurso||0, img||null, data||'', status||'pendente']
    );
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

// Tabela de sessão persistente
pool.query(`CREATE TABLE IF NOT EXISTS wpp_auth (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`).catch(() => {});

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

app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
