// APP LOTERIAS — CONFIGURAÇÕES CENTRAIS

const APP = {
  nome: 'Lotérica Taguacenter',
  versao: '1.0.0',
};

const LOTERIAS = {
  megasena:  { id:'megasena',  nome:'Mega-Sena',   emoji:'🎰', dezenas:6,  max:60,  preco:5.00, cor:'#209869', cor2:'#0d4f35', api:'megasena',  dias:'Quarta e Sábado' },
  quina:     { id:'quina',     nome:'Quina',        emoji:'🎯', dezenas:5,  max:80,  preco:2.50, cor:'#6d0e7d', cor2:'#3a0742', api:'quina',     dias:'Segunda a Sábado' },
  lotofacil: { id:'lotofacil', nome:'Lotofácil',    emoji:'🍀', dezenas:15, max:25,  preco:3.00, cor:'#930089', cor2:'#4f0049', api:'lotofacil', dias:'Segunda a Sábado' },
  lotomania: { id:'lotomania', nome:'Lotomania',    emoji:'🎪', dezenas:20, max:100, preco:3.00, cor:'#f78100', cor2:'#7a3e00', api:'lotomania', dias:'Segunda e Quinta' },
  timemania: { id:'timemania', nome:'Timemania',    emoji:'⚽', dezenas:10, max:80,  preco:3.50, cor:'#41b13b', cor2:'#1d5a1a', api:'timemania', dias:'Ter, Qui e Sáb' },
  duplasena: { id:'duplasena', nome:'Dupla Sena',   emoji:'🎲', dezenas:6,  max:50,  preco:2.50, cor:'#a31040', cor2:'#5c091f', api:'duplasena', dias:'Ter, Qui e Sáb' },
  diadesorte:{ id:'diadesorte',nome:'Dia de Sorte', emoji:'🌟', dezenas:7,  max:31,  preco:2.50, cor:'#108743', cor2:'#063d1e', api:'diadesorte',dias:'Terça e Sábado' },
};

const FRASES_ZE = [
  'Jogue com responsabilidade! 🎯',
  'Bora! Hoje é o nosso dia de sorte! 🍀',
  'Lembre: não gaste antes do dinheiro cair na conta! 😂',
  'Quem não arrisca, não petisca! 🎰',
  'Dinheiro na conta primeiro, festa depois! 🥳',
  'Os números quentes estão fervendo hoje! 🔥',
  'Bolão reunido, família unida! 👨‍👩‍👧‍👦',
  'Hoje pode ser o dia! Vai que é sua! 🚀',
  'Aposte, mas nunca mais do que pode perder! 💡',
  'Sorte favorece quem tenta! 😄',
  'Número frio hoje pode ser quente amanhã! 🌡️',
  'Kkk não gaste o prêmio antes de ganhar! 💸',
];

// ─── TEMAS SAZONAIS ────────────────────────────────────────────────────────
const TEMAS = {
  padrao:        { id:'padrao',        nome:'Padrão',                     emoji:'🎰', desc:'Tema original do app',         decos:[], cores:{ bg:'#0f172a', bg2:'#1e293b', bg3:'#273449', primary:'#10b981', gold:'#f59e0b', border:'#334155' } },
  mega_virada:   { id:'mega_virada',   nome:'Mega da Virada',             emoji:'🎆', desc:'31 de Dezembro · Ano Novo',    decos:['✨','🎆','🎇','🥂','🎊','⭐'], cores:{ bg:'#08080f', bg2:'#101026', bg3:'#18183a', primary:'#FFD700', gold:'#ff9500', border:'#2a2a55' } },
  sao_joao:      { id:'sao_joao',      nome:'Quina de São João',          emoji:'🎪', desc:'Festa Junina · Junho',          decos:['🎪','🌽','🔥','⭐','🎊','🎆'], cores:{ bg:'#180400', bg2:'#2a0800', bg3:'#3d0e00', primary:'#FF6B00', gold:'#FFD700', border:'#5a1a00' } },
  pascoa:        { id:'pascoa',        nome:'Mega de Páscoa',             emoji:'🐣', desc:'Semana Santa · Março/Abril',   decos:['🐣','🌸','🥚','🌷','🐰','💐'], cores:{ bg:'#14072a', bg2:'#1e0d3d', bg3:'#2a1250', primary:'#c45af5', gold:'#f5c45a', border:'#3d1a65' } },
  independencia: { id:'independencia', nome:'Lotofácil Independência',    emoji:'🇧🇷', desc:'7 de Setembro',               decos:['🇧🇷','⭐','🌿','💚','🌟','🎯'], cores:{ bg:'#001a00', bg2:'#002600', bg3:'#003300', primary:'#00d45a', gold:'#FFD700', border:'#006600' } },
  natal:         { id:'natal',         nome:'Natal',                      emoji:'🎄', desc:'Dezembro · Feliz Natal',       decos:['🎄','❄️','⭐','🎁','🔔','🦌'], cores:{ bg:'#0a160a', bg2:'#0f220f', bg3:'#152e15', primary:'#2ecc71', gold:'#FFD700', border:'#1a5a1a' } },
  maes:          { id:'maes',          nome:'Mega Dia das Mães',          emoji:'🌸', desc:'Segundo Domingo de Maio',      decos:['🌸','💕','🌹','🌷','💐','🥰'], cores:{ bg:'#18060f', bg2:'#2a0c1c', bg3:'#3d1228', primary:'#ff5f9e', gold:'#ffb3d1', border:'#5a1a35' } },
  pais:          { id:'pais',          nome:'Mega Dia dos Pais',          emoji:'👔', desc:'Segundo Domingo de Agosto',    decos:['👔','⭐','🏆','💪','🎯','🥃'], cores:{ bg:'#080c1a', bg2:'#0d1226', bg3:'#121832', primary:'#3b82f6', gold:'#f59e0b', border:'#1e2d55' } },
  criancas:      { id:'criancas',      nome:'Mega Dia das Crianças',      emoji:'🎈', desc:'12 de Outubro',                decos:['🎈','🎠','🍭','🎊','🎡','🌈'], cores:{ bg:'#08081a', bg2:'#0f0f2a', bg3:'#15153a', primary:'#ff9f00', gold:'#ff5252', border:'#2a1a45' } },
  copa:          { id:'copa',          nome:'Copa / Timemania',           emoji:'⚽', desc:'Temporada de Futebol',         decos:['⚽','🏆','🌟','🥅','📣','🎯'], cores:{ bg:'#001000', bg2:'#001800', bg3:'#002000', primary:'#FFDD00', gold:'#00c851', border:'#003800' } },
};

const MOCK = {
  megasena: [
    { numero:2780, data:'09/11/2024', dezenas:['04','11','23','38','51','59'], acumulado:false, ganhadores:2,  premio:45000000 },
    { numero:2779, data:'06/11/2024', dezenas:['07','14','22','33','47','55'], acumulado:true,  ganhadores:0,  premio:39000000 },
    { numero:2778, data:'02/11/2024', dezenas:['01','08','19','29','44','58'], acumulado:true,  ganhadores:0,  premio:32000000 },
  ],
  quina: [
    { numero:6328, data:'09/11/2024', dezenas:['08','17','32','55','78'], acumulado:false, ganhadores:5,  premio:2800000 },
    { numero:6327, data:'08/11/2024', dezenas:['03','21','34','60','72'], acumulado:false, ganhadores:3,  premio:1900000 },
    { numero:6326, data:'07/11/2024', dezenas:['11','25','41','56','79'], acumulado:false, ganhadores:7,  premio:3200000 },
  ],
  lotofacil: [
    { numero:3218, data:'09/11/2024', dezenas:['01','02','05','07','09','11','14','16','18','19','20','22','23','24','25'], acumulado:false, ganhadores:52, premio:1700000 },
    { numero:3217, data:'08/11/2024', dezenas:['01','03','04','07','08','10','12','14','15','17','19','21','22','24','25'], acumulado:false, ganhadores:38, premio:1500000 },
    { numero:3216, data:'07/11/2024', dezenas:['02','04','06','08','09','11','13','15','16','18','20','21','23','24','25'], acumulado:false, ganhadores:61, premio:2100000 },
  ],
  lotomania: [
    { numero:2618, data:'07/11/2024', dezenas:['03','11','17','22','28','35','41','47','52','58','63','71','79','84','91','94','95','96','98','99'], acumulado:false, ganhadores:1, premio:8000000 },
    { numero:2617, data:'04/11/2024', dezenas:['02','08','14','21','27','33','40','46','51','57','62','70','78','83','90','93','94','96','97','99'], acumulado:true,  ganhadores:0, premio:7200000 },
    { numero:2616, data:'31/10/2024', dezenas:['01','07','13','20','26','32','39','45','50','56','61','69','77','82','89','92','93','95','97','98'], acumulado:true,  ganhadores:0, premio:6500000 },
  ],
  timemania: [
    { numero:2108, data:'09/11/2024', dezenas:['05','12','19','28','37','44','53','61','72','79'], acumulado:false, ganhadores:3, premio:4500000 },
    { numero:2107, data:'07/11/2024', dezenas:['02','09','16','25','34','41','50','58','69','76'], acumulado:false, ganhadores:2, premio:3800000 },
    { numero:2106, data:'05/11/2024', dezenas:['07','14','21','30','39','46','55','63','74','77'], acumulado:true,  ganhadores:0, premio:3200000 },
  ],
  duplasena: [
    { numero:2598, data:'09/11/2024', dezenas:['06','14','22','31','40','48'], acumulado:false, ganhadores:1, premio:9000000 },
    { numero:2597, data:'07/11/2024', dezenas:['03','11','19','28','37','45'], acumulado:false, ganhadores:2, premio:7500000 },
    { numero:2596, data:'05/11/2024', dezenas:['08','16','24','33','42','50'], acumulado:true,  ganhadores:0, premio:6200000 },
  ],
  diadesorte: [
    { numero:978, data:'09/11/2024', dezenas:['04','09','15','20','24','28','31'], acumulado:false, ganhadores:8,  premio:1200000 },
    { numero:977, data:'05/11/2024', dezenas:['02','07','12','18','23','27','30'], acumulado:false, ganhadores:5,  premio: 950000 },
    { numero:976, data:'02/11/2024', dezenas:['01','06','11','17','22','26','29'], acumulado:false, ganhadores:11, premio:1400000 },
  ],
};
