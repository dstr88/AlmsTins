// History download, organized by wallet: the text inside the files and on the buttons (EN · ES · FR).
//
// Almstins is not tax software: these files list the transactions as recorded, with no cost
// basis, gain or loss, lot or holding-period columns, and no copy calls them tax-ready. The
// line on the button is the one the owner approved on Oct 12 2026. No em dashes.

import type { Lang } from '@/lib/i18n/locale';

export interface HistoryFileStrings {
	/** The 20 columns of all-wallets.csv and of each wallet's file, in order. */
	columns: {
		wallet: string;
		owner: string;
		accountType: string;
		walletKey: string;
		addressOrAccount: string;
		chain: string;
		date: string;
		direction: string;
		asset: string;
		amount: string;
		usdValue: string;
		fee: string;
		feeAsset: string;
		txHash: string;
		counterparty: string;
		counterpartyLabel: string;
		category: string;
		notes: string;
		transferId: string;
		transferOtherWallet: string;
	};
	/** The plain CSV (every plan): the Owner column, no wallet or label columns. */
	plainColumns: {
		date: string;
		source: string;
		owner: string;
		chain: string;
		direction: string;
		asset: string;
		amount: string;
		usdValue: string;
		fee: string;
		feeAsset: string;
		txHash: string;
		counterparty: string;
		category: string;
		notes: string;
	};
	/** wallets.csv, the index. */
	indexColumns: {
		walletKey: string;
		wallet: string;
		owner: string;
		accountType: string;
		addressOrAccount: string;
		firstDate: string;
		lastDate: string;
		rows: string;
		file: string;
	};
	ownerNotSet: string;
	accountTypes: { onchain: string; custom: string; exchange: string; unassigned: string };
	/** "Crypto.com (unassigned)": imported rows that have no account. */
	unassignedName: (source: string) => string;
	/** "Crypto.com · account removed": rows whose account no longer exists. */
	removedAccountName: (source: string) => string;
	customChain: string;
	unknownChain: string;
	failedTx: string;
	/** Header note lines at the top of wallets.csv. */
	notes: {
		copyLine: string;
		generated: (dateUtc: string, period: string) => string;
		allYears: string;
		recordsOnly: string;
		duplicates: string;
		transfers: string;
		unassigned: string;
		/** Shown only when a row has the direction lost. */
		lost: string;
	};
}

export interface HistoryUiStrings {
	copyLine: string;
	btnLabel: string;
	/** Bookkeeping, next to the Year Summary: the file for the selected year. */
	btnLabelYear: (year: number) => string;
	btnTitle: string;
	btnBusy: string;
	btnError: string;
	/** 413: more rows than one file holds. All years (Wallets) / one year (Bookkeeping). */
	btnTooMany: string;
	btnTooManyYear: string;
	/** 429: this account already has a download being prepared. */
	btnInProgress: string;
	/** The plain CSV of the account's transactions (every plan), shown to a Free account. */
	plainLabel: string;
	plainLabelYear: (year: number) => string;
	plainTitle: string;
	lockedLabel: string;
	lockedBadge: string;
	lockedNote: string;
	/** The Needs Attention and Income CSV buttons on Bookkeeping, for a Free account. */
	csvLockedTitle: string;
}

export interface HistoryExportLocale {
	lang: Lang;
	file: HistoryFileStrings;
	ui: HistoryUiStrings;
}

export const en: HistoryExportLocale = {
	lang: 'en',
	file: {
		columns: {
			wallet: 'Wallet',
			owner: 'Owner',
			accountType: 'Account type',
			walletKey: 'Wallet key',
			addressOrAccount: 'Address/Account',
			chain: 'Chain',
			date: 'Date (UTC)',
			direction: 'Direction',
			asset: 'Asset',
			amount: 'Amount',
			usdValue: 'USD value',
			fee: 'Fee',
			feeAsset: 'Fee asset',
			txHash: 'Tx hash',
			counterparty: 'Counterparty',
			counterpartyLabel: 'Counterparty label',
			category: 'Category',
			notes: 'Notes',
			transferId: 'Transfer ID',
			transferOtherWallet: 'Transfer other wallet',
		},
		plainColumns: {
			date: 'Date (UTC)',
			source: 'Source',
			owner: 'Owner',
			chain: 'Chain',
			direction: 'Direction',
			asset: 'Asset',
			amount: 'Amount',
			usdValue: 'USD value',
			fee: 'Fee',
			feeAsset: 'Fee asset',
			txHash: 'Tx hash',
			counterparty: 'Counterparty',
			category: 'Category',
			notes: 'Notes',
		},
		indexColumns: {
			walletKey: 'Wallet key',
			wallet: 'Wallet',
			owner: 'Owner',
			accountType: 'Account type',
			addressOrAccount: 'Address/Account',
			firstDate: 'First date (UTC)',
			lastDate: 'Last date (UTC)',
			rows: 'Rows',
			file: 'File',
		},
		ownerNotSet: 'Owner not set',
		accountTypes: {
			onchain: 'On-chain wallet',
			custom: 'Custom wallet',
			exchange: 'Exchange account',
			unassigned: 'Unassigned',
		},
		unassignedName: (source) => `${source} (unassigned)`,
		removedAccountName: (source) => `${source} · account removed`,
		customChain: 'Custom',
		unknownChain: 'Unknown',
		failedTx: 'Failed transaction: only the network fee was paid.',
		notes: {
			copyLine: 'Your records, organized by wallet, for you and your tax professional.',
			generated: (date, period) => `Generated ${date} (UTC). Period: ${period}.`,
			allYears: 'all years',
			recordsOnly: 'These files list your transactions as recorded. They have no cost basis, gain, loss or lot columns.',
			duplicates: 'Rows flagged as duplicates are left out.',
			transfers:
				'Transfer ID and Transfer other wallet are blank for now. Linking both sides of a transfer between your own wallets comes in a later update.',
			unassigned:
				'Rows marked Unassigned were imported without an account, so Almstins cannot tell which account they belong to.',
			lost: 'Rows with the direction lost were marked in the exchange file as lost, burned or sent on the wrong chain: the asset left the account.',
		},
	},
	ui: {
		copyLine: 'Your records, organized by wallet, for you and your tax professional.',
		btnLabel: '↓ Download history by wallet',
		btnLabelYear: (year) => `↓ ${year} history by wallet`,
		btnTitle: 'A ZIP file: one CSV for each wallet and exchange account, one combined CSV, and an index of your wallets.',
		btnBusy: 'Preparing your download…',
		btnError: 'The download did not work. Please try again.',
		btnTooMany: 'Your history has too many rows for one file. Download one year at a time from the Bookkeeping page.',
		btnTooManyYear: 'This year has too many rows for one file.',
		btnInProgress: 'A download is already being prepared. Please wait for it to finish.',
		plainLabel: '↓ Download my transactions (CSV)',
		plainLabelYear: (year) => `↓ My ${year} transactions (CSV)`,
		plainTitle: 'One plain CSV file of your transactions, included in every plan.',
		lockedLabel: 'History by wallet',
		lockedBadge: 'Paid plans',
		lockedNote: 'Downloading your history, organized by wallet, is included in every paid plan, starting with Starter.',
		csvLockedTitle: 'CSV downloads are included in every paid plan, starting with Starter.',
	},
};

export const es: HistoryExportLocale = {
	lang: 'es',
	file: {
		columns: {
			wallet: 'Billetera',
			owner: 'Propietario',
			accountType: 'Tipo de cuenta',
			walletKey: 'Clave de billetera',
			addressOrAccount: 'Dirección/Cuenta',
			chain: 'Cadena',
			date: 'Fecha (UTC)',
			direction: 'Sentido',
			asset: 'Activo',
			amount: 'Cantidad',
			usdValue: 'Valor en USD',
			fee: 'Comisión',
			feeAsset: 'Activo de la comisión',
			txHash: 'Hash de la transacción',
			counterparty: 'Contraparte',
			counterpartyLabel: 'Etiqueta de la contraparte',
			category: 'Categoría',
			notes: 'Notas',
			transferId: 'ID de transferencia',
			transferOtherWallet: 'Otra billetera de la transferencia',
		},
		plainColumns: {
			date: 'Fecha (UTC)',
			source: 'Origen',
			owner: 'Propietario',
			chain: 'Cadena',
			direction: 'Sentido',
			asset: 'Activo',
			amount: 'Cantidad',
			usdValue: 'Valor en USD',
			fee: 'Comisión',
			feeAsset: 'Activo de la comisión',
			txHash: 'Hash de la transacción',
			counterparty: 'Contraparte',
			category: 'Categoría',
			notes: 'Notas',
		},
		indexColumns: {
			walletKey: 'Clave de billetera',
			wallet: 'Billetera',
			owner: 'Propietario',
			accountType: 'Tipo de cuenta',
			addressOrAccount: 'Dirección/Cuenta',
			firstDate: 'Primera fecha (UTC)',
			lastDate: 'Última fecha (UTC)',
			rows: 'Filas',
			file: 'Archivo',
		},
		ownerNotSet: 'Propietario sin indicar',
		accountTypes: {
			onchain: 'Billetera on-chain',
			custom: 'Billetera personalizada',
			exchange: 'Cuenta de exchange',
			unassigned: 'Sin asignar',
		},
		unassignedName: (source) => `${source} (sin asignar)`,
		removedAccountName: (source) => `${source} · cuenta eliminada`,
		customChain: 'Personalizada',
		unknownChain: 'Desconocida',
		failedTx: 'Transacción fallida: solo se pagó la comisión de red.',
		notes: {
			copyLine: 'Sus registros, organizados por billetera, para usted y su profesional de impuestos.',
			generated: (date, period) => `Generado el ${date} (UTC). Período: ${period}.`,
			allYears: 'todos los años',
			recordsOnly:
				'Estos archivos listan sus transacciones tal como se registraron. No tienen columnas de costo base, ganancia, pérdida ni lotes.',
			duplicates: 'Las filas marcadas como duplicadas no se incluyen.',
			transfers:
				'Las columnas ID de transferencia y Otra billetera de la transferencia están vacías por ahora. Enlazar los dos lados de una transferencia entre sus propias billeteras llegará en una actualización posterior.',
			unassigned:
				'Las filas marcadas Sin asignar se importaron sin una cuenta, así que Almstins no puede saber a qué cuenta pertenecen.',
			lost: 'Las filas con el sentido lost se marcaron en el archivo del exchange como perdidas, quemadas o enviadas a la cadena equivocada: el activo salió de la cuenta.',
		},
	},
	ui: {
		copyLine: 'Sus registros, organizados por billetera, para usted y su profesional de impuestos.',
		btnLabel: '↓ Descargar historial por billetera',
		btnLabelYear: (year) => `↓ Historial ${year} por billetera`,
		btnTitle: 'Un archivo ZIP: un CSV por cada billetera y cuenta de exchange, un CSV combinado y un índice de sus billeteras.',
		btnBusy: 'Preparando la descarga…',
		btnError: 'La descarga no funcionó. Inténtelo de nuevo.',
		btnTooMany: 'Su historial tiene demasiadas filas para un solo archivo. Descargue un año a la vez desde la página Bookkeeping.',
		btnTooManyYear: 'Este año tiene demasiadas filas para un solo archivo.',
		btnInProgress: 'Ya se está preparando una descarga. Espere a que termine.',
		plainLabel: '↓ Descargar mis transacciones (CSV)',
		plainLabelYear: (year) => `↓ Mis transacciones de ${year} (CSV)`,
		plainTitle: 'Un archivo CSV simple con sus transacciones, incluido en todos los planes.',
		lockedLabel: 'Historial por billetera',
		lockedBadge: 'Planes de pago',
		lockedNote: 'La descarga del historial, organizado por billetera, está incluida en todos los planes de pago, desde Starter.',
		csvLockedTitle: 'Las descargas CSV están incluidas en todos los planes de pago, desde Starter.',
	},
};

export const fr: HistoryExportLocale = {
	lang: 'fr',
	file: {
		columns: {
			wallet: 'Portefeuille',
			owner: 'Propriétaire',
			accountType: 'Type de compte',
			walletKey: 'Clé du portefeuille',
			addressOrAccount: 'Adresse/Compte',
			chain: 'Chaîne',
			date: 'Date (UTC)',
			direction: 'Sens',
			asset: 'Actif',
			amount: 'Montant',
			usdValue: 'Valeur en USD',
			fee: 'Frais',
			feeAsset: 'Actif des frais',
			txHash: 'Hash de transaction',
			counterparty: 'Contrepartie',
			counterpartyLabel: 'Libellé de la contrepartie',
			category: 'Catégorie',
			notes: 'Notes',
			transferId: 'ID de transfert',
			transferOtherWallet: 'Autre portefeuille du transfert',
		},
		plainColumns: {
			date: 'Date (UTC)',
			source: 'Source',
			owner: 'Propriétaire',
			chain: 'Chaîne',
			direction: 'Sens',
			asset: 'Actif',
			amount: 'Montant',
			usdValue: 'Valeur en USD',
			fee: 'Frais',
			feeAsset: 'Actif des frais',
			txHash: 'Hash de transaction',
			counterparty: 'Contrepartie',
			category: 'Catégorie',
			notes: 'Notes',
		},
		indexColumns: {
			walletKey: 'Clé du portefeuille',
			wallet: 'Portefeuille',
			owner: 'Propriétaire',
			accountType: 'Type de compte',
			addressOrAccount: 'Adresse/Compte',
			firstDate: 'Première date (UTC)',
			lastDate: 'Dernière date (UTC)',
			rows: 'Lignes',
			file: 'Fichier',
		},
		ownerNotSet: 'Propriétaire non indiqué',
		accountTypes: {
			onchain: 'Portefeuille on-chain',
			custom: 'Portefeuille personnalisé',
			exchange: "Compte d'exchange",
			unassigned: 'Non attribué',
		},
		unassignedName: (source) => `${source} (non attribué)`,
		removedAccountName: (source) => `${source} · compte supprimé`,
		customChain: 'Personnalisée',
		unknownChain: 'Inconnue',
		failedTx: 'Transaction échouée : seuls les frais de réseau ont été payés.',
		notes: {
			copyLine: 'Vos registres, classés par portefeuille, pour vous et votre professionnel de la fiscalité.',
			generated: (date, period) => `Généré le ${date} (UTC). Période : ${period}.`,
			allYears: 'toutes les années',
			recordsOnly:
				"Ces fichiers listent vos transactions telles qu'elles ont été enregistrées. Ils n'ont aucune colonne de cost basis, de plus-value, de moins-value ou de lots.",
			duplicates: 'Les lignes signalées comme doublons sont exclues.',
			transfers:
				"Les colonnes ID de transfert et Autre portefeuille du transfert sont vides pour l'instant. Le lien entre les deux côtés d'un transfert entre vos propres portefeuilles arrivera dans une prochaine mise à jour.",
			unassigned:
				"Les lignes marquées Non attribué ont été importées sans compte : Almstins ne peut donc pas savoir à quel compte elles appartiennent.",
			lost: "Les lignes au sens lost ont été marquées dans le fichier de l'exchange comme perdues, brûlées ou envoyées sur la mauvaise chaîne : l'actif a quitté le compte.",
		},
	},
	ui: {
		copyLine: 'Vos registres, classés par portefeuille, pour vous et votre professionnel de la fiscalité.',
		btnLabel: "↓ Télécharger l'historique par portefeuille",
		btnLabelYear: (year) => `↓ Historique ${year} par portefeuille`,
		btnTitle: 'Un fichier ZIP : un CSV par portefeuille et par compte d\'exchange, un CSV combiné et un index de vos portefeuilles.',
		btnBusy: 'Préparation du téléchargement…',
		btnError: "Le téléchargement n'a pas fonctionné. Veuillez réessayer.",
		btnTooMany: "Votre historique a trop de lignes pour un seul fichier. Téléchargez une année à la fois depuis la page Bookkeeping.",
		btnTooManyYear: 'Cette année a trop de lignes pour un seul fichier.',
		btnInProgress: 'Un téléchargement est déjà en préparation. Veuillez attendre la fin.',
		plainLabel: '↓ Télécharger mes transactions (CSV)',
		plainLabelYear: (year) => `↓ Mes transactions ${year} (CSV)`,
		plainTitle: 'Un fichier CSV simple de vos transactions, inclus dans tous les forfaits.',
		lockedLabel: 'Historique par portefeuille',
		lockedBadge: 'Forfaits payants',
		lockedNote: "Le téléchargement de l'historique, classé par portefeuille, est inclus dans tous les forfaits payants, à partir de Starter.",
		csvLockedTitle: 'Les téléchargements CSV sont inclus dans tous les forfaits payants, à partir de Starter.',
	},
};

const LOCALES: Record<Lang, HistoryExportLocale> = { en, es, fr };

export function getHistoryExport(lang: Lang): HistoryExportLocale {
	return LOCALES[lang] ?? en;
}
