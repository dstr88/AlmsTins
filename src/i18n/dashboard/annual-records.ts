// Tax/records page — finance terminology is FIRST-PASS; gate behind a fluent finance-literate reviewer before authoritative (design.claude.md).

import type { Lang } from '@/lib/i18n/locale';

export interface AnnualRecordsLocale {
  lang: Lang;
  /** <Layout title> when admin */
  pageTitleAdmin: string;
  /** <Layout title> when non-admin */
  pageTitleUser: string;
  // ── Disclaimer modal ──────────────────────────────────────────────────────
  disclaimerTitle: string;
  disclaimerBody1: string;
  disclaimerBody2: string;
  disclaimerOk: string;
  // ── Hero ──────────────────────────────────────────────────────────────────
  heroTitle: string;
  heroSub: string;
  /** "{n} transaction{s} need review" — n=count, s='' or 's' */
  reviewWarning: (n: number) => string;
  // ── Year bar ──────────────────────────────────────────────────────────────
  yearBarLabel: string;
  // ── C1 (admin): Income & Records card ────────────────────────────────────
  incomeRecordsTitle: string;
  sectionTradIncome: string;
  docEmployment: string;
  docInterest: string;
  docDividend: string;
  docDistribution: string;
  docOtherIncome: string;
  docSocialSecurity: string;
  sectionDigitalAssets: string;
  sectionSelfCustody: string;
  sectionUploadCsv: string;
  uploadDropText: string;
  uploadBrowse: string;
  // ── C1 (non-admin): Data Health card ─────────────────────────────────────
  dataHealthTitle: string;
  sectionDataQuality: string;
  walletsConnected: (n: number) => string;
  noWalletsConnected: string;
  walletsUpToDate: string;
  walletsNeedSyncing: (n: number) => string;
  noWalletDataYet: string;
  exchangesConnected: (n: number) => string;
  noExchangesConnected: string;
  allTransactionsClassified: string;
  transactionsUnclassified: (n: number) => string;
  costBasisComplete: string;
  lotsMissingBasis: (n: number) => string;
  sectionQuickLinks: string;
  manageWallets: string;
  viewPortfolio: string;
  yearInReview: string;
  // ── C2: Data Sync Status card ─────────────────────────────────────────────
  dataSyncTitle: string;
  syncAllBtn: string;
  walletsSynced: string;
  staleNote: (n: number) => string;
  sectionSelfCustodyWallets: string;
  sectionExchangeAccounts: string;
  sectionExchangeImports: string;
  noData: string;
  never: string;
  // ── Row 2: Gains card ─────────────────────────────────────────────────────
  gainsTitle: (year: number) => string;
  labelShortTermGains: string;
  labelLongTermGains: string;
  labelInterestIncome: string;
  /** "Total taxable" (admin) */
  labelTotalTaxable: string;
  /** "Net realized" (non-admin) */
  labelNetRealized: string;
  sectionByAsset: string;
  noGainsNote: (year: number) => string;
  // ── Row 2: Losses card ────────────────────────────────────────────────────
  lossesTitle: string;
  labelTotalRealizedLosses: string;
  sectionByAssetWorstFirst: string;
  noLossesNote: string;
  // ── Row 2: Missing Cost Basis card ────────────────────────────────────────
  missingBasisTitle: string;
  basisClearScript: string;
  basisClearNote: string;
  basisWarningLabel: string;
  basisWarningLink: string;
  // ── Downloads ─────────────────────────────────────────────────────────────
  downloadsTitle: string;
  downloadsGroupForPreparer: string;
  downloadsGroupExports: string;
  downloadsGroupAdditional: string;
  downloadFifoCsv: string;
  downloadAnnualPdf: string;
  downloadYearSummaryPdf: string;
  downloadCapitalDisposals: string;
  downloadRealizedGains: string;
  downloadIncomeRecords: string;
  signUp: string;
  paid: string;
  // ── FAQ (admin) ───────────────────────────────────────────────────────────
  faqTitle: string;
  faqGroupUnderstanding: string;
  faqQ_stVsLt: string;
  faqA_stVsLt: string;
  faqQ_costBasis: string;
  faqA_costBasis: string;
  faqQ_fifo: string;
  faqA_fifo: string;
  faqQ_wailingWall: string;
  faqA_wailingWall: string;
  faqQ_taxableIncome: string;
  faqA_taxableIncome: string;
  faqQ_cardRebates: string;
  faqA_cardRebates: string;
  faqQ_cryptoTrades: string;
  faqA_cryptoTrades: string;
  faqQ_washSale: string;
  faqA_washSale: string;
  faqGroupDocsFiling: string;
  faqQ_needEveryDoc: string;
  faqA_needEveryDoc: string;
  faqQ_1099da: string;
  faqA_1099da: string;
  faqQ_1099recon: string;
  faqA_1099recon: string;
  faqQ_form8949: string;
  faqA_form8949: string;
  faqQ_schedD: string;
  faqA_schedD: string;
  faqQ_whatGiveCpa: string;
  faqA_whatGiveCpa: string;
  faqGroupHowAppWorks: string;
  faqQ_syncDoes: string;
  faqA_syncDoes: string;
  faqQ_reviewQueue: string;
  faqA_reviewQueue: string;
  faqQ_accuracy: string;
  faqA_accuracy: string;
  faqQ_yearMatters: string;
  faqA_yearMatters: string;
  // ── FAQ (non-admin) ───────────────────────────────────────────────────────
  faqGroupUnderstandingNumbers: string;
  faqQ_costBasisUser: string;
  faqA_costBasisUser: string;
  faqQ_fifoUser: string;
  faqA_fifoUser: string;
  faqQ_stVsLtUser: string;
  faqA_stVsLtUser: string;
  faqQ_wailingWallUser: string;
  faqA_wailingWallUser: string;
  faqQ_interestIncome: string;
  faqA_interestIncome: string;
  faqGroupHowAppWorksUser: string;
  faqQ_syncAllUser: string;
  faqA_syncAllUser: string;
  faqQ_reviewQueueUser: string;
  faqA_reviewQueueUser: string;
  faqQ_accuracyUser: string;
  faqA_accuracyUser: string;
  faqQ_yearMattersUser: string;
  faqA_yearMattersUser: string;
  faqQ_addMore: string;
  faqA_addMore: string;
  // ── Footer ────────────────────────────────────────────────────────────────
  footerDisclaimer: string;
  // ── JS strings (injected via define:vars) ─────────────────────────────────
  jsSyncing: string;
  jsSyncingWallets: string;
  jsRebuilding: string;
  jsSyncDone: string;
  jsSyncNetworkError: string;
  jsConfirmRemoveAccount: (label: string) => string;
  jsCouldNotDelete: string;
  jsUploadingFile: (name: string) => string;
  jsUploadNetworkError: string;
  jsRemoveFile: (name: string) => string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENGLISH
// ─────────────────────────────────────────────────────────────────────────────
export const en: AnnualRecordsLocale = {
  lang: 'en',
  pageTitleAdmin: 'Tax Hub | almsTins',
  pageTitleUser: 'Portfolio Hub | almsTins',
  // Disclaimer
  disclaimerTitle: 'Tax Season Reminder',
  disclaimerBody1:
    'almsTins is a record-keeping and analysis tool, <strong>not a tax preparation service.</strong> ' +
    'The figures shown are based solely on the transaction data you have imported. Results may be ' +
    'incomplete if any exchange imports, wallet syncs, or manual entries are missing.',
  disclaimerBody2:
    'Nothing on this page constitutes tax, legal, or financial advice. ' +
    '<strong>Always consult a qualified CPA or tax professional before filing.</strong>',
  disclaimerOk: "I understand — let's go",
  // Hero
  heroTitle: 'Annual Records Hub',
  heroSub:
    'Everything in one place — your accounts, your gains, your losses, and your exports. ' +
    'Your complete annual reconciliation, clearly organized.',
  reviewWarning: (n) =>
    `⚠️ ${n} transaction${n !== 1 ? 's' : ''} need review — these may affect your totals. →`,
  // Year bar
  yearBarLabel: 'Year',
  // C1 admin
  incomeRecordsTitle: 'Income & Records',
  sectionTradIncome: 'Traditional Income',
  docEmployment: 'Employment Income',
  docInterest: 'Interest Income',
  docDividend: 'Dividend Income',
  docDistribution: 'Distribution Income',
  docOtherIncome: 'Other Income',
  docSocialSecurity: 'Social Security',
  sectionDigitalAssets: 'Digital Asset Exchanges',
  sectionSelfCustody: 'Self-Custody Wallets',
  sectionUploadCsv: 'Upload CSV/PDF Records',
  uploadDropText: 'Drop a CSV or PDF here or ',
  uploadBrowse: 'browse',
  // C1 non-admin
  dataHealthTitle: 'Data Health',
  sectionDataQuality: 'Data Quality',
  walletsConnected: (n) => `${n} wallet${n !== 1 ? 's' : ''} connected`,
  noWalletsConnected: 'No wallets connected',
  walletsUpToDate: 'All wallets up to date',
  walletsNeedSyncing: (n) => `${n} wallet${n !== 1 ? 's' : ''} need syncing`,
  noWalletDataYet: 'No wallet data yet',
  exchangesConnected: (n) => `${n} exchange${n !== 1 ? 's' : ''} connected`,
  noExchangesConnected: 'No exchanges connected',
  allTransactionsClassified: 'All transactions classified',
  transactionsUnclassified: (n) => `${n} transactions unclassified`,
  costBasisComplete: 'Cost basis complete',
  lotsMissingBasis: (n) => `${n} lots missing cost basis`,
  sectionQuickLinks: 'Quick Links',
  manageWallets: 'Manage wallets',
  viewPortfolio: 'View portfolio',
  yearInReview: 'Year in review',
  // C2 sync status
  dataSyncTitle: 'Data Sync Status',
  syncAllBtn: 'Sync All',
  walletsSynced: 'Wallets synced',
  staleNote: (n) => `⚠️ ${n} wallet${n !== 1 ? 's' : ''} stale (>60 days)`,
  sectionSelfCustodyWallets: 'Self-Custody Wallets',
  sectionExchangeAccounts: 'Exchange Accounts',
  sectionExchangeImports: 'Exchange Imports',
  noData: 'No data',
  never: 'Never',
  // Gains
  gainsTitle: (year) => `Gains — ${year}`,
  labelShortTermGains: 'Short-term gains',
  labelLongTermGains: 'Long-term gains',
  labelInterestIncome: 'Interest & income',
  labelTotalTaxable: 'Total taxable',
  labelNetRealized: 'Net realized',
  sectionByAsset: 'By asset',
  noGainsNote: (year) => `No gains recorded for ${year}.`,
  // Losses
  lossesTitle: 'Wailing Wall',
  labelTotalRealizedLosses: 'Total realized losses',
  sectionByAssetWorstFirst: 'By asset — worst first',
  noLossesNote: 'No losses — clean year! 🎉',
  // Missing basis
  missingBasisTitle: 'Missing Cost Basis',
  basisClearScript: 'nothing to see here!',
  basisClearNote: 'All cost basis resolved ✓',
  basisWarningLabel: 'lots with missing cost basis',
  basisWarningLink: 'Resolve in Lot Manager →',
  // Downloads
  downloadsTitle: 'Downloads',
  downloadsGroupForPreparer: 'For your tax preparer',
  downloadsGroupExports: 'Exports',
  downloadsGroupAdditional: 'Additional Reports',
  downloadFifoCsv: 'FIFO Gain/Loss CSV',
  downloadAnnualPdf: 'Annual Records PDF',
  downloadYearSummaryPdf: 'Year Summary PDF',
  downloadCapitalDisposals: 'Capital Disposals',
  downloadRealizedGains: 'Realized Gains & Losses',
  downloadIncomeRecords: 'Income Records',
  signUp: 'Sign up',
  paid: 'Paid',
  // FAQ admin
  faqTitle: 'Frequently Asked Questions',
  faqGroupUnderstanding: 'Understanding Your Records',
  faqQ_stVsLt: 'What is the difference between short-term and long-term capital gains?',
  faqA_stVsLt:
    'If you sold a crypto asset you held for <strong>365 days or less</strong>, the gain is short-term and taxed as ordinary income — the same rate as your salary. If you held it for <strong>more than 365 days</strong>, the gain is long-term and taxed at the preferential capital gains rate (0%, 15%, or 20% depending on your income). Holding longer before selling almost always results in a lower tax bill.',
  faqQ_costBasis: 'What is cost basis and why does it matter?',
  faqA_costBasis:
    'Cost basis is what you originally paid for an asset — including fees. Your taxable gain or loss is the difference between what you received when you sold it and your cost basis. If the IRS cannot find a cost basis record for a disposal, they assume it is <strong>$0</strong>, making the entire sale proceeds taxable. This is why missing cost basis is treated as a critical issue.',
  faqQ_fifo: 'What is FIFO and why does the app use it?',
  faqA_fifo:
    'FIFO stands for <strong>First In, First Out</strong>. When you sell crypto, FIFO assumes you are selling the oldest coins you own first. It is the IRS default method and the most widely accepted by tax professionals. The app also supports HIFO (Highest In, First Out — minimises gains) and Specific Identification (you pick the exact lot) for users who want to optimise their tax outcome.',
  faqQ_wailingWall: 'What is the "Wailing Wall"?',
  faqA_wailingWall:
    'The Wailing Wall shows your <strong>realised losses</strong> for the year — positions you sold for less than you paid. Losses are not just bad news: they can be used to offset capital gains dollar for dollar, reducing your tax bill. If your losses exceed your gains, up to <strong>$3,000 of the excess</strong> can be deducted against ordinary income, and any remaining amount carries forward to future tax years.',
  faqQ_taxableIncome: 'What counts as taxable income from crypto?',
  faqA_taxableIncome:
    'Beyond buying and selling, the following are generally treated as ordinary income in the year you receive them: <strong>staking rewards</strong>, <strong>mining income</strong>, <strong>airdrops</strong>, <strong>referral bonuses</strong>, <strong>DeFi interest earned</strong>, and <strong>hard fork proceeds</strong>. The app tracks all of these separately in the Interest &amp; Income line so they flow correctly to Schedule 1 rather than Schedule D.',
  faqQ_cardRebates: 'Are Crypto.com card rebates taxable?',
  faqA_cardRebates:
    '<strong>No — card rebates are not taxable income.</strong> The IRS treats credit and debit card rebates as a <em>reduction in purchase price</em>, not as compensation or income. When you earn a "Card Rebate" in CRO through your Crypto.com Visa card, it works like cash back on a regular credit card — you simply paid a little less for that purchase. Because it is not income, it does not appear on Schedule 1 and is not added to your ordinary income total.<br /><br />This is different from <strong>staking rewards</strong>, <strong>referral bonuses</strong>, and <strong>earn interest</strong> — which <em>are</em> ordinary income. The app automatically separates them: any transaction whose description starts with "Card Rebate" in your Crypto.com CSV is moved to a dedicated non-taxable section in the Year Summary report so your taxable income total stays accurate.',
  faqQ_cryptoTrades: 'Do crypto-to-crypto trades count as taxable events?',
  faqA_cryptoTrades:
    'Yes. Since 2017 the IRS has made clear that swapping one cryptocurrency for another — even without converting to dollars — is a taxable disposal. When you trade ETH for USDC, for example, you are treated as having sold your ETH at its fair market value at the moment of the swap. The app captures every on-chain swap and calculates the gain or loss automatically.',
  faqQ_washSale: 'Does the wash sale rule apply to crypto?',
  faqA_washSale:
    'As of the 2025 tax year, the wash sale rule — which disallows a loss if you repurchase the same asset within 30 days — <strong>does not apply to cryptocurrency</strong> under current IRS guidance (crypto is property, not a security). This means you can sell at a loss to harvest the deduction and immediately buy back the same coin. This is a significant planning opportunity. Note: legislation to change this has been proposed and may pass in future years.',
  faqGroupDocsFiling: 'Documents & Filing',
  faqQ_needEveryDoc: 'Do I need every document in the checklist?',
  faqA_needEveryDoc:
    'Only the ones that apply to you. W-2s apply if you have employment income. 1099-INT applies if you earned bank interest. 1099-R applies if you took a retirement distribution. The checklist is a prompt — not every box needs to be checked. The crypto exchange 1099s are the most important for this page: if your exchange issued one, the IRS received a copy too.',
  faqQ_1099da: 'What is a 1099-DA and which exchanges issue one?',
  faqA_1099da:
    'Form 1099-DA is the IRS form for digital asset transactions, required starting with the <strong>2025 tax year</strong> (the return you are filing now in 2026). Major exchanges — Coinbase, Kraken, Gemini, and Binance US among others — are issuing 1099-DAs this filing season. If your exchange issued one, the IRS received a copy too. You should have received it by January 31, 2026.',
  faqQ_1099recon: 'What is 1099 reconciliation and why should I care?',
  faqA_1099recon:
    'When an exchange sends you a 1099, they send an identical copy to the IRS. If the numbers on that form differ from what you report on your tax return, it triggers an automatic mismatch flag — potentially leading to a notice or audit. The reconciliation tool lets you upload your exchange\'s 1099 CSV and compare it line by line against the app\'s computed figures <strong>before you file</strong>, so you can catch and explain any discrepancies.',
  faqQ_form8949: 'What is Form 8949?',
  faqA_form8949:
    'Form 8949 is the IRS form where every individual capital asset sale must be reported — each disposal on its own line with the date acquired, date sold, proceeds, cost basis, and gain or loss. The totals from Form 8949 flow into Schedule D. The app generates a print-ready and CSV version of Form 8949 from your transaction history.',
  faqQ_schedD: 'What is Schedule D?',
  faqA_schedD:
    'Schedule D is the IRS summary form for capital gains and losses. It takes the box totals from Form 8949 and rolls them up into short-term and long-term net figures. The net number from Schedule D flows to your Form 1040. Think of Form 8949 as the detail and Schedule D as the summary.',
  faqQ_whatGiveCpa: 'What should I give my CPA?',
  faqA_whatGiveCpa:
    'At minimum: the <strong>Form 8949 CSV</strong>, the <strong>Year Summary PDF</strong>, and a note on any unresolved items from the review queue. If your CPA uses tax software, the Form 8949 CSV imports directly into most platforms. The Year Summary PDF gives them the narrative — income by category, loan events, open positions, and a completeness summary — so they can file with confidence.',
  faqGroupHowAppWorks: 'How the App Works',
  faqQ_syncDoes: 'What does "Sync" do on this page?',
  faqA_syncDoes:
    'The Sync button pulls the latest transaction data from your connected exchange accounts and then rebuilds the FIFO cost basis calculation. This is a targeted sync — it covers your tax-relevant exchange data only. Full wallet chain syncing (on-chain transactions, DeFi positions) is managed separately from the Vault page.',
  faqQ_reviewQueue: 'What is the Review Queue?',
  faqA_reviewQueue:
    'The app automatically classifies most transactions — trades, transfers, income events, fees. Occasionally a transaction is ambiguous: an unusual transfer, a token the classifier doesn\'t recognise, or a wallet-to-wallet move with no matching deposit. These land in the Review Queue. <strong>Unresolved items are excluded from your gain/loss totals</strong>, which means your numbers are understated until they are resolved. Always clear the queue before filing.',
  faqQ_accuracy: 'How accurate are the numbers shown here?',
  faqA_accuracy:
    'The numbers are as accurate as the data you have imported. If every exchange import is complete and every wallet is synced, the figures will be highly accurate. Common sources of error include: missing exchange imports, wallets that have not been synced recently, transactions that were manually entered incorrectly, and unresolved items in the review queue. The Data Completeness score at the top of the hub reflects how complete your data is.',
  faqQ_yearMatters: 'Why does the selected tax year matter?',
  faqA_yearMatters:
    'Every number on this page — gains, losses, income, missing cost basis — is filtered to the tax year you have selected. Make sure you are on the correct year before downloading any forms or sending figures to your CPA. The year selector at the top of the page controls everything.',
  // FAQ non-admin
  faqGroupUnderstandingNumbers: 'Understanding Your Numbers',
  faqQ_costBasisUser: 'What is cost basis and why does it matter?',
  faqA_costBasisUser:
    'Cost basis is what you originally paid for an asset — including fees. Your realized gain or loss is the difference between what you received when you sold it and your cost basis. Missing cost basis means the app cannot accurately calculate your gain or loss on that position, which is why the Data Health card flags it.',
  faqQ_fifoUser: 'What is FIFO?',
  faqA_fifoUser:
    'FIFO stands for <strong>First In, First Out</strong>. When you sell crypto, FIFO assumes you are selling the oldest coins you own first. It is the most widely accepted accounting method for crypto and is what the app uses by default to calculate your realized gains and losses.',
  faqQ_stVsLtUser: 'What is the difference between short-term and long-term gains?',
  faqA_stVsLtUser:
    'If you sold an asset you held for <strong>365 days or less</strong>, the gain is short-term. If you held it for <strong>more than 365 days</strong>, it is long-term. The app tracks both separately because they have different financial implications depending on your situation.',
  faqQ_wailingWallUser: 'What is the "Wailing Wall"?',
  faqA_wailingWallUser:
    'The Wailing Wall shows your <strong>realized losses</strong> for the year — positions you sold for less than you paid. Losses offset your realized gains, so understanding them is important for an accurate picture of your portfolio performance.',
  faqQ_interestIncome: 'What does "Interest & Income" include?',
  faqA_interestIncome:
    'This line covers crypto you received without selling something — such as <strong>staking rewards</strong>, <strong>DeFi interest</strong>, <strong>airdrops</strong>, and <strong>referral bonuses</strong>. The app tracks these separately from your buy/sell gains so you have a complete picture of where your crypto came from.',
  faqGroupHowAppWorksUser: 'How the App Works',
  faqQ_syncAllUser: 'What does "Sync All" do?',
  faqA_syncAllUser:
    'The Sync button pulls the latest transaction data from your connected exchange accounts and rebuilds the cost basis calculation. Full wallet chain syncing (on-chain transactions, DeFi positions) is managed from the Vault page.',
  faqQ_reviewQueueUser: 'What is the Review Queue?',
  faqA_reviewQueueUser:
    'The app automatically classifies most transactions — trades, transfers, income events, fees. Occasionally a transaction is ambiguous and lands in the Review Queue. <strong>Unresolved items are excluded from your gain/loss totals</strong>, so your numbers are understated until they are resolved.',
  faqQ_accuracyUser: 'How accurate are the numbers shown here?',
  faqA_accuracyUser:
    'The numbers are as accurate as the data you have imported. If every exchange import is complete and every wallet is synced, the figures will be highly accurate. Common sources of error: missing exchange imports, stale wallets, and unresolved items in the review queue.',
  faqQ_yearMattersUser: 'Why does the year selector matter?',
  faqA_yearMattersUser:
    'Every number on this page — gains, losses, income, missing cost basis — is filtered to the year you have selected. The year selector at the top controls everything.',
  faqQ_addMore: 'How do I add more wallets or exchanges?',
  faqA_addMore:
    'Use the <strong>Manage wallets</strong> link in the Data Health card to add on-chain wallet addresses. For exchange accounts, go to the <strong>Vault</strong> and import a CSV from your exchange. Once connected, click Sync All to pull the latest data.',
  // Footer
  footerDisclaimer: '⚖️ Tax disclaimer & limitations',
  // JS strings
  jsSyncing: '⏳ Syncing…',
  jsSyncingWallets: '⏳ Syncing wallets…',
  jsRebuilding: '⏳ Rebuilding…',
  jsSyncDone: '✓ Done',
  jsSyncNetworkError: '✗ Network error',
  jsConfirmRemoveAccount: (label) =>
    `Remove "${label}" and all its imported data?\n\nThis cannot be undone.`,
  jsCouldNotDelete: 'Could not delete',
  jsUploadingFile: (name) => `Uploading ${name}…`,
  jsUploadNetworkError: '✗ Network error — please try again.',
  jsRemoveFile: (name) => `Remove "${name}"?`,
};

// ─────────────────────────────────────────────────────────────────────────────
// SPANISH
// ─────────────────────────────────────────────────────────────────────────────
export const es: AnnualRecordsLocale = {
  lang: 'es',
  pageTitleAdmin: "Centro Fiscal | almsTins",
  pageTitleUser: "Centro de Portafolio | almsTins",
  // Disclaimer
  disclaimerTitle: "Recordatorio de Temporada Fiscal",
  disclaimerBody1:
    "almsTins es una herramienta de registro y análisis, <strong>no un servicio de preparación fiscal.</strong> " +
    "Las cifras mostradas se basan únicamente en los datos de transacciones que has importado. Los resultados pueden ser " +
    "incompletos si faltan importaciones de exchanges, sincronizaciones de wallets o entradas manuales.",
  disclaimerBody2:
    "Nada en esta página constituye asesoramiento fiscal, legal o financiero. " +
    "<strong>Consulta siempre a un CPA o profesional fiscal calificado antes de presentar tu declaración.</strong>",
  disclaimerOk: "Entendido — ¡vamos!",
  // Hero
  heroTitle: "Centro de Registros Anuales",
  heroSub:
    "Todo en un solo lugar — tus cuentas, ganancias, pérdidas y exportaciones. " +
    "Tu conciliación anual completa, claramente organizada.",
  reviewWarning: (n) =>
    `⚠️ ${n} transacción${n !== 1 ? "es" : ""} necesitan revisión — pueden afectar tus totales. →`,
  // Year bar
  yearBarLabel: "Año",
  // C1 admin
  incomeRecordsTitle: "Ingresos y Registros",
  sectionTradIncome: "Ingresos Tradicionales",
  docEmployment: "Ingresos por Empleo",
  docInterest: "Ingresos por Intereses",
  docDividend: "Ingresos por Dividendos",
  docDistribution: "Ingresos por Distribución",
  docOtherIncome: "Otros Ingresos",
  docSocialSecurity: "Seguridad Social",
  sectionDigitalAssets: "Exchanges de Activos Digitales",
  sectionSelfCustody: "Wallets de Autocustodia",
  sectionUploadCsv: "Subir Registros CSV/PDF",
  uploadDropText: "Suelta un CSV o PDF aquí o ",
  uploadBrowse: "explora",
  // C1 non-admin
  dataHealthTitle: "Estado de los Datos",
  sectionDataQuality: "Calidad de Datos",
  walletsConnected: (n) => `${n} wallet${n !== 1 ? "s" : ""} conectada${n !== 1 ? "s" : ""}`,
  noWalletsConnected: "Sin wallets conectadas",
  walletsUpToDate: "Todas las wallets actualizadas",
  walletsNeedSyncing: (n) => `${n} wallet${n !== 1 ? "s" : ""} necesitan sincronización`,
  noWalletDataYet: "Sin datos de wallet todavía",
  exchangesConnected: (n) => `${n} exchange${n !== 1 ? "s" : ""} conectado${n !== 1 ? "s" : ""}`,
  noExchangesConnected: "Sin exchanges conectados",
  allTransactionsClassified: "Todas las transacciones clasificadas",
  transactionsUnclassified: (n) => `${n} transacciones sin clasificar`,
  costBasisComplete: "Base de coste completa",
  lotsMissingBasis: (n) => `${n} lotes sin base de coste`,
  sectionQuickLinks: "Accesos Directos",
  manageWallets: "Gestionar wallets",
  viewPortfolio: "Ver portafolio",
  yearInReview: "Año en revisión",
  // C2 sync status
  dataSyncTitle: "Estado de Sincronización",
  syncAllBtn: "Sincronizar Todo",
  walletsSynced: "Wallets sincronizadas",
  staleNote: (n) => `⚠️ ${n} wallet${n !== 1 ? "s" : ""} desactualizad${n !== 1 ? "as" : "a"} (>60 días)`,
  sectionSelfCustodyWallets: "Wallets de Autocustodia",
  sectionExchangeAccounts: "Cuentas de Exchange",
  sectionExchangeImports: "Importaciones de Exchange",
  noData: "Sin datos",
  never: "Nunca",
  // Gains
  gainsTitle: (year) => `Ganancias — ${year}`,
  labelShortTermGains: "Ganancias a corto plazo",
  labelLongTermGains: "Ganancias a largo plazo",
  labelInterestIncome: "Intereses e ingresos",
  labelTotalTaxable: "Total imponible",
  labelNetRealized: "Ganancia neta realizada",
  sectionByAsset: "Por activo",
  noGainsNote: (year) => `No se registraron ganancias para ${year}.`,
  // Losses
  lossesTitle: "Muro de las Pérdidas",
  labelTotalRealizedLosses: "Total de pérdidas realizadas",
  sectionByAssetWorstFirst: "Por activo — peores primero",
  noLossesNote: "Sin pérdidas — ¡año limpio! 🎉",
  // Missing basis
  missingBasisTitle: "Base de Coste Faltante",
  basisClearScript: "¡nada que ver aquí!",
  basisClearNote: "Toda la base de coste resuelta ✓",
  basisWarningLabel: "lotes con base de coste faltante",
  basisWarningLink: "Resolver en el Gestor de Lotes →",
  // Downloads
  downloadsTitle: "Descargas",
  downloadsGroupForPreparer: "Para tu preparador fiscal",
  downloadsGroupExports: "Exportaciones",
  downloadsGroupAdditional: "Informes Adicionales",
  downloadFifoCsv: "CSV de Ganancias/Pérdidas FIFO",
  downloadAnnualPdf: "PDF de Registros Anuales",
  downloadYearSummaryPdf: "PDF de Resumen Anual",
  downloadCapitalDisposals: "Disposiciones de Capital",
  downloadRealizedGains: "Ganancias y Pérdidas Realizadas",
  downloadIncomeRecords: "Registros de Ingresos",
  signUp: "Registrarse",
  paid: "De pago",
  // FAQ admin
  faqTitle: "Preguntas Frecuentes",
  faqGroupUnderstanding: "Comprendiendo tus Registros",
  faqQ_stVsLt: "¿Cuál es la diferencia entre ganancias de capital a corto y largo plazo?",
  faqA_stVsLt:
    "Si vendiste un activo cripto que mantuviste durante <strong>365 días o menos</strong>, la ganancia es a corto plazo y se grava como ingreso ordinario, a la misma tasa que tu salario. Si lo mantuviste por <strong>más de 365 días</strong>, la ganancia es a largo plazo y se grava a la tasa preferencial de ganancias de capital (0%, 15% o 20% según tus ingresos). Mantener el activo más tiempo antes de vender casi siempre resulta en una factura fiscal menor.",
  faqQ_costBasis: "¿Qué es la base de coste y por qué importa?",
  faqA_costBasis:
    "La base de coste es lo que pagaste originalmente por un activo, incluidas las comisiones. Tu ganancia o pérdida imponible es la diferencia entre lo que recibiste al venderlo y tu base de coste. Si el IRS no puede encontrar un registro de base de coste para una disposición, asume que es <strong>$0</strong>, haciendo que todos los ingresos de la venta sean imponibles. Por eso la base de coste faltante se trata como un problema crítico.",
  faqQ_fifo: "¿Qué es FIFO y por qué lo usa la aplicación?",
  faqA_fifo:
    "FIFO significa <strong>First In, First Out</strong> (primero en entrar, primero en salir). Al vender cripto, FIFO asume que vendes primero las monedas más antiguas. Es el método predeterminado del IRS y el más aceptado por los profesionales fiscales. La aplicación también admite HIFO (Highest In, First Out — minimiza ganancias) e Identificación Específica (eliges el lote exacto) para usuarios que desean optimizar su resultado fiscal.",
  faqQ_wailingWall: "¿Qué es el \"Muro de las Pérdidas\"?",
  faqA_wailingWall:
    "El Muro de las Pérdidas muestra tus <strong>pérdidas realizadas</strong> del año — posiciones que vendiste por menos de lo que pagaste. Las pérdidas no son solo malas noticias: pueden usarse para compensar ganancias de capital dólar por dólar, reduciendo tu factura fiscal. Si tus pérdidas superan tus ganancias, hasta <strong>$3,000 del exceso</strong> pueden deducirse de los ingresos ordinarios, y cualquier monto restante se traslada a años fiscales futuros.",
  faqQ_taxableIncome: "¿Qué cuenta como ingreso imponible de cripto?",
  faqA_taxableIncome:
    "Además de comprar y vender, generalmente se tratan como ingresos ordinarios en el año en que los recibes: <strong>recompensas de staking</strong>, <strong>ingresos por minería</strong>, <strong>airdrops</strong>, <strong>bonificaciones por referidos</strong>, <strong>intereses ganados en DeFi</strong> y <strong>productos de hard fork</strong>. La aplicación los rastrea todos por separado en la línea de Intereses e Ingresos.",
  faqQ_cardRebates: "¿Son imponibles los reembolsos de la tarjeta Crypto.com?",
  faqA_cardRebates:
    "<strong>No — los reembolsos de tarjeta no son ingresos imponibles.</strong> El IRS trata los reembolsos de tarjetas de crédito y débito como una <em>reducción en el precio de compra</em>, no como compensación o ingreso. Cuando ganas un \"Reembolso de Tarjeta\" en CRO con tu tarjeta Visa de Crypto.com, funciona como un reembolso en efectivo de una tarjeta de crédito normal. La aplicación los separa automáticamente para que tu total de ingresos imponibles sea correcto.",
  faqQ_cryptoTrades: "¿Los intercambios cripto-a-cripto cuentan como eventos imponibles?",
  faqA_cryptoTrades:
    "Sí. Desde 2017, el IRS ha dejado claro que intercambiar una criptomoneda por otra — incluso sin convertir a dólares — es una disposición imponible. Cuando intercambias ETH por USDC, por ejemplo, se considera que vendiste tu ETH a su valor de mercado justo en el momento del intercambio. La aplicación captura cada swap on-chain y calcula la ganancia o pérdida automáticamente.",
  faqQ_washSale: "¿Se aplica la regla de venta lavada al cripto?",
  faqA_washSale:
    "A partir del año fiscal 2025, la regla de venta lavada — que rechaza una pérdida si recompras el mismo activo en 30 días — <strong>no se aplica a las criptomonedas</strong> según la orientación actual del IRS (el cripto es propiedad, no un valor). Esto significa que puedes vender con pérdida para aprovechar la deducción y recomprar inmediatamente la misma moneda. Nota: se ha propuesto legislación para cambiar esto y podría aprobarse en años futuros.",
  faqGroupDocsFiling: "Documentos y Declaración",
  faqQ_needEveryDoc: "¿Necesito todos los documentos de la lista?",
  faqA_needEveryDoc:
    "Solo los que te apliquen. Los W-2 aplican si tienes ingresos de empleo. El 1099-INT aplica si ganaste intereses bancarios. El 1099-R aplica si tomaste una distribución de retiro. La lista es una guía — no todos los casilleros necesitan marcarse. Los 1099 de exchanges cripto son los más importantes: si tu exchange emitió uno, el IRS también recibió una copia.",
  faqQ_1099da: "¿Qué es el 1099-DA y qué exchanges lo emiten?",
  faqA_1099da:
    "El Formulario 1099-DA es el formulario del IRS para transacciones de activos digitales, requerido a partir del <strong>año fiscal 2025</strong>. Los principales exchanges — Coinbase, Kraken, Gemini y Binance US, entre otros — están emitiendo 1099-DA esta temporada de presentación. Si tu exchange emitió uno, el IRS también recibió una copia. Debiste haberlo recibido antes del 31 de enero de 2026.",
  faqQ_1099recon: "¿Qué es la conciliación del 1099 y por qué me importa?",
  faqA_1099recon:
    "Cuando un exchange te envía un 1099, envía una copia idéntica al IRS. Si las cifras de ese formulario difieren de lo que declaras en tu devolución, se activa una bandera de discrepancia automática, lo que puede resultar en un aviso o auditoría. La herramienta de conciliación te permite subir el CSV 1099 de tu exchange y compararlo línea por línea con las cifras calculadas por la aplicación <strong>antes de presentar</strong>.",
  faqQ_form8949: "¿Qué es el Formulario 8949?",
  faqA_form8949:
    "El Formulario 8949 es el formulario del IRS donde debe reportarse cada venta individual de activos de capital — cada disposición en su propia línea con la fecha de adquisición, fecha de venta, ingresos, base de coste y ganancia o pérdida. Los totales del Formulario 8949 fluyen hacia el Schedule D. La aplicación genera una versión lista para imprimir y una versión CSV del Formulario 8949 a partir de tu historial de transacciones.",
  faqQ_schedD: "¿Qué es el Schedule D?",
  faqA_schedD:
    "El Schedule D es el formulario resumen del IRS para ganancias y pérdidas de capital. Toma los totales del Formulario 8949 y los agrupa en cifras netas a corto y largo plazo. El número neto del Schedule D fluye a tu Formulario 1040. Piensa en el Formulario 8949 como el detalle y en el Schedule D como el resumen.",
  faqQ_whatGiveCpa: "¿Qué debo darle a mi CPA?",
  faqA_whatGiveCpa:
    "Como mínimo: el <strong>CSV del Formulario 8949</strong>, el <strong>PDF de Resumen Anual</strong> y una nota sobre cualquier elemento no resuelto de la cola de revisión. Si tu CPA usa software fiscal, el CSV del Formulario 8949 se importa directamente en la mayoría de las plataformas. El PDF de Resumen Anual les proporciona la narrativa — ingresos por categoría, eventos de préstamo, posiciones abiertas y un resumen de completitud.",
  faqGroupHowAppWorks: "Cómo Funciona la Aplicación",
  faqQ_syncDoes: "¿Qué hace \"Sincronizar\" en esta página?",
  faqA_syncDoes:
    "El botón de Sincronizar obtiene los datos de transacciones más recientes de tus cuentas de exchange conectadas y luego reconstruye el cálculo de base de coste FIFO. Esta es una sincronización específica — cubre solo los datos de exchange relevantes para impuestos. La sincronización completa de la cadena de wallets se gestiona por separado desde la página de Bóveda.",
  faqQ_reviewQueue: "¿Qué es la Cola de Revisión?",
  faqA_reviewQueue:
    "La aplicación clasifica automáticamente la mayoría de las transacciones — operaciones, transferencias, eventos de ingresos, comisiones. Ocasionalmente una transacción es ambigua y termina en la Cola de Revisión. <strong>Los elementos no resueltos están excluidos de tus totales de ganancias/pérdidas</strong>, lo que significa que tus cifras están subestimadas hasta que se resuelvan. Limpia siempre la cola antes de presentar.",
  faqQ_accuracy: "¿Qué tan precisas son las cifras mostradas aquí?",
  faqA_accuracy:
    "Las cifras son tan precisas como los datos que has importado. Si todas las importaciones de exchanges están completas y todas las wallets están sincronizadas, las cifras serán muy precisas. Fuentes comunes de error: importaciones de exchanges faltantes, wallets no sincronizadas recientemente, transacciones ingresadas manualmente de forma incorrecta y elementos no resueltos en la cola de revisión.",
  faqQ_yearMatters: "¿Por qué importa el año fiscal seleccionado?",
  faqA_yearMatters:
    "Cada cifra en esta página — ganancias, pérdidas, ingresos, base de coste faltante — está filtrada al año fiscal que has seleccionado. Asegúrate de estar en el año correcto antes de descargar formularios o enviar cifras a tu CPA. El selector de año en la parte superior de la página controla todo.",
  // FAQ non-admin
  faqGroupUnderstandingNumbers: "Comprendiendo tus Cifras",
  faqQ_costBasisUser: "¿Qué es la base de coste y por qué importa?",
  faqA_costBasisUser:
    "La base de coste es lo que pagaste originalmente por un activo, incluidas las comisiones. Tu ganancia o pérdida realizada es la diferencia entre lo que recibiste al venderlo y tu base de coste. La base de coste faltante significa que la aplicación no puede calcular con precisión tu ganancia o pérdida en esa posición.",
  faqQ_fifoUser: "¿Qué es FIFO?",
  faqA_fifoUser:
    "FIFO significa <strong>First In, First Out</strong> (primero en entrar, primero en salir). Al vender cripto, FIFO asume que vendes primero las monedas más antiguas. Es el método de contabilidad más aceptado para cripto y es el que usa la aplicación por defecto para calcular tus ganancias y pérdidas realizadas.",
  faqQ_stVsLtUser: "¿Cuál es la diferencia entre ganancias a corto y largo plazo?",
  faqA_stVsLtUser:
    "Si vendiste un activo que mantuviste durante <strong>365 días o menos</strong>, la ganancia es a corto plazo. Si lo mantuviste por <strong>más de 365 días</strong>, es a largo plazo. La aplicación rastrea ambas por separado porque tienen diferentes implicaciones financieras según tu situación.",
  faqQ_wailingWallUser: "¿Qué es el \"Muro de las Pérdidas\"?",
  faqA_wailingWallUser:
    "El Muro de las Pérdidas muestra tus <strong>pérdidas realizadas</strong> del año — posiciones que vendiste por menos de lo que pagaste. Las pérdidas compensan tus ganancias realizadas, por lo que entenderlas es importante para tener una imagen precisa del rendimiento de tu portafolio.",
  faqQ_interestIncome: "¿Qué incluye \"Intereses e Ingresos\"?",
  faqA_interestIncome:
    "Esta línea cubre el cripto que recibiste sin vender algo — como <strong>recompensas de staking</strong>, <strong>intereses DeFi</strong>, <strong>airdrops</strong> y <strong>bonificaciones por referidos</strong>. La aplicación los rastrea por separado de tus ganancias de compra/venta.",
  faqGroupHowAppWorksUser: "Cómo Funciona la Aplicación",
  faqQ_syncAllUser: "¿Qué hace \"Sincronizar Todo\"?",
  faqA_syncAllUser:
    "El botón de Sincronizar obtiene los datos de transacciones más recientes de tus cuentas de exchange conectadas y reconstruye el cálculo de base de coste. La sincronización completa de la cadena de wallets se gestiona desde la página de Bóveda.",
  faqQ_reviewQueueUser: "¿Qué es la Cola de Revisión?",
  faqA_reviewQueueUser:
    "La aplicación clasifica automáticamente la mayoría de las transacciones. Ocasionalmente una transacción es ambigua y termina en la Cola de Revisión. <strong>Los elementos no resueltos están excluidos de tus totales de ganancias/pérdidas</strong>, por lo que tus cifras están subestimadas hasta que se resuelvan.",
  faqQ_accuracyUser: "¿Qué tan precisas son las cifras mostradas aquí?",
  faqA_accuracyUser:
    "Las cifras son tan precisas como los datos que has importado. Si todas las importaciones de exchanges están completas y todas las wallets están sincronizadas, las cifras serán muy precisas. Fuentes comunes de error: importaciones faltantes, wallets desactualizadas y elementos no resueltos en la cola de revisión.",
  faqQ_yearMattersUser: "¿Por qué importa el selector de año?",
  faqA_yearMattersUser:
    "Cada cifra en esta página — ganancias, pérdidas, ingresos, base de coste faltante — está filtrada al año que has seleccionado. El selector de año en la parte superior controla todo.",
  faqQ_addMore: "¿Cómo agrego más wallets o exchanges?",
  faqA_addMore:
    "Usa el enlace <strong>Gestionar wallets</strong> en la tarjeta de Estado de los Datos para agregar direcciones de wallets on-chain. Para cuentas de exchange, ve a la <strong>Bóveda</strong> e importa un CSV de tu exchange. Una vez conectado, haz clic en Sincronizar Todo para obtener los datos más recientes.",
  // Footer
  footerDisclaimer: "⚖️ Aviso legal fiscal y limitaciones",
  // JS strings
  jsSyncing: "⏳ Sincronizando…",
  jsSyncingWallets: "⏳ Sincronizando wallets…",
  jsRebuilding: "⏳ Reconstruyendo…",
  jsSyncDone: "✓ Listo",
  jsSyncNetworkError: "✗ Error de red",
  jsConfirmRemoveAccount: (label) =>
    `¿Eliminar "${label}" y todos sus datos importados?\n\nEsta acción no se puede deshacer.`,
  jsCouldNotDelete: "No se pudo eliminar",
  jsUploadingFile: (name) => `Subiendo ${name}…`,
  jsUploadNetworkError: "✗ Error de red — por favor, inténtalo de nuevo.",
  jsRemoveFile: (name) => `¿Eliminar "${name}"?`,
};

// ─────────────────────────────────────────────────────────────────────────────
// FRENCH
// ─────────────────────────────────────────────────────────────────────────────
export const fr: AnnualRecordsLocale = {
  lang: 'fr',
  pageTitleAdmin: "Centre Fiscal | almsTins",
  pageTitleUser: "Centre de Portefeuille | almsTins",
  // Disclaimer
  disclaimerTitle: "Rappel de Saison Fiscale",
  disclaimerBody1:
    "almsTins est un outil de tenue de registres et d'analyse, <strong>pas un service de préparation fiscale.</strong> " +
    "Les chiffres affichés sont basés uniquement sur les données de transactions que vous avez importées. Les résultats peuvent être " +
    "incomplets si des importations d'exchanges, des synchronisations de wallets ou des saisies manuelles sont manquantes.",
  disclaimerBody2:
    "Rien sur cette page ne constitue un conseil fiscal, juridique ou financier. " +
    "<strong>Consultez toujours un CPA ou un professionnel fiscal qualifié avant de déposer votre déclaration.</strong>",
  disclaimerOk: "Compris — allons-y",
  // Hero
  heroTitle: "Centre des Registres Annuels",
  heroSub:
    "Tout en un seul endroit — vos comptes, vos gains, vos pertes et vos exportations. " +
    "Votre réconciliation annuelle complète, clairement organisée.",
  reviewWarning: (n) =>
    `⚠️ ${n} transaction${n !== 1 ? "s" : ""} nécessitent une révision — elles peuvent affecter vos totaux. →`,
  // Year bar
  yearBarLabel: "Année",
  // C1 admin
  incomeRecordsTitle: "Revenus et Registres",
  sectionTradIncome: "Revenus Traditionnels",
  docEmployment: "Revenus d'Emploi",
  docInterest: "Revenus d'Intérêts",
  docDividend: "Revenus de Dividendes",
  docDistribution: "Revenus de Distribution",
  docOtherIncome: "Autres Revenus",
  docSocialSecurity: "Sécurité Sociale",
  sectionDigitalAssets: "Exchanges d'Actifs Numériques",
  sectionSelfCustody: "Wallets en Autocustode",
  sectionUploadCsv: "Télécharger des Registres CSV/PDF",
  uploadDropText: "Déposez un CSV ou PDF ici ou ",
  uploadBrowse: "parcourir",
  // C1 non-admin
  dataHealthTitle: "État des Données",
  sectionDataQuality: "Qualité des Données",
  walletsConnected: (n) => `${n} wallet${n !== 1 ? "s" : ""} connecté${n !== 1 ? "s" : ""}`,
  noWalletsConnected: "Aucun wallet connecté",
  walletsUpToDate: "Tous les wallets à jour",
  walletsNeedSyncing: (n) => `${n} wallet${n !== 1 ? "s" : ""} nécessitent une synchronisation`,
  noWalletDataYet: "Aucune donnée de wallet pour le moment",
  exchangesConnected: (n) => `${n} exchange${n !== 1 ? "s" : ""} connecté${n !== 1 ? "s" : ""}`,
  noExchangesConnected: "Aucun exchange connecté",
  allTransactionsClassified: "Toutes les transactions classifiées",
  transactionsUnclassified: (n) => `${n} transactions non classifiées`,
  costBasisComplete: "Coût de base complet",
  lotsMissingBasis: (n) => `${n} lots avec coût de base manquant`,
  sectionQuickLinks: "Accès Rapides",
  manageWallets: "Gérer les wallets",
  viewPortfolio: "Voir le portefeuille",
  yearInReview: "Bilan annuel",
  // C2 sync status
  dataSyncTitle: "État de Synchronisation",
  syncAllBtn: "Tout Synchroniser",
  walletsSynced: "Wallets synchronisés",
  staleNote: (n) => `⚠️ ${n} wallet${n !== 1 ? "s" : ""} obsolète${n !== 1 ? "s" : ""} (>60 jours)`,
  sectionSelfCustodyWallets: "Wallets en Autocustode",
  sectionExchangeAccounts: "Comptes d'Exchange",
  sectionExchangeImports: "Importations d'Exchange",
  noData: "Aucune donnée",
  never: "Jamais",
  // Gains
  gainsTitle: (year) => `Gains — ${year}`,
  labelShortTermGains: "Gains à court terme",
  labelLongTermGains: "Gains à long terme",
  labelInterestIncome: "Intérêts et revenus",
  labelTotalTaxable: "Total imposable",
  labelNetRealized: "Gain net réalisé",
  sectionByAsset: "Par actif",
  noGainsNote: (year) => `Aucun gain enregistré pour ${year}.`,
  // Losses
  lossesTitle: "Mur des Pertes",
  labelTotalRealizedLosses: "Total des pertes réalisées",
  sectionByAssetWorstFirst: "Par actif — pires en premier",
  noLossesNote: "Aucune perte — année sans accroc ! 🎉",
  // Missing basis
  missingBasisTitle: "Coût de Base Manquant",
  basisClearScript: "rien à voir ici !",
  basisClearNote: "Tout le coût de base résolu ✓",
  basisWarningLabel: "lots avec coût de base manquant",
  basisWarningLink: "Résoudre dans le Gestionnaire de Lots →",
  // Downloads
  downloadsTitle: "Téléchargements",
  downloadsGroupForPreparer: "Pour votre préparateur fiscal",
  downloadsGroupExports: "Exportations",
  downloadsGroupAdditional: "Rapports Supplémentaires",
  downloadFifoCsv: "CSV Gains/Pertes FIFO",
  downloadAnnualPdf: "PDF des Registres Annuels",
  downloadYearSummaryPdf: "PDF de Résumé Annuel",
  downloadCapitalDisposals: "Cessions de Capital",
  downloadRealizedGains: "Gains et Pertes Réalisés",
  downloadIncomeRecords: "Registres de Revenus",
  signUp: "Inscription",
  paid: "Payant",
  // FAQ admin
  faqTitle: "Questions Fréquentes",
  faqGroupUnderstanding: "Comprendre vos Registres",
  faqQ_stVsLt: "Quelle est la différence entre les gains en capital à court et à long terme ?",
  faqA_stVsLt:
    "Si vous avez vendu un actif crypto détenu pendant <strong>365 jours ou moins</strong>, le gain est à court terme et imposé comme revenu ordinaire — au même taux que votre salaire. Si vous l'avez détenu pendant <strong>plus de 365 jours</strong>, le gain est à long terme et imposé au taux préférentiel des gains en capital (0%, 15% ou 20% selon vos revenus). Détenir plus longtemps avant de vendre entraîne presque toujours une facture fiscale moins élevée.",
  faqQ_costBasis: "Qu'est-ce que le coût de base et pourquoi est-il important ?",
  faqA_costBasis:
    "Le coût de base est ce que vous avez initialement payé pour un actif — frais inclus. Votre gain ou perte imposable est la différence entre ce que vous avez reçu lors de la vente et votre coût de base. Si l'IRS ne peut pas trouver de dossier de coût de base pour une cession, il suppose qu'il est de <strong>0 $</strong>, rendant la totalité du produit de la vente imposable. C'est pourquoi un coût de base manquant est traité comme un problème critique.",
  faqQ_fifo: "Qu'est-ce que FIFO et pourquoi l'application l'utilise-t-elle ?",
  faqA_fifo:
    "FIFO signifie <strong>First In, First Out</strong> (premier entré, premier sorti). Lorsque vous vendez des cryptos, FIFO suppose que vous vendez en premier les pièces les plus anciennes. C'est la méthode par défaut de l'IRS et la plus largement acceptée par les professionnels fiscaux. L'application prend également en charge HIFO (Highest In, First Out — minimise les gains) et l'Identification Spécifique pour les utilisateurs souhaitant optimiser leur résultat fiscal.",
  faqQ_wailingWall: "Qu'est-ce que le \"Mur des Pertes\" ?",
  faqA_wailingWall:
    "Le Mur des Pertes affiche vos <strong>pertes réalisées</strong> pour l'année — les positions vendues pour moins que ce que vous avez payé. Les pertes ne sont pas seulement de mauvaises nouvelles : elles peuvent être utilisées pour compenser les gains en capital dollar pour dollar, réduisant votre facture fiscale. Si vos pertes dépassent vos gains, jusqu'à <strong>3 000 $ de l'excédent</strong> peuvent être déduits des revenus ordinaires, et tout montant restant est reporté sur les années fiscales futures.",
  faqQ_taxableIncome: "Qu'est-ce qui compte comme revenu imposable provenant des cryptos ?",
  faqA_taxableIncome:
    "Au-delà de l'achat et de la vente, les éléments suivants sont généralement traités comme revenus ordinaires l'année où vous les recevez : <strong>récompenses de staking</strong>, <strong>revenus de minage</strong>, <strong>airdrops</strong>, <strong>primes de parrainage</strong>, <strong>intérêts DeFi gagnés</strong> et <strong>produits de hard fork</strong>. L'application les suit tous séparément dans la ligne Intérêts et Revenus.",
  faqQ_cardRebates: "Les remises de carte Crypto.com sont-elles imposables ?",
  faqA_cardRebates:
    "<strong>Non — les remises de carte ne sont pas des revenus imposables.</strong> L'IRS traite les remises de cartes de crédit et de débit comme une <em>réduction du prix d'achat</em>, pas comme une compensation ou un revenu. Lorsque vous gagnez un \"Remboursement de Carte\" en CRO avec votre carte Visa Crypto.com, cela fonctionne comme un remboursement en espèces d'une carte de crédit ordinaire. L'application les sépare automatiquement pour que votre total de revenus imposables soit exact.",
  faqQ_cryptoTrades: "Les échanges crypto-à-crypto comptent-ils comme des événements imposables ?",
  faqA_cryptoTrades:
    "Oui. Depuis 2017, l'IRS a clairement indiqué qu'échanger une cryptomonnaie contre une autre — même sans convertir en dollars — est une cession imposable. Lorsque vous échangez ETH contre USDC, par exemple, vous êtes traité comme ayant vendu votre ETH à sa juste valeur marchande au moment de l'échange. L'application capture chaque swap on-chain et calcule automatiquement le gain ou la perte.",
  faqQ_washSale: "La règle de vente à perte s'applique-t-elle aux cryptos ?",
  faqA_washSale:
    "À partir de l'année fiscale 2025, la règle de vente à perte — qui interdit une perte si vous rachetez le même actif dans les 30 jours — <strong>ne s'applique pas aux cryptomonnaies</strong> selon les directives actuelles de l'IRS (les cryptos sont des biens, pas des titres). Cela signifie que vous pouvez vendre à perte pour bénéficier de la déduction et racheter immédiatement la même pièce. Remarque : une législation pour modifier cela a été proposée et pourrait être adoptée dans les années à venir.",
  faqGroupDocsFiling: "Documents et Déclaration",
  faqQ_needEveryDoc: "Ai-je besoin de chaque document de la liste ?",
  faqA_needEveryDoc:
    "Seulement ceux qui vous concernent. Les W-2 s'appliquent si vous avez des revenus d'emploi. Le 1099-INT s'applique si vous avez gagné des intérêts bancaires. Le 1099-R s'applique si vous avez pris une distribution de retraite. La liste est un guide — pas toutes les cases n'ont besoin d'être cochées. Les 1099 des exchanges crypto sont les plus importants : si votre exchange en a émis un, l'IRS en a également reçu une copie.",
  faqQ_1099da: "Qu'est-ce qu'un 1099-DA et quels exchanges en émettent un ?",
  faqA_1099da:
    "Le Formulaire 1099-DA est le formulaire IRS pour les transactions d'actifs numériques, requis à partir de l'<strong>année fiscale 2025</strong>. Les grands exchanges — Coinbase, Kraken, Gemini et Binance US entre autres — émettent des 1099-DA cette saison de déclaration. Si votre exchange en a émis un, l'IRS en a également reçu une copie. Vous auriez dû le recevoir avant le 31 janvier 2026.",
  faqQ_1099recon: "Qu'est-ce que la réconciliation du 1099 et pourquoi est-ce important ?",
  faqA_1099recon:
    "Lorsqu'un exchange vous envoie un 1099, il envoie une copie identique à l'IRS. Si les chiffres sur ce formulaire diffèrent de ce que vous déclarez sur votre déclaration fiscale, cela déclenche un indicateur de discordance automatique — pouvant entraîner un avis ou un audit. L'outil de réconciliation vous permet de télécharger le CSV 1099 de votre exchange et de le comparer ligne par ligne avec les chiffres calculés par l'application <strong>avant de déposer</strong>.",
  faqQ_form8949: "Qu'est-ce que le Formulaire 8949 ?",
  faqA_form8949:
    "Le Formulaire 8949 est le formulaire IRS où chaque vente individuelle d'actifs en capital doit être déclarée — chaque cession sur sa propre ligne avec la date d'acquisition, la date de vente, le produit, le coût de base et le gain ou la perte. Les totaux du Formulaire 8949 vont dans le Schedule D. L'application génère une version prête à imprimer et une version CSV du Formulaire 8949 à partir de votre historique de transactions.",
  faqQ_schedD: "Qu'est-ce que le Schedule D ?",
  faqA_schedD:
    "Le Schedule D est le formulaire récapitulatif IRS pour les gains et pertes en capital. Il prend les totaux du Formulaire 8949 et les regroupe en chiffres nets à court et à long terme. Le chiffre net du Schedule D va dans votre Formulaire 1040. Pensez au Formulaire 8949 comme au détail et au Schedule D comme au résumé.",
  faqQ_whatGiveCpa: "Que dois-je donner à mon CPA ?",
  faqA_whatGiveCpa:
    "Au minimum : le <strong>CSV du Formulaire 8949</strong>, le <strong>PDF de Résumé Annuel</strong> et une note sur les éléments non résolus de la file de révision. Si votre CPA utilise un logiciel fiscal, le CSV du Formulaire 8949 s'importe directement dans la plupart des plateformes. Le PDF de Résumé Annuel leur fournit le récit — revenus par catégorie, événements de prêt, positions ouvertes et un résumé d'exhaustivité.",
  faqGroupHowAppWorks: "Comment Fonctionne l'Application",
  faqQ_syncDoes: "Que fait \"Synchroniser\" sur cette page ?",
  faqA_syncDoes:
    "Le bouton Synchroniser récupère les dernières données de transactions de vos comptes d'exchange connectés, puis reconstruit le calcul du coût de base FIFO. Il s'agit d'une synchronisation ciblée — elle couvre uniquement vos données d'exchange pertinentes pour les impôts. La synchronisation complète de la chaîne des wallets est gérée séparément depuis la page du Coffre.",
  faqQ_reviewQueue: "Qu'est-ce que la File de Révision ?",
  faqA_reviewQueue:
    "L'application classifie automatiquement la plupart des transactions — opérations, transferts, événements de revenus, frais. Parfois une transaction est ambiguë et atterrit dans la File de Révision. <strong>Les éléments non résolus sont exclus de vos totaux de gains/pertes</strong>, ce qui signifie que vos chiffres sont sous-estimés jusqu'à leur résolution. Videz toujours la file avant de déposer.",
  faqQ_accuracy: "Quelle est la précision des chiffres affichés ici ?",
  faqA_accuracy:
    "Les chiffres sont aussi précis que les données que vous avez importées. Si chaque importation d'exchange est complète et que chaque wallet est synchronisé, les chiffres seront très précis. Sources d'erreur courantes : importations d'exchanges manquantes, wallets non synchronisés récemment, transactions saisies manuellement de manière incorrecte et éléments non résolus dans la file de révision.",
  faqQ_yearMatters: "Pourquoi l'année fiscale sélectionnée est-elle importante ?",
  faqA_yearMatters:
    "Chaque chiffre sur cette page — gains, pertes, revenus, coût de base manquant — est filtré sur l'année fiscale que vous avez sélectionnée. Assurez-vous d'être sur la bonne année avant de télécharger des formulaires ou d'envoyer des chiffres à votre CPA. Le sélecteur d'année en haut de la page contrôle tout.",
  // FAQ non-admin
  faqGroupUnderstandingNumbers: "Comprendre vos Chiffres",
  faqQ_costBasisUser: "Qu'est-ce que le coût de base et pourquoi est-il important ?",
  faqA_costBasisUser:
    "Le coût de base est ce que vous avez initialement payé pour un actif — frais inclus. Votre gain ou perte réalisé(e) est la différence entre ce que vous avez reçu lors de la vente et votre coût de base. Un coût de base manquant signifie que l'application ne peut pas calculer avec précision votre gain ou perte sur cette position.",
  faqQ_fifoUser: "Qu'est-ce que FIFO ?",
  faqA_fifoUser:
    "FIFO signifie <strong>First In, First Out</strong> (premier entré, premier sorti). Lorsque vous vendez des cryptos, FIFO suppose que vous vendez en premier les pièces les plus anciennes. C'est la méthode comptable la plus largement acceptée pour les cryptos et c'est celle que l'application utilise par défaut pour calculer vos gains et pertes réalisés.",
  faqQ_stVsLtUser: "Quelle est la différence entre les gains à court et à long terme ?",
  faqA_stVsLtUser:
    "Si vous avez vendu un actif détenu pendant <strong>365 jours ou moins</strong>, le gain est à court terme. Si vous l'avez détenu pendant <strong>plus de 365 jours</strong>, il est à long terme. L'application suit les deux séparément car ils ont des implications financières différentes selon votre situation.",
  faqQ_wailingWallUser: "Qu'est-ce que le \"Mur des Pertes\" ?",
  faqA_wailingWallUser:
    "Le Mur des Pertes affiche vos <strong>pertes réalisées</strong> pour l'année — les positions vendues pour moins que ce que vous avez payé. Les pertes compensent vos gains réalisés, donc les comprendre est important pour avoir une image précise de la performance de votre portefeuille.",
  faqQ_interestIncome: "Que comprend \"Intérêts et Revenus\" ?",
  faqA_interestIncome:
    "Cette ligne couvre les cryptos reçus sans vendre quoi que ce soit — tels que <strong>les récompenses de staking</strong>, <strong>les intérêts DeFi</strong>, <strong>les airdrops</strong> et <strong>les primes de parrainage</strong>. L'application les suit séparément de vos gains d'achat/vente.",
  faqGroupHowAppWorksUser: "Comment Fonctionne l'Application",
  faqQ_syncAllUser: "Que fait \"Tout Synchroniser\" ?",
  faqA_syncAllUser:
    "Le bouton Synchroniser récupère les dernières données de transactions de vos comptes d'exchange connectés et reconstruit le calcul du coût de base. La synchronisation complète de la chaîne des wallets est gérée depuis la page du Coffre.",
  faqQ_reviewQueueUser: "Qu'est-ce que la File de Révision ?",
  faqA_reviewQueueUser:
    "L'application classifie automatiquement la plupart des transactions. Parfois une transaction est ambiguë et atterrit dans la File de Révision. <strong>Les éléments non résolus sont exclus de vos totaux de gains/pertes</strong>, donc vos chiffres sont sous-estimés jusqu'à leur résolution.",
  faqQ_accuracyUser: "Quelle est la précision des chiffres affichés ici ?",
  faqA_accuracyUser:
    "Les chiffres sont aussi précis que les données que vous avez importées. Si chaque importation d'exchange est complète et que chaque wallet est synchronisé, les chiffres seront très précis. Sources d'erreur courantes : importations manquantes, wallets obsolètes et éléments non résolus dans la file de révision.",
  faqQ_yearMattersUser: "Pourquoi le sélecteur d'année est-il important ?",
  faqA_yearMattersUser:
    "Chaque chiffre sur cette page — gains, pertes, revenus, coût de base manquant — est filtré sur l'année que vous avez sélectionnée. Le sélecteur d'année en haut contrôle tout.",
  faqQ_addMore: "Comment ajouter plus de wallets ou d'exchanges ?",
  faqA_addMore:
    "Utilisez le lien <strong>Gérer les wallets</strong> dans la carte État des Données pour ajouter des adresses de wallets on-chain. Pour les comptes d'exchange, allez au <strong>Coffre</strong> et importez un CSV de votre exchange. Une fois connecté, cliquez sur Tout Synchroniser pour récupérer les dernières données.",
  // Footer
  footerDisclaimer: "⚖️ Avertissement fiscal et limitations",
  // JS strings
  jsSyncing: "⏳ Synchronisation…",
  jsSyncingWallets: "⏳ Synchronisation des wallets…",
  jsRebuilding: "⏳ Reconstruction…",
  jsSyncDone: "✓ Terminé",
  jsSyncNetworkError: "✗ Erreur réseau",
  jsConfirmRemoveAccount: (label) =>
    `Supprimer "${label}" et toutes ses données importées ?\n\nCette action est irréversible.`,
  jsCouldNotDelete: "Impossible de supprimer",
  jsUploadingFile: (name) => `Téléchargement de ${name}…`,
  jsUploadNetworkError: "✗ Erreur réseau — veuillez réessayer.",
  jsRemoveFile: (name) => `Supprimer "${name}" ?`,
};

// ─────────────────────────────────────────────────────────────────────────────
const MAP: Record<Lang, AnnualRecordsLocale> = { en, es, fr };

/** Select the AnnualRecords locale for a language, falling back to English. */
export function getAnnualRecords(lang: Lang): AnnualRecordsLocale {
  return MAP[lang] ?? en;
}
