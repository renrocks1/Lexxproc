'use strict';

/**
 * Provedor de demonstração: gera dados fictícios, porém realistas e
 * determinísticos (mesma entrada → mesmo resultado), com números CNJ válidos.
 * Permite usar o sistema sem rede ou sem chaves de API (DEMO_MODE=1).
 * As movimentações "acontecem" ao longo do tempo, então o monitoramento
 * detecta novidades em dias diferentes.
 */

const { parseCNJ, calcularDV } = require('../lib/cnj');
const { TRIBUNAIS, tribunalPorSigla } = require('../lib/tribunais');
const { novoProcesso, ordenarMovimentos, resumo } = require('../lib/modelo');

const NOME = 'demo';

function rng(semente) {
  let h = 2166136261;
  for (const ch of String(semente)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const escolher = (r, arr) => arr[Math.floor(r() * arr.length)];

const CLASSES = {
  8: [[7, 'Procedimento Comum Cível'], [436, 'Procedimento do Juizado Especial Cível'], [1116, 'Execução Fiscal'],
    [159, 'Execução de Título Extrajudicial'], [12154, 'Execução de Alimentos'], [283, 'Ação Penal - Procedimento Ordinário']],
  5: [[985, 'Ação Trabalhista - Rito Ordinário'], [1125, 'Ação Trabalhista - Rito Sumaríssimo']],
  4: [[7, 'Procedimento Comum Cível'], [1116, 'Execução Fiscal'], [120, 'Mandado de Segurança Cível']],
};
const ASSUNTOS = {
  8: [[7779, 'Indenização por Dano Moral'], [7780, 'Indenização por Dano Material'], [9580, 'Cobrança de Aluguéis - Sem despejo'],
    [6226, 'IPTU/ Imposto Predial e Territorial Urbano'], [5626, 'Alimentos'], [11806, 'Planos de Saúde'], [7621, 'Inclusão Indevida em Cadastro de Inadimplentes']],
  5: [[2086, 'Horas Extras'], [2546, 'Verbas Rescisórias'], [1855, 'Indenização por Dano Moral'], [2021, 'Adicional de Insalubridade']],
  4: [[6114, 'Aposentadoria por Tempo de Contribuição'], [6101, 'Auxílio-Doença Previdenciário'], [5986, 'Contribuições Previdenciárias']],
};
const PF = ['Maria Aparecida da Silva', 'João Carlos Pereira', 'Ana Paula Souza', 'José Roberto Oliveira', 'Francisca Lima Santos',
  'Carlos Eduardo Ferreira', 'Juliana Rodrigues Alves', 'Antônio Marcos Costa', 'Patrícia Gomes Ribeiro', 'Luiz Fernando Martins'];
const PJ = ['Banco Horizonte S.A.', 'Telefônica Brasil Conecta Ltda.', 'Construtora Alvorada Ltda.', 'Seguradora Vitalis S.A.',
  'Município de Vila Nova', 'Instituto Nacional do Seguro Social - INSS', 'Varejo Popular Comércio Ltda.', 'Unimed Regional Cooperativa'];
const ADV = ['Rafael Teixeira Nunes', 'Camila Duarte Moraes', 'Bruno Henrique Lopes', 'Fernanda Castro Pinto', 'Gustavo Almeida Reis'];
const ROTEIRO = [
  [26, 'Distribuição', ['tipo de distribuição: sorteio']],
  [11383, 'Ato ordinatório', []],
  [60, 'Expedição de documento', ['tipo de documento: Mandado']],
  [106, 'Mandado', ['resultado: cumprido com finalidade atingida']],
  [85, 'Petição', ['tipo de petição: Contestação']],
  [51, 'Conclusão', ['tipo de conclusão: para despacho']],
  [11010, 'Mero expediente', []],
  [85, 'Petição', ['tipo de petição: Réplica']],
  [51, 'Conclusão', ['tipo de conclusão: para decisão']],
  [11009, 'Despacho', []],
  [970, 'Audiência', ['tipo de audiência: Conciliação', 'situação da audiência: realizada']],
  [51, 'Conclusão', ['tipo de conclusão: para sentença']],
  [219, 'Procedência em Parte', []],
  [92, 'Publicação', []],
  [85, 'Petição', ['tipo de petição: Apelação']],
  [123, 'Remessa', ['motivo da remessa: em grau de recurso']],
  [22, 'Baixa Definitiva', []],
];
const UFS_DEMO = ['SP', 'RJ', 'MG', 'RS', 'PR', 'BA', 'SC', 'PE', 'CE', 'GO', 'DF'];

function gerarNumero(r, tribunalFixo) {
  const seg = escolher(r, [8, 8, 8, 5, 4]);
  const uf = escolher(r, UFS_DEMO);
  const regiao = 1 + Math.floor(r() * (seg === 5 ? 24 : 6));
  const sigla = seg === 8 ? (uf === 'DF' ? 'TJDFT' : `TJ${uf}`) : seg === 5 ? `TRT${regiao}` : `TRF${regiao}`;
  const t = tribunalFixo || TRIBUNAIS.find((x) => x.sigla === sigla);
  const seq = String(Math.floor(r() * 9999999)).padStart(7, '0');
  const ano = String(2016 + Math.floor(r() * 9));
  const origem = String(1 + Math.floor(r() * 700)).padStart(4, '0');
  const dv = calcularDV(seq, ano, t.j, t.tr, origem);
  return `${seq}${dv}${ano}${t.j}${t.tr}${origem}`;
}

/** Gera o processo fictício correspondente a um número CNJ. */
function gerarProcesso(numero, { parteFixa } = {}) {
  const info = parseCNJ(numero);
  if (!info || !info.tribunal) return null;
  const r = rng(info.digitos);
  const seg = [4, 5].includes(info.j) ? info.j : 8;
  const p = novoProcesso(info.digitos);
  const [cc, cn] = escolher(r, CLASSES[seg]);
  p.classe = { codigo: cc, nome: cn };
  p.assuntos = [escolher(r, ASSUNTOS[seg]), escolher(r, ASSUNTOS[seg])]
    .filter((a, i, arr) => arr.findIndex((b) => b[0] === a[0]) === i)
    .map(([codigo, nome]) => ({ codigo, nome }));
  const vara = 1 + Math.floor(r() * 12);
  const tipoVara = seg === 5 ? 'Vara do Trabalho' : seg === 4 ? 'Vara Federal' : escolher(r, ['Vara Cível', 'Vara da Fazenda Pública', 'Vara de Família e Sucessões', 'Juizado Especial Cível']);
  p.orgaoJulgador = { codigo: 1000 + Math.floor(r() * 9000), nome: `${vara}ª ${tipoVara} - Foro ${info.origem}`, municipioIBGE: null };
  p.sistema = escolher(r, ['PJe', 'e-SAJ', 'Eproc', 'Projudi']);
  p.formato = 'Eletrônico';
  p.valorCausa = (5000 + Math.floor(r() * 250000)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const autor = parteFixa || escolher(r, PF);
  const reu = seg === 4 ? 'Instituto Nacional do Seguro Social - INSS' : escolher(r, PJ);
  const oab = () => `${100000 + Math.floor(r() * 400000)}/${info.tribunal.sigla.slice(-2).replace('FT', 'DF')}`;
  p.partes = [
    { polo: 'ativo', tipo: seg === 5 ? 'Reclamante' : 'Autor', nome: autor, documento: null, advogados: [{ nome: escolher(r, ADV), oab: oab() }] },
    { polo: 'passivo', tipo: seg === 5 ? 'Reclamado' : 'Réu', nome: reu, documento: null, advogados: [{ nome: escolher(r, ADV), oab: oab() }] },
  ];

  // Ajuizamento dentro do ano do número; movimentos espaçados até hoje.
  const inicio = new Date(Date.UTC(info.ano, Math.floor(r() * 12), 1 + Math.floor(r() * 27), 9 + Math.floor(r() * 8), Math.floor(r() * 60)));
  p.dataAjuizamento = inicio.toISOString().slice(0, 19);
  const agora = Date.now();
  let t = inicio.getTime();
  const movs = [];
  for (const [codigo, nome, complementos] of ROTEIRO) {
    if (t > agora) break;
    movs.push({ data: new Date(t).toISOString().slice(0, 19), codigo, nome, complementos, orgao: p.orgaoJulgador.nome, grau: 'G1' });
    t += (3 + Math.floor(r() * 90)) * 86400000 + Math.floor(r() * 36000000);
  }
  p.graus = ['G1'];
  p.movimentos = ordenarMovimentos(movs);
  p.ultimaAtualizacao = p.movimentos[0]?.data || p.dataAjuizamento;
  p.situacao = movs.some((m) => m.codigo === 22) ? 'Baixado' : 'Em andamento';
  p.fontes = [NOME];
  return p;
}

function gerarLista(semente, parteFixa, quantidade, tribunalFixo) {
  const r = rng(semente);
  const n = quantidade || 3 + Math.floor(r() * 6);
  const lista = [];
  for (let i = 0; i < n; i++) lista.push(gerarProcesso(gerarNumero(r, tribunalFixo), { parteFixa }));
  return { total: lista.length, resultados: lista.map(resumo), proximoCursor: null };
}

function criarDemo() {
  return {
    nome: NOME,
    rotulo: 'Demonstração (dados fictícios)',
    habilitado: true,
    suporta: ['cnj', 'nome', 'cpf', 'cnpj', 'oab', 'avancada'],
    async buscarPorNumero(numero) {
      return gerarProcesso(numero);
    },
    async buscarPorNome(nome) {
      const formatado = nome.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      return gerarLista(`nome:${nome.toLowerCase()}`, formatado);
    },
    async buscarPorDocumento(doc) {
      const r = rng(doc);
      return gerarLista(`doc:${doc}`, doc.length === 14 ? escolher(r, PJ) : escolher(r, PF));
    },
    async buscarPorOAB({ numero, uf }) {
      return gerarLista(`oab:${numero}${uf}`, null, 8);
    },
    async buscaAvancada({ tribunal, classeCodigo }) {
      const t = tribunalPorSigla(tribunal);
      if (!t || !t.alias) return { total: 0, resultados: [], proximoCursor: null };
      return gerarLista(`av:${tribunal}:${classeCodigo || ''}`, null, 10, t);
    },
  };
}

module.exports = { criarDemo, gerarProcesso, gerarNumero, rng };
