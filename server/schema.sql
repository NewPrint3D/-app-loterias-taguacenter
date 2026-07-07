-- Schema do App Loterias Taguacenter
-- Execute no Neon SQL Editor para criar/recriar as tabelas

CREATE TABLE IF NOT EXISTS grupos (
  id      TEXT PRIMARY KEY,
  nome    TEXT NOT NULL,
  link    TEXT DEFAULT '',
  membros INTEGER DEFAULT 0,
  ativo   BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS boloes (
  id          TEXT PRIMARY KEY,
  loteria     TEXT NOT NULL,
  nome        TEXT NOT NULL,
  grupo       TEXT DEFAULT '',
  grupo_id    TEXT REFERENCES grupos(id) ON DELETE SET NULL,
  cotas_total INTEGER DEFAULT 10,
  valor_cota  NUMERIC DEFAULT 0,
  concurso    INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'ativo',
  numeros     JSONB DEFAULT '[]',
  criado      TEXT DEFAULT '',
  resultado   JSONB
);

CREATE TABLE IF NOT EXISTS grupo_membros (
  id       TEXT PRIMARY KEY,
  grupo_id TEXT REFERENCES grupos(id) ON DELETE CASCADE,
  nome     TEXT NOT NULL,
  fone     TEXT DEFAULT '',
  wpp_jid  TEXT DEFAULT '',
  ativo    BOOLEAN DEFAULT TRUE,
  criado   TEXT DEFAULT ''
);
-- Parcial: participante manual sem wpp_jid ('') pode coexistir várias vezes; só o MESMO wpp_jid
-- real no MESMO grupo é duplicata de verdade.
CREATE UNIQUE INDEX IF NOT EXISTS grupo_membros_grupo_wpp_jid_idx
  ON grupo_membros(grupo_id, wpp_jid) WHERE wpp_jid <> '';

CREATE TABLE IF NOT EXISTS membros (
  id       TEXT PRIMARY KEY,
  bolao_id TEXT REFERENCES boloes(id) ON DELETE CASCADE,
  nome     TEXT NOT NULL,
  fone     TEXT DEFAULT '',
  cotas    INTEGER DEFAULT 1,
  pago     BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS vendas (
  id       TEXT PRIMARY KEY,
  bolao_id TEXT,
  loteria  TEXT,
  membro   TEXT,
  cotas    INTEGER DEFAULT 1,
  valor    NUMERIC DEFAULT 0,
  data     TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pagamentos (
  id       TEXT PRIMARY KEY,
  bolao_id TEXT,
  membro   TEXT,
  concurso INTEGER DEFAULT 0,
  img      TEXT,
  data     TEXT DEFAULT '',
  status   TEXT DEFAULT 'pendente'
);

CREATE TABLE IF NOT EXISTS usuarios (
  id     TEXT PRIMARY KEY,
  nome   TEXT NOT NULL,
  ativo  BOOLEAN DEFAULT TRUE,
  criado TEXT DEFAULT '',
  fone   TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS config (
  id       INTEGER PRIMARY KEY DEFAULT 1,
  bloqueado BOOLEAN DEFAULT FALSE,
  msg      TEXT DEFAULT '',
  cliente  TEXT DEFAULT 'Demo',
  licenca  TEXT DEFAULT 'DEMO-2024',
  validade TEXT DEFAULT '2025-12-31',
  logs     JSONB DEFAULT '[]',
  admin_fone TEXT DEFAULT '',
  CONSTRAINT config_single_row CHECK (id = 1)
);

-- Garante que existe exatamente uma linha de config
INSERT INTO config(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

-- ============================================================
-- COTAS AO VIVO — bolão relâmpago (cronômetro + reserva atômica de cota + comprovante)
-- (o server.js também cria estas tabelas via CREATE TABLE IF NOT EXISTS no startup)
-- ============================================================
-- Um "lote" é uma oferta relâmpago de N cotas de um bolão, divulgada nos grupos com contador
-- regressivo. Status do lote: 'ativo' -> 'esgotado' (100% com comprovante) ou 'encerrado' (tempo).
CREATE TABLE IF NOT EXISTS lotes (
  id             TEXT PRIMARY KEY,
  bolao_id       TEXT,
  loteria        TEXT DEFAULT '',
  nome           TEXT DEFAULT 'Bolao',
  concurso       INTEGER DEFAULT 0,
  total_cotas    INTEGER NOT NULL,
  valor_cota     NUMERIC DEFAULT 0,
  duracao_min    INTEGER DEFAULT 10,
  inicia_em      TIMESTAMPTZ DEFAULT NOW(),
  expira_em      TIMESTAMPTZ,
  status         TEXT DEFAULT 'ativo',
  grupos         JSONB DEFAULT '[]',
  aviso50        BOOLEAN DEFAULT false,
  aviso_esgotado BOOLEAN DEFAULT false,
  espera         JSONB DEFAULT '[]',
  criado         TIMESTAMPTZ DEFAULT NOW()
);

-- Cada "cota" é um slot individual que um apostador reserva com o nome e depois anexa o comprovante.
-- Reserva atômica (UPDATE ... WHERE status='livre') evita dois pegarem a mesma cota.
-- Status da cota: 'livre' -> 'reservada' (só nome) -> 'comprovante' (anexou, conta no X/N) ->
-- 'paga' (admin conferiu e confirmou manualmente).
CREATE TABLE IF NOT EXISTS cotas (
  id           TEXT PRIMARY KEY,
  lote_id      TEXT REFERENCES lotes(id) ON DELETE CASCADE,
  numero       INTEGER,
  status       TEXT DEFAULT 'livre',
  nome         TEXT DEFAULT '',
  fone         TEXT DEFAULT '',
  comprovante  TEXT,
  reservada_em TIMESTAMPTZ,
  pago_em      TIMESTAMPTZ,
  criado       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cotas_lote ON cotas(lote_id);
