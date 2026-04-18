/**
 * B3 (Bovespa) listed companies with tickers and sectors.
 * Source: B3 classification system.
 */

export interface BovespaCompany {
  name: string;
  ticker: string;
  sector: string;
}

export const B3_SECTORS = [
  'Petróleo, Gás e Biocombustíveis',
  'Materiais Básicos',
  'Bens Industriais',
  'Consumo Não Cíclico',
  'Consumo Cíclico',
  'Saúde',
  'Financeiro',
  'Tecnologia da Informação',
  'Telecomunicações',
  'Utilidade Pública',
  'Imobiliário',
  'Energia',
  'Mineração',
  'Varejo',
  'Agronegócio',
  'Educação',
  'Transporte e Logística',
  'Saneamento',
  'Seguros',
  'Construção Civil',
] as const;

export const BOVESPA_COMPANIES: BovespaCompany[] = [
  // --- Petróleo, Gás e Biocombustíveis ---
  { name: 'Petrobras', ticker: 'PETR4', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Petrobras ON', ticker: 'PETR3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'PRIO', ticker: 'PRIO3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: '3R Petroleum', ticker: 'RRRP3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Petrorecôncavo', ticker: 'RECV3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Ultrapar', ticker: 'UGPA3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Vibra Energia', ticker: 'VBBR3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Cosan', ticker: 'CSAN3', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Raízen', ticker: 'RAIZ4', sector: 'Petróleo, Gás e Biocombustíveis' },
  { name: 'Braskem', ticker: 'BRKM5', sector: 'Petróleo, Gás e Biocombustíveis' },

  // --- Mineração e Materiais Básicos ---
  { name: 'Vale', ticker: 'VALE3', sector: 'Mineração' },
  { name: 'CSN Mineração', ticker: 'CMIN3', sector: 'Mineração' },
  { name: 'Gerdau', ticker: 'GGBR4', sector: 'Materiais Básicos' },
  { name: 'Gerdau Metalúrgica', ticker: 'GOAU4', sector: 'Materiais Básicos' },
  { name: 'Usiminas', ticker: 'USIM5', sector: 'Materiais Básicos' },
  { name: 'CSN', ticker: 'CSNA3', sector: 'Materiais Básicos' },
  { name: 'Suzano', ticker: 'SUZB3', sector: 'Materiais Básicos' },
  { name: 'Klabin', ticker: 'KLBN11', sector: 'Materiais Básicos' },
  { name: 'Dexco', ticker: 'DXCO3', sector: 'Materiais Básicos' },
  { name: 'Irani', ticker: 'RANI3', sector: 'Materiais Básicos' },

  // --- Financeiro ---
  { name: 'Itaú Unibanco', ticker: 'ITUB4', sector: 'Financeiro' },
  { name: 'Itaú Unibanco ON', ticker: 'ITUB3', sector: 'Financeiro' },
  { name: 'Bradesco', ticker: 'BBDC4', sector: 'Financeiro' },
  { name: 'Bradesco ON', ticker: 'BBDC3', sector: 'Financeiro' },
  { name: 'Banco do Brasil', ticker: 'BBAS3', sector: 'Financeiro' },
  { name: 'Santander Brasil', ticker: 'SANB11', sector: 'Financeiro' },
  { name: 'BTG Pactual', ticker: 'BPAC11', sector: 'Financeiro' },
  { name: 'Nubank (Nu Holdings)', ticker: 'ROXO34', sector: 'Financeiro' },
  { name: 'B3', ticker: 'B3SA3', sector: 'Financeiro' },
  { name: 'Cielo', ticker: 'CIEL3', sector: 'Financeiro' },
  { name: 'XP Inc.', ticker: 'XPBR31', sector: 'Financeiro' },
  { name: 'Banco Inter', ticker: 'INBR32', sector: 'Financeiro' },
  { name: 'Banco ABC Brasil', ticker: 'ABCB4', sector: 'Financeiro' },
  { name: 'Banrisul', ticker: 'BRSR6', sector: 'Financeiro' },

  // --- Seguros ---
  { name: 'BB Seguridade', ticker: 'BBSE3', sector: 'Seguros' },
  { name: 'Porto Seguro', ticker: 'PSSA3', sector: 'Seguros' },
  { name: 'SulAmérica', ticker: 'SULA11', sector: 'Seguros' },
  { name: 'IRB Brasil', ticker: 'IRBR3', sector: 'Seguros' },

  // --- Utilidade Pública / Energia ---
  { name: 'Eletrobras', ticker: 'ELET3', sector: 'Energia' },
  { name: 'Eletrobras PNB', ticker: 'ELET6', sector: 'Energia' },
  { name: 'CPFL Energia', ticker: 'CPFE3', sector: 'Energia' },
  { name: 'Engie Brasil', ticker: 'EGIE3', sector: 'Energia' },
  { name: 'Equatorial Energia', ticker: 'EQTL3', sector: 'Energia' },
  { name: 'Energisa', ticker: 'ENGI11', sector: 'Energia' },
  { name: 'Taesa', ticker: 'TAEE11', sector: 'Energia' },
  { name: 'Cemig', ticker: 'CMIG4', sector: 'Energia' },
  { name: 'Copel', ticker: 'CPLE6', sector: 'Energia' },
  { name: 'Neoenergia', ticker: 'NEOE3', sector: 'Energia' },
  { name: 'Alupar', ticker: 'ALUP11', sector: 'Energia' },
  { name: 'AES Brasil', ticker: 'AESB3', sector: 'Energia' },
  { name: 'Omega Energia', ticker: 'MEGA3', sector: 'Energia' },
  { name: 'CTEEP (ISA)', ticker: 'TRPL4', sector: 'Energia' },
  { name: 'Light', ticker: 'LIGT3', sector: 'Energia' },
  { name: 'Eneva', ticker: 'ENEV3', sector: 'Energia' },

  // --- Saneamento ---
  { name: 'Sabesp', ticker: 'SBSP3', sector: 'Saneamento' },
  { name: 'Sanepar', ticker: 'SAPR11', sector: 'Saneamento' },
  { name: 'Copasa', ticker: 'CSMG3', sector: 'Saneamento' },
  { name: 'Iguá Saneamento', ticker: 'IGSN3', sector: 'Saneamento' },

  // --- Telecomunicações ---
  { name: 'Vivo (Telefônica Brasil)', ticker: 'VIVT3', sector: 'Telecomunicações' },
  { name: 'TIM', ticker: 'TIMS3', sector: 'Telecomunicações' },
  { name: 'Oi', ticker: 'OIBR3', sector: 'Telecomunicações' },

  // --- Consumo Cíclico / Varejo ---
  { name: 'Magazine Luiza', ticker: 'MGLU3', sector: 'Varejo' },
  { name: 'Lojas Renner', ticker: 'LREN3', sector: 'Varejo' },
  { name: 'Americanas', ticker: 'AMER3', sector: 'Varejo' },
  { name: 'Via (Casas Bahia)', ticker: 'BHIA3', sector: 'Varejo' },
  { name: 'Petz', ticker: 'PETZ3', sector: 'Varejo' },
  { name: 'Arezzo', ticker: 'ARZZ3', sector: 'Varejo' },
  { name: 'Vivara', ticker: 'VIVA3', sector: 'Varejo' },
  { name: 'Grupo SBF (Centauro)', ticker: 'SBFG3', sector: 'Varejo' },
  { name: 'Soma (Grupo)', ticker: 'SOMA3', sector: 'Varejo' },
  { name: 'C&A Brasil', ticker: 'CEAB3', sector: 'Varejo' },
  { name: 'Track & Field', ticker: 'TFCO4', sector: 'Varejo' },
  { name: 'Assaí Atacadista', ticker: 'ASAI3', sector: 'Varejo' },
  { name: 'Carrefour Brasil', ticker: 'CRFB3', sector: 'Varejo' },
  { name: 'GPA (Pão de Açúcar)', ticker: 'PCAR3', sector: 'Varejo' },
  { name: 'RD (Raia Drogasil)', ticker: 'RADL3', sector: 'Varejo' },

  // --- Consumo Não Cíclico ---
  { name: 'Ambev', ticker: 'ABEV3', sector: 'Consumo Não Cíclico' },
  { name: 'JBS', ticker: 'JBSS3', sector: 'Consumo Não Cíclico' },
  { name: 'BRF', ticker: 'BRFS3', sector: 'Consumo Não Cíclico' },
  { name: 'Marfrig', ticker: 'MRFG3', sector: 'Consumo Não Cíclico' },
  { name: 'Minerva Foods', ticker: 'BEEF3', sector: 'Consumo Não Cíclico' },
  { name: 'M.Dias Branco', ticker: 'MDIA3', sector: 'Consumo Não Cíclico' },
  { name: 'Camil', ticker: 'CAML3', sector: 'Consumo Não Cíclico' },
  { name: 'Natura & Co', ticker: 'NTCO3', sector: 'Consumo Não Cíclico' },
  { name: 'Hypera Pharma', ticker: 'HYPE3', sector: 'Consumo Não Cíclico' },

  // --- Saúde ---
  { name: 'Hapvida', ticker: 'HAPV3', sector: 'Saúde' },
  { name: 'Rede D\'Or', ticker: 'RDOR3', sector: 'Saúde' },
  { name: 'Fleury', ticker: 'FLRY3', sector: 'Saúde' },
  { name: 'Dasa (Diagnósticos da América)', ticker: 'DASA3', sector: 'Saúde' },
  { name: 'Blau Farmacêutica', ticker: 'BLAU3', sector: 'Saúde' },
  { name: 'Odontoprev', ticker: 'ODPV3', sector: 'Saúde' },
  { name: 'Qualicorp', ticker: 'QUAL3', sector: 'Saúde' },

  // --- Tecnologia da Informação ---
  { name: 'TOTVS', ticker: 'TOTS3', sector: 'Tecnologia da Informação' },
  { name: 'Locaweb', ticker: 'LWSA3', sector: 'Tecnologia da Informação' },
  { name: 'Positivo Tecnologia', ticker: 'POSI3', sector: 'Tecnologia da Informação' },
  { name: 'Intelbras', ticker: 'INTB3', sector: 'Tecnologia da Informação' },
  { name: 'Clearsale', ticker: 'CLSA3', sector: 'Tecnologia da Informação' },
  { name: 'Méliuz', ticker: 'CASH3', sector: 'Tecnologia da Informação' },

  // --- Imobiliário / Construção Civil ---
  { name: 'MRV', ticker: 'MRVE3', sector: 'Construção Civil' },
  { name: 'Cyrela', ticker: 'CYRE3', sector: 'Construção Civil' },
  { name: 'EZTec', ticker: 'EZTC3', sector: 'Construção Civil' },
  { name: 'Even', ticker: 'EVEN3', sector: 'Construção Civil' },
  { name: 'Direcional Engenharia', ticker: 'DIRR3', sector: 'Construção Civil' },
  { name: 'Tenda', ticker: 'TEND3', sector: 'Construção Civil' },
  { name: 'Cury', ticker: 'CURY3', sector: 'Construção Civil' },
  { name: 'Lavvi', ticker: 'LAVV3', sector: 'Construção Civil' },
  { name: 'Multiplan', ticker: 'MULT3', sector: 'Imobiliário' },
  { name: 'Iguatemi', ticker: 'IGTI11', sector: 'Imobiliário' },
  { name: 'brMalls (Aliansce Sonae)', ticker: 'ALSO3', sector: 'Imobiliário' },
  { name: 'LOG Commercial Properties', ticker: 'LOGG3', sector: 'Imobiliário' },

  // --- Transporte e Logística ---
  { name: 'Localiza', ticker: 'RENT3', sector: 'Transporte e Logística' },
  { name: 'Rumo', ticker: 'RAIL3', sector: 'Transporte e Logística' },
  { name: 'CCR', ticker: 'CCRO3', sector: 'Transporte e Logística' },
  { name: 'Ecorodovias', ticker: 'ECOR3', sector: 'Transporte e Logística' },
  { name: 'Azul', ticker: 'AZUL4', sector: 'Transporte e Logística' },
  { name: 'GOL', ticker: 'GOLL4', sector: 'Transporte e Logística' },
  { name: 'Santos Brasil', ticker: 'STBP3', sector: 'Transporte e Logística' },
  { name: 'JSL', ticker: 'JSLG3', sector: 'Transporte e Logística' },
  { name: 'Vamos', ticker: 'VAMO3', sector: 'Transporte e Logística' },
  { name: 'Movida', ticker: 'MOVI3', sector: 'Transporte e Logística' },

  // --- Bens Industriais ---
  { name: 'WEG', ticker: 'WEGE3', sector: 'Bens Industriais' },
  { name: 'Embraer', ticker: 'EMBR3', sector: 'Bens Industriais' },
  { name: 'Weg S.A.', ticker: 'WEGE3', sector: 'Bens Industriais' },
  { name: 'Randon', ticker: 'RAPT4', sector: 'Bens Industriais' },
  { name: 'Tupy', ticker: 'TUPY3', sector: 'Bens Industriais' },
  { name: 'Marcopolo', ticker: 'POMO4', sector: 'Bens Industriais' },
  { name: 'Aeris Energy', ticker: 'AERI3', sector: 'Bens Industriais' },

  // --- Agronegócio ---
  { name: 'SLC Agrícola', ticker: 'SLCE3', sector: 'Agronegócio' },
  { name: 'São Martinho', ticker: 'SMTO3', sector: 'Agronegócio' },
  { name: 'Jalles Machado', ticker: 'JALL3', sector: 'Agronegócio' },
  { name: 'BrasilAgro', ticker: 'AGRO3', sector: 'Agronegócio' },
  { name: 'Boa Safra Sementes', ticker: 'SOJA3', sector: 'Agronegócio' },
  { name: '3tentos', ticker: 'TTEN3', sector: 'Agronegócio' },

  // --- Educação ---
  { name: 'Cogna (Kroton)', ticker: 'COGN3', sector: 'Educação' },
  { name: 'Yduqs', ticker: 'YDUQ3', sector: 'Educação' },
  { name: 'Ânima Educação', ticker: 'ANIM3', sector: 'Educação' },
  { name: 'Ser Educacional', ticker: 'SEER3', sector: 'Educação' },
  { name: 'Cruzeiro do Sul Educacional', ticker: 'CSED3', sector: 'Educação' },
];

// Remove duplicates (same ticker)
const seen = new Set<string>();
export const BOVESPA_UNIQUE: BovespaCompany[] = BOVESPA_COMPANIES.filter(c => {
  if (seen.has(c.ticker)) return false;
  seen.add(c.ticker);
  return true;
});
