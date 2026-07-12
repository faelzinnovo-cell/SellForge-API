const express = require('express');
const cors = require('cors');
const { v4: gerarUUID } = require('uuid');
const app = express();

app.use(cors());
app.use(express.static('.'));
app.use(express.json());

// ======================================
// 🔐 DADOS FIXOS DA MARCA - PROTEGIDOS
// ======================================
const ASSINATURA_OFICIAL = "SELLFORGE|v1|PAINEL|OFICIAL";
const NOME_SISTEMA = "SellForge API - Painel Cliente";
const PLANOS_DISPONIVEIS = {
  basico: { nome: "Plano Básico", duracaoDias: 30, limiteRequisicoes: 500, descricao: "Sensibilidade + Gerador" },
  profissional: { nome: "Plano Profissional", duracaoDias: 30, limiteRequisicoes: 2500, descricao: "Todos os recursos + Pack" },
  ultra: { nome: "Plano Ultra", duracaoDias: 30, limiteRequisicoes: 10000, descricao: "Acesso total + suporte" }
};

// Armazenamento temporário (reinicia se servidor desligar — depois pode trocar por arquivo)
const dispositivos = new Map();
const chavesAcesso = new Map();

// ======================================
// 🛡️ FUNÇÕES DE SEGURANÇA
// ======================================
function gerarIDDispositivo(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const agente = req.headers['user-agent'] || 'desconhecido';
  return Buffer.from(`${ASSINATURA_OFICIAL}|${ip}|${agente}`).toString('base64');
}

function verificarIntegridade() {
  return { valido: true, marca: NOME_SISTEMA, assinatura: ASSINATURA_OFICIAL };
}

function verificarDispositivo(req) {
  const id = gerarIDDispositivo(req);
  if (!dispositivos.has(id)) dispositivos.set(id, { primeiroAcesso: new Date() });
  return id;
}

// ======================================
// ⚙️ FUNÇÃO: ALUGAR API = GERAR CHAVE AUTOMÁTICA
// ======================================
app.post('/api/sellforge/alugar', (req, res) => {
  try {
    const idDisp = verificarDispositivo(req);
    const { plano } = req.body;
    const integridade = verificarIntegridade();

    if (!integridade.valido) throw new Error("Sistema alterado");
    if (!PLANOS_DISPONIVEIS[plano]) return res.json({ erro: "Plano inválido" });

    const dadosPlano = PLANOS_DISPONIVEIS[plano];
    const chave = `SF-${gerarUUID().split('-')[0].toUpperCase()}`;
    const dataAtual = new Date();
    const dataValidade = new Date();
    dataValidade.setDate(dataAtual.getDate() + dadosPlano.duracaoDias);

    chavesAcesso.set(chave, {
      chave,
      idDispositivo: idDisp,
      plano: dadosPlano.nome,
      descricao: dadosPlano.descricao,
      limiteRequisicoes: dadosPlano.limiteRequisicoes,
      usosFeitos: 0,
      dataInicio: dataAtual.toISOString(),
      dataValidade: dataValidade.toISOString(),
      ativa: true
    });

    res.json({
      sellforge: true,
      sistema: NOME_SISTEMA,
      sucesso: true,
      mensagem: "✅ API ALUGADA COM SUCESSO - CHAVE GERADA",
      dados: chavesAcesso.get(chave)
    });

  } catch (erro) {
    res.json({
      sellforge: false,
      bloqueado: true,
      aviso: "❌ Somente funciona com o sistema oficial: SellForge API - Painel Cliente"
    });
  }
});

// ======================================
// ⚙️ VALIDAR CHAVE PARA USO DAS FERRAMENTAS
// ======================================
function validarChave(chave, idDisp) {
  if (!chavesAcesso.has(chave)) return { valido: false, motivo: "Chave não existe" };
  const dados = chavesAcesso.get(chave);
  if (dados.idDispositivo !== idDisp) return { valido: false, motivo: "Chave usada em outro aparelho" };
  if (!dados.ativa) return { valido: false, motivo: "Chave desativada" };
  if (new Date() > new Date(dados.dataValidade)) return { valido: false, motivo: "Chave vencida" };
  if (dados.usosFeitos >= dados.limiteRequisicoes) return { valido: false, motivo: "Limite de uso atingido" };
  
  dados.usosFeitos += 1;
  chavesAcesso.set(chave, dados);
  return { valido: true, dados };
}

// ======================================
// ⚙️ RECURSOS DAS SUAS APIS
// ======================================
app.post('/api/sellforge/calcular-sensibilidade', (req, res) => {
  try {
    const idDisp = verificarDispositivo(req);
    const { chave, dpi } = req.body;
    const checagem = validarChave(chave, idDisp);
    if (!checagem.valido) return res.json({ sucesso: false, aviso: checagem.motivo });

    const dpiNum = Number(dpi);
    const sens = {
      geral: Math.max(1, Math.min(100, Math.round(102 - (dpiNum / 7.8)))),
      miraPonto: Math.max(1, Math.min(100, Math.round(98 - (dpiNum / 9.2)))),
      mira2x: Math.max(1, Math.min(100, Math.round(95 - (dpiNum / 10.1)))),
      mira4x: Math.max(1, Math.min(100, Math.round(91 - (dpiNum / 11.3)))),
      miraFranco: Math.max(1, Math.min(100, Math.round(68 - (dpiNum / 14.5)))),
      camera: Math.max(1, Math.min(100, Math.round(73 - (dpiNum / 13.8))))
    };

    res.json({ sucesso: true, marca: NOME_SISTEMA, configuracao: sens });
  } catch {
    res.json({ aviso: "❌ Sistema não oficial" });
  }
});

app.get('/api/sellforge/gerar-sensibilidade', (req, res) => {
  try {
    const idDisp = verificarDispositivo(req);
    const chave = req.query.chave;
    const checagem = validarChave(chave, idDisp);
    if (!checagem.valido) return res.json({ sucesso: false, aviso: checagem.motivo });

    const sens = {
      geral: Math.floor(Math.random() * 28) + 68,
      miraPonto: Math.floor(Math.random() * 23) + 72,
      mira2x: Math.floor(Math.random() * 25) + 70,
      mira4x: Math.floor(Math.random() * 27) + 63,
      miraFranco: Math.floor(Math.random() * 32) + 38,
      camera: Math.floor(Math.random() * 30) + 52
    };

    res.json({ sucesso: true, marca: NOME_SISTEMA, configuracao: sens });
  } catch {
    res.json({ aviso: "❌ Sistema não oficial" });
  }
});

app.get('/api/sellforge/meu-acesso', (req, res) => {
  try {
    const idDisp = verificarDispositivo(req);
    const chave = req.query.chave;
    if (!chavesAcesso.has(chave) || chavesAcesso.get(chave).idDispositivo !== idDisp)
      return res.json({ ativo: false, mensagem: "Sem acesso válido" });

    res.json({ ativo: true, dados: chavesAcesso.get(chave) });
  } catch {
    res.json({ ativo: false, mensagem: "Sistema inválido" });
  }
});

// Iniciar
const porta = process.env.PORT || 3000;
app.listen(porta, () => {
  console.log(`
=============================================
⚡ SELLFORGE API - PAINEL CLIENTE
🔒 Proteção: Assinatura + Dispositivo + Chave
🚫 Sem pagamentos | 🚫 Sem compartilhamento
=============================================
  `);
});
