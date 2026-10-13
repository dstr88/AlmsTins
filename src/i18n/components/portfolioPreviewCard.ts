// PortfolioPreviewCard (login-page mock) strings. This is a pre-auth, route-based
// component, so it receives `lang` as a PROP from LoginPageComponent (t.lang),
// not from the cookie. All numbers/$ are static mock values and stay as-is;
// tickers / chain names / "Crypto" / "DeFi" stay English.

import type { Lang } from '@/lib/i18n/locale';

export interface PortfolioPreviewCardLocale {
  lang: Lang;
  samplePortfolio: string;
  live: string;
  totalChangeToday: string;
  donutChangeToday: string;
  segCrypto: string;
  segStocks: string;
  segDefi: string;
  lastSynced: string;
  lastSyncedValue: string;
  footnote: string;
}

export const en: PortfolioPreviewCardLocale = {
  lang: 'en',
  samplePortfolio: 'Sample Portfolio',
  live: 'Live',
  totalChangeToday: '↑ +$2,340 today',
  donutChangeToday: '+4.1% today',
  segCrypto: 'Crypto',
  segStocks: 'Stocks',
  segDefi: 'DeFi',
  lastSynced: 'Last synced',
  lastSyncedValue: '2 min ago',
  footnote: 'Demo data. Connect your wallet, exchange, or brokerage to see yours.',
};

export const es: PortfolioPreviewCardLocale = {
  lang: 'es',
  samplePortfolio: "Portafolio de ejemplo",
  live: "En vivo",
  totalChangeToday: "↑ +$2,340 hoy",
  donutChangeToday: "+4.1% hoy",
  segCrypto: "Cripto",
  segStocks: "Acciones",
  segDefi: "DeFi",
  lastSynced: "Última sincronización",
  lastSyncedValue: "hace 2 min",
  footnote: "Datos de demostración. Conecta tu wallet, exchange o bróker para ver los tuyos.",
};

export const fr: PortfolioPreviewCardLocale = {
  lang: 'fr',
  samplePortfolio: "Portefeuille d'exemple",
  live: "En direct",
  totalChangeToday: "↑ +$2,340 aujourd'hui",
  donutChangeToday: "+4.1% aujourd'hui",
  segCrypto: "Crypto",
  segStocks: "Actions",
  segDefi: "DeFi",
  lastSynced: "Dernière synchronisation",
  lastSyncedValue: "il y a 2 min",
  footnote: "Données de démonstration. Connectez votre wallet, exchange ou courtier pour voir les vôtres.",
};

const MAP: Record<Lang, PortfolioPreviewCardLocale> = { en, es, fr };

export function getPortfolioPreviewCard(lang: Lang): PortfolioPreviewCardLocale {
  return MAP[lang] ?? en;
}
