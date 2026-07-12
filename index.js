const express = require('express');
const cors = require('cors');
const { v4: gerarUUID } = require('uuid');
const { MercadoPagoConfig, Payment } = require('mercadopago');
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('.')); // 🆕 Serve arquivos estáticos como index.html

const ASSINATURA_OFICIAL = "SELLFORGE|v1|DISCORD|FINANCE|OFICIAL";
const NOME_API = "SellForge API - Discord Finance";

const chavesSistema = new Map();
const contasMP = new Map();
const planos = new Map();
const acessos = new Map();

function gerarIDBot(req) {
  const ip = req.headers['x-forwarded-for'] || req.ip;
  const agente = req.headers['user-agent'] || 'discord-bot';
  return Buffer.from(`${ASSINATURA_OFICIAL}|${ip}|${agente}`).toString('base64');
}

function validarChave(chave, idBot) {
  if (!chavesSistema.has(chave)) return {ok:false, motivo:"Chave inválida"};
  const d = chavesSistema.get(chave);
  if (d.idDispositivo !== idBot) return {ok:false, motivo:"Só funciona no mesmo local"};
  if (!d.ativa || new Date() > new Date(d.validade)) return {ok:false, motivo:"Assinatura vencida"};
  return {ok:true, dados:d};
}

app.post('/api/sellforge/alugar', (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { periodo = "mensal" } = req.body;
    const dias = {trial:1, diario:1, semanal:7, mensal:30, anual:365}[periodo] || 30;
    const chave = `SF-API-${gerarUUID().slice(0,8).toUpperCase()}`;
    const validoAte = new Date(Date.now() + dias * 86400000);
    chavesSistema.set(chave, {chave, idDispositivo:idBot, ativa:true, validade:validoAte.toISOString()});
    res.json({sucesso:true, chaveSistema:chave, validoAte});
  } catch {
    res.json({bloqueado:true, aviso:`Só funciona: ${NOME_API}`});
  }
});

app.post('/api/sellforge/configurar-mp', async (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { chaveSistema, accessToken } = req.body;
    const v = validarChave(chaveSistema, idBot);
    if (!v.ok) return res.json(v);
    const mp = new MercadoPagoConfig({accessToken});
    contasMP.set(idBot, {mp, ativo:true});
    res.json({sucesso:true, mensagem:"Mercado Pago configurado"});
  } catch {
    res.json({sucesso:false, aviso:"Chave MP inválida"});
  }
});

app.post('/api/sellforge/criar-plano', (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { chaveSistema, tipo, valor, desc } = req.body;
    const v = validarChave(chaveSistema, idBot);
    if (!v.ok) return res.json(v);
    const duracao = {trial:1, diario:1, semanal:7, mensal:30, anual:365}[tipo];
    if (!duracao) return res.json({aviso:"Use: trial/diario/semanal/mensal/anual"});
    const idPlano = `PL-${gerarUUID().slice(0,6).toUpperCase()}`;
    if (!planos.has(idBot)) planos.set(idBot, new Map());
    planos.get(idBot).set(idPlano, {tipo, duracao, valor:Number(valor.toFixed(2)), desc});
    res.json({sucesso:true, idPlano});
  } catch {
    res.json({sucesso:false});
  }
});

app.post('/api/sellforge/gerar-pix', async (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { chaveSistema, idPlano, idUsuario } = req.body;
    const v = validarChave(chaveSistema, idBot);
    if (!v.ok) return res.json(v);
    const conta = contasMP.get(idBot);
    const plano = planos.get(idBot).get(idPlano);
    if (!conta || !plano) return res.json({aviso:"Configure MP e plano primeiro"});
    const pagamento = await new Payment(conta.mp).create({
      transaction_amount: plano.valor,
      description: `Aluguel: ${plano.desc}`,
      payment_method_id: "pix",
      external_reference: `SF-${idUsuario}-${gerarUUID().slice(0,5)}`
    });
    const pix = pagamento.point_of_interaction?.transaction_data || {};
    res.json({sucesso:true, idPagamento:pagamento.id, qrCode: pix.qr_code_base64 || "", copiaCola: pix.qr_code || ""});
  } catch {
    res.json({sucesso:false, aviso:"Erro ao gerar PIX"});
  }
});

app.post('/api/sellforge/verificar', async (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { chaveSistema, idPagamento, idUsuario, idPlano } = req.body;
    const v = validarChave(chaveSistema, idBot);
    if (!v.ok) return res.json(v);
    const conta = contasMP.get(idBot);
    const plano = planos.get(idBot).get(idPlano);
    const detalhe = await new Payment(conta.mp).get(idPagamento);
    if (detalhe.status === "approved") {
      const validoAte = new Date(Date.now() + plano.duracao * 86400000);
      acessos.set(`${idBot}-${idUsuario}`, {ativo:true, validoAte});
      return res.json({sucesso:true, liberado:true, validoAte});
    }
    res.json({sucesso:true, liberado:false, status:detalhe.status});
  } catch {
    res.json({sucesso:false});
  }
});

app.get('/api/sellforge/checar-acesso', (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { chaveSistema, idUsuario } = req.query;
    const v = validarChave(chaveSistema, idBot);
    if (!v.ok) return res.json(v);
    const dado = acessos.get(`${idBot}-${idUsuario}`);
    if (!dado || !dado.ativo || new Date() > new Date(dado.validoAte)) {
      return res.json({ativo:false});
    }
    res.json({ativo:true, validoAte:dado.validoAte});
  } catch {
    res.json({ativo:false});
  }
});

app.get('/api/sellforge/gerar-dado', (req, res) => {
  try {
    const idBot = gerarIDBot(req);
    const { chaveSistema, tipo } = req.query;
    const v = validarChave(chaveSistema, idBot);
    if (!v.ok) return res.json(v);
    let dado;
    if (tipo === "aleatorio") dado = `SF-${gerarUUID().slice(0,10).toUpperCase()}`;
    else if (tipo === "numero") dado = String(Math.floor(1e9 + Math.random() * 9e9));
    else if (tipo === "cpf") {
      const n = Array.from({length:9}, ()=>Math.floor(Math.random()*9));
      const d1 = ((n[0]*10 + n[1]*9 + n[2]*8 + n[3]*7 + n[4]*6 + n[5]*5 + n[6]*4 + n[7]*3 + n[8]*2)*10)%11%10;
      const d2 = ((n[0]*11 + n[1]*10 + n[2]*9 + n[3]*8 + n[4]*7 + n[5]*6 + n[6]*5 + n[7]*4 + n[8]*3 + d1*2)*10)%11%10;
      dado = n.join("") + d1 + d2;
    }
    res.json({sucesso:true, dado});
  } catch {
    res.json({sucesso:false});
  }
});

module.exports = app;
