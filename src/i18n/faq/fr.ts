// FAQ — French items. First-pass translation; review by a fluent speaker before authoritative.
import type { FaqItem } from '../faq';

export const items: FaqItem[] = [
  {
    id: "faq-project",
    q: "En savoir plus sur le projet",
    a: `<p>
          Almstins existe parce que les portefeuilles crypto sont véritablement difficiles à comprendre. Les pièces se déplacent entre les wallets et les exchanges, sont échangées, mises en staking, offertes ou perdues — et la plupart des gens n'ont pas un seul endroit qui présente le tableau complet clairement.
        </p>

        <p>
          L'objectif est simple : ouvrir votre portefeuille et savoir exactement ce que vous possédez, d'où cela vient, combien de temps vous le détenez, et ce que cela vaut. Ces informations sont affichées sur trois pages :
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Vault</strong> — valeurs de marché en temps réel pour tous vos wallets et comptes d'exchange connectés. Chaque pièce affiche son ticker, sa quantité, sa valeur actuelle en dollars, son profit/perte et le nombre de jours depuis son entrée dans votre écosystème. Le Vault affiche également les positions DeFi Aave (santé du prêt, répartition du collatéral).</li>
          <li><strong>Bookkeeping</strong> — votre historique complet des transactions en un seul endroit, avec les gains réalisés, le cost basis et le suivi des lots FIFO. C'est la page qui compte à la période fiscale.</li>
          <li><strong>Research</strong> — un outil d'investigation dédié pour trouver d'où viennent les pièces, où elles sont allées, et résoudre toute lacune dans votre historique. Le moteur de rapprochement des transferts lie automatiquement les retraits aux dépôts entre les sources, et tout ce qu'il ne peut pas résoudre automatiquement apparaît dans le panneau Needs Attention pour que vous puissiez l'examiner.</li>
        </ul>

        <p>
          Vous pouvez supprimer n'importe quel tin dont vous n'avez plus besoin à tout moment. Vos données de transactions brutes ne sont jamais modifiées — tout est stocké tel qu'importé.
        </p>`,
  },
  {
    id: "faq-exchanges",
    q: "Qu'en est-il des exchanges",
    a: `<p>
          Vous pouvez ajouter des exchanges. Les wallets en self-custody récupèrent les données depuis des APIs,
          les exchanges utilisent des fichiers CSV. Vous pouvez simplement téléverser le fichier dans
          le projet. Il n'existe pas de format standard dans l'industrie pour les fichiers CSV, donc un
          fichier peut avoir un tableau à cinq colonnes commençant par les frais de gas, tandis qu'un
          autre peut avoir dix colonnes commençant par un identifiant utilisateur unique que
          personne ne comprend à part les personnes qui travaillent avec des bases de données. Ainsi, chaque
          exchange possède un import unique. Ces tins afficheront les tokens de
          votre compte et enverront vos transactions à la page de bookkeeping pour
          leur stockage.
        </p>`,
  },
  {
    id: "faq-transactions",
    q: "Qu'en est-il des transactions",
    a: `<p>
          Chaque pièce a une histoire de vie. Elle a été achetée, échangée, mise en staking, offerte ou envoyée depuis quelque part — et finalement elle a été vendue, déplacée ou se trouve encore dans un wallet. Almstins suit tout ce parcours.
        </p>

        <p>
          Les transactions sont importées depuis vos exchanges via des téléversements CSV et depuis les wallets en self-custody via l'API blockchain. Une fois importées, chaque transaction est stockée exactement telle que reçue et n'est jamais modifiée. Les notes et étiquettes de cession que vous ajoutez sont stockées séparément, à côté des données brutes.
        </p>

        <p>
          La page Bookkeeping regroupe les transactions par pièce et calcule le cost basis en utilisant FIFO (first-in, first-out). Lorsque vous vendez ou échangez une pièce, le lot le plus ancien est consommé en premier. L'ancienneté de chaque lot détermine si une cession constitue une plus-value à court ou à long terme — une distinction qui peut faire une différence significative sur votre facture fiscale.
        </p>

        <p>
          La page Research gère la question plus difficile : qu'en est-il des transactions qui n'ont pas de contrepartie évidente ? Lorsque vous retirez de Coinbase et déposez sur Kraken, chaque plateforme n'enregistre que sa moitié. Le moteur de rapprochement des transferts trouve automatiquement ces paires dans toutes vos sources. Tout ce qu'il ne peut pas rapprocher avec confiance apparaît dans le panneau Needs Attention, où vous pouvez l'examiner, le confirmer ou l'annoter vous-même.
        </p>`,
  },
  {
    id: "faq-bookkeeping",
    q: "Page Bookkeeping",
    a: `<p>
          La page Bookkeeping est l'endroit où tout se rassemble. Chaque transaction importée depuis chaque exchange et wallet apparaît dans un historique unifié — trié, consultable et organisé par actif.
        </p>

        <p>
          Pour chaque pièce que vous détenez, la page affiche votre historique complet de lots : quand vous l'avez acquis, ce que vous avez payé (cost basis), et si une partie a été cédée. Les gains et pertes réalisés sont calculés automatiquement en utilisant le rapprochement FIFO (first-in, first-out) — la même méthode attendue par l'IRS. La répartition entre court terme et long terme est gérée automatiquement en fonction du temps de détention réel.
        </p>

        <p>
          Vous pouvez télécharger votre liste complète de transactions en CSV à tout moment. Vous pouvez également ajouter des notes à des transactions individuelles — utile pour annoter des dons, des cadeaux, des pièces perdues, ou tout ce dont votre comptable aura besoin de contexte.
        </p>

        <p>
          En bas de la page, la <strong>vue Reconciliation</strong> compare les soldes calculés par le pipeline avec ce que vos wallets et exchanges en direct affichent réellement — afin que vous puissiez repérer les données manquantes avant qu'elles ne deviennent un problème à la période fiscale.
        </p>`,
  },
  {
    id: "faq-privacy",
    q: "Est-ce privé",
    a: `<p>
          Réponse courte : non. Tout ce qui est récupéré depuis les clés API est visible par
          le public. Mais le site web est privé, votre connexion est privée
          et vos données sont sécurisées. La base de données chiffre tout. Je vais
          éventuellement suivre les IDs uniques, le nombre de wallets, les fonctionnalités que les gens
          utilisent, et le volume de trafic. Mon but est de mesurer mon
          efficacité et de créer un meilleur produit.
        </p>`,
  },
  {
    id: "faq-safety-checker",
    q: "Qu’est-ce que le vérificateur de sécurité de portefeuilles et de sites web ?",
    a: `<p>
          Un outil public et gratuit — sans compte, sans connexion de portefeuille
          — pour vérifier une adresse ou un site web <em>avant</em> d’envoyer des
          fonds ou de vous connecter. Collez une adresse de portefeuille et il
          exécute des vérifications de sécurité (liste de blocage GoPlus, sanctions
          OFAC, activité de mélangeurs / Tornado Cash, détection de honeypot, âge
          du portefeuille, multi-signature). Collez une URL et il la vérifie auprès
          de 7 bases de données indépendantes de phishing et de logiciels
          malveillants — MetaMask, ScamSniffer, GoPlus, URLScan.io, OpenPhish,
          Google Safe Browsing et VirusTotal — et renvoie rouge, jaune ou vert.
          Almstins ne porte jamais son propre jugement ; il fait remonter ce que la
          communauté de la sécurité a déjà signalé.
        </p>
        <p>
          Rien de ce que vous vérifiez n’est stocké sous une forme lisible. Les
          vérifications répétées proviennent d’un cache de courte durée indexé par
          une empreinte unidirectionnelle et irréversible de ce que vous avez
          saisi, et le compteur d’utilisation n’enregistre que cette même empreinte
          — il n’existe donc aucun moyen de remonter vers ce que vous avez
          consulté. Cela garde l’outil conforme à la règle selon laquelle Almstins
          ne relie jamais une adresse à une personne.
        </p>`,
  },
  {
    id: "faq-support",
    q: "Que prend en charge le projet actuellement ?",
    a: `<p><strong>Wallets en self-custody (données blockchain en direct)</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Chaînes EVM : Ethereum, Polygon, Avalanche, Arbitrum et autres</li>
          <li>Sui (SUI) — soldes de wallet natifs et synchronisation des transactions</li>
          <li>Solana (SOL) — soldes de wallet natifs</li>
          <li>Bitcoin (BTC) et Litecoin (LTC) — suivi d'adresses</li>
          <li>Soldes de pièces, ancienneté des avoirs, ticker, quantité, valeur actuelle, profit/perte</li>
          <li>Positions DeFi Aave — santé du prêt, répartition du collatéral, suivi de la dette</li>
        </ul>

        <p><strong>Imports CSV d'exchanges</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Coinbase</li>
          <li>Crypto.com</li>
          <li>Gemini (lignes Buy, Debit et Credit incluant staking, airdrops et récompenses d'apprentissage)</li>
          <li>Kraken (export Ledgers)</li>
          <li>Exodus</li>
          <li>Cash App</li>
          <li>Robinhood</li>
          <li>Venmo</li>
        </ul>

        <p><strong>Bookkeeping</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Historique complet des transactions de toutes les sources en une seule vue</li>
          <li>Calcul du cost basis FIFO et des gains réalisés</li>
          <li>Classification des gains à court terme vs. long terme selon le temps de détention</li>
          <li>Vue Reconciliation — compare les soldes calculés avec les données de wallet en direct</li>
          <li>Liste de transactions téléchargeable</li>
        </ul>

        <p><strong>Page Research</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Moteur de rapprochement des transferts — lie automatiquement les retraits aux dépôts entre les sources en utilisant le hash de transaction, l'adresse, le montant et les signaux temporels</li>
          <li>Panneau Needs Attention — présente les transactions non résolues et les rapprochements suggérés</li>
          <li>Recherche en texte intégral dans toutes les transactions par hash, symbole, plage de dates ou mot-clé</li>
          <li>Puces de symboles pour un audit par actif en un clic</li>
          <li>Annotations de cession — étiquetez n'importe quelle transaction comme vente, échange, cadeau, don ou perte directement depuis la page Research</li>
          <li>Étiquettes d'adresses — adresses de wallet connues étiquetées automatiquement ; étiquettes personnalisées stockables par hash de transaction ou ID</li>
          <li>Tin des résolues — rapprochements confirmés archivés en bas du panneau</li>
        </ul>`,
  },
  {
    id: "faq-defi",
    q: "Quelles positions DeFi Almstins prend-il en charge ?",
    a: `<p>Almstins lit vos positions de prêt et de dette DeFi en direct par adresse (lecture seule, sans connexion de wallet) et les intègre à votre valeur nette, votre portefeuille et votre coût de base. Actuellement pris en charge :</p>
        <p><strong>Aave V3 — prêt et emprunt</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Collatéral déposé et positions de dette variable (borrow)</li>
          <li>Facteur de santé du prêt, risque de liquidation et taux supply/borrow en direct</li>
          <li><strong>Ethereum</strong> — les quatre marchés : Core, Lido, EtherFi et Horizon (une position dans l'un d'eux s'affiche, par exemple wstETH déposé sur le marché Lido)</li>
          <li><strong>Polygon</strong></li>
          <li><strong>Avalanche</strong></li>
        </ul>
        <p><strong>Sovryn — DeFi Bitcoin</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Positions du protocole Sovryn sur le réseau Rootstock (RSK)</li>
        </ul>
        <p>Chaque position Aave renvoie directement à son marché sur l'app Aave, pour l'atteindre en un clic. Les positions sont en lecture seule et suivies uniquement par adresse : Almstins ne connecte jamais votre wallet et ne demande jamais d'autorisation de signature. Si une position DeFi ne s'affiche pas, elle se trouve très probablement sur un protocole ou un réseau pas encore listé ici.</p>`,
  },
  {
    id: "faq-defi-untracked",
    q: "Comment suivre des cryptos prêtées ou stakées sur un protocole qu'Almstins ne prend pas encore en charge ?",
    a: `<p>Almstins lit directement un ensemble croissant de protocoles DeFi (Aave, Sovryn). Si votre position est sur un protocole que nous ne couvrons pas encore (de nombreux marchés de prêt Solana, par exemple), les pièces se trouvent généralement <em>à l'intérieur</em> du protocole plutôt que dans votre wallet, elles n'apparaîtront donc pas dans le snapshot de votre wallet. Vous pouvez tout de même les garder correctes dans vos livres :</p>
        <ol style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li><strong>Ne ressaisissez pas l'achat.</strong> Si vous avez acheté les pièces sur un exchange, cet achat est déjà importé depuis votre CSV ; le rajouter le compterait deux fois.</li>
          <li><strong>Marquez le transfert comme votre propre wallet.</strong> Sur la page Research, trouvez le retrait qui a déplacé les pièces de l'exchange vers le protocole et marquez-le <em>Mon propre wallet</em>. Cela indique à Almstins qu'il s'agissait d'un mouvement entre vos propres comptes, pas d'une vente, de sorte que les pièces restent une position détenue à votre coût de base réel au lieu d'être comptées comme une cession.</li>
          <li><strong>Ajoutez une note pour la retrouver plus tard.</strong> Sur cette transaction, ajoutez une note avec le lien de l'app du protocole et l'adresse de votre wallet, pour savoir où se trouvent réellement les pièces.</li>
          <li><strong>Étiquetez l'adresse de destination comme wallet à vous.</strong> Sur la page Research, étiquetez le wallet vers lequel vous avez déplacé les pièces comme l'un des vôtres. Les transferts futurs vers celui-ci se classeront alors automatiquement via Auto-classify.</li>
        </ol>
        <p>Deux choses à prévoir. Le panneau de réconciliation affichera un petit écart pour cette pièce : vos livres disent que vous la détenez, mais le snapshot du wallet ne peut pas la voir à l'intérieur du protocole. C'est normal et cela n'affecte pas votre coût de base. Et la position reste une plus-value ou moins-value <em>latente</em> jusqu'à ce que vous retiriez et vendiez réellement ; à ce moment-là, enregistrez la vente comme une cession pour la réaliser.</p>
        <p><strong>Pour que le changement apparaisse :</strong> après avoir reclassé une transaction, votre coût de base se met à jour lors de la prochaine reconstruction du cycle de vie, qui s'exécute automatiquement à l'ouverture de la page <strong>Bookkeeping</strong> ou <strong>Portfolio</strong>, ou en utilisant <strong>Fill Missing Prices</strong> sur la page Research. Notez que <em>Re-run matching</em>, <em>Auto-classify</em> et le <em>Sync Tins</em> du Vault <em>ne</em> déclenchent <em>pas</em> la reconstruction ; ouvrez donc Bookkeeping (ou lancez Fill Missing Prices) pour voir la reclassification appliquée.</p>`,
  },
  {
    id: "faq-now",
    q: "Sur quoi travaillez-vous en ce moment ?",
    a: `<p>Le tracker de portefeuille principal, le moteur de bookkeeping et la page Research sont en ligne. Voici ce qui est activement développé ou planifié ensuite :</p>

        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Plus d'importateurs d'exchanges.</strong> Les huit exchanges actuellement pris en charge couvrent la majorité des utilisateurs américains, mais il y en a d'autres à ajouter. Bybit, OKX et Kraken Pro sont sur la liste. Si votre exchange n'est pas pris en charge, utilisez l'option Flag for Support et il sera priorisé.
          </li>
          <li>
            <strong>Remplissage des prix historiques pour les transactions plus anciennes.</strong> L'API gratuite de CoinGecko ne remonte que 365 jours en arrière. Une clé API payante débloque l'historique complet pour les transactions de 2021 et antérieures. Cela sera ajouté comme une mise à niveau optionnelle pour les utilisateurs avec des données historiques profondes.
          </li>
          <li>
            <strong>Page Research — annotation en lot.</strong> Actuellement vous annotez une transaction à la fois. Le plan est de permettre la sélection de plusieurs transactions et d'appliquer un type de cession ou une note à toutes en une seule étape.
          </li>
          <li>
            <strong>Récapitulatif annuel des gains/pertes.</strong> Le moteur de comptabilité classe chaque transaction en utilisant le rapprochement de lots FIFO et organise vos gains réalisés à court et long terme dans un récapitulatif annuel clair à remettre à votre comptable. Une couverture élargie et des équivalents internationaux arrivent. Almstins organise vos registres — ce n'est pas un logiciel de déclaration fiscale.
          </li>
          <li>
            <strong>Prise en charge de chaînes supplémentaires.</strong> Les wallets Solana et Sui sont maintenant en ligne. Cardano est le suivant sur la liste. La synchronisation de l'historique des transactions Solana (au-delà du solde) est en cours.
          </li>
          <li>
            <strong>Page Events.</strong> Une vue calendrier des événements importants du portefeuille — grands dépôts, cessions, jalons de récompenses de staking. Actuellement désactivée dans la navigation ; bientôt disponible.
          </li>
        </ol>`,
  },
  {
    id: "faq-tax",
    q: "Ce logiciel sert-il à déposer des déclarations ?",
    a: `<p>
          Almstins n'est pas un service de préparation fiscale et ne dépose pas de déclarations en votre nom. Ce qu'il fait, c'est organiser les données sous-jacentes dont votre comptable ou votre logiciel fiscal a besoin — et pour la crypto, ces données sont véritablement difficiles à assembler seul.
        </p>

        <p>
          Le moteur de comptabilité classe chaque transaction dans tous vos exchanges et wallets connectés, exécute le rapprochement de lots FIFO pour calculer le cost basis, et signale tout ce qui nécessite votre attention (prix manquants, transferts non rapprochés, actifs empruntés). Il produit un <strong>récapitulatif annuel clair</strong> de vos gains réalisés à court et long terme, revenus et positions ouvertes, que vous pouvez remettre directement à votre comptable ou à son logiciel fiscal.
        </p>

        <p>
          Plus vos données importées sont complètes, plus la sortie est précise. Chaque CSV que vous téléversez et chaque wallet que vous connectez améliore le tableau. Le pipeline devient plus intelligent au fil du temps à mesure que vous résolvez les éléments signalés.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>⚠️ Il ne s'agit pas d'un conseil fiscal.</strong> Vérifiez toujours le résultat avec un professionnel fiscal qualifié avant de déposer. Le traitement fiscal de la crypto varie selon la juridiction et les circonstances individuelles.
        </p>`,
  },
  {
    id: "faq-wallet-vs-bookkeeping",
    q: "Pourquoi \"Still in Wallet\" est-il différent de mon solde dans le Vault ?",
    a: `<p>
          Ces deux chiffres mesurent les mêmes actifs de manières complètement différentes — et les deux sont corrects. Voici la différence :
        </p>

        <p>
          <strong>Vault — Valeur de marché</strong><br />
          Le Vault récupère les données en direct directement depuis la blockchain en ce moment. La valeur en dollars affichée correspond à ce que valent vos pièces <em>aujourd'hui</em> aux prix actuels du marché. Si vous avez acheté Bitcoin en 2018 pour $6 000 et qu'il vaut maintenant $90 000, le Vault affiche $90 000.
        </p>

        <p>
          <strong>Bookkeeping — Cost Basis</strong><br />
          "Still in Wallet" sur la page Bookkeeping affiche ce que vous avez <em>payé à l'origine</em> pour les pièces que vous n'avez pas encore vendues — votre cost basis. En utilisant le même exemple, il afficherait $6 000 pour ce Bitcoin. Ce chiffre est important pour les impôts : lorsque vous vendez enfin, votre gain imposable est la différence entre ce pour quoi vous le vendez et ce que vous avez payé (le cost basis).
        </p>

        <p>
          <strong>En bref :</strong> Vault = valeur de marché actuelle de votre portefeuille. Bookkeeping = ce que vous avez payé pour le construire. L'écart entre les deux est votre profit (ou perte) non réalisé(e).
        </p>`,
  },
  {
    id: "faq-erc20-zero",
    q: "Une transaction affiche $0 sur le block explorer — mais mon tracker affiche $1 000 ?",
    a: `<p>
          Vous ne devenez pas fou, et le tracker non plus. C'est l'un des points de confusion les plus
          courants dans le bookkeeping crypto, et cela vient de la façon dont
          les block explorers affichent les transferts de tokens.
        </p>

        <p>
          <strong>Pourquoi Polyscan (ou Etherscan) affiche-t-il $0 ?</strong><br />
          Chaque transaction sur une blockchain possède un champ "Value" — mais ce champ ne suit que
          la <em>pièce native</em> (MATIC, ETH, etc.). Lorsque vous envoyez un token comme
          USDC ou USDT, la valeur de la pièce native est littéralement zéro car vous ne déplacez pas
          MATIC ou ETH. Le transfert réel du token est enregistré séparément dans les logs
          de la transaction. Pour le voir, cliquez sur l'onglet <strong>"ERC-20 Token Txns"</strong> sur la
          page de la transaction — c'est là que vos 1 000 USDC apparaîtront.
        </p>

        <p>
          <strong>Donc le tracker a raison ?</strong><br />
          Oui. Le tracker lit directement les logs de transfert de tokens, il enregistre donc correctement
          la quantité de USDC et sa valeur en dollars au moment du transfert. Les $1 000 que
          vous voyez sont réels — le block explorer vous montre simplement le mauvais champ.
        </p>

        <p>
          <strong>Comment le retirer de "Needs Attention" ?</strong><br />
          Cliquez sur <strong>Details →</strong> sur l'élément. Vous verrez un
          bouton rapide <strong>💵 Stablecoin · $1.00</strong> — appuyez dessus et cliquez sur Save.
          Puisque vous avez payé $1,00 par USDC et reçu $1,00 par USDC, le gain
          est effectivement $0. L'élément disparaît de la liste et rien ne change dans
          votre Year Summary.
        </p>

        <p>
          <strong>Que faire si le wallet de destination est signalé comme arnaque ?</strong><br />
          C'est un problème distinct — cela signifie que votre USDC a peut-être été envoyé à un escroc
          (une astuce courante appelée "address poisoning"). Le transfert a quand même eu lieu et
          le tracker est toujours correct. Malheureusement, les tokens ont probablement disparu. À des
          fins fiscales, fixez le cost basis à $1,00 comme ci-dessus — la perte des fonds
          peut être déductible comme perte par vol selon votre juridiction, alors notez-le
          et parlez-en à votre comptable.
        </p>`,
  },
  {
    id: "faq-borrowed-money",
    q: "J'ai emprunté de l'argent via Aave — comment cela fonctionne-t-il dans le bookkeeping ?",
    a: `<p>
          Excellente question, et elle déroute les gens tout le temps. La réponse courte :
          <strong>l'argent emprunté n'est pas un revenu</strong>, et le tracker le sait déjà.
        </p>

        <p>
          <strong>Lorsque vous empruntez à Aave :</strong><br />
          Vous déposez du collatéral (disons, ETH) et le protocole vous prête USDC contre celui-ci.
          Ce USDC arrive dans votre wallet comme un transfert entrant — mais c'est un
          <em>prêt</em>, pas un achat ou un cadeau. Le tracker classe cela comme une
          <strong>augmentation de passif</strong> et l'ignore entièrement lors de la construction de votre
          cost basis. Il n'apparaîtra jamais comme un lot d'achat dans "Still in Wallet" car
          vous ne l'avez pas acheté — vous devez le rembourser.
        </p>

        <p>
          <strong>Où apparaît-il ?</strong><br />
          Sur la page Bookkeeping, faites défiler vers le bas jusqu'à la section <strong>🔷 DeFi Positions</strong>.
          Votre collatéral (le ETH ou USDC que vous avez déposé) apparaît en couleur teal marqué
          <em>AAVE</em>. Votre prêt en cours apparaît en rouge marqué <em>DEBT</em>. Ceux-ci
          sont séparés de vos avoirs réguliers de wallet intentionnellement — ils suivent
          des règles comptables différentes.
        </p>

        <p>
          <strong>Lorsque vous remboursez le prêt :</strong><br />
          Le USDC que vous renvoyez à Aave est également géré automatiquement — il est classé
          comme un <strong>remboursement de passif</strong>. Le tracker consomme le lot de coût de
          ce USDC (vous restituez quelque chose que vous avez emprunté) mais n'enregistre aucun gain
          ou perte imposable, car rembourser un prêt n'est pas une vente.
        </p>

        <p>
          <strong>Qu'en est-il des intérêts que je paie ?</strong><br />
          Aave facture des intérêts en augmentant lentement le montant que vous devez — le solde de votre token de dette
          augmente au fil du temps. Le tracker suit cela, et les intérêts cumulés apparaissent
          dans votre tin DeFi Positions. Que les intérêts Aave soient déductibles fiscalement dépend de
          la façon dont vous avez utilisé le prêt (investissement vs. usage personnel) et de votre droit fiscal local — parlez-en
          à votre comptable.
        </p>

        <p>
          <strong>Que se passe-t-il si je suis liquidé ?</strong><br />
          Si la valeur de votre collatéral chute trop et qu'Aave liquide votre position, une
          partie de votre collatéral est saisie pour rembourser une partie de la dette. Cela est traité
          comme une <em>cession</em> de votre collatéral — ce qui signifie que cela peut être un événement imposable.
          Le tracker fera remonter ces événements sur la page de bookkeeping afin que vous puissiez les comptabiliser.
        </p>`,
  },
  {
    id: "faq-reconciliation",
    q: "Qu'est-ce que la vue Reconciliation ?",
    a: `<p>
          La vue Reconciliation est un outil d'audit intégré situé en bas de votre
          page Bookkeeping. Elle compare deux vues indépendantes de votre portefeuille côte à côte :
        </p>

        <ul>
          <li><strong>Ce que le tin pense que vous avez</strong> — les pièces restant dans vos lots FIFO "Still in Wallet", calculées à partir de chaque transaction que vous avez importée.</li>
          <li><strong>Ce que vos wallets et exchanges affichent réellement</strong> — les soldes en direct récupérés directement depuis vos wallets connectés et les téléversements CSV d'exchanges.</li>
        </ul>

        <p>
          Pour chaque pièce, elle affiche la différence en quantité et en valeur estimée en dollars,
          et signale la gravité par une couleur :
        </p>

        <ul>
          <li>✅ <strong>Balanced</strong> — dans 1%. Vous êtes en ordre.</li>
          <li>⚠️ <strong>Over</strong> — votre solde en direct est supérieur à ce que le tin attend. Cela signifie généralement qu'il y a un flux entrant que le tracker ne connaît pas encore.</li>
          <li>🔴 <strong>Under</strong> — votre solde en direct est inférieur à ce qui est attendu. Cela signifie généralement qu'un CSV n'a pas été téléversé, ou que des pièces ont été déplacées vers un endroit non encore connecté.</li>
          <li>🔴 <strong>Missing</strong> — le tin affiche des pièces que vous devriez avoir, mais le wallet affiche zéro. Cela vaut la peine d'être investigué.</li>
          <li>⬜ <strong>Untracked</strong> — des pièces apparaissant dans votre wallet qui n'ont aucun historique de transaction dans le système.</li>
        </ul>

        <p>
          <strong>Que faire si je ne peux pas expliquer une divergence ?</strong><br />
          Cliquez sur n'importe quelle ligne pour la développer. Vous verrez la dernière date de transaction connue, une répartition
          des wallets et exchanges contribuant au solde en direct, et deux options :
        </p>

        <ul>
          <li><strong>Add a note</strong> — notez ce que vous pensez s'être passé afin de vous en souvenir plus tard.</li>
          <li><strong>Flag for support</strong> — cochez cette case et Donnie sera notifié directement. Il examinera vos données et fera un suivi personnellement.</li>
        </ul>

        <p>
          Les causes les plus fréquentes d'une divergence sont un fichier CSV manquant, un exchange
          qui n'a pas encore été connecté, ou un hardware wallet qui n'est pas suivi. Dans la plupart
          des cas, le téléversement des données manquantes résout le problème immédiatement.
        </p>

        <p>
          <em>Remarque : la colonne estimée Δ USD utilise votre cost basis moyen comme estimation de
          prix, et non le prix de marché actuel. C'est un guide approximatif, pas une évaluation en direct.</em>
        </p>`,
  },
  {
    id: "faq-kraken-export",
    q: "Comment exporter mon historique Kraken ?",
    a: `<p>
          Kraken propose deux exports CSV — assurez-vous de prendre le bon :
        </p>
        <ol style="margin: 0.75rem 0 0.75rem 1.25rem; line-height: 1.8;">
          <li>Connectez-vous à votre compte Kraken</li>
          <li>Allez dans <strong>Account</strong> → <strong>History</strong></li>
          <li>Cliquez sur <strong>Ledgers</strong> (pas Trades)</li>
          <li>Définissez votre plage de dates et cliquez sur <strong>Export</strong></li>
          <li>Téléversez le CSV téléchargé dans votre tin Kraken ici</li>
        </ol>
        <p>
          L'export <em>Ledgers</em> contient chaque dépôt, retrait, échange et récompense de staking
          en un seul fichier. L'export <em>Trades</em> ne couvre que les transactions spot et ne
          s'importera pas correctement.
        </p>`,
  },
  {
    id: "faq-pnl",
    q: "Qu'est-ce que le chiffre P&L à côté de Market Value ?",
    a: `<p>
          Le chiffre affiché en vert ou en rouge à côté de votre Market Value sur le tile Portfolio est votre <strong>profit ou perte non réalisé(e)</strong> — combien vous êtes en hausse ou en baisse sur les pièces que vous détenez actuellement.
        </p>

        <p>
          <strong>Comment il est calculé :</strong><br />
          C'est la différence entre deux chiffres :
        </p>

        <ul>
          <li><strong>Market Value</strong> — ce que valent vos pièces en ce moment aux prix actuels (récupéré en direct depuis la blockchain et les soldes d'exchange).</li>
          <li><strong>Cost Basis</strong> — ce que vous avez payé à l'origine pour les pièces que vous détenez encore, calculé en utilisant le rapprochement FIFO (first in, first out) sur toutes vos transactions importées.</li>
        </ul>

        <p>
          <strong>P&amp;L = Market Value − Cost Basis</strong>
        </p>

        <p>
          S'il est en <span style="color: #86efac; font-weight: 600;">vert</span>, votre portefeuille vaut plus que ce que vous avez payé — vous avez des gains non réalisés. S'il est en <span style="color: #fca5a5; font-weight: 600;">rouge</span>, votre valeur de marché actuelle est inférieure à ce que vous avez payé — vous détenez à perte.
        </p>

        <p>
          <strong>"Non réalisé" signifie que vous n'avez pas encore vendu.</strong> Aucun événement fiscal n'a eu lieu. Le gain ou la perte ne devient réel (et potentiellement imposable) que lorsque vous vendez, échangez ou disposez autrement des pièces.
        </p>

        <p>
          Il s'agit de la même méthodologie de cost basis utilisée sur la page Bookkeeping sous "Still in Wallet". Plus votre historique de transactions est complet (téléversements CSV, wallets connectés), plus ce chiffre sera précis.
        </p>`,
  },
  {
    id: "faq-sync",
    q: "À quelle fréquence dois-je synchroniser mon portefeuille ?",
    a: `<p>
          Cela dépend de la fraîcheur que vous souhaitez pour vos chiffres. Voici un guide pratique :
        </p>

        <ul>
          <li>
            <strong>Après chaque téléversement CSV</strong> — chaque fois que vous importez un nouveau fichier d'exchange, appuyez sur Sync juste après. Cela garantit que le tile Portfolio reflète immédiatement vos derniers soldes calculés.
          </li>
          <li>
            <strong>Avant de prendre des décisions</strong> — si vous êtes sur le point d'échanger, de rééquilibrer, ou souhaitez simplement voir où vous en êtes, synchronisez d'abord pour que les chiffres soient à jour.
          </li>
          <li>
            <strong>Une fois par semaine suffit pour la plupart des gens</strong> — le tile portfolio est conçu pour vous donner une image générale, pas un suivi tick par tick. Une fois par semaine maintient les choses raisonnablement à jour sans effort supplémentaire.
          </li>
        </ul>

        <p>
          <strong>Ce que le bouton Sync fait réellement :</strong><br />
          Il exécute trois choses en séquence :
        </p>
        <ol style="line-height: 1.9; margin: 0.5rem 0 1rem 1.25rem;">
          <li><strong>Recalcule les soldes d'exchange</strong> — écrit un snapshot frais à partir de toutes vos transactions CSV importées afin que le tile Portfolio affiche des chiffres actuels.</li>
          <li><strong>Actualise les valeurs des wallets on-chain</strong> — récupère les derniers soldes de vos wallets EVM connectés (Ethereum, Polygon, Avalanche, Arbitrum), wallets Sui et wallets Solana.</li>
          <li><strong>Reconstruit le moteur de bookkeeping</strong> — réexécute le calcul du cost basis FIFO sur chaque transaction que vous avez importée, depuis chaque source. C'est ce qui maintient la page Bookkeeping précise après un nouveau téléversement CSV. Si une pièce apparaissait dans "Needs Attention" parce qu'un enregistrement d'achat manquait, synchroniser après avoir téléversé le bon CSV le résoudra.</li>
        </ol>

        <p>
          <strong>Ce qu'il ne fait pas :</strong><br />
          La synchronisation ne récupère pas de nouvelles données depuis votre exchange. Elle recalcule uniquement sur la base de ce que vous avez déjà importé. Si vous avez effectué de nouveaux échanges ou dépôts, téléversez d'abord un CSV frais, puis synchronisez.
        </p>`,
  },
  {
    id: "faq-unauthorized",
    q: "Pourquoi mon import CSV indique-t-il \"Unauthorized\" ?",
    a: `<p>
          Cette erreur signifie que l'application n'a pas pu vérifier votre identité lorsque vous avez essayé de téléverser le fichier. C'est presque jamais un problème avec le CSV lui-même. Voici toutes les causes connues :
        </p>

        <ol style="line-height: 2; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Votre session a expiré.</strong> La cause la plus fréquente. Si vous avez laissé l'onglet ouvert un moment sans activité, votre session de connexion a expiré. Déconnectez-vous, reconnectez-vous et réessayez le téléversement.
          </li>
          <li>
            <strong>Vous êtes connecté au mauvais compte.</strong> Si vous avez plusieurs comptes (un personnel et un professionnel par exemple), assurez-vous d'être connecté au bon avant de téléverser.
          </li>
          <li>
            <strong>Interférence du mode démo.</strong> Si vous naviguiez en mode démo puis vous êtes connecté, la session peut parfois se confondre. Déconnectez-vous complètement, effacez les cookies de votre navigateur pour ce site, et reconnectez-vous à nouveau.
          </li>
          <li>
            <strong>Le navigateur a bloqué le cookie.</strong> Certains navigateurs en mode de confidentialité strict ou avec certaines extensions bloquent les cookies de session. Essayez un navigateur différent ou désactivez la protection contre le suivi pour ce site.
          </li>
          <li>
            <strong>Vous avez ouvert la page de téléversement dans un nouvel onglet.</strong> Les cookies de session peuvent se comporter différemment selon les onglets si vous avez ouvert un nouvel onglet plutôt que de naviguer dans l'application. Revenez à l'application principale et naviguez jusqu'au téléversement depuis là.
          </li>
          <li>
            <strong>Le serveur a redémarré en cours de session.</strong> Occasionnellement, un déploiement ou un redémarrage du serveur invalidera les sessions actives. Déconnectez-vous et reconnectez-vous pour obtenir une session fraîche.
          </li>
        </ol>

        <p>
          <strong>La solution dans presque tous les cas :</strong> déconnectez-vous, reconnectez-vous et réessayez. Si l'erreur persiste après cela, utilisez l'option Flag for Support sur la page Reconciliation et Donnie l'examinera directement.
        </p>`,
  },
  {
    id: "faq-earned-symbols",
    q: "Que signifient les symboles ⚡ 🪂 🎓 ∞ à côté de l'ancienneté de ma pièce ?",
    a: `<p>
          La colonne <strong>Days</strong> sur votre tin d'exchange indique depuis combien de temps vous avez dernièrement acquis une pièce — ce qui compte pour déterminer si une vente future serait imposée comme une plus-value à court ou à long terme.
        </p>

        <p>
          Lorsqu'une pièce a été <em>gagnée ou reçue</em> plutôt qu'achetée directement, un symbole apparaît à côté de l'ancienneté (ou à sa place) pour vous indiquer comment elle est entrée :
        </p>

        <ul style="line-height: 2; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>⚡ Récompense de staking</strong> — la pièce a été gagnée par staking, pas achetée. L'ancienneté affichée est la date de votre dernier vrai achat ; le revenu de staking ne réinitialise pas le compteur.</li>
          <li><strong>🪂 Airdrop</strong> — la pièce a été reçue comme un airdrop. L'ancienneté reflète quand l'airdrop a été reçu.</li>
          <li><strong>🎓 Récompense d'apprentissage</strong> — gagnée via un programme learn-and-earn tel que Coinbase Earn.</li>
          <li><strong>∞ Origine inconnue</strong> — aucun enregistrement d'achat n'a été trouvé. La pièce a probablement été gagnée, offerte ou transférée depuis une source que le tracker n'a pas encore vue.</li>
        </ul>

        <p>
          <strong>Pourquoi le staking ne réinitialise-t-il pas le compteur ?</strong><br />
          Le revenu de staking arrive sous forme de minuscules micro-dépôts de manière régulière. Si chacun réinitialisait votre minuteur de période de détention, une pièce achetée il y a des années pourrait sembler n'avoir que quelques jours parce qu'elle a gagné une fraction de centime du jour au lendemain. Cela la disqualifierait injustement du traitement des plus-values à long terme. Le tracker ignore intentionnellement le revenu de staking lors du calcul de la valeur Days afin de préserver votre date d'achat originale.
        </p>

        <p>
          <strong>Gagner une pièce change-t-il ma situation fiscale ?</strong><br />
          Oui — les pièces reçues par staking, airdrops ou programmes learn-and-earn sont généralement traitées comme un <em>revenu ordinaire</em> au moment de la réception (basé sur leur juste valeur marchande ce jour-là), pas comme un achat. Parlez à votre comptable de la manière de les déclarer correctement.
        </p>`,
  },
  {
    id: "faq-staked-coins",
    q: "Pourquoi mon tin d'exchange affiche-t-il plus de pièces que mon solde disponible ?",
    a: `<p>
          La colonne <strong>Coins</strong> sur votre tin d'exchange affiche vos avoirs <em>totaux</em> — le solde liquide plus toutes les pièces que vous avez bloquées en staking. Votre exchange peut n'afficher que votre solde "disponible", qui exclut les pièces en staking.
        </p>

        <p>
          Par exemple : si vous avez 0,11 ETH disponible et 0,208 ETH en staking, le tracker affiche 0,318 ETH car tout cela vous appartient — il est simplement temporairement bloqué à gagner des récompenses.
        </p>

        <p>
          La ligne <strong>🔒 Staked</strong> directement sous la quantité de pièces affiche la portion bloquée séparément afin que vous puissiez voir exactement combien est liquide par rapport à ce qui est en staking en un coup d'œil.
        </p>

        <p>
          <strong>Pourquoi cela est-il important pour les impôts ?</strong><br />
          Les pièces en staking sont toujours votre propriété — vous ne pouvez simplement pas les dépenser jusqu'à la fin de la période de déblocage. Leur cost basis et leur période de détention se transmettent depuis quand vous les avez achetées à l'origine, donc le tracker les conserve dans votre total plutôt que de les traiter comme disparues.
        </p>`,
  },
  {
    id: "faq-account-identity",
    q: "Comment mon compte est-il lié à mon adresse e-mail ?",
    a: `<p>
          Votre compte Almstins a une seule identité véritable : un ID permanent et unique qui ne change jamais. Votre adresse e-mail est la clé qui le déverrouille. Peu importe comment vous vous connectez — e-mail et mot de passe, Google ou GitHub — tant que la méthode de connexion peut confirmer la même adresse e-mail, vous arrivez dans le même compte à chaque fois.
        </p>

        <p>
          <strong>Comment cela fonctionne étape par étape :</strong>
        </p>

        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>La première connexion crée votre compte.</strong> Au moment où vous vous connectez pour la première fois, le système crée un ID permanent lié à votre adresse e-mail et provisionne un coffre-fort de données privé (votre "tenant") uniquement pour vous.
          </li>
          <li>
            <strong>Couche 1 — correspondance par e-mail.</strong> Chaque connexion ultérieure vérifie si cet e-mail existe déjà. Si vous vous êtes inscrit avec Google et essayez ensuite GitHub, et que les deux fournisseurs confirment le même e-mail, le système vous reconnaît et vous amène directement dans votre coffre-fort existant. Aucun compte en double n'est créé.
          </li>
          <li>
            <strong>Couche 2 — repli sur l'ID du fournisseur.</strong> Dans de rares cas, un fournisseur ne retourne aucun e-mail du tout (par exemple, un utilisateur GitHub avec un e-mail privé avant la configuration correcte des scopes). Dans ce cas, le système se rabat sur la correspondance de l'ID numérique de votre compte fournisseur avec nos enregistrements. Si nous avons déjà vu cet ID GitHub, vous êtes automatiquement réuni avec votre compte. C'est le filet de sécurité — il est sûr car votre ID GitHub numérique est unique et vous seul pouvez vous y connecter.
          </li>
        </ol>

        <p>
          <strong>Ce que cela signifie en pratique :</strong> vous pouvez vous connecter depuis un nouveau navigateur, un nouvel appareil ou un nouveau fournisseur OAuth et vos wallets, transactions et historique fiscal vous attendent tous — car votre adresse e-mail est ce qui lie tout ensemble.
        </p>`,
  },
  {
    id: "faq-research-page",
    q: "Qu'est-ce que la page Research ?",
    a: `<p>
          La page Research est un outil d'investigation dédié pour comprendre l'intégralité de votre historique de transactions sur chaque exchange et wallet que vous avez connecté. Considérez-la comme un centre de commandement — vous pouvez rechercher, identifier et résoudre des questions sur la provenance et la destination de vos pièces.
        </p>

        <p>
          <strong>La page comporte deux panneaux :</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Needs Attention (gauche).</strong> Ce panneau fait remonter automatiquement les transactions non résolues — les transferts sortants sans dépôt correspondant trouvé dans votre historique, et les dépôts entrants dont la source est inconnue. Il affiche également tous les paires de transferts que le moteur de rapprochement a signalées pour votre examen. Rien ici ne nécessite d'agir immédiatement, mais travailler dessus vous donne un tableau plus propre et plus complet de vos avoirs.
          </li>
          <li>
            <strong>Search Results (droite).</strong> Un panneau de recherche flexible vous permet de rechercher des transactions par mot-clé, symbole de pièce, plage de dates ou note. Vous pouvez également cliquer sur n'importe quelle ligne du panneau Needs Attention et le système pré-remplit la recherche pour vous — ainsi, investiguer un dépôt mystérieux n'est qu'à un clic.
          </li>
        </ul>

        <p>
          Les <strong>puces de symboles</strong> s'étendent en haut de la carte de recherche. Cliquer sur une pièce charge instantanément chaque transaction pour ce symbole — un moyen rapide d'auditer un seul actif sur toutes vos sources à la fois.
        </p>

        <p>
          Le bouton <strong>Re-run Matching</strong> en haut vous permet de déclencher manuellement le moteur de rapprochement des transferts à tout moment. C'est utile après l'import de nouveaux fichiers CSV afin que toutes les transactions nouvellement téléversées soient immédiatement vérifiées par rapport à votre historique existant.
        </p>

        <p>
          <strong>Recherche d'adresses.</strong> Collez n'importe quelle adresse blockchain dans le champ de recherche et la page l'identifiera — indiquant si elle appartient à l'un de vos wallets suivis, à un exchange connu, ou à une adresse que vous avez vous-même étiquetée. Si elle n'est pas encore dans votre compte, vous pouvez l'ajouter comme wallet suivi et lui donner une étiquette directement. Vous pouvez également marquer une adresse comme appartenant à un exchange spécifique, de sorte que chaque fois qu'elle apparaît dans des transactions futures, elle soit immédiatement reconnue plutôt qu'affichée comme inconnue.
        </p>

        <p>
          La page Research ne modifie aucune de vos données de transactions brutes — elle ne fait que présenter des informations et vous permet d'étiqueter ou de confirmer les relations entre les enregistrements.
        </p>`,
  },
  {
    id: "faq-transfer-matching",
    q: "Comment fonctionne le rapprochement des transferts ?",
    a: `<p>
          Lorsque vous déplacez des pièces entre deux comptes que vous possédez — par exemple, en retirant de Coinbase et en déposant sur Kraken — chaque plateforme n'enregistre que sa moitié du mouvement. Vos imports CSV afficheront une transaction sortante d'un côté et une transaction entrante de l'autre, sans lien évident entre elles.
        </p>

        <p>
          Le moteur de rapprochement des transferts trouve automatiquement ces paires et les relie, afin que votre portefeuille ne soit pas compté en double et que votre historique raconte une histoire cohérente.
        </p>

        <p>
          <strong>Comment il évalue une correspondance potentielle :</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Hash de transaction (100 pts) —</strong> si le retrait et le dépôt partagent le même hash on-chain, c'est une correspondance certaine. Aucun autre signal n'est nécessaire.</li>
          <li><strong>Adresse connue (50 pts) —</strong> si l'adresse de destination du retrait est déjà enregistrée comme appartenant à l'exchange destinataire, le moteur accorde un crédit fort.</li>
          <li><strong>Correspondance de montant (jusqu'à 40 pts) —</strong> le montant reçu est comparé au montant envoyé moins des frais de réseau raisonnables. Les montants dans 1% l'un de l'autre obtiennent le maximum. Les montants dans 2% obtiennent encore un crédit partiel.</li>
          <li><strong>Timing (jusqu'à 30 pts) —</strong> le dépôt doit arriver après le retrait. Les paires dans l'heure obtiennent le maximum ; les paires dans 72 heures obtiennent un crédit partiel. Un dépôt arrivant avant le retrait est automatiquement disqualifié.</li>
          <li><strong>Bonus de montant exact (10 pts) —</strong> accordé lorsque les montants envoyé et reçu sont identiques à la pièce près, courant dans les transferts sur le même réseau sans frais.</li>
        </ul>

        <p>
          <strong>Ce qui se passe avec le score :</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>90 pts ou plus —</strong> la paire est rapprochée automatiquement et silencieusement. Aucune action requise.</li>
          <li><strong>60–89 pts —</strong> la paire est rapprochée automatiquement mais signalée pour que vous puissiez l'examiner sur la page Research.</li>
          <li><strong>35–59 pts —</strong> la paire apparaît comme une suggestion dans le panneau Needs Attention. Vous pouvez la confirmer ou la rejeter en un clic.</li>
          <li><strong>En dessous de 35 pts —</strong> la paire n'est pas enregistrée. Les deux transactions restent dans le pool non résolu.</li>
        </ul>

        <p>
          <strong>Vos données brutes ne sont jamais modifiées.</strong> Chaque ligne CSV que vous téléversez est stockée exactement telle qu'importée et ne change jamais. Les correspondances sont stockées séparément comme annotations reliant deux IDs de transaction. Si vous rejetez une correspondance ou si le moteur a commis une erreur, vous pouvez la rejeter et les enregistrements originaux sont intacts.
        </p>

        <p>
          <strong>Les étiquettes d'adresses sont construites automatiquement.</strong> Lorsqu'une correspondance de confiance moyenne ou supérieure est établie, le moteur enregistre la connexion entre les deux comptes. Les imports futurs de ces mêmes sources en bénéficient immédiatement — l'adresse est déjà connue, donc les correspondances obtiennent un score plus élevé et se résolvent plus rapidement.
        </p>

        <p>
          Le moteur s'exécute automatiquement chaque fois que vous importez un nouveau CSV, et vous pouvez également le déclencher manuellement depuis la page Research en utilisant le bouton Re-run Matching.
        </p>`,
  },
  {
    id: "faq-cost-basis-history",
    q: "Pourquoi le cost basis ne remonte-t-il qu'à un an ?",
    a: `<p>
          Pour vous montrer ce que valait une transaction en dollars américains le jour où elle s'est produite, Almstins recherche le prix historique de cet actif sur CoinGecko — l'une des sources de données de prix les plus fiables de l'industrie. Cette recherche est ce qui remplit les chiffres en dollars que vous voyez à côté de vos transactions.
        </p>

        <p>
          <strong>Le niveau gratuit a une limite de 365 jours.</strong> L'API publique de CoinGecko ne permet des requêtes de prix historiques que sur un an en arrière. Demander un prix d'il y a deux ans sur le plan gratuit et la requête est rejetée. C'est une restriction délibérée — CoinGecko facture pour un accès plus profond car maintenir des années de données de prix propres et horodatées sur des milliers d'actifs est véritablement coûteux.
        </p>

        <p>
          <strong>Ce que cela signifie en pratique :</strong> si vous avez importé des transactions de 2021 ou 2022, Almstins peut toujours suivre les montants et les mouvements correctement — il peut simplement ne pas être en mesure d'attacher une valeur historique en dollars à ces lignes plus anciennes automatiquement. Tout exchange qui incluait une valeur USD dans son export CSV (Crypto.com et Coinbase le font tous les deux) aura déjà le bon chiffre stocké indépendamment de l'ancienneté.
        </p>

        <p>
          <strong>Comment débloquer l'historique complet :</strong> passer à une clé API CoinGecko Pro supprime entièrement la restriction de 365 jours et permet à Almstins de tarifer chaque transaction jusqu'au début de l'historique de trading de chaque actif. Si vous gérez un grand portefeuille avec une activité significative antérieure à 2024, c'est le chemin recommandé. Contactez votre administrateur de compte ou ajoutez <code>COINGECKO_API_KEY</code> à votre environnement pour l'activer.
        </p>

        <p>
          <strong>Qu'en est-il de la liste Needs Attention ?</strong> Pour les dépôts antérieurs à 2024 qui provenaient d'exchanges qui ont depuis quitté le marché américain — comme Binance.US ou Bittrex — il peut n'y avoir aucune transaction de contrepartie correspondante disponible du tout. Pour ces cas, Almstins vous permet d'étiqueter la transaction manuellement pour expliquer son origine. Une fois étiquetée, elle est automatiquement retirée de la liste Needs Attention. La limite de 2024 est intentionnelle : elle couvre la période où la plupart des départs d'exchanges motivés par la réglementation ont eu lieu, tout en gardant visibles les dépôts récents inexpliqués afin que rien ne passe inaperçu.
        </p>`,
  },
  {
    id: "faq-annotate",
    q: "Comment étiqueter une cession — cadeau, vente ou pièce perdue ?",
    a: `<p>
          Toute transaction sortante n'est pas une vente. La crypto peut quitter votre wallet en tant que cadeau, don caritatif, échange ou perte — et chacun est traité différemment à des fins fiscales. Almstins vous permet d'étiqueter n'importe quelle transaction avec son type de cession afin que vos enregistrements soient précis et que votre préparateur fiscal ait tout ce dont il a besoin.
        </p>

        <p><strong>Comment annoter une transaction :</strong></p>
        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Allez sur la page <strong>Research</strong>.</li>
          <li>Trouvez la transaction dans le panneau <strong>Needs Attention</strong> ou cherchez-la dans le panneau de droite.</li>
          <li>Cliquez sur le bouton <strong>📝 Add note</strong> en bas de la carte de transaction.</li>
          <li>Choisissez un type de cession dans le menu déroulant et ajoutez optionnellement une note en texte libre.</li>
          <li>Cliquez sur <strong>Save</strong>.</li>
        </ol>

        <p>La note et la catégorie sont écrites directement sur l'enregistrement de la transaction, elles suivent donc la transaction partout où elle apparaît — Bookkeeping, Research et tout export futur.</p>

        <p><strong>Types de cession disponibles :</strong></p>
        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Sell</strong> — une vente directe contre fiat ou stablecoin. Une plus-value ou moins-value s'applique.</li>
          <li><strong>Trade (crypto → crypto)</strong> — échanger une cryptomonnaie contre une autre. Également une cession imposable aux États-Unis — le gain ou la perte est calculé au moment de l'échange.</li>
          <li><strong>Gift out</strong> — crypto envoyée à une autre personne en cadeau. Pas un événement imposable pour l'expéditeur au moment du cadeau, mais le destinataire hérite de votre cost basis. Les cadeaux dépassant la limite d'exclusion annuelle ($18 000 en 2024) peuvent nécessiter une déclaration de taxe sur les dons.</li>
          <li><strong>Gift in</strong> — crypto reçue en cadeau. Pas un revenu imposable. Votre cost basis est le cost basis original du donateur.</li>
          <li><strong>Lost / stolen</strong> — pièces définitivement inaccessibles. Que cela soit déductible comme perte dépend de votre juridiction et de quand cela s'est produit. Consultez un professionnel fiscal.</li>
          <li><strong>Donation</strong> — crypto envoyée à une organisation caritative enregistrée. Si détenue depuis plus d'un an, vous pouvez déduire la juste valeur marchande au moment du don sans reconnaître une plus-value. Si détenue moins d'un an, la déduction est limitée à votre cost basis.</li>
          <li><strong>Other / explained</strong> — pour tout ce qui ne rentre pas dans les catégories ci-dessus. Utilisez la note en texte libre pour le décrire.</li>
        </ul>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>⚠️ Il ne s'agit pas d'un conseil fiscal.</strong> Almstins vous aide à organiser et étiqueter votre historique de transactions — il ne dépose pas de déclarations et ne fournit pas de conseils juridiques ou fiscaux. Le traitement fiscal de la crypto varie selon la juridiction et les circonstances individuelles. Consultez toujours un professionnel fiscal qualifié avant de prendre des décisions basées sur ces données.
        </p>`,
  },
  {
    id: "faq-custodial-address",
    q: "Si un exchange envoie de la crypto depuis une adresse, cette adresse m'appartient-elle ?",
    a: `<p>
          Pas nécessairement. Lorsqu'un exchange comme Venmo, Coinbase ou Kraken vous envoie de la crypto, la transaction provient de <em>leur</em> wallet — pas du vôtre. Les exchanges regroupent les fonds de milliers d'utilisateurs dans des hot wallets partagés. L'adresse dans le champ "From" appartient à l'infrastructure de l'exchange, pas à votre compte personnel.
        </p>

        <p>
          Il y a deux façons fondamentalement différentes de détenir de la crypto :
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Custodial (comptes d'exchange)</strong> — l'exchange détient vos clés privées. Vous avez un solde dans leur système et ils déplacent les fonds en votre nom. Les adresses on-chain leur appartiennent. Venmo, Coinbase, Kraken et Gemini fonctionnent tous de cette façon.</li>
          <li><strong>Self-custody (votre propre wallet)</strong> — vous détenez les clés privées. L'adresse est la vôtre et uniquement la vôtre. Personne d'autre ne peut envoyer depuis elle. MetaMask, les hardware wallets (Ledger, Trezor) et outils similaires fonctionnent de cette façon.</li>
        </ul>

        <p>
          Cela est important lors de l'utilisation de la recherche d'adresses de la page Research. Si vous collez une adresse provenant d'une transaction d'exchange, vous verrez l'activité de <em>cet exchange</em> — tous les transferts entrants et sortants de leur pool partagé — pas seulement votre historique personnel. Pour suivre précisément vos propres fonds, utilisez les adresses des wallets que vous contrôlez personnellement.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Conseil :</strong> Si vous avez reçu de la crypto via Venmo et l'avez ensuite vendue, votre transaction est enregistrée dans le registre interne de Venmo. L'adresse on-chain n'est que leur backend — la suivre n'affichera pas votre solde personnel.
        </p>`,
  },
  {
    id: "faq-address-labels",
    q: "Comment fonctionne l'Address Book ?",
    a: `<p>
          Lorsque de l'argent se déplace sur une blockchain, il se déplace entre des adresses — de longues chaînes de lettres et de chiffres comme <code style="font-size: 0.82em; background: rgba(255,255,255,0.08); padding: 0.1rem 0.35rem; border-radius: 4px;">0x794a61…</code>. Par elles-mêmes, ces adresses ne signifient rien. L'Address Book est la façon dont vous les transformez en noms comme <strong>"Aave V3 Pool · Ethereum"</strong> ou <strong>"Crypto.com Deposit"</strong> — afin que partout où une adresse apparaît dans votre historique, vous voyiez un nom à la place.
        </p>

        <p>
          L'Address Book se trouve sur la page <strong>Addresses</strong>. Ce ne sont <em>pas</em> des wallets que vous possédez — ce sont des contreparties : exchanges, protocoles DeFi, bridges ou wallets d'autres personnes qui apparaissent dans votre historique de transactions.
        </p>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Comment le carnet est renseigné</h2>

        <p>Il y a trois façons dont une adresse se retrouve étiquetée :</p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Contrats pré-chargés</strong> — les adresses de protocoles DeFi bien connus (Aave V3 sur Ethereum, Polygon et Avalanche) sont pré-étiquetées. Vous n'avez pas besoin de les ajouter vous-même.</li>
          <li><strong>Saisie manuelle</strong> — tapez ou collez une adresse, donnez-lui un nom, choisissez une catégorie (Exchange, DeFi Protocol, Personal Wallet, Bridge, etc.) et optionnellement une chaîne. Appuyez sur Save.</li>
          <li><strong>📷 Scan Screenshot</strong> — certains exchanges (comme Crypto.com) ne vous laissent pas copier les adresses de wallet. Prenez une capture d'écran de l'adresse sur votre téléphone ou ordinateur, téléversez-la avec le bouton Scan Screenshot, et Claude Vision lit l'adresse depuis l'image et pré-remplit le formulaire pour vous automatiquement.</li>
        </ul>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Comment cela se connecte aux transactions mystérieuses</h2>

        <p>
          Chaque transaction dans votre historique a une <strong>adresse d'origine</strong> et une <strong>adresse de destination</strong>. Lorsque l'une de ces adresses est dans votre Address Book, Almstins affiche le nom à la place du hexadécimal brut — dans le tiroir de transaction, dans le panneau Needs Attention et partout où des adresses apparaissent dans votre historique.
        </p>

        <p>
          C'est particulièrement utile pour les éléments <strong>Needs Attention</strong> — transactions qui n'ont pas pu être classifiées automatiquement. Si l'adresse de la contrepartie est étiquetée "Aave V3 Pool · Polygon", vous savez immédiatement qu'il s'agissait d'un dépôt ou retrait DeFi plutôt que d'un transfert inconnu mystérieux. Ce contexte vous aide à décider rapidement de la bonne classification.
        </p>

        <p style="background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 0.5rem;">
          <strong>Conseil :</strong> Plus vous étiquetez d'adresses, moins vous aurez de transactions mystérieuses. Commencez par vos adresses de dépôt d'exchange — ce sont la source la plus fréquente de transferts non résolus.
        </p>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Étiquettes communautaires</h2>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Chaque fois que vous sauvegardez une étiquette, un vote communautaire silencieux est enregistré en arrière-plan.</li>
          <li>Lorsque 3 utilisateurs étiquettent indépendamment la même adresse de la même façon, elle devient une <strong>étiquette globale</strong> visible par tous sur la plateforme.</li>
          <li>Si 5 utilisateurs s'accordent ensuite sur un nom différent, l'étiquette globale est corrigée automatiquement.</li>
          <li>Votre étiquette personnelle a toujours la priorité sur une étiquette communautaire si elles sont en désaccord.</li>
        </ul>`,
  },
  {
    id: "faq-recognized-tokens",
    q: "Quels tokens sont automatiquement tarifés et reconnus ?",
    a: `<p>
          Almstins maintient une liste de tokens connus et vérifiés. Les tokens sur cette liste obtiennent un prix en direct, apparaissent correctement dans vos pages Vault et Bookkeeping, et ne sont jamais signalés comme spam potentiel — quelle que soit la wallet dans laquelle ils apparaissent.
        </p>

        <p><strong>Tokens actuellement reconnus :</strong></p>

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
          Les variantes wrapped et bridged (WETH, WBTC, WAVAX, etc.) sont automatiquement mappées à leur actif sous-jacent pour la tarification — vos tokens wrapped affichent donc la valeur de marché correcte sans aucune configuration manuelle.
        </p>

        <p style="background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 0.5rem;">
          <strong>Vous ne voyez pas votre token ?</strong> Tout token ne figurant pas sur cette liste apparaîtra sans prix dans votre Vault. C'est intentionnel — les contrats non vérifiés sont un vecteur courant pour les airdrops de spam. Si vous détenez un token légitime manquant, utilisez l'option <em>Flag for Support</em> et il sera examiné pour ajout.
        </p>`,
  },
  {
    id: "faq-health-alerts",
    q: "Comment fonctionnent les alertes de health factor Aave ?",
    a: `<p>
          Si vous avez un prêt Aave actif, votre <strong>health factor</strong> est le chiffre le plus important à surveiller. Il mesure à quel point votre collatéral couvre votre dette en toute sécurité. Lorsqu'il descend trop près de 1,0, Aave peut liquider votre collatéral pour rembourser le prêt — ce qui se produit généralement à un mauvais prix pour vous.
        </p>

        <p>
          Almstins vérifie votre health factor toutes les 30 minutes et vous envoie un e-mail dès qu'il dépasse un seuil que vous définissez. Vous choisissez :
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Direction</strong> — alerte lorsque le health factor tombe <em>en dessous</em> de votre seuil (le plus courant) ou monte <em>au-dessus</em> de celui-ci.</li>
          <li><strong>Seuil</strong> — le chiffre qui déclenche l'alerte. Une valeur de 1,5 est un niveau d'alerte précoce raisonnable ; beaucoup de personnes fixent une seconde alerte à 1,2 comme avertissement final.</li>
        </ul>

        <p>
          Pour définir une alerte, ouvrez n'importe quelle position DeFi Aave sur votre page Vault et cliquez sur la pastille <strong>🔔 Set Alert</strong> à côté de votre health factor. Une fois active, la pastille devient jaune et affiche votre paramètre actuel — par exemple, <strong>🔔 HF &lt; 1.5</strong>.
        </p>

        <p>
          Les alertes sont envoyées à votre <strong>e-mail d'alerte</strong>, qui peut être différent de l'e-mail de connexion de votre compte. Vous pouvez le définir ou le modifier dans le menu <strong>Account</strong> en haut de n'importe quelle page. Si aucun e-mail d'alerte n'est défini, la pastille vous invitera à en ajouter un avant que l'alerte puisse se déclencher.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Limite de fréquence :</strong> Pour éviter de saturer votre boîte de réception, les alertes sont envoyées au maximum une fois toutes les 4 heures par wallet, même si votre health factor reste en dessous du seuil pendant tout ce temps. Une fois la situation résolue et le health factor rétabli, le compteur se réinitialise.
        </p>`,
  },
  {
    id: "faq-reconciliation-delta",
    q: "Pourquoi ma réconciliation mensuelle affiche-t-elle un delta même quand rien n'a mal tourné ?",
    a: `<p>
          Le livre de comptes mensuel fonctionne en <strong>montants en dollars</strong> — le solde d'ouverture, les entrées, les sorties et le solde de clôture sont tous en USD. Cela signifie que même un mois parfaitement propre avec zéro transaction manquante affichera un delta, car la valeur en dollars de vos pièces change avec le marché chaque jour.
        </p>

        <p>
          <strong>Exemple :</strong> Vous ouvrez janvier avec $10 000 en Bitcoin. Vous n'achetez rien, ne vendez rien et ne déplacez rien. Mais Bitcoin monte de 20% pendant le mois. Votre solde de clôture est $12 000. La formule du livre de comptes dit :
        </p>

        <blockquote style="background: rgba(255,255,255,0.05); border-left: 3px solid #e8a020; padding: 0.75rem 1rem; margin: 0.75rem 0; border-radius: 0 8px 8px 0;">
          Clôture attendue = $10 000 + $0 − $0 = $10 000<br />
          Clôture réelle = $12 000<br />
          Delta = +$2 000
        </blockquote>

        <p>
          Ce delta de $2 000 n'est pas un problème. C'est une appréciation non réalisée — exactement ce que vous souhaitez voir. Le livre de comptes basé en dollars ne peut pas faire la distinction entre "des pièces sont apparues de nulle part" et "les pièces que vous aviez déjà ont pris de la valeur."
        </p>

        <p>
          <strong>La bonne façon de vérifier les données manquantes est de compter les pièces, pas les dollars.</strong>
        </p>

        <p>
          Si vous déteniez 0,10 BTC au début du mois, n'avez rien acheté, rien vendu, et détenez toujours 0,10 BTC à la fin — les livres s'équilibrent parfaitement quel que soit le prix. Une réconciliation en quantité de pièces est immunisée contre les mouvements du marché car le prix n'affecte pas le nombre de pièces que vous possédez.
        </p>

        <p>
          <strong>Comment utiliser cela en pratique :</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Un <strong>delta en dollars</strong> lors d'un mois calme est presque toujours une appréciation ou dépréciation de prix. Normal.</li>
          <li>Une <strong>divergence du comptage de pièces</strong> — où votre quantité attendue et votre quantité réelle ne correspondent pas — signifie toujours que quelque chose manque : une transaction n'a pas été importée, un transfert a perdu un côté, ou un exchange n'est pas encore connecté.</li>
          <li>La <strong>vue Reconciliation</strong> sur la page Bookkeeping fonctionne en quantités de pièces exactement pour cette raison. Utilisez-la pour trouver les lacunes de données. Utilisez le livre de comptes mensuel pour voir les tendances de flux de trésorerie dans le temps.</li>
          <li>Si votre delta en dollars est important et <em>négatif</em> lors d'un mois où les prix étaient stables ou en hausse, cela vaut la peine d'être investigué — cela suggère que des pièces ont quitté votre portefeuille sans enregistrement de transaction correspondant.</li>
        </ul>

        <p>
          Le livre de comptes mensuel suit également séparément les <strong>moitiés de transferts non rapprochées</strong> — des transactions classifiées comme transferts qui n'ont pas de contrepartie correspondante dans vos données. Celles-ci sont signalées avec un avertissement et décomposées par actif afin que vous puissiez retracer exactement quelle transaction a disparu.
        </p>`,
  },
  {
    id: "faq-api-public",
    q: "Puis-je appeler les vérifications de sécurité d'Almstins depuis mon propre script ou agent ?",
    a: `<p>
          Oui. Trois endpoints sont ouverts au public sans connexion requise :
        </p>
        <ul>
          <li><strong>GET /api/wallet-check?address=</strong> — vérifie une adresse crypto contre les listes noires, les sanctions, les liens avec le dark web, les tokens honeypot, l'âge du portefeuille et bien plus. Accepte aussi un POST avec un corps JSON.</li>
          <li><strong>GET /api/dapp-check?url=</strong> — contrôle une URL ou un domaine de dApp contre MetaMask, ScamSniffer, GoPlus, URLScan et d'autres bases de données de phishing.</li>
          <li><strong>GET /api/verify/lookup?address=</strong> — indique si une adresse a un éditeur vérifié sur Almstins Verify et quel domaine l'a publiée.</li>
        </ul>
        <p>
          Les trois renvoient du JSON et incluent des en-têtes CORS, donc ils peuvent être appelés depuis un navigateur, un script ou un agent IA. Les appels non authentifiés sont limités à 10 requêtes par minute par IP. Pour passer à 60 par minute, générez une clé d'API depuis la section <strong>Clés d'API</strong> en bas du <a href="/dashboard/verify">tableau de bord Verify</a> et transmettez-la dans l'en-tête <code>X-Api-Key</code>.
        </p>
        <p>
          La documentation complète des requêtes/réponses, les définitions des champs et les codes d'erreur se trouvent sur <a href="/api-docs">almstins.com/api-docs</a>.
        </p>`,
  },
  {
    id: "faq-verify-self-send",
    q: "Comment prouver que je possède une adresse sur Almstins Verify ?",
    a: `<p>
          La méthode d'auto-envoi fonctionne sans site web ni connexion de wallet. Dans le tableau de bord Verify, enregistrez votre adresse, puis envoyez n'importe quelle transaction sortante depuis celle-ci — même un montant minime à vous-même. Almstins surveille la chaîne publique et marque l'adresse comme Vérifiée dès qu'il détecte une activité après l'émission du défi.
        </p>
        <p>
          Rien n'est connecté à Almstins et rien n'est signé pour nous. La seule preuve qui compte est d'envoyer <em>depuis</em> l'adresse, ce que seule la personne détenant la clé privée peut faire. Une fois prouvée, chaque adresse reçoit un badge QR téléchargeable que vous pouvez imprimer, ajouter à une facture ou placer sur une page de paiement pour que les clients confirment que l'adresse est bien la vôtre avant de payer.
        </p>
        <p>
          Une adresse ne peut être revendiquée que par un seul compte. Si vous tentez de revendiquer une adresse déjà prouvée par un autre compte, la vérification échoue. Le scanner public sur <a href="/verify/scan">almstins.com/verify/scan</a> indique si une adresse est vérifiée et par qui, avant tout mouvement de fonds.
        </p>
        <p>
          La preuve par auto-envoi est disponible pour les adresses Ethereum, Polygon, Avalanche, Bitcoin, Litecoin et Solana.
        </p>`,
  },
  {
    id: "faq-verify-domain",
    q: "J'ai un site web. Puis-je prouver mes adresses en utilisant mon domaine plutôt qu'en envoyant une transaction ?",
    a: `<p>
          Oui. Dans le tableau de bord Verify, ouvrez le panneau Prove pour n'importe quelle destination d'adresse et passez à l'onglet Domaine. Saisissez votre domaine et Almstins génère un petit fichier JSON avec un token de défi unique. Téléversez-le sur votre serveur web à l'adresse <code>/.well-known/almstins-verify.json</code>, puis cliquez sur Vérifier. Almstins récupère le fichier, vérifie que le défi correspond et attache votre domaine comme éditeur vérifié de cette adresse.
        </p>
        <p>
          Si vous préférez le DNS plutôt qu'un fichier, vous pouvez également ajouter un enregistrement TXT à votre domaine. Le tableau de bord affiche les deux options côte à côte — utilisez celle qui convient le mieux à votre configuration d'hébergement.
        </p>
        <p>
          Une adresse prouvée par domaine affiche "vérifié par votredomaine.com" sur le scanner public plutôt que simplement "vérifié." C'est le signal le plus fort pour les entreprises — il lie l'adresse à un domaine que vous démontrez contrôler.
        </p>`,
  },
  {
    id: "faq-verify-exchange",
    q: "Je gère un exchange ou un service de paiement. Puis-je publier toutes nos adresses de dépôt comme vérifiées ?",
    a: `<p>
          Oui, via le parcours Entité Vérifiée dans le tableau de bord Verify. Cela fonctionne en deux étapes :
        </p>
        <ol>
          <li><strong>Prouvez votre domaine.</strong> Téléversez le fichier de défi Almstins sur <code>/.well-known/almstins-verify.json</code> sur votre domaine (ou ajoutez l'enregistrement DNS TXT). Almstins le récupère et confirme que vous contrôlez le domaine.</li>
          <li><strong>Connectez un endpoint d'adresses en direct.</strong> Une fois votre domaine prouvé, collez un endpoint HTTPS sur ce même domaine et une clé API en lecture seule. Almstins appelle l'endpoint régulièrement, lit votre liste actuelle d'adresses et les publie comme "vérifiées par votredomaine.com" sur le scanner public.</li>
        </ol>
        <p>
          Votre endpoint n'a qu'à retourner un tableau JSON d'objets d'adresse — Almstins gère le polling et la mise en miroir. L'endpoint doit se trouver sur le même domaine (ou un sous-domaine) que vous avez prouvé, afin que la racine de confiance soit votre domaine, et non une affirmation prise sur parole.
        </p>
        <p>
          Les exchanges ne peuvent pas utiliser la méthode d'auto-envoi car les adresses de dépôt sont contrôlées par la plateforme — l'exchange lui-même détient les clés privées, pas l'utilisateur. Le parcours domaine-plus-endpoint existe spécifiquement pour ce cas : une institution qui cautionne ses propres adresses en les publiant depuis une infrastructure qu'elle démontre contrôler.
        </p>
        <p>
          La clé API est stockée chiffrée et n'est utilisée que pour récupérer la liste d'adresses. Almstins ne stocke ni ne transmet jamais de valeur en votre nom. Il s'agit d'une intégration en lecture seule, cohérente avec l'architecture sans garde.
        </p>`,
  },
  {
    id: "faq-tron-safety",
    q: "Le vérificateur de wallet fonctionne-t-il pour les adresses TRON ?",
    a: `<p>
          Oui. Les adresses TRON (commençant par <strong>T</strong>, 34 caractères) bénéficient de vérifications de sécurité complètes :
        </p>
        <ul>
          <li><strong>Liste noire GoPlus</strong> — croisée avec la base de données mondiale de GoPlus Security en utilisant la chaîne TRON, qui couvre les adresses de scams, phishing et draineurs signalées sur TRON.</li>
          <li><strong>Signalements communautaires Chainabuse</strong> — tout signalement de fraude soumis par la communauté lié à l'adresse.</li>
          <li><strong>Ancienneté du wallet</strong> — les adresses créées dans les 30 derniers jours sont signalées ; les wallets très récents sont un signal courant dans les arnaques par ingénierie sociale.</li>
          <li><strong>Avoirs en tokens TRC-20</strong> — l'onglet Holdings affiche le solde TRX et les principaux tokens TRC-20 de l'adresse (USDT, USDC et autres).</li>
        </ul>
        <p>
          TRON est l'une des chaînes les plus courantes pour la fraude crypto et les opérations d'arnaque, notamment l'USDT (TRC-20). Si quelqu'un vous donne une adresse TRON et vous demande d'envoyer des USDT, vérifiez-la d'abord.
        </p>
        <p>
          <strong>Un avertissement important que le vérificateur affiche toujours :</strong> une adresse TRON ne peut recevoir que des actifs natifs TRON (TRX, USDT-TRC20, etc.). Envoyer des ETH, BTC, SOL ou tout token EVM à une adresse TRON signifie que ces fonds sont perdus définitivement. Le vérificateur affiche cet avertissement sur chaque résultat TRON.
        </p>`,
  },
  {
    id: "faq-chain-recognition",
    q: "Le vérificateur a reconnu mon adresse XRP / Dogecoin / Cardano / Cosmos mais indique qu'il n'y a pas de données — pourquoi ?",
    a: `<p>
          Le vérificateur de wallet peut détecter des adresses de plusieurs chaînes au-delà d'Ethereum, Bitcoin, Solana, Litecoin, Sui et TRON. Quand vous collez une adresse XRP, Dogecoin, Cardano ou Cosmos, il identifie à quelle chaîne elle appartient et affiche le bon badge de chaîne — vous savez ainsi au moins que vous avez collé le bon type d'adresse.
        </p>
        <p>
          Les vérifications complètes des bases de données de sécurité (listes noires, signalements d'arnaques, ancienneté du wallet, avoirs en tokens) ne sont pas encore disponibles pour ces quatre chaînes. L'extension de la couverture de sécurité à celles-ci est prévu dans la roadmap.
        </p>
        <p>
          La chose la plus importante que le label évite : coller une adresse Dogecoin et que le vérificateur signale "adresse invalide" — ce qui pourrait vous faire croire que vous avez mal saisi quelque chose alors que l'adresse est parfaitement valide. Savoir à quelle chaîne appartient une adresse aide également à éviter l'erreur d'envoi entre chaînes décrite ci-dessous.
        </p>`,
  },
  {
    id: "faq-wallet-error",
    q: "Un tin de wallet affiche une erreur et un ref code — qu'est-ce que cela signifie ?",
    a: `<p>
          L'application n'a pas pu récupérer les données de solde pour ce wallet — généralement un problème réseau ou de service temporaire. Nous ne pouvons pas confirmer votre solde actuel jusqu'à ce que la connexion soit rétablie. Utilisez Try again, ou consultez directement un block explorer pour une confirmation en temps réel.
        </p>

        <p>
          <strong>Ce qu'est le ref code :</strong><br />
          Le code court que vous voyez (par exemple <code style="font-size: 0.85em; background: rgba(255,255,255,0.08); padding: 0.1rem 0.4rem; border-radius: 4px;">FA5B-1K2M9</code>) est un ID d'incident unique généré au moment où l'erreur s'est produite. Il encode quel wallet a échoué et quand, de sorte que si vous contactez le support, nous pouvons trouver l'échec exact dans les logs sans avoir à vous poser une douzaine de questions.
        </p>

        <p>
          <strong>Que faire en premier — réessayez :</strong><br />
          Cliquez sur le bouton <strong>Try again</strong> directement dans le tin. La plupart des erreurs sont transitoires (l'API en amont était brièvement inaccessible) et se résolvent à la prochaine tentative. Si le solde se charge avec succès, vous avez terminé.
        </p>

        <p>
          <strong>Si l'erreur persiste :</strong><br />
          Une alerte a déjà été envoyée automatiquement — vous n'avez pas besoin de la signaler manuellement. Si vous souhaitez faire un suivi, envoyez un e-mail à <a href="mailto:hello@almstins.com">hello@almstins.com</a> et incluez le ref code. Ce code est le moyen le plus rapide de retracer exactement ce qui a échoué.
        </p>

        <p style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Remarque :</strong> Le ref code est sélectionnable en un clic — appuyez dessus ou cliquez une fois pour surligner l'intégralité du code, puis copiez-le avant de nous contacter.
        </p>`,
  },
  {
    id: "faq-ai-chat",
    q: "Qu'est-ce que l'Assistant Portefeuille et que puis-je lui demander ?",
    a: `<p>
          L'Assistant Portefeuille est un bouton de chat flottant (intitule <strong>&#10022; Ask AI</strong>) sur les pages Research et Bookkeeping. Il vous permet de poser des questions en langage naturel sur les donnees de votre portefeuille -- vos avoirs, transactions recentes, cout de base et plus -- sans avoir a fouiller manuellement dans le grand livre.
        </p>

        <p><strong>Exemples de questions :</strong></p>
        <ul>
          <li>"Quel est mon avoir le plus important en valeur ?"</li>
          <li>"Combien d'ETH ai-je recu cette annee ?"</li>
          <li>"Quelles transactions sont encore non classifiees ?"</li>
          <li>"Quel prix moyen ai-je paye pour SOL ?"</li>
        </ul>

        <p>
          <strong>Ce qu'il ne peut pas faire :</strong> L'assistant ne donne pas de conseils financiers ou fiscaux, ne peut pas modifier vos donnees et n'a pas acces au compte d'un autre utilisateur. Il repond a des questions sur ce que montrent les donnees -- les decisions vous appartiennent.
        </p>

        <p><strong>Limites mensuelles de questions par abonnement :</strong></p>
        <ul>
          <li><strong>Free</strong> -- 5 questions par mois</li>
          <li><strong>Starter</strong> -- 30 questions par mois</li>
          <li><strong>Pro</strong> -- 150 questions par mois</li>
          <li><strong>Unlimited</strong> -- sans limite</li>
        </ul>

        <p>
          Les limites se reinitalisent automatiquement le premier de chaque mois. Le badge sur le bouton Ask AI indique combien de questions il vous reste ce mois-ci. Si vous atteignez la limite, le champ de saisie est remplace par un lien de mise a niveau.
        </p>

        <p>
          <strong>Confidentialite :</strong> Chaque question envoie un apercu de votre historique de transactions et de vos avoirs actuels a Anthropic (Claude Haiku) pour generer la reponse. L'apercu est limite a votre compte uniquement -- les donnees d'aucun autre utilisateur ne sont incluses. Anthropic ne conserve pas les entrees de l'API au-dela de la requete immediate. Les questions ne sont pas stockees ni examinees par Almstins.
        </p>`,
  },
];
