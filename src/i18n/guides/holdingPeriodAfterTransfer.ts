/**
 * Guide: how to prove when you bought crypto after you transferred it.
 * Public and indexable at /guides/crypto-holding-period-after-transfer (English first).
 *
 * The body is the reviewed draft from the Oct 12 search-page week, word for word, with every
 * citation inline. One owner-approved change: the "How Almstins helps" paragraph says the
 * signed Year Summary export is on the Unlimited plan; Oct 11 additions: the line under the short
 * answer pointing readers to the official sources. Oct 12: the Wallet Watcher paragraph says only
 * what the product does today (transfer matching, read-only) and discloses that gain and loss
 * figures do not yet apply the 2025 wallet-by-wallet rule (see PR #199 and the engine follow-ups). Nothing else is added: no
 * call-to-action links, and the not-tax-advice line appears once, where the draft has it.
 * Sources were checked against the primary texts on October 11, 2026; when you change a
 * claim, re-check its source and update reviewed below.
 *
 * Rendered by src/components/guides/GuidePage.astro; pinned by tests/seo/guides.test.ts.
 */
import type { GuideCopy } from './types';

export const en: GuideCopy = {
	lang: 'en',
	slug: '/guides/crypto-holding-period-after-transfer',
	canonical: 'https://almstins.com/guides/crypto-holding-period-after-transfer',
	meta: {
		title: 'Crypto Holding Period After a Transfer: How to Prove It',
		description:
			'A move between your own wallets is not a taxable event, but your 1099-DA may skip basis. Keep these records to prove when you bought your crypto.',
	},
	nav: {
		brand: 'Almstins',
		links: [
			{ label: 'Wallet Checker', href: '/wallet-checker' },
			{ label: 'Pricing', href: '/prices' },
		],
	},
	eyebrow: 'Crypto records guide',
	h1: 'How to prove when you bought crypto after you transferred it',
	reviewed: { label: 'Last reviewed: October 11, 2026', iso: '2026-10-11' },
	published: '2026-10-11',
	intro: [
		{ kind: 'p', md: '**Short answer:** A move between your own wallets is not a taxable event ([IRS digital asset FAQ 81](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq81)), and the IRS rules look to the original purchase date, not the date coins arrive in a new wallet ([FAQs 86](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_18c1497986) and [92](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_11c8e9b755)), so your holding period still runs from the purchase. To prove that date, keep three linked records: the purchase, the transaction hash of every move between your own wallets, and the sale.' },
		{ kind: 'p', md: 'Every rule on this page links to its official source on IRS.gov or in the Treasury regulations, so you can check it yourself.' },
	],
	sections: [
		{
			id: 'why-a-transfer-hides-your-purchase-date',
			h2: 'Why a transfer hides your purchase date',
			blocks: [
				{ kind: 'p', md: "When you send coins to another exchange, it sees a deposit, not a purchase. Brokers do not have to pass purchase information to each other for digital assets (Treas. Reg. [1.6045A-1(a)(1)(vi)](<https://www.ecfr.gov/current/title-26/section-1.6045A-1#p-1.6045A-1(a)(1)(vi)>), read with [1.6045-1(a)(14)(v)](<https://www.ecfr.gov/current/title-26/section-1.6045-1#p-1.6045-1(a)(14)(v)>); Treasury and the IRS explain the exemption in [T.D. 10000](https://www.federalregister.gov/documents/2024/07/09/2024-14004/gross-proceeds-and-basis-reporting-by-brokers-and-determination-of-amount-realized-and-basis-for#p-331), 89 FR 56480). For coins you transferred in, the receiving broker's Form 1099-DA reports how many units came in and, if they all arrived on one date, the date they arrived (Treas. Reg. [1.6045-1(d)(2)(i)(B)(7)](<https://www.ecfr.gov/current/title-26/section-1.6045-1#p-1.6045-1(d)(2)(i)(B)(7)>); Instructions for Form 1099-DA, boxes [12a](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000130779) and [12b](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000130780)). Unless you give the broker purchase information and it chooses to use it, the receiving broker must treat transferred-in units as acquired at the date and time of the transfer for its reporting (Treas. Reg. [1.6045-1(d)(2)(ii)(B)(1)](<https://www.ecfr.gov/current/title-26/section-1.6045-1#p-1.6045-1(d)(2)(ii)(B)(1)>)). A broker that does use your information may use it only to order lots (Treas. Reg. [1.6045-1(d)(2)(ii)(B)(4)](<https://www.ecfr.gov/current/title-26/section-1.6045-1#p-1.6045-1(d)(2)(ii)(B)(4)>)), not to report your basis or purchase date ([IRS FAQs about broker reporting, Q7](https://www.irs.gov/filing/frequently-asked-questions-about-broker-reporting#:~:text=A7.%20No.); [Instructions for Form 1099-DA, box 1g](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000130757))." },
				{ kind: 'p', md: 'Tax year 2026 is the first year brokers must report cost basis on Form 1099-DA, and only for "covered" assets: coins bought or traded for on or after January 1, 2026, in a custodial account at that broker, and held there until the sale (2026 Instructions for Form 1099-DA, ["2026 and beyond"](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000156488) and ["Covered security"](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000132014); compare the [2025 Instructions for Form 1099-DA](https://www.irs.gov/pub/irs-prior/i1099da--2025.pdf#page=1)). The [2026 Instructions for Form 1099-DA](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000132017) list coins acquired before 2026 and coins transferred in as noncovered. A broker may report their basis voluntarily, but it is not required to ([2026 Instructions for Form 1099-DA](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000156488)).' },
				{ kind: 'p', md: 'Here is the catch. A coin bought in 2026 cannot be held more than one year by December 31, 2026, so every long-term crypto sale in tax year 2026 falls outside mandatory basis reporting. That follows from the two rules above; for an illustration, see the [IRS example](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000130727) in the 2026 Instructions for Form 1099-DA.' },
				{ kind: 'p', md: 'Foreign exchanges may not send a 1099-DA, and DeFi platforms are not required to file one ([IRS fact sheet FS-2025-06](https://www.irs.gov/newsroom/tax-professionals-can-prepare-now-to-assist-their-clients-with-reporting-proceeds-from-certain-digital-asset-transactions)). You still report every taxable gain and loss, whether or not you get a form ([IRS digital asset FAQ 108](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_769797b803); [Instructions for Form 8949, line 1](https://www.irs.gov/instructions/i8949#en_US_2025_publink59421zd0e1625)).' },
			],
		},
		{
			id: 'what-the-irs-rules-say',
			h2: 'What the IRS rules say',
			blocks: [
				{
					kind: 'ul',
					items: [
						'**Long-term means more than one year.** One year or less is short-term ([26 U.S.C. 1222](https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleA-chap1-subchapP-partIII-sec1222.htm); [IRS digital asset FAQ 50](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_6c126f7b58)). The holding period starts the day after you acquire the coins and includes the day you sell ([IRS digital asset FAQ 50](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_6c126f7b58); [Instructions for Form 8949](https://www.irs.gov/instructions/i8949#en_US_2025_publink1000285296)).',
						'**A move between your own wallets is not taxable.** The IRS calls it a non-taxable event ([digital asset FAQ 81](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq81)). Its older FAQ, for transactions before 2025, said this holds even if a platform sends you a form about the transfer ([virtual currency FAQ 38](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-virtual-currency-transactions#btn_81fc81e9c0)). One exception: crypto you spend on the network fee counts as a disposition ([FAQs 81](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq81) and [97](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_865bd44bfb)), and the IRS says that fee is not a "digital asset transaction cost" ([FAQ 53](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq53)).',
						"**The transfer-in date does not count.** Since January 1, 2025, when the regulations put your units in first-in, first-out order, they disregard the date units arrived in your wallet or a broker's custody (Treas. Reg. [1.1012-1(j)(1)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(1)>), [(j)(3)(i)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(3)(i)>), [(j)(6)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(6)>)). In that default order, units keep their original purchase date, not the date they arrived ([FAQ 86](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_18c1497986) for wallets you control; [FAQ 92](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_11c8e9b755) for broker accounts).",
						'**A swap is different.** Trading one coin for another is a taxable exchange, and the coins you receive start a new holding period the day after you receive them ([FAQs 64](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_8696c503b5) and [74](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_6902cb1073)).',
						'**Basis is tracked wallet by wallet.** If you do not identify which units you are selling by the time of the sale, the default is first in, first out within that wallet or broker account, by original purchase date (Treas. Reg. [1.1012-1(j)(1)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(1)>) and [Example 2](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(5)(ii)(B)>) for wallets, [(j)(3)(i)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(3)(i)>) and [Example 4](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(5)(iv)(B)>) for broker accounts; [FAQs 86](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_18c1497986) and [92](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_11c8e9b755)). [Notice 2026-20](https://www.irs.gov/irb/2026-15_IRB#NOT-2026-20) lets you record that choice for broker-held coins in your own books through December 31, 2026. A record made after the sale cannot pick the units after the fact ([FAQ 82](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq82); [Notice 2026-20, section 4.02](https://www.irs.gov/irb/2026-15_IRB#id60)).',
						'**Recordkeeping is your job.** You must keep records that support your return ([26 U.S.C. 6001](https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleF-chap61-subchapA-partI-sec6001.htm); Treas. Reg. [1.6001-1(a)](<https://www.ecfr.gov/current/title-26/section-1.6001-1#p-1.6001-1(a)>); [IRS, "How long should I keep records?"](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records)), and [Notice 2026-20](https://www.irs.gov/irb/2026-15_IRB#id58) says that for 2026 transactions, the dates and basis a broker reports "may not match" the lots and basis in your own books.',
					],
				},
			],
		},
		{
			id: 'the-records-that-prove-it',
			h2: 'The records that prove it',
			blocks: [
				{
					kind: 'ol',
					items: [
						'**The purchase.** Date and time, coin, number of units, and what you paid in US dollars, including fees. An exchange trade confirmation or full CSV history works best.',
						'**Every transfer between your own wallets.** The transaction hash, the sending and receiving addresses, the units, the date and time, and the network fee. The hash is the link: it ties coins leaving one wallet to the same coins arriving in the next, on a public ledger anyone can check. It shows when coins moved and how many, but usually not what you paid, so it connects your records rather than replacing the purchase record.',
						'**The sale.** Date and time, units, proceeds in US dollars, and the sale transaction ID if one exists.',
					],
				},
				{ kind: 'p', md: 'Keep them as long as they may matter for your taxes (Treas. Reg. [1.6001-1(e)](<https://www.ecfr.gov/current/title-26/section-1.6001-1#p-1.6001-1(e)>)). The IRS says to keep records about property until the period of limitations ends for the year you sell it, generally three years and longer in some cases ([IRS, "How long should I keep records?"](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records)).' },
			],
		},
		{
			id: 'what-you-can-do-today',
			h2: 'What you can do today',
			blocks: [
				{
					kind: 'ol',
					items: [
						'Download the full history from every exchange you have used, including old accounts, while you still can.',
						'List every wallet address you control.',
						'Match each withdrawal to its deposit and write down the transaction hash.',
						'Next to each coin you still hold, note the wallet it sits in, its original purchase date and its cost.',
						'If you choose which units to sell, write that choice in your own records, by purchase date and price, before the sale. A choice written down afterward does not count ([FAQ 82](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq82)). For coins held at a broker, a choice written only in your own records counts for sales through December 31, 2026 ([Notice 2026-20](https://www.irs.gov/irb/2026-15_IRB#id61)). After that, give the instruction to the broker before you sell ([FAQ 85](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq85)).',
						'When your 2026 Form 1099-DA arrives, compare its dates and basis to your records. If basis is missing, you enter the correct basis on Form 8949. If the form shows a wrong basis, you correct it using code B ([Instructions for Form 8949](https://www.irs.gov/instructions/i8949#en_US_2025_publink59421zd0e1889), [columns (f) and (g)](https://www.irs.gov/instructions/i8949#en_US_2025_publink1000286502); 2025 edition, current as of October 2026).',
					],
				},
			],
		},
		{
			id: 'how-almstins-helps',
			h2: 'How Almstins helps',
			blocks: [
				{ kind: 'p', md: 'Almstins Wallet Watcher puts the wallets and exchange files you add side by side. Its transfer matching links a withdrawal from an exchange to its arrival in your wallet by transaction hash, address, amount and timing, flags transfers it cannot match, and suggests likely pairs for you to confirm, so you can see which moves were between your own accounts and which purchase records are still missing. It works read-only from public addresses and the exchange files you import, never asks you to connect a wallet or sign, and never holds funds or keys. Its gain and loss figures do not yet apply the 2025 wallet-by-wallet rule described above, so check them with your tax professional. The signed Year Summary export, on the Unlimited plan, gives you and your tax professional one organized record to start from. Almstins organizes records. It does not file taxes, give tax advice, or promise how any sale will be treated.' },
				{ kind: 'p', md: '**This page is general information, not tax advice.** Tax rules change, and your own facts matter. Confirm your situation with a tax professional before you file.' },
			],
		},
	],
	faq: {
		id: 'faq',
		heading: 'Frequently asked questions',
		items: [
			{
				q: 'Does moving crypto to another wallet reset my holding period?',
				a: 'No. A move between your own wallets is a non-taxable event ([IRS digital asset FAQ 81](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#faq81); see also [virtual currency FAQ 38](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-virtual-currency-transactions#btn_81fc81e9c0) for transactions before 2025), and when the default first-in, first-out rule applies, the regulations disregard the date coins arrive in a new wallet or broker account (Treas. Reg. [1.1012-1(j)(1)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(1)>), [(j)(3)(i)](<https://www.ecfr.gov/current/title-26/section-1.1012-1#p-1.1012-1(j)(3)(i)>)). The one exception is crypto spent on the network fee, which counts as a disposition ([FAQ 97](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions#btn_865bd44bfb)).',
			},
			{
				q: 'Why does my 1099-DA show no cost basis for crypto I transferred in?',
				a: 'Brokers must report basis only for covered assets: bought or traded for on or after January 1, 2026, in that account, and held there until the sale ([2026 Instructions for Form 1099-DA, "Covered security"](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000132014)). Coins you transferred in are noncovered, so the broker is not required to report their basis (same instructions, ["Noncovered security"](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000132017) and ["2026 and beyond"](https://www.irs.gov/instructions/i1099da#en_US_2026_publink1000156488)). You still report the correct basis yourself ([Instructions for Form 8949, column (e)](https://www.irs.gov/instructions/i8949#en_US_2025_publink59421zd0e1889)).',
			},
			{
				q: 'Is a blockchain record enough to prove my cost basis?',
				a: 'Not by itself. A transaction hash shows when coins moved and how many, which links your purchase to your sale. It usually does not show what you paid. Brokers may, but do not have to, use purchase records or public ledger data you give them to order lots (Treas. Reg. [1.6045-1(d)(2)(ii)(B)(4)](<https://www.ecfr.gov/current/title-26/section-1.6045-1#p-1.6045-1(d)(2)(ii)(B)(4)>)), but they may not use that information to report your basis ([IRS FAQs about broker reporting, Q7](https://www.irs.gov/filing/frequently-asked-questions-about-broker-reporting#:~:text=A7.%20No.)). Keep the original purchase record too.',
			},
		],
	},
	sources: {
		id: 'sources',
		heading: 'Sources',
		intro: 'Every source below is an official US government page.',
		groups: [
			{
				heading: 'Internal Revenue Service (irs.gov)',
				items: [
					'*Frequently asked questions on digital asset transactions.* <https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-digital-asset-transactions>. Accessed October 11, 2026.',
					'*Frequently asked questions on virtual currency transactions.* <https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-virtual-currency-transactions>. Accessed October 11, 2026.',
					'*Frequently asked questions about broker reporting.* <https://www.irs.gov/filing/frequently-asked-questions-about-broker-reporting>. Accessed October 11, 2026.',
					'*Instructions for Form 1099-DA (2026).* <https://www.irs.gov/instructions/i1099da>. Accessed October 11, 2026.',
					'*Instructions for Form 1099-DA (2025).* <https://www.irs.gov/pub/irs-prior/i1099da--2025.pdf>. Accessed October 11, 2026.',
					'*Instructions for Form 8949 (2025).* <https://www.irs.gov/instructions/i8949>. Accessed October 11, 2026.',
					'*Notice 2026-20, Extension of Temporary Relief Under Section 1.1012-1(j)(3)(ii),* Internal Revenue Bulletin 2026-15. <https://www.irs.gov/irb/2026-15_IRB#NOT-2026-20>. Accessed October 11, 2026.',
					'*FS-2025-06, Tax professionals can prepare now to assist their clients with reporting proceeds from certain digital asset transactions* (Sept. 25, 2025). <https://www.irs.gov/newsroom/tax-professionals-can-prepare-now-to-assist-their-clients-with-reporting-proceeds-from-certain-digital-asset-transactions>. Accessed October 11, 2026.',
					'*How long should I keep records?* <https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records>. Accessed October 11, 2026.',
				],
			},
			{
				heading: 'Treasury regulations (Electronic Code of Federal Regulations, ecfr.gov)',
				items: [
					'*26 CFR 1.1012-1, Basis of property.* <https://www.ecfr.gov/current/title-26/section-1.1012-1>. Accessed October 11, 2026.',
					'*26 CFR 1.6001-1, Records.* <https://www.ecfr.gov/current/title-26/section-1.6001-1>. Accessed October 11, 2026.',
					'*26 CFR 1.6045-1, Returns of information of brokers and barter exchanges.* <https://www.ecfr.gov/current/title-26/section-1.6045-1>. Accessed October 11, 2026.',
					'*26 CFR 1.6045A-1, Statements of information required in connection with transfers of securities.* <https://www.ecfr.gov/current/title-26/section-1.6045A-1>. Accessed October 11, 2026.',
				],
			},
			{
				heading: 'Federal Register (federalregister.gov)',
				items: [
					'*T.D. 10000, Gross Proceeds and Basis Reporting by Brokers and Determination of Amount Realized and Basis for Digital Asset Transactions,* 89 FR 56480 (July 9, 2024). <https://www.federalregister.gov/documents/2024/07/09/2024-14004/gross-proceeds-and-basis-reporting-by-brokers-and-determination-of-amount-realized-and-basis-for>. Accessed October 11, 2026.',
				],
			},
			{
				heading: 'Internal Revenue Code (United States Code, 2024 edition, govinfo.gov)',
				items: [
					'*26 U.S.C. 1222, Other terms relating to capital gains and losses.* <https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleA-chap1-subchapP-partIII-sec1222.htm>. Accessed October 11, 2026.',
					'*26 U.S.C. 6001, Notice or regulations requiring records, statements, and special returns.* <https://www.govinfo.gov/content/pkg/USCODE-2024-title26/html/USCODE-2024-title26-subtitleF-chap61-subchapA-partI-sec6001.htm>. Accessed October 11, 2026.',
				],
			},
		],
	},
};
