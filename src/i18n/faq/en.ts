// FAQ — English source items (auto-extracted from the original faq.astro markup).
// Shape: { id (DOM id, language-agnostic), q (question/button + modal <h1>), a (answer HTML) }.
// `a` is rendered with set:html inside .modal-content; `q` is auto-escaped text.
import type { FaqItem } from '../faq';

export const items: FaqItem[] = [
  {
    id: "faq-project",
    q: "Learn about the project",
    a: `<p>
          Almstins exists because crypto portfolios are genuinely hard to understand. Coins move between wallets and exchanges, get traded, staked, gifted, or lost — and most people have no single place that shows the full picture clearly.
        </p>

        <p>
          The goal is simple: open your portfolio and know exactly what you have, where it came from, how long you have held it, and what it is worth. That information is displayed across three pages:
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Vault</strong> — live market values for all your connected wallets and exchange accounts. Each coin shows its ticker, amount, current dollar value, profit/loss, and the number of days it has been in your ecosystem. The Vault also surfaces Aave DeFi positions (loan health, collateral breakdown).</li>
          <li><strong>Bookkeeping</strong> — your full transaction history in one place, with realized gains, cost basis, and FIFO lot tracking. This is the page that matters at tax time.</li>
          <li><strong>Research</strong> — a dedicated investigation tool for finding where coins came from, where they went, and resolving any gaps in your history. The transfer matching engine automatically links withdrawals to deposits across sources, and anything it can't resolve automatically shows up in the Needs Attention panel for you to review.</li>
        </ul>

        <p>
          You can delete any tin you no longer need at any time. Your raw transaction data is never modified — everything is stored as imported.
        </p>`,
  },
  {
    id: "faq-exchanges",
    q: "What about exchanges",
    a: `<p>
          You can add exchanges. The self-custody wallets pull data from APIs,
          exchanges use CSV files. You can just upload the file into the
          project. There's no industry standard format for the csv files, so one
          file may have a table with five columns beginning with gas fees, while
          the other may have ten columns beginning with a unique user ID that
          nobody understands except people who work with databases. So, each
          exchange has a unique upload. These tins will display the tokens in
          your account. and push your transactions to the bookkeeping page for
          storage.
        </p>`,
  },
  {
    id: "faq-transactions",
    q: "What about transactions",
    a: `<p>
          Every coin has a life story. It was bought, traded for, staked, gifted, or sent to you from somewhere — and eventually it was sold, moved, or is still sitting in a wallet. Almstins tracks that entire journey.
        </p>

        <p>
          Transactions are imported from your exchanges via CSV upload and from self-custody wallets via blockchain API. Once imported, every transaction is stored exactly as received and never modified. Notes and disposal labels you add are stored separately alongside the raw data.
        </p>

        <p>
          The Bookkeeping page groups transactions by coin and calculates cost basis using FIFO (first-in, first-out). When you sell or trade a coin, the oldest lot is consumed first. The age of each lot determines whether a disposal is a short-term or long-term capital gain — a distinction that can make a significant difference to your tax bill.
        </p>

        <p>
          The Research page handles the harder question: what about transactions that don't have an obvious counterpart? When you withdraw from Coinbase and deposit to Kraken, each platform records only its half. The transfer matching engine automatically finds those pairs across all your sources. Anything it can't confidently match surfaces in the Needs Attention panel, where you can investigate, confirm, or annotate it yourself.
        </p>`,
  },
  {
    id: "faq-bookkeeping",
    q: "Bookkeeping page",
    a: `<p>
          The Bookkeeping page is where everything comes together. Every transaction imported from every exchange and wallet appears in one unified history — sorted, searchable, and organized by asset.
        </p>

        <p>
          For each coin you hold, the page shows your full lot history: when you acquired it, what you paid (cost basis), and whether any of it has been disposed of. Realized gains and losses are calculated automatically using FIFO (first-in, first-out) matching — the same method the IRS expects. The short-term versus long-term split is handled for you based on actual hold time.
        </p>

        <p>
          You can download your full transaction list as a CSV at any time. You can also add notes to individual transactions — useful for annotating gifts, donations, lost coins, or anything your accountant will need context on.
        </p>

        <p>
          At the bottom of the page, the <strong>Reconciliation view</strong> compares the balances the pipeline computed against what your live wallets and exchanges actually show — so you can spot missing data before it becomes a problem at tax time.
        </p>`,
  },
  {
    id: "faq-privacy",
    q: "Is it private",
    a: `<p>
          Short answer, no. Everything pulled from the API keys is out there for
          the public to see. But, the website is private, your login is private
          and your data is secure. The database encrypts everything. I will
          eventually track unique Ids, number of wallets, what features people
          are using, and how much traffic. My purpose is to measure my
          effectiveness, and make a better product.
        </p>`,
  },
  {
    id: "faq-safety-checker",
    q: "What is the wallet & website safety checker?",
    a: `<p>
          A free public tool — no account, no wallet connection — for checking an
          address or a website <em>before</em> you send funds or connect. Paste a
          wallet address and it runs safety checks (GoPlus blacklist, OFAC
          sanctions, mixer / Tornado Cash activity, honeypot detection, wallet
          age, multi-sig). Paste a URL and it checks 7 independent phishing and
          malware databases — MetaMask, ScamSniffer, GoPlus, URLScan.io,
          OpenPhish, Google Safe Browsing, and VirusTotal — and returns red,
          yellow, or green. Almstins never makes its own determination; it
          surfaces what the security community has already flagged.
        </p>
        <p>
          Nothing you check is stored in readable form. Repeat checks come from a
          short-lived cache keyed to an irreversible one-way hash of what you
          entered, and the usage counter records only that same hash — so there
          is no way to work backward to what you looked up. This keeps the tool
          consistent with the rule that Almstins never links an address to a
          person.
        </p>`,
  },
  {
    id: "faq-support",
    q: "What does the project currently support?",
    a: `<p><strong>Self-custody wallets (live blockchain data)</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>EVM chains: Ethereum, Polygon, Avalanche, Arbitrum, and others</li>
          <li>Sui (SUI) — native wallet balances and transaction sync</li>
          <li>Solana (SOL) — native wallet balances</li>
          <li>Bitcoin (BTC) and Litecoin (LTC) — address tracking</li>
          <li>Coin balances, age of holdings, ticker, amount, current value, profit/loss</li>
          <li>Aave DeFi positions — loan health, collateral breakdown, debt tracking</li>
        </ul>

        <p><strong>Exchange CSV imports</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Coinbase</li>
          <li>Crypto.com</li>
          <li>Gemini (Buy, Debit, and Credit rows including staking, airdrops, and learning rewards)</li>
          <li>Kraken (Ledgers export)</li>
          <li>Exodus</li>
          <li>Cash App</li>
          <li>Robinhood</li>
          <li>Venmo</li>
        </ul>

        <p><strong>Bookkeeping</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Full transaction history across all sources in one view</li>
          <li>FIFO cost basis and realized gains calculation</li>
          <li>Short-term vs. long-term gain classification by hold time</li>
          <li>Reconciliation view — compares computed balances against live wallet data</li>
          <li>Downloadable transaction list</li>
        </ul>

        <p><strong>Research page</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Transfer matching engine — automatically links withdrawals to deposits across sources using transaction hash, address, amount, and timing signals</li>
          <li>Needs Attention panel — surfaces unresolved transactions and suggested matches</li>
          <li>Full-text search across all transactions by hash, symbol, date range, or keyword</li>
          <li>Symbol chips for one-click per-asset audit</li>
          <li>Disposal annotations — label any transaction as a sale, trade, gift, donation, or loss directly from the Research page</li>
          <li>Address labels — known wallet addresses labeled automatically; custom labels storable by transaction hash or ID</li>
          <li>Resolved tin — confirmed matches archived at the bottom of the panel</li>
        </ul>`,
  },
  {
    id: "faq-defi",
    q: "What DeFi positions does Almstins serve?",
    a: `<p>Almstins reads your live DeFi lending and borrowing positions by address (read-only, no wallet connection) and folds them into your net worth, portfolio, and cost basis. Currently supported:</p>
        <p><strong>Aave V3 — lending &amp; borrowing</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Supplied collateral and variable-debt (borrow) positions</li>
          <li>Loan health factor, liquidation risk, and live supply/borrow rates</li>
          <li><strong>Ethereum</strong> — all four markets: Core, Lido, EtherFi, and Horizon (a position in any of them shows, e.g. wstETH supplied to the Lido market)</li>
          <li><strong>Polygon</strong></li>
          <li><strong>Avalanche</strong></li>
        </ul>
        <p><strong>Sovryn — Bitcoin DeFi</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Sovryn protocol positions on the Rootstock (RSK) network</li>
        </ul>
        <p>Each Aave position links straight through to its market on the Aave app, so you can reach it in one click. Positions are read-only and tracked by address only — Almstins never connects your wallet or requests signing permission. If a DeFi position is not showing, it is most likely on a protocol or chain not yet listed here.</p>`,
  },
  {
    id: "faq-defi-untracked",
    q: "How do I track crypto I've lent or staked on a protocol Almstins doesn't support yet?",
    a: `<p>Almstins reads a growing set of DeFi protocols directly (Aave, Sovryn). If your position is on one we don't cover yet — many Solana lending markets, for example — the coins usually sit <em>inside</em> the protocol rather than in your wallet, so they won't appear in your wallet snapshot. You can still keep them correct on your books:</p>
        <ol style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li><strong>Don't re-enter the purchase.</strong> If you bought the coins on an exchange, that buy is already imported from your CSV — adding it again would double-count it.</li>
          <li><strong>Mark the transfer as your own wallet.</strong> On the Research page, find the withdrawal that moved the coins from the exchange to the protocol and mark it <em>My own wallet</em>. This tells Almstins it was a move between your own accounts, not a sale, so the coins stay a held position at your real cost basis instead of being counted as a disposal.</li>
          <li><strong>Add a note so you can find it later.</strong> On that transaction, add a note with the protocol's app link and your wallet address, so you know where the coins actually live.</li>
          <li><strong>Label the destination address as an own wallet.</strong> On the Research page, label the wallet you moved the coins to as one of your own. Future transfers to it then classify themselves automatically via Auto-classify.</li>
        </ol>
        <p>Two things to expect. The reconciliation panel will show a small gap for that coin — your books say you hold it, but the wallet snapshot can't see it inside the protocol. That is normal and does not affect your cost basis. And the position stays an <em>unrealized</em> gain or loss until you actually withdraw and sell it; at that point, record the sale as a disposal to realize it.</p>
        <p><strong>Making the change show up:</strong> after you reclassify a transaction, your cost basis updates on the next lifecycle rebuild — which runs automatically when you open the <strong>Bookkeeping</strong> or <strong>Portfolio</strong> page, or when you use <strong>Fill Missing Prices</strong> on the Research page. Note that <em>Re-run matching</em>, <em>Auto-classify</em>, and the Vault's <em>Sync Tins</em> do <em>not</em> trigger the rebuild, so open Bookkeeping (or run Fill Missing Prices) to see the reclassification land.</p>`,
  },
  {
    id: "faq-now",
    q: "What are you working on now?",
    a: `<p>The core portfolio tracker, bookkeeping engine, and Research page are live. Here is what is actively being developed or planned next:</p>

        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>More exchange importers.</strong> The eight currently supported exchanges cover the majority of US users, but there are more to add. Bybit, OKX, and Kraken Pro are on the list. If your exchange is not supported, use the Flag for Support option and it will be prioritised.
          </li>
          <li>
            <strong>Historical price backfill for older transactions.</strong> The free CoinGecko API only reaches back 365 days. A paid API key unlocks full history for transactions from 2021 and earlier. This will be added as an optional upgrade for users with deep historical data.
          </li>
          <li>
            <strong>Research page — bulk annotation.</strong> Currently you annotate one transaction at a time. The plan is to allow selecting multiple transactions and applying a disposal type or note to all of them in one step.
          </li>
          <li>
            <strong>Year-end gain/loss summary.</strong> The bookkeeping engine classifies every transaction using FIFO lot matching and organizes your realized short- and long-term gains into a clear year-end summary to hand your accountant. Broader coverage and international equivalents are coming. Almstins organizes your records — it isn't tax-filing software.
          </li>
          <li>
            <strong>Additional chain support.</strong> Solana and Sui wallets are now live. Cardano is next on the list. Solana transaction history sync (beyond balance) is in progress.
          </li>
          <li>
            <strong>Events page.</strong> A calendar view of significant portfolio events — large deposits, disposals, staking rewards milestones. Currently disabled in the nav; coming soon.
          </li>
        </ol>`,
  },
  {
    id: "faq-tax",
    q: "Is this software for filing returns?",
    a: `<p>
          Almstins is not a tax preparation service and does not file returns on your behalf. What it does is organize the underlying data your accountant or tax software needs — and for crypto, that data is genuinely difficult to assemble on your own.
        </p>

        <p>
          The bookkeeping engine classifies every transaction across all your connected exchanges and wallets, runs FIFO lot matching to calculate cost basis, and flags anything that needs your attention (missing prices, unmatched transfers, borrowed assets). It produces a <strong>clear year-end summary</strong> of your realized short- and long-term gains, income, and open positions that you can hand directly to your accountant or their tax software.
        </p>

        <p>
          The more complete your imported data, the more accurate the output. Every CSV you upload and every wallet you connect improves the picture. The pipeline gets smarter over time as you resolve flagged items.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>⚠️ This is not tax advice.</strong> Always verify the output with a qualified tax professional before filing. Tax treatment of crypto varies by jurisdiction and individual circumstances.
        </p>`,
  },
  {
    id: "faq-wallet-vs-bookkeeping",
    q: "Why is \"Still in Wallet\" different from my Vault balance?",
    a: `<p>
          These two numbers measure the same assets in completely different ways — and both are correct. Here's the difference:
        </p>

        <p>
          <strong>Vault — Market Value</strong><br />
          The Vault pulls live data directly from the blockchain right now. The dollar value shown is what your coins are worth <em>today</em> at current market prices. If you bought Bitcoin in 2018 for $6,000 and it's now worth $90,000, the Vault shows $90,000.
        </p>

        <p>
          <strong>Bookkeeping — Cost Basis</strong><br />
          "Still in Wallet" on the Bookkeeping page shows what you <em>originally paid</em> for the coins you haven't sold yet — your cost basis. Using the same example, it would show $6,000 for that Bitcoin. This number matters for taxes: when you eventually sell, your taxable gain is the difference between what you sell it for and what you paid (the cost basis).
        </p>

        <p>
          <strong>In short:</strong> Vault = current market value of your portfolio. Bookkeeping = what you paid to build it. The gap between the two is your unrealized profit (or loss).
        </p>`,
  },
  {
    id: "faq-erc20-zero",
    q: "A transaction shows $0 on the block explorer — but my tracker shows $1,000?",
    a: `<p>
          You're not going crazy, and neither is the tracker. This is one of the most
          common points of confusion in crypto bookkeeping, and it comes down to how
          block explorers display token transfers.
        </p>

        <p>
          <strong>Why does Polyscan (or Etherscan) show $0?</strong><br />
          Every transaction on a blockchain has a "Value" field — but that field only
          tracks the <em>native coin</em> (MATIC, ETH, etc.). When you send a token like
          USDC or USDT, the native coin value is literally zero because you aren't moving
          MATIC or ETH. The actual token transfer is recorded separately in the transaction
          logs. To see it, click the <strong>"ERC-20 Token Txns"</strong> tab on the
          transaction page — that's where your 1,000 USDC will appear.
        </p>

        <p>
          <strong>So the tracker is right?</strong><br />
          Yes. The tracker reads the token transfer logs directly, so it correctly records
          the USDC amount and its dollar value at the time of the transfer. The $1,000 you
          see is real — the block explorer is just showing you the wrong field.
        </p>

        <p>
          <strong>How do I clear it from "Needs Attention"?</strong><br />
          Click <strong>Details →</strong> on the item. You'll see a
          <strong>💵 Stablecoin · $1.00</strong> quick button — tap it and hit Save.
          Since you paid $1.00 per USDC and received $1.00 per USDC, the gain
          is effectively $0. The item disappears from the list and nothing changes on
          your Year Summary.
        </p>

        <p>
          <strong>What if the destination wallet is flagged as a scam?</strong><br />
          That's a separate issue — it means your USDC may have been sent to a scammer
          (a common trick called "address poisoning"). The transfer still happened and
          the tracker is still correct. Unfortunately the tokens are likely gone. For
          tax purposes, set the cost basis to $1.00 as above — the loss of the funds
          may be deductible as a theft loss depending on your jurisdiction, so make a
          note of it and talk to your accountant.
        </p>`,
  },
  {
    id: "faq-borrowed-money",
    q: "I borrowed money through Aave — how does that work in bookkeeping?",
    a: `<p>
          Great question, and it trips people up all the time. The short answer:
          <strong>borrowed money is not income</strong>, and the tracker already knows that.
        </p>

        <p>
          <strong>When you borrow from Aave:</strong><br />
          You deposit collateral (say, ETH) and the protocol lends you USDC against it.
          That USDC lands in your wallet as an incoming transfer — but it's a
          <em>loan</em>, not a purchase or a gift. The tracker classifies this as a
          <strong>liability increase</strong> and skips it entirely when building your
          cost basis. It will never show up as a buy lot in "Still in Wallet" because
          you didn't buy it — you owe it back.
        </p>

        <p>
          <strong>Where does it show up?</strong><br />
          On the Bookkeeping page, scroll down to the <strong>🔷 DeFi Positions</strong>
          section. Your collateral (the ETH or USDC you deposited) appears in teal marked
          <em>AAVE</em>. Your outstanding loan appears in red marked <em>DEBT</em>. These
          are separated from your regular wallet holdings on purpose — they follow
          different accounting rules.
        </p>

        <p>
          <strong>When you repay the loan:</strong><br />
          The USDC you send back to Aave is also handled automatically — it's classified
          as a <strong>liability repayment</strong>. The tracker consumes the cost lot for
          that USDC (you're returning something you borrowed) but records no taxable gain
          or loss, because paying back a loan isn't a sale.
        </p>

        <p>
          <strong>What about the interest I'm paying?</strong><br />
          Aave charges interest by slowly increasing the amount you owe — your debt token
          balance grows over time. The tracker tracks this, and the accrued interest shows
          in your DeFi Positions tin. Whether Aave interest is tax-deductible depends on
          how you used the loan (investing vs. personal use) and your local tax law — talk
          to your accountant about that one.
        </p>

        <p>
          <strong>What if I get liquidated?</strong><br />
          If your collateral value drops too far and Aave liquidates your position, a
          portion of your collateral is seized to repay part of the debt. This is treated
          as a <em>disposal</em> of your collateral — meaning it can be a taxable event.
          The tracker will surface those events on the bookkeeping page so you can account
          for them.
        </p>`,
  },
  {
    id: "faq-reconciliation",
    q: "What is the Reconciliation view?",
    a: `<p>
          The Reconciliation view is a built-in audit tool that sits at the bottom of your
          Bookkeeping page. It compares two independent views of your portfolio side by side:
        </p>

        <ul>
          <li><strong>What the tin thinks you have</strong> — the coins remaining in your FIFO "Still in Wallet" lots, calculated from every transaction you've ever imported.</li>
          <li><strong>What your wallets and exchanges actually show</strong> — live balances pulled directly from your connected wallets and exchange CSV uploads.</li>
        </ul>

        <p>
          For each coin, it shows the difference in both quantity and estimated dollar value,
          and flags the severity with a colour:
        </p>

        <ul>
          <li>✅ <strong>Balanced</strong> — within 1%. You're good.</li>
          <li>⚠️ <strong>Over</strong> — your live balance is higher than the tin expects. Usually means there's an inflow the tracker doesn't know about yet.</li>
          <li>🔴 <strong>Under</strong> — your live balance is lower than expected. Usually means a CSV wasn't uploaded, or coins moved somewhere not yet connected.</li>
          <li>🔴 <strong>Missing</strong> — the tin shows coins you should have, but the wallet shows zero. Worth investigating.</li>
          <li>⬜ <strong>Untracked</strong> — coins showing in your wallet that have no transaction history in the system at all.</li>
        </ul>

        <p>
          <strong>What if I can't explain a discrepancy?</strong><br />
          Click any row to expand it. You'll see the last known transaction date, a breakdown
          of which wallets and exchanges are contributing the live balance, and two options:
        </p>

        <ul>
          <li><strong>Add a note</strong> — write down what you think happened so you remember later.</li>
          <li><strong>Flag for support</strong> — check this box and Donnie will be notified directly. He'll look at your data and follow up personally.</li>
        </ul>

        <p>
          The most common causes of a discrepancy are a missing CSV file, an exchange that
          hasn't been connected yet, or a hardware wallet that isn't being tracked. In most
          cases, uploading the missing data resolves it immediately.
        </p>

        <p>
          <em>Note: the estimated Δ USD column uses your average cost basis as a price
          estimate, not the current market price. It's a rough guide, not a live valuation.</em>
        </p>`,
  },
  {
    id: "faq-kraken-export",
    q: "How do I export my Kraken history?",
    a: `<p>
          Kraken offers two CSV exports — make sure you grab the right one:
        </p>
        <ol style="margin: 0.75rem 0 0.75rem 1.25rem; line-height: 1.8;">
          <li>Log in to your Kraken account</li>
          <li>Go to <strong>Account</strong> → <strong>History</strong></li>
          <li>Click <strong>Ledgers</strong> (not Trades)</li>
          <li>Set your date range and click <strong>Export</strong></li>
          <li>Upload the downloaded CSV into your Kraken tin here</li>
        </ol>
        <p>
          The <em>Ledgers</em> export contains every deposit, withdrawal, trade, and staking
          reward in one file. The <em>Trades</em> export only covers spot trades and will not
          import correctly.
        </p>`,
  },
  {
    id: "faq-pnl",
    q: "What is the P&L number next to Market Value?",
    a: `<p>
          The number shown in green or red next to your Market Value on the Portfolio tile is your <strong>unrealized profit or loss</strong> — how much you're up or down on the coins you're currently holding.
        </p>

        <p>
          <strong>How it's calculated:</strong><br />
          It's the difference between two numbers:
        </p>

        <ul>
          <li><strong>Market Value</strong> — what your coins are worth right now at current prices (pulled live from the blockchain and exchange balances).</li>
          <li><strong>Cost Basis</strong> — what you originally paid for the coins you still hold, calculated using FIFO (first in, first out) matching across all your imported transactions.</li>
        </ul>

        <p>
          <strong>P&amp;L = Market Value − Cost Basis</strong>
        </p>

        <p>
          If it's <span style="color: #86efac; font-weight: 600;">green</span>, your portfolio is worth more than you paid — you're sitting on unrealized gains. If it's <span style="color: #fca5a5; font-weight: 600;">red</span>, your current market value is below what you paid — you're holding at a loss.
        </p>

        <p>
          <strong>"Unrealized" means you haven't sold yet.</strong> No tax event has occurred. The gain or loss only becomes real (and potentially taxable) when you sell, trade, or otherwise dispose of the coins.
        </p>

        <p>
          This is the same cost basis methodology used on the Bookkeeping page under "Still in Wallet." The more complete your transaction history (CSV uploads, connected wallets), the more accurate this number will be.
        </p>`,
  },
  {
    id: "faq-sync",
    q: "How often should I sync my portfolio?",
    a: `<p>
          It depends on how current you want your numbers to be. Here's a practical guide:
        </p>

        <ul>
          <li>
            <strong>After every CSV upload</strong> — whenever you import a new exchange file, hit Sync right after. This ensures the Portfolio tile reflects your latest computed balances immediately.
          </li>
          <li>
            <strong>Before making decisions</strong> — if you're about to trade, rebalance, or just want to see where you stand, sync first so the numbers are fresh.
          </li>
          <li>
            <strong>Weekly is fine for most people</strong> — the portfolio tile is meant to give you a general picture, not tick-by-tick tracking. Once a week keeps things reasonably up to date without any extra effort.
          </li>
        </ul>

        <p>
          <strong>What the Sync button actually does:</strong><br />
          It runs three things in sequence:
        </p>
        <ol style="line-height: 1.9; margin: 0.5rem 0 1rem 1.25rem;">
          <li><strong>Recalculates exchange balances</strong> — writes a fresh snapshot from all your imported CSV transactions so the Portfolio tile shows current numbers.</li>
          <li><strong>Refreshes on-chain wallet values</strong> — pulls the latest balances from your connected EVM wallets (Ethereum, Polygon, Avalanche, Arbitrum), Sui wallets, and Solana wallets.</li>
          <li><strong>Rebuilds the bookkeeping engine</strong> — re-runs the FIFO cost basis calculation across every transaction you've ever imported, from every source. This is what keeps the Bookkeeping page accurate after a new CSV upload. If a coin was showing in "Needs Attention" because a purchase record was missing, syncing after uploading the correct CSV will resolve it.</li>
        </ol>

        <p>
          <strong>What it doesn't do:</strong><br />
          Syncing does not pull new data from your exchange. It only recalculates based on what you've already imported. If you made new trades or deposits, upload a fresh CSV first, then sync.
        </p>`,
  },
  {
    id: "faq-unauthorized",
    q: "Why does my CSV import say \"Unauthorized\"?",
    a: `<p>
          This error means the app could not verify your identity when you tried to upload the file. It is almost never a problem with the CSV itself. Here are all the known causes:
        </p>

        <ol style="line-height: 2; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Your session expired.</strong> The most common cause. If you left the tab open for a while without activity, your login session timed out. Sign out, sign back in, and try the upload again.
          </li>
          <li>
            <strong>You are signed into the wrong account.</strong> If you have multiple accounts (personal and a business account for example), make sure you are signed into the correct one before uploading.
          </li>
          <li>
            <strong>Demo mode interference.</strong> If you were browsing the demo and then signed in, the session can occasionally get confused. Sign out fully, clear your browser cookies for this site, and sign back in fresh.
          </li>
          <li>
            <strong>Browser blocked the cookie.</strong> Some browsers in strict privacy mode or with certain extensions block session cookies. Try a different browser or disable tracking protection for this site.
          </li>
          <li>
            <strong>You opened the upload page in a new tab.</strong> Session cookies can behave differently across tabs if you opened a fresh tab rather than navigating within the app. Go back to the main app and navigate to the upload from there.
          </li>
          <li>
            <strong>The server restarted mid-session.</strong> Occasionally a deployment or server restart will invalidate active sessions. Sign out and sign back in to get a fresh session.
          </li>
        </ol>

        <p>
          <strong>The fix in almost every case:</strong> sign out, sign back in, and try again. If the error persists after that, use the Flag for Support option on the Reconciliation page and Donnie will look into it directly.
        </p>`,
  },
  {
    id: "faq-earned-symbols",
    q: "What do the symbols ⚡ 🪂 🎓 ∞ mean next to my coin's age?",
    a: `<p>
          The <strong>Days</strong> column on your exchange tin shows how long ago you last acquired a coin — which matters for determining whether a future sale would be taxed as a short-term or long-term capital gain.
        </p>

        <p>
          When a coin was <em>earned or received</em> rather than purchased outright, a symbol appears alongside the age (or in place of it) to let you know how it came in:
        </p>

        <ul style="line-height: 2; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>⚡ Staking reward</strong> — the coin was earned through staking, not purchased. The age shown is the date of your last real buy; staking income does not reset the clock.</li>
          <li><strong>🪂 Airdrop</strong> — the coin was received as an airdrop. The age reflects when the airdrop was received.</li>
          <li><strong>🎓 Learning reward</strong> — earned through a learn-and-earn program such as Coinbase Earn.</li>
          <li><strong>∞ Unknown origin</strong> — no purchase record was found. The coin was likely earned, gifted, or transferred in from a source the tracker hasn't seen yet.</li>
        </ul>

        <p>
          <strong>Why doesn't staking reset the clock?</strong><br />
          Staking income arrives as tiny micro-deposits on a regular basis. If each one reset your holding-period timer, a coin you bought years ago could appear to be only days old just because it earned a fraction of a cent overnight. That would unfairly disqualify it from long-term capital gains treatment. The tracker intentionally ignores staking income when calculating the Days value so your original purchase date is preserved.
        </p>

        <p>
          <strong>Does earning a coin change my tax situation?</strong><br />
          Yes — coins received through staking, airdrops, or learn-and-earn programs are generally treated as <em>ordinary income</em> at the time of receipt (based on their fair market value that day), not as a purchase. Talk to your accountant about how to report them correctly.
        </p>`,
  },
  {
    id: "faq-staked-coins",
    q: "Why does my exchange tin show more coins than my available balance?",
    a: `<p>
          The <strong>Coins</strong> column on your exchange tin shows your <em>total</em> holdings — liquid balance plus any coins you have locked in staking. Your exchange may only show your "available" balance, which excludes staked coins.
        </p>

        <p>
          For example: if you have 0.11 ETH available and 0.208 ETH staked, the tracker shows 0.318 ETH because all of it is yours — it's just temporarily locked earning rewards.
        </p>

        <p>
          The <strong>🔒 Staked</strong> line directly below the coin quantity shows the locked portion separately so you can see exactly how much is liquid versus staked at a glance.
        </p>

        <p>
          <strong>Why does this matter for taxes?</strong><br />
          Staked coins are still your property — you just can't spend them until the unbonding period ends. Their cost basis and holding period carry over from when you originally bought them, so the tracker keeps them in your total rather than treating them as gone.
        </p>`,
  },
  {
    id: "faq-account-identity",
    q: "How is my account tied to my email address?",
    a: `<p>
          Your Almstins account has one true identity: a permanent, unique ID that never changes. Your email address is the key that unlocks it. No matter how you sign in — email and password, Google, or GitHub — as long as the sign-in method can confirm the same email address, you land in the same account every time.
        </p>

        <p>
          <strong>How it works step by step:</strong>
        </p>

        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>First sign-in creates your account.</strong> The moment you sign in for the first time, the system creates a permanent ID tied to your email address and provisions a private data vault (your "tenant") just for you.
          </li>
          <li>
            <strong>Layer 1 — email matching.</strong> Every subsequent sign-in checks whether that email already exists. If you signed up with Google and later try GitHub, and both providers confirm the same email, the system recognises you and drops you straight into your existing vault. No duplicate account is created.
          </li>
          <li>
            <strong>Layer 2 — provider ID fallback.</strong> In rare cases a provider returns no email at all (for example, a GitHub user with a private email before proper scopes are configured). When that happens the system falls back to matching your provider's numeric account ID against our records. If we've seen that GitHub ID before, you're reunited with your account automatically. This is the backstop — it's safe because your numeric GitHub ID is unique and only you can sign in with it.
          </li>
        </ol>

        <p>
          <strong>What this means in practice:</strong> you can sign in from a new browser, a new device, or a new OAuth provider and your wallets, transactions, and tax history are all waiting for you — because your email address is what ties everything together.
        </p>`,
  },
  {
    id: "faq-research-page",
    q: "What is the Research page?",
    a: `<p>
          The Research page is a dedicated investigation tool for understanding your full transaction history across every exchange and wallet you have connected. Think of it as a command centre — you can search, identify, and resolve questions about where your coins came from and where they went.
        </p>

        <p>
          <strong>The page has two panels:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Needs Attention (left).</strong> This panel automatically surfaces transactions that are unresolved — outgoing transfers with no matching deposit found anywhere in your history, and incoming deposits whose source is unknown. It also shows any transfer pairs that the matching engine has flagged for your review. Nothing here requires you to act immediately, but working through it gives you a cleaner, more complete picture of your holdings.
          </li>
          <li>
            <strong>Search Results (right).</strong> A flexible search panel lets you look up transactions by keyword, coin symbol, date range, or note. You can also click any row in the Needs Attention panel and the system pre-fills the search for you — so investigating a mystery deposit is one click away.
          </li>
        </ul>

        <p>
          <strong>Symbol chips</strong> run across the top of the search card. Clicking a coin instantly loads every transaction for that symbol — a fast way to audit a single asset across all your sources at once.
        </p>

        <p>
          <strong>Re-run Matching</strong> button at the top lets you trigger the transfer matching engine manually at any time. This is useful after importing new CSV files so any newly uploaded transactions are immediately checked against your existing history.
        </p>

        <p>
          <strong>Address lookup.</strong> Paste any blockchain address into the search field and the page will identify it — showing whether it belongs to one of your tracked wallets, a known exchange, or an address you have labelled yourself. If it is not yet in your account, you can add it as a tracked wallet and give it a label right there. You can also mark an address as belonging to a specific exchange, so that whenever it appears in future transactions it is immediately recognised rather than showing as unknown.
        </p>

        <p>
          The Research page does not change any of your raw transaction data — it only surfaces information and lets you label or confirm relationships between records.
        </p>`,
  },
  {
    id: "faq-transfer-matching",
    q: "How does transfer matching work?",
    a: `<p>
          When you move coins between two accounts you own — for example, withdrawing from Coinbase and depositing into Kraken — each platform records only its half of the move. Your CSV imports will show an outgoing transaction on one side and an incoming transaction on the other, with no obvious link between them.
        </p>

        <p>
          The transfer matching engine automatically finds these pairs and links them together, so your portfolio is not double-counted and your history tells a coherent story.
        </p>

        <p>
          <strong>How it scores a potential match:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Transaction hash (100 pts) —</strong> if the withdrawal and deposit share the same on-chain hash, it is a certain match. No further signals are needed.</li>
          <li><strong>Known address (50 pts) —</strong> if the destination address of the withdrawal is already recorded as belonging to the receiving exchange, the engine awards strong credit.</li>
          <li><strong>Amount match (up to 40 pts) —</strong> the received amount is compared to the sent amount minus a reasonable network fee. Amounts within 1% of each other score the maximum. Amounts within 2% still score partial credit.</li>
          <li><strong>Timing (up to 30 pts) —</strong> the deposit must arrive after the withdrawal. Pairs within an hour score the maximum; pairs within 72 hours score partial credit. A deposit that arrives before the withdrawal is automatically disqualified.</li>
          <li><strong>Exact amount bonus (10 pts) —</strong> awarded when sent and received amounts are identical to the coin, common in same-network transfers with no fee.</li>
        </ul>

        <p>
          <strong>What happens with the score:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>90 pts or above —</strong> the pair is matched automatically and silently. No action required.</li>
          <li><strong>60–89 pts —</strong> the pair is matched automatically but flagged so you can review it on the Research page.</li>
          <li><strong>35–59 pts —</strong> the pair appears as a suggestion in the Needs Attention panel. You can confirm or reject it with one click.</li>
          <li><strong>Below 35 pts —</strong> the pair is not recorded. Both transactions remain in the unresolved pool.</li>
        </ul>

        <p>
          <strong>Your raw data is never modified.</strong> Every CSV row you upload is stored exactly as imported and never changes. Matches are stored separately as annotations that link two transaction IDs together. If you reject a match or if the engine made a mistake, you can dismiss it and the original records are untouched.
        </p>

        <p>
          <strong>Address labels are built automatically.</strong> When a medium-confidence or higher match is made, the engine records the connection between the two accounts. Future imports from those same sources benefit immediately — the address is already known, so matches score higher and resolve faster.
        </p>

        <p>
          The engine runs automatically every time you import a new CSV, and you can also trigger it manually from the Research page using the Re-run Matching button.
        </p>`,
  },
  {
    id: "faq-cost-basis-history",
    q: "Why does cost basis only go back one year?",
    a: `<p>
          To show you what a transaction was worth in US dollars on the day it happened, Almstins looks up the historical price of that asset from CoinGecko — one of the most trusted price data sources in the industry. That lookup is what populates the dollar figures you see next to your transactions.
        </p>

        <p>
          <strong>The free tier has a 365-day limit.</strong> CoinGecko's public API only allows historical price queries going back one year. Ask for a price from two years ago on the free plan and the request is rejected. This is a deliberate restriction — CoinGecko charges for deeper access because maintaining years of clean, timestamped price data across thousands of assets is genuinely expensive.
        </p>

        <p>
          <strong>What this means in practice:</strong> if you imported transactions from 2021 or 2022, Almstins can still track the amounts and movements correctly — it just may not be able to attach a historical dollar value to those older rows automatically. Any exchange that included a USD value in its CSV export (Crypto.com and Coinbase both do) will already have the correct figure stored regardless of age.
        </p>

        <p>
          <strong>How to unlock full history:</strong> upgrading to a CoinGecko Pro API key removes the 365-day restriction entirely and lets Almstins price every transaction back to the beginning of each asset's trading history. If you manage a large portfolio with significant pre-2024 activity, this is the recommended path. Contact your account administrator or add <code>COINGECKO_API_KEY</code> to your environment to enable it.
        </p>

        <p>
          <strong>What about the Needs Attention list?</strong> For deposits that are older than 2024 and came from exchanges that have since left the US market — such as Binance.US or Bittrex — there may be no matching counterpart transaction available at all. For those cases, Almstins lets you label the transaction manually to explain its origin. Once labeled, it is removed from the Needs Attention list automatically. The 2024 boundary is intentional: it covers the period when most regulatory-driven exchange departures occurred, while keeping recent unexplained deposits visible so nothing slips through unnoticed.
        </p>`,
  },
  {
    id: "faq-annotate",
    q: "How do I label a disposal — gift, sale, or lost coin?",
    a: `<p>
          Not every outgoing transaction is a sale. Crypto can leave your wallet as a gift, a charitable donation, a trade, or a loss — and each of those is treated differently for tax purposes. Almstins lets you label any transaction with its disposal type so your records are accurate and your tax preparer has everything they need.
        </p>

        <p><strong>How to annotate a transaction:</strong></p>
        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Go to the <strong>Research</strong> page.</li>
          <li>Find the transaction in the <strong>Needs Attention</strong> panel or search for it in the right panel.</li>
          <li>Click the <strong>📝 Add note</strong> button at the bottom of the transaction card.</li>
          <li>Choose a disposal type from the dropdown and optionally add a free-text note.</li>
          <li>Click <strong>Save</strong>.</li>
        </ol>

        <p>The note and category are written directly onto the transaction record, so they follow the transaction everywhere it appears — Bookkeeping, Research, and any future exports.</p>

        <p><strong>Available disposal types:</strong></p>
        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Sell</strong> — a straightforward sale for fiat or stablecoin. Capital gain or loss applies.</li>
          <li><strong>Trade (crypto → crypto)</strong> — exchanging one cryptocurrency for another. Also a taxable disposal in the US — the gain or loss is calculated at the time of the trade.</li>
          <li><strong>Gift out</strong> — crypto sent to another person as a gift. Not a taxable event for the sender at the time of the gift, but the recipient inherits your cost basis. Gifts above the annual exclusion limit ($18,000 in 2024) may require a gift tax return.</li>
          <li><strong>Gift in</strong> — crypto received as a gift. Not taxable income. Your cost basis is the donor's original cost basis.</li>
          <li><strong>Lost / stolen</strong> — coins that are permanently inaccessible. Whether this is deductible as a loss depends on your jurisdiction and when it occurred. Consult a tax professional.</li>
          <li><strong>Donation</strong> — crypto sent to a registered charity. If held for more than one year, you may deduct the fair market value at the time of donation without recognising a capital gain. If held for less than one year, the deduction is limited to your cost basis.</li>
          <li><strong>Other / explained</strong> — for anything that doesn't fit the above categories. Use the free-text note to describe it.</li>
        </ul>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>⚠️ This is not tax advice.</strong> Almstins helps you organise and label your transaction history — it does not file returns or provide legal or tax guidance. Tax treatment of crypto varies by jurisdiction and individual circumstances. Always consult a qualified tax professional before making decisions based on this data.
        </p>`,
  },
  {
    id: "faq-custodial-address",
    q: "If an exchange sends crypto from an address, does that address belong to me?",
    a: `<p>
          Not necessarily. When an exchange like Venmo, Coinbase, or Kraken sends you crypto, the transaction originates from <em>their</em> wallet — not yours. Exchanges pool funds across thousands of users into shared hot wallets. The address in the "From" field belongs to the exchange's infrastructure, not to your personal account.
        </p>

        <p>
          There are two fundamentally different ways to hold crypto:
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Custodial (exchange accounts)</strong> — the exchange holds your private keys. You have a balance in their system and they move funds on your behalf. The on-chain addresses belong to them. Venmo, Coinbase, Kraken, and Gemini all work this way.</li>
          <li><strong>Self-custody (your own wallet)</strong> — you hold the private keys. The address is yours and yours alone. No one else can send from it. MetaMask, hardware wallets (Ledger, Trezor), and similar tools work this way.</li>
        </ul>

        <p>
          This matters when using the Research page's address lookup. If you paste an address from an exchange transaction, you will see <em>that exchange's</em> activity — all transfers in and out of their shared pool — not just your personal history. To track your own funds accurately, use the addresses from wallets you personally control.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Tip:</strong> If you received crypto through Venmo and then sold it, your transaction is recorded in Venmo's internal ledger. The on-chain address is just their backend — tracking it won't show your personal balance.
        </p>`,
  },
  {
    id: "faq-address-labels",
    q: "How does the Address Book work?",
    a: `<p>
          When money moves on a blockchain, it moves between addresses — long strings of letters and numbers like <code style="font-size: 0.82em; background: rgba(255,255,255,0.08); padding: 0.1rem 0.35rem; border-radius: 4px;">0x794a61…</code>. By themselves those addresses mean nothing. The Address Book is how you turn them into names like <strong>"Aave V3 Pool · Ethereum"</strong> or <strong>"Crypto.com Deposit"</strong> — so that everywhere an address appears in your history, you see a name instead.
        </p>

        <p>
          The Address Book lives on the <strong>Addresses</strong> page. These are <em>not</em> wallets you own — they are counterparties: exchanges, DeFi protocols, bridges, or other people's wallets that show up in your transaction history.
        </p>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">How the book gets populated</h2>

        <p>There are three ways an address ends up labeled:</p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Pre-seeded contracts</strong> — well-known DeFi protocol addresses (Aave V3 on Ethereum, Polygon, and Avalanche) come pre-labeled. You do not need to add these yourself.</li>
          <li><strong>Manual entry</strong> — type or paste an address, give it a name, pick a category (Exchange, DeFi Protocol, Personal Wallet, Bridge, etc.) and optionally a chain. Hit Save.</li>
          <li><strong>📷 Scan Screenshot</strong> — some exchanges (like Crypto.com) don't let you copy wallet addresses. Take a screenshot of the address on your phone or desktop, upload it with the Scan Screenshot button, and Claude Vision reads the address out of the image and pre-fills the form for you automatically.</li>
        </ul>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">How it connects to mystery transactions</h2>

        <p>
          Every transaction in your history has a <strong>from address</strong> and a <strong>to address</strong>. When one of those addresses is in your Address Book, Almstins shows the name instead of raw hex — in the transaction drawer, in the Needs Attention panel, and anywhere addresses appear in your history.
        </p>

        <p>
          This is especially useful for <strong>Needs Attention</strong> items — transactions that couldn't be automatically classified. If the counterparty address is labeled "Aave V3 Pool · Polygon," you immediately know this was a DeFi deposit or withdrawal rather than a mysterious unknown transfer. That context helps you decide the right classification quickly.
        </p>

        <p style="background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 0.5rem;">
          <strong>Tip:</strong> The more addresses you label, the fewer mystery transactions you will have. Start with your exchange deposit addresses — those are the most common source of unresolved transfers.
        </p>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Community labels</h2>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Every time you save a label, a silent community vote is recorded in the background.</li>
          <li>When 3 users independently label the same address the same way, it becomes a <strong>global label</strong> visible to everyone on the platform.</li>
          <li>If 5 users later agree on a different name, the global label is corrected automatically.</li>
          <li>Your personal label always takes priority over a community label if they disagree.</li>
        </ul>`,
  },
  {
    id: "faq-recognized-tokens",
    q: "Which tokens are automatically priced and recognized?",
    a: `<p>
          Almstins maintains a list of known, verified tokens. Tokens on this list get a live price, show up correctly in your Vault and Bookkeeping pages, and are never flagged as potential spam — regardless of which wallet they appear in.
        </p>

        <p><strong>Currently recognized tokens:</strong></p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem; columns: 2;">
          <li><strong>BTC</strong> — Bitcoin</li>
          <li><strong>ETH</strong> — Ethereum</li>
          <li><strong>WETH</strong> — Wrapped Ether</li>
          <li><strong>WBTC</strong> — Wrapped Bitcoin</li>
          <li><strong>USDC</strong> — USD Coin</li>
          <li><strong>USDT</strong> — Tether</li>
          <li><strong>SOL</strong> — Solana</li>
          <li><strong>BNB</strong> — BNB</li>
          <li><strong>XRP</strong> — XRP</li>
          <li><strong>ADA</strong> — Cardano</li>
          <li><strong>LINK</strong> — Chainlink</li>
          <li><strong>XLM</strong> — Stellar</li>
          <li><strong>ZEC</strong> — Zcash</li>
          <li><strong>SUI</strong> — Sui</li>
          <li><strong>AVAX</strong> — Avalanche</li>
          <li><strong>WAVAX</strong> — Wrapped AVAX</li>
          <li><strong>SAVAX</strong> — Staked AVAX</li>
          <li><strong>POL / MATIC</strong> — Polygon</li>
          <li><strong>AAVE</strong> — Aave</li>
          <li><strong>ARB</strong> — Arbitrum</li>
          <li><strong>STETH</strong> — Lido Staked ETH</li>
          <li><strong>WSTETH</strong> — Wrapped stETH</li>
          <li><strong>QUICK</strong> — QuickSwap</li>
        </ul>

        <p>
          Wrapped and bridged variants (WETH, WBTC, WAVAX, etc.) are automatically mapped to their underlying asset for pricing — so your wrapped tokens show the correct market value without any manual setup.
        </p>

        <p style="background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 0.5rem;">
          <strong>Don't see your token?</strong> Any token not on this list will show as unpriced in your Vault. This is intentional — unverified contracts are a common vector for spam airdrops. If you hold a legitimate token that's missing, use the <em>Flag for Support</em> option and it will be reviewed for addition.
        </p>`,
  },
  {
    id: "faq-health-alerts",
    q: "How do Aave health factor alerts work?",
    a: `<p>
          If you have an active Aave loan, your <strong>health factor</strong> is the single most important number to watch. It measures how safely your collateral covers your debt. When it drops too close to 1.0, Aave can liquidate your collateral to repay the loan — which usually happens at a bad price for you.
        </p>

        <p>
          Almstins checks your health factor every 30 minutes and sends you an email the moment it crosses a threshold you set. You choose:
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Direction</strong> — alert when the health factor falls <em>below</em> your threshold (most common) or rises <em>above</em> it.</li>
          <li><strong>Threshold</strong> — the number that triggers the alert. A value of 1.5 is a reasonable early-warning level; many people set a second alert at 1.2 as a final warning.</li>
        </ul>

        <p>
          To set an alert, open any Aave DeFi position on your Vault page and click the <strong>🔔 Set Alert</strong> pill next to your health factor. Once active, the pill turns yellow and shows your current setting — for example, <strong>🔔 HF &lt; 1.5</strong>.
        </p>

        <p>
          Alerts are sent to your <strong>alert email</strong>, which can be different from your account login email. You can set or change it in the <strong>Account</strong> menu at the top of any page. If no alert email is set, the pill will prompt you to add one before the alert can fire.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Rate limit:</strong> To avoid inbox noise, alerts are sent at most once every 4 hours per wallet, even if your health factor stays below the threshold the entire time. Once the situation is resolved and the health factor recovers, the clock resets.
        </p>`,
  },
  {
    id: "faq-reconciliation-delta",
    q: "Why does my monthly reconciliation show a delta even when nothing went wrong?",
    a: `<p>
          The monthly checkbook works in <strong>dollar amounts</strong> — opening balance, inflows, outflows, and closing balance are all in USD. That means even a perfectly clean month with zero missing transactions will show a delta, because the dollar value of your coins changes with the market every single day.
        </p>

        <p>
          <strong>Example:</strong> You open January with $10,000 in Bitcoin. You buy nothing, sell nothing, and move nothing. But Bitcoin rises 20% during the month. Your closing balance is $12,000. The checkbook formula says:
        </p>

        <blockquote style="background: rgba(255,255,255,0.05); border-left: 3px solid #e8a020; padding: 0.75rem 1rem; margin: 0.75rem 0; border-radius: 0 8px 8px 0;">
          Expected closing = $10,000 + $0 − $0 = $10,000<br />
          Actual closing = $12,000<br />
          Delta = +$2,000
        </blockquote>

        <p>
          That $2,000 delta is not a problem. It is unrealized appreciation — exactly what you want to see. The dollar-based checkbook cannot distinguish between "coins appeared from nowhere" and "coins you already had became more valuable."
        </p>

        <p>
          <strong>The right way to check for missing data is to count coins, not dollars.</strong>
        </p>

        <p>
          If you held 0.10 BTC at the start of the month, bought nothing, sold nothing, and still hold 0.10 BTC at the end — the books balance perfectly regardless of price. A coin-quantity reconciliation is immune to market movements because price does not affect how many coins you own.
        </p>

        <p>
          <strong>How to use this in practice:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>A <strong>dollar delta</strong> on a quiet month is almost always price appreciation or depreciation. Normal.</li>
          <li>A <strong>coin-count discrepancy</strong> — where your expected quantity and actual quantity don't match — always means something is missing: a transaction wasn't imported, a transfer lost one side, or an exchange isn't connected yet.</li>
          <li>The <strong>Reconciliation view</strong> on the Bookkeeping page works in coin quantities for exactly this reason. Use it to find data gaps. Use the monthly checkbook to see cash-flow trends over time.</li>
          <li>If your dollar delta is large and <em>negative</em> in a month where prices were flat or up, that is worth investigating — it suggests coins left your portfolio without a matching transaction record.</li>
        </ul>

        <p>
          The monthly checkbook also separately tracks <strong>unmatched transfer halves</strong> — transactions classified as transfers that have no matching counterpart in your data. Those are flagged with a warning and broken out by asset so you can trace exactly which transaction disappeared.
        </p>`,
  },
  {
    id: "faq-api-public",
    q: "Can I call Almstins safety checks from my own script or agent?",
    a: `<p>
          Yes. Three endpoints are open to the public with no login required:
        </p>
        <ul>
          <li><strong>GET /api/wallet-check?address=</strong> — checks a crypto address for blacklist hits, sanctions, dark-web links, honeypot tokens, wallet age, and more. Also accepts a POST with a JSON body.</li>
          <li><strong>GET /api/dapp-check?url=</strong> — checks a URL or dApp domain against MetaMask, ScamSniffer, GoPlus, URLScan, and other phishing databases.</li>
          <li><strong>GET /api/verify/lookup?address=</strong> — returns whether an address has a verified publisher on Almstins Verify, and which domain published it.</li>
        </ul>
        <p>
          All three return JSON and include CORS headers, so they can be called from a browser, a script, or an AI agent. Unauthenticated callers are limited to 10 requests per minute per IP. To raise that to 60 per minute, generate an API key from the <strong>API Keys</strong> section at the bottom of the <a href="/dashboard/verify">Verify dashboard</a> and pass it as an <code>X-Api-Key</code> header.
        </p>
        <p>
          Full request/response documentation, field definitions, and error codes are at <a href="/api-docs">almstins.com/api-docs</a>.
        </p>`,
  },
  {
    id: "faq-verify-self-send",
    q: "How do I prove I own an address on Almstins Verify?",
    a: `<p>
          The self-send method works without a website or wallet connection. On the Verify dashboard, register your address, then send any outgoing transaction from it — even a tiny amount to yourself. Almstins watches the public chain and marks the address Verified once it sees activity after the challenge was issued.
        </p>
        <p>
          Nothing is connected to Almstins and nothing is signed for us. The only proof that counts is sending <em>from</em> the address, which only the person holding the private key can do. Once proven, each address gets a downloadable QR badge you can print, add to an invoice, or put on a checkout page so customers can confirm the address is yours before they pay.
        </p>
        <p>
          An address can be claimed by one account only. If you try to claim an address that is already proven by another account, the check fails. The public scanner at <a href="/verify/scan">almstins.com/verify/scan</a> shows whether an address is verified and by whom before any funds move.
        </p>
        <p>
          Self-send proof is available for Ethereum, Polygon, Avalanche, Bitcoin, Litecoin, and Solana addresses.
        </p>`,
  },
  {
    id: "faq-verify-domain",
    q: "I have a website. Can I prove my addresses using my domain instead of sending a transaction?",
    a: `<p>
          Yes. On the Verify dashboard, open the Prove panel for any address destination and switch to the Domain tab. Enter your domain, and Almstins generates a small JSON file with a unique challenge token. Upload it to your web server at <code>/.well-known/almstins-verify.json</code>, then click Verify. Almstins fetches the file, checks the challenge matches, and attaches your domain as the verified publisher of that address.
        </p>
        <p>
          If you prefer DNS over a file, you can instead add a TXT record to your domain. The dashboard shows both options side by side — use whichever your hosting setup makes easier.
        </p>
        <p>
          A domain-proven address shows "verified by yourdomain.com" on the public scanner instead of just "verified." This is the stronger signal for businesses — it ties the address to a domain you demonstrably control.
        </p>`,
  },
  {
    id: "faq-verify-exchange",
    q: "I run an exchange or payment service. Can I publish all our deposit addresses as verified?",
    a: `<p>
          Yes, through the Verified Entity path on the Verify dashboard. It works in two steps:
        </p>
        <ol>
          <li><strong>Prove your domain.</strong> Upload the Almstins challenge file to <code>/.well-known/almstins-verify.json</code> on your domain (or add the DNS TXT record). Almstins fetches it and confirms you control the domain.</li>
          <li><strong>Connect a live address endpoint.</strong> Once your domain is proven, paste in an HTTPS endpoint on that same domain and a read-only API key. Almstins calls the endpoint on a regular schedule, reads back your current list of addresses, and mirrors them as "verified by yourdomain.com" on the public scanner.</li>
        </ol>
        <p>
          Your endpoint just needs to return a JSON array of address objects — Almstins handles the polling and mirroring. The endpoint must live on the same domain (or a subdomain) that you proved, so the trust root is your domain, not a claim taken on trust.
        </p>
        <p>
          Exchanges cannot use the self-send method because deposit addresses are platform-controlled — the exchange itself holds the private keys, not the user. The domain-plus-endpoint path exists specifically for this case: an institution vouching for its own addresses by publishing them from infrastructure it demonstrably controls.
        </p>
        <p>
          The API key is stored encrypted and is only used to pull the address list. Almstins never stores or transmits value on your behalf. This is a read-only integration, consistent with the no-custody architecture.
        </p>`,
  },
  {
    id: "faq-tron-safety",
    q: "Does the wallet checker work for TRON addresses?",
    a: `<p>
          Yes. TRON addresses (starting with <strong>T</strong>, 34 characters) get full safety checks:
        </p>
        <ul>
          <li><strong>GoPlus blacklist</strong> — cross-referenced against GoPlus Security's global database using the TRON chain, which covers reported scam, phishing, and drainer addresses on TRON.</li>
          <li><strong>Chainabuse community reports</strong> — any community-submitted fraud reports linked to the address.</li>
          <li><strong>Wallet age</strong> — addresses created in the last 30 days are flagged; very new wallets are a common signal in social engineering scams.</li>
          <li><strong>TRC-20 token holdings</strong> — the Holdings tab shows the address's TRX balance and its top TRC-20 tokens (USDT, USDC, and others).</li>
        </ul>
        <p>
          TRON is one of the most common chains for crypto fraud and scam operations, particularly USDT (TRC-20). If someone gives you a TRON address and asks you to send USDT, run it through the checker first.
        </p>
        <p>
          <strong>One important warning the checker always shows:</strong> a TRON address can only receive TRON-native assets (TRX, USDT-TRC20, etc.). Sending ETH, BTC, SOL, or any EVM token to a TRON address means those funds are permanently lost. The checker displays this warning on every TRON result.
        </p>`,
  },
  {
    id: "faq-chain-recognition",
    q: "The checker recognised my XRP / Dogecoin / Cardano / Cosmos address but says no safety data — why?",
    a: `<p>
          The wallet checker can detect addresses from several chains beyond Ethereum, Bitcoin, Solana, Litecoin, Sui, and TRON. When you paste an XRP, Dogecoin, Cardano, or Cosmos address, it identifies which chain it belongs to and shows the correct chain badge — so you at least know you pasted the right kind of address.
        </p>
        <p>
          Full safety database checks (blacklists, scam reports, wallet age, token holdings) are not yet available for those four chains. Expanding safety coverage to them is on the roadmap.
        </p>
        <p>
          The most important thing the label prevents: pasting a Dogecoin address and having the checker report "invalid address" — which could leave you thinking you typed something wrong when the address is perfectly valid. Knowing which chain an address belongs to also helps avoid the cross-chain sending mistake described below.
        </p>`,
  },
  {
    id: "faq-wallet-error",
    q: "A wallet tin is showing an error and a ref code — what does that mean?",
    a: `<p>
          The app couldn't retrieve balance data for this wallet — usually a temporary network or service issue. We can't confirm your current balance until the connection is restored. Use Try again, or check a block explorer directly for real-time confirmation.
        </p>

        <p>
          <strong>What the ref code is:</strong><br />
          The short code you see (for example <code style="font-size: 0.85em; background: rgba(255,255,255,0.08); padding: 0.1rem 0.4rem; border-radius: 4px;">FA5B-1K2M9</code>) is a unique incident ID generated the moment the error occurred. It encodes which wallet failed and when, so that if you contact support, we can find the exact failure in the logs without needing to ask you a dozen questions.
        </p>

        <p>
          <strong>What to do first — try again:</strong><br />
          Click the <strong>Try again</strong> button directly in the tin. Most errors are transient (the upstream API was briefly unreachable) and resolve on the next attempt. If the balance loads successfully, you're done.
        </p>

        <p>
          <strong>If the error keeps coming back:</strong><br />
          An alert has already been sent automatically — you don't need to report it manually. If you want to follow up, email <a href="mailto:hello@almstins.com">hello@almstins.com</a> and include the ref code. That code is the fastest way to trace exactly what failed.
        </p>

        <p style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Note:</strong> The ref code is click-to-select — tap or click it once to highlight the whole code, then copy it before reaching out.
        </p>`,
  },
  {
    id: "faq-ai-chat",
    q: "What is the Portfolio Assistant and what can I ask it?",
    a: `<p>
          The Portfolio Assistant is a floating chat button (labeled <strong>✦ Ask AI</strong>) on the Research and Bookkeeping pages. It lets you ask plain-English questions about your own portfolio data — your holdings, recent transactions, cost basis, and more — without having to dig through the ledger manually.
        </p>

        <p><strong>Example questions:</strong></p>
        <ul>
          <li>"What is my largest holding by value?"</li>
          <li>"How much ETH have I received this year?"</li>
          <li>"Which transactions are still unclassified?"</li>
          <li>"What did I pay on average for SOL?"</li>
        </ul>

        <p>
          <strong>What it can't do:</strong> The assistant does not give financial or tax advice, cannot make changes to your data, and has no access to any other user's account. It answers questions about what the data shows — judgment calls are yours.
        </p>

        <p><strong>Monthly question limits by plan:</strong></p>
        <ul>
          <li><strong>Free</strong> — 5 questions per month</li>
          <li><strong>Starter</strong> — 30 questions per month</li>
          <li><strong>Pro</strong> — 150 questions per month</li>
          <li><strong>Unlimited</strong> — no limit</li>
        </ul>

        <p>
          Limits reset automatically on the first of each month. The badge on the Ask AI button shows how many questions you have left this month. If you reach the limit, the input is replaced with an upgrade link.
        </p>

        <p>
          <strong>Privacy:</strong> Each question sends a snapshot of your transaction history and current holdings to Anthropic (Claude Haiku) to generate the answer. The snapshot is scoped to your account only — no other user's data is ever included. Anthropic does not retain API inputs beyond the immediate request. Questions are not stored or reviewed by Almstins.
        </p>`,
  },
];
