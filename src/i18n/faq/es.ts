// FAQ — Spanish items. First-pass translation; review by a fluent speaker before authoritative.
import type { FaqItem } from '../faq';

export const items: FaqItem[] = [
  {
    id: "faq-project",
    q: "Conoce el proyecto",
    a: `<p>
          Almstins existe porque los portafolios de cripto son genuinamente difíciles de entender. Las monedas se mueven entre wallets y exchanges, se intercambian, se hace staking, se regalan o se pierden — y la mayoría de la gente no tiene un único lugar que muestre el panorama completo con claridad.
        </p>

        <p>
          El objetivo es simple: abrir tu portafolio y saber exactamente qué tienes, de dónde vino, cuánto tiempo lo has tenido y cuánto vale. Esa información se muestra a lo largo de tres páginas:
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Vault</strong> — valores de mercado en vivo para todos tus wallets y cuentas de exchange conectados. Cada moneda muestra su ticker, cantidad, valor actual en dólares, ganancia/pérdida y el número de días que ha estado en tu ecosistema. El Vault también muestra posiciones DeFi de Aave (salud del préstamo, desglose de colateral).</li>
          <li><strong>Bookkeeping</strong> — todo tu historial de transacciones en un solo lugar, con ganancias realizadas, cost basis y seguimiento de lots FIFO. Esta es la página que importa en época de impuestos.</li>
          <li><strong>Research</strong> — una herramienta de investigación dedicada para encontrar de dónde vinieron las monedas, a dónde fueron y resolver cualquier hueco en tu historial. El motor de coincidencia de transferencias enlaza automáticamente los retiros con los depósitos a través de las fuentes, y todo lo que no pueda resolver automáticamente aparece en el panel Needs Attention para que lo revises.</li>
        </ul>

        <p>
          Puedes eliminar cualquier tin que ya no necesites en cualquier momento. Tus datos de transacciones en bruto nunca se modifican — todo se almacena tal como se importó.
        </p>`,
  },
  {
    id: "faq-exchanges",
    q: "Qué hay de los exchanges",
    a: `<p>
          Puedes agregar exchanges. Los wallets de self-custody obtienen los datos de APIs,
          los exchanges usan archivos CSV. Solo tienes que subir el archivo al
          proyecto. No existe un formato estándar en la industria para los archivos CSV, así que un
          archivo puede tener una tabla con cinco columnas empezando por las comisiones de gas, mientras
          que otro puede tener diez columnas empezando por un ID de usuario único que
          nadie entiende excepto la gente que trabaja con bases de datos. Por eso, cada
          exchange tiene una carga única. Estos tins mostrarán los tokens de
          tu cuenta y enviarán tus transacciones a la página de bookkeeping para
          su almacenamiento.
        </p>`,
  },
  {
    id: "faq-transactions",
    q: "Qué hay de las transacciones",
    a: `<p>
          Cada moneda tiene una historia de vida. Fue comprada, intercambiada, sometida a staking, regalada o enviada a ti desde algún lugar — y eventualmente fue vendida, movida o sigue en un wallet. Almstins rastrea todo ese recorrido.
        </p>

        <p>
          Las transacciones se importan desde tus exchanges mediante carga de CSV y desde los wallets de self-custody mediante el API de la blockchain. Una vez importada, cada transacción se almacena exactamente como se recibió y nunca se modifica. Las notas y etiquetas de disposición que agregues se almacenan por separado, junto a los datos en bruto.
        </p>

        <p>
          La página de Bookkeeping agrupa las transacciones por moneda y calcula el cost basis usando FIFO (first-in, first-out). Cuando vendes o intercambias una moneda, el lot más antiguo se consume primero. La antigüedad de cada lot determina si una disposición es una ganancia de capital a corto o a largo plazo — una distinción que puede marcar una diferencia significativa en tu factura de impuestos.
        </p>

        <p>
          La página de Research se encarga de la pregunta más difícil: ¿qué pasa con las transacciones que no tienen una contraparte obvia? Cuando retiras de Coinbase y depositas en Kraken, cada plataforma registra solo su mitad. El motor de coincidencia de transferencias encuentra automáticamente esos pares en todas tus fuentes. Todo lo que no pueda coincidir con confianza aparece en el panel Needs Attention, donde puedes investigarlo, confirmarlo o anotarlo tú mismo.
        </p>`,
  },
  {
    id: "faq-bookkeeping",
    q: "Página de Bookkeeping",
    a: `<p>
          La página de Bookkeeping es donde todo se junta. Cada transacción importada de cada exchange y wallet aparece en un historial unificado — ordenado, buscable y organizado por activo.
        </p>

        <p>
          Para cada moneda que tienes, la página muestra tu historial completo de lots: cuándo la adquiriste, cuánto pagaste (cost basis) y si se ha dispuesto de alguna parte. Las ganancias y pérdidas realizadas se calculan automáticamente usando coincidencia FIFO (first-in, first-out) — el mismo método que el IRS espera. La división entre corto y largo plazo se maneja por ti según el tiempo real de tenencia.
        </p>

        <p>
          Puedes descargar tu lista completa de transacciones como CSV en cualquier momento. También puedes agregar notas a transacciones individuales — útil para anotar regalos, donaciones, monedas perdidas o cualquier cosa sobre la que tu contador necesite contexto.
        </p>

        <p>
          Al final de la página, la <strong>vista de Reconciliation</strong> compara los saldos que calculó el pipeline contra lo que tus wallets y exchanges en vivo realmente muestran — para que puedas detectar datos faltantes antes de que se conviertan en un problema en época de impuestos.
        </p>`,
  },
  {
    id: "faq-privacy",
    q: "¿Es privado?",
    a: `<p>
          Respuesta corta: no. Todo lo que se obtiene de las API keys está ahí afuera para
          que el público lo vea. Pero el sitio web es privado, tu login es privado
          y tus datos están seguros. La base de datos lo encripta todo. Eventualmente voy a
          rastrear IDs únicos, número de wallets, qué funciones está usando la gente
          y cuánto tráfico hay. Mi propósito es medir mi
          efectividad y hacer un mejor producto.
        </p>`,
  },
  {
    id: "faq-safety-checker",
    q: "¿Qué es el verificador de seguridad de billeteras y sitios web?",
    a: `<p>
          Una herramienta pública y gratuita — sin cuenta, sin conexión de
          billetera — para verificar una dirección o un sitio web <em>antes</em>
          de enviar fondos o conectarte. Pega una dirección de billetera y ejecuta
          verificaciones de seguridad (lista de bloqueo de GoPlus, sanciones OFAC,
          actividad de mezcladores / Tornado Cash, detección de honeypot, edad de
          la billetera, multi-firma). Pega una URL y la verifica contra 7 bases de
          datos independientes de phishing y malware — MetaMask, ScamSniffer,
          GoPlus, URLScan.io, OpenPhish, Google Safe Browsing y VirusTotal — y
          devuelve rojo, amarillo o verde. Almstins nunca hace su propia
          determinación; muestra lo que la comunidad de seguridad ya ha señalado.
        </p>
        <p>
          Nada de lo que verificas se almacena en forma legible. Las verificaciones
          repetidas se sirven desde una caché de corta duración indexada mediante
          una huella unidireccional e irreversible de lo que ingresaste, y el
          contador de uso registra solo esa misma huella — por lo que no hay forma
          de retroceder hasta lo que consultaste. Esto mantiene la herramienta
          coherente con la regla de que Almstins nunca vincula una dirección a una
          persona.
        </p>`,
  },
  {
    id: "faq-support",
    q: "¿Qué soporta el proyecto actualmente?",
    a: `<p><strong>Wallets de self-custody (datos de blockchain en vivo)</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Cadenas EVM: Ethereum, Polygon, Avalanche, Arbitrum y otras</li>
          <li>Sui (SUI) — saldos de wallet nativos y sincronización de transacciones</li>
          <li>Solana (SOL) — saldos de wallet nativos</li>
          <li>Bitcoin (BTC) y Litecoin (LTC) — seguimiento de direcciones</li>
          <li>Saldos de monedas, antigüedad de las tenencias, ticker, cantidad, valor actual, ganancia/pérdida</li>
          <li>Posiciones DeFi de Aave — salud del préstamo, desglose de colateral, seguimiento de deuda</li>
        </ul>

        <p><strong>Importaciones de CSV de exchanges</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Coinbase</li>
          <li>Crypto.com</li>
          <li>Gemini (filas de Buy, Debit y Credit, incluyendo staking, airdrops y recompensas de aprendizaje)</li>
          <li>Kraken (exportación de Ledgers)</li>
          <li>Exodus</li>
          <li>Cash App</li>
          <li>Robinhood</li>
          <li>Venmo</li>
        </ul>

        <p><strong>Bookkeeping</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Historial completo de transacciones de todas las fuentes en una sola vista</li>
          <li>Cálculo de cost basis FIFO y ganancias realizadas</li>
          <li>Clasificación de ganancias a corto vs. largo plazo según el tiempo de tenencia</li>
          <li>Vista de Reconciliation — compara los saldos calculados contra los datos de wallet en vivo</li>
          <li>Lista de transacciones descargable</li>
        </ul>

        <p><strong>Página de Research</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Motor de coincidencia de transferencias — enlaza automáticamente los retiros con los depósitos a través de las fuentes usando hash de transacción, dirección, monto y señales de tiempo</li>
          <li>Panel Needs Attention — muestra las transacciones sin resolver y las coincidencias sugeridas</li>
          <li>Búsqueda de texto completo en todas las transacciones por hash, símbolo, rango de fechas o palabra clave</li>
          <li>Chips de símbolo para una auditoría por activo con un solo clic</li>
          <li>Anotaciones de disposición — etiqueta cualquier transacción como venta, intercambio, regalo, donación o pérdida directamente desde la página de Research</li>
          <li>Etiquetas de dirección — direcciones de wallet conocidas etiquetadas automáticamente; etiquetas personalizadas almacenables por hash de transacción o ID</li>
          <li>Tin de resueltas — coincidencias confirmadas archivadas al final del panel</li>
        </ul>`,
  },
  {
    id: "faq-defi",
    q: "¿Qué posiciones DeFi admite Almstins?",
    a: `<p>Almstins lee tus posiciones de préstamo y deuda de DeFi en vivo por dirección (solo lectura, sin conexión de wallet) y las integra en tu patrimonio, portafolio y costo base. Actualmente admite:</p>
        <p><strong>Aave V3 — préstamos y deuda</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Colateral aportado y posiciones de deuda variable (borrow)</li>
          <li>Factor de salud del préstamo, riesgo de liquidación y tasas de supply/borrow en vivo</li>
          <li><strong>Ethereum</strong> — los cuatro mercados: Core, Lido, EtherFi y Horizon (una posición en cualquiera de ellos aparece, por ejemplo wstETH aportado al mercado Lido)</li>
          <li><strong>Polygon</strong></li>
          <li><strong>Avalanche</strong></li>
        </ul>
        <p><strong>Sovryn — DeFi de Bitcoin</strong></p>
        <ul style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li>Posiciones del protocolo Sovryn en la red Rootstock (RSK)</li>
        </ul>
        <p>Cada posición de Aave enlaza directamente a su mercado en la app de Aave, para que llegues a ella en un clic. Las posiciones son de solo lectura y se rastrean solo por dirección: Almstins nunca conecta tu wallet ni solicita permiso de firma. Si una posición DeFi no aparece, lo más probable es que esté en un protocolo o red que todavía no figura aquí.</p>`,
  },
  {
    id: "faq-defi-untracked",
    q: "¿Cómo registro cripto que presté o puse en staking en un protocolo que Almstins todavía no admite?",
    a: `<p>Almstins lee directamente un conjunto creciente de protocolos DeFi (Aave, Sovryn). Si tu posición está en uno que aún no cubrimos (muchos mercados de préstamos de Solana, por ejemplo), las monedas suelen estar <em>dentro</em> del protocolo en lugar de en tu wallet, así que no aparecerán en el snapshot de tu wallet. Aun así puedes mantenerlas correctas en tus libros:</p>
        <ol style="line-height: 1.8; margin: 0.5rem 0 1rem 1.25rem;">
          <li><strong>No vuelvas a ingresar la compra.</strong> Si compraste las monedas en un exchange, esa compra ya está importada desde tu CSV; agregarla de nuevo la contaría dos veces.</li>
          <li><strong>Marca la transferencia como tu propia wallet.</strong> En la página de Research, encuentra el retiro que movió las monedas del exchange al protocolo y márcalo como <em>Mi propia wallet</em>. Esto le dice a Almstins que fue un movimiento entre tus propias cuentas, no una venta, así que las monedas quedan como posición retenida con tu costo base real en lugar de contarse como una disposición.</li>
          <li><strong>Agrega una nota para encontrarla luego.</strong> En esa transacción, agrega una nota con el enlace de la app del protocolo y la dirección de tu wallet, para saber dónde están realmente las monedas.</li>
          <li><strong>Etiqueta la dirección de destino como wallet propia.</strong> En la página de Research, etiqueta la wallet a la que moviste las monedas como una de las tuyas. Las transferencias futuras a ella se clasificarán automáticamente con Auto-classify.</li>
        </ol>
        <p>Dos cosas a esperar. El panel de reconciliación mostrará una pequeña diferencia para esa moneda: tus libros dicen que la tienes, pero el snapshot de la wallet no puede verla dentro del protocolo. Eso es normal y no afecta tu costo base. Y la posición sigue siendo una ganancia o pérdida <em>no realizada</em> hasta que realmente retires y vendas; en ese momento, registra la venta como una disposición para realizarla.</p>
        <p><strong>Para que el cambio aparezca:</strong> después de reclasificar una transacción, tu costo base se actualiza en la próxima reconstrucción del ciclo de vida, que se ejecuta automáticamente al abrir la página de <strong>Bookkeeping</strong> o <strong>Portfolio</strong>, o al usar <strong>Fill Missing Prices</strong> en la página de Research. Ten en cuenta que <em>Re-run matching</em>, <em>Auto-classify</em> y el <em>Sync Tins</em> del Vault <em>no</em> activan la reconstrucción, así que abre Bookkeeping (o usa Fill Missing Prices) para ver aplicada la reclasificación.</p>`,
  },
  {
    id: "faq-now",
    q: "¿En qué estás trabajando ahora?",
    a: `<p>El rastreador de portafolio principal, el motor de bookkeeping y la página de Research están en vivo. Esto es lo que se está desarrollando activamente o planeando a continuación:</p>

        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Más importadores de exchanges.</strong> Los ocho exchanges que se soportan actualmente cubren a la mayoría de los usuarios de EE. UU., pero hay más por agregar. Bybit, OKX y Kraken Pro están en la lista. Si tu exchange no está soportado, usa la opción Flag for Support y se le dará prioridad.
          </li>
          <li>
            <strong>Relleno de precios históricos para transacciones más antiguas.</strong> El API gratuito de CoinGecko solo llega 365 días hacia atrás. Una API key de pago desbloquea el historial completo para transacciones de 2021 y anteriores. Esto se agregará como una mejora opcional para los usuarios con datos históricos profundos.
          </li>
          <li>
            <strong>Página de Research — anotación en lote.</strong> Actualmente anotas una transacción a la vez. El plan es permitir seleccionar varias transacciones y aplicar un tipo de disposición o nota a todas ellas en un solo paso.
          </li>
          <li>
            <strong>Resumen anual de ganancias/pérdidas.</strong> El motor de contabilidad clasifica cada transacción usando coincidencia de lots FIFO y organiza tus ganancias realizadas a corto y largo plazo en un resumen anual claro para entregar a tu contador. Mayor cobertura y equivalentes internacionales están en camino. Almstins organiza tus registros — no es software para declarar impuestos.
          </li>
          <li>
            <strong>Soporte de cadenas adicionales.</strong> Los wallets de Solana y Sui ya están en vivo. Cardano es el siguiente en la lista. La sincronización del historial de transacciones de Solana (más allá del saldo) está en progreso.
          </li>
          <li>
            <strong>Página de Events.</strong> Una vista de calendario de eventos significativos del portafolio — depósitos grandes, disposiciones, hitos de recompensas de staking. Actualmente desactivada en la navegación; próximamente.
          </li>
        </ol>`,
  },
  {
    id: "faq-tax",
    q: "¿Es este software para presentar declaraciones?",
    a: `<p>
          Almstins no es un servicio de preparación de impuestos y no presenta declaraciones en tu nombre. Lo que sí hace es organizar los datos subyacentes que tu contador o software de impuestos necesita — y para cripto, esos datos son genuinamente difíciles de reunir por cuenta propia.
        </p>

        <p>
          El motor de contabilidad clasifica cada transacción en todos tus exchanges y wallets conectados, ejecuta la coincidencia de lots FIFO para calcular el cost basis y marca todo lo que necesita tu atención (precios faltantes, transferencias sin coincidencia, activos prestados). Produce un <strong>resumen anual claro</strong> de tus ganancias realizadas a corto y largo plazo, ingresos y posiciones abiertas que puedes entregar directamente a tu contador o a su software de impuestos.
        </p>

        <p>
          Cuanto más completos sean tus datos importados, más preciso será el resultado. Cada CSV que subes y cada wallet que conectas mejora el panorama. El pipeline se vuelve más inteligente con el tiempo a medida que resuelves los elementos marcados.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>⚠️ Esto no es asesoría fiscal.</strong> Siempre verifica el resultado con un profesional de impuestos calificado antes de presentar. El tratamiento fiscal de las cripto varía según la jurisdicción y las circunstancias individuales.
        </p>`,
  },
  {
    id: "faq-wallet-vs-bookkeeping",
    q: "¿Por qué \"Still in Wallet\" es diferente de mi saldo en el Vault?",
    a: `<p>
          Estos dos números miden los mismos activos de maneras completamente distintas — y ambos son correctos. Esta es la diferencia:
        </p>

        <p>
          <strong>Vault — Valor de Mercado</strong><br />
          El Vault obtiene datos en vivo directamente de la blockchain en este momento. El valor en dólares que se muestra es lo que valen tus monedas <em>hoy</em> a los precios actuales del mercado. Si compraste Bitcoin en 2018 por $6,000 y ahora vale $90,000, el Vault muestra $90,000.
        </p>

        <p>
          <strong>Bookkeeping — Cost Basis</strong><br />
          "Still in Wallet" en la página de Bookkeeping muestra lo que <em>originalmente pagaste</em> por las monedas que aún no has vendido — tu cost basis. Usando el mismo ejemplo, mostraría $6,000 por ese Bitcoin. Este número importa para los impuestos: cuando finalmente vendas, tu ganancia gravable es la diferencia entre lo que la vendes y lo que pagaste (el cost basis).
        </p>

        <p>
          <strong>En resumen:</strong> Vault = valor de mercado actual de tu portafolio. Bookkeeping = lo que pagaste para construirlo. La brecha entre ambos es tu ganancia (o pérdida) no realizada.
        </p>`,
  },
  {
    id: "faq-erc20-zero",
    q: "Una transacción muestra $0 en el block explorer — ¿pero mi rastreador muestra $1,000?",
    a: `<p>
          No te estás volviendo loco, y el rastreador tampoco. Este es uno de los puntos de confusión más
          comunes en el bookkeeping de cripto, y se reduce a cómo
          los block explorers muestran las transferencias de tokens.
        </p>

        <p>
          <strong>¿Por qué Polyscan (o Etherscan) muestra $0?</strong><br />
          Cada transacción en una blockchain tiene un campo "Value" — pero ese campo solo
          rastrea la <em>moneda nativa</em> (MATIC, ETH, etc.). Cuando envías un token como
          USDC o USDT, el valor de la moneda nativa es literalmente cero porque no estás moviendo
          MATIC ni ETH. La transferencia real del token se registra por separado en los logs
          de la transacción. Para verla, haz clic en la pestaña <strong>"ERC-20 Token Txns"</strong> en la
          página de la transacción — ahí es donde aparecerán tus 1,000 USDC.
        </p>

        <p>
          <strong>¿Entonces el rastreador tiene razón?</strong><br />
          Sí. El rastreador lee los logs de transferencia del token directamente, así que registra correctamente
          la cantidad de USDC y su valor en dólares al momento de la transferencia. Los $1,000 que
          ves son reales — el block explorer simplemente te está mostrando el campo equivocado.
        </p>

        <p>
          <strong>¿Cómo lo quito de "Needs Attention"?</strong><br />
          Haz clic en <strong>Details →</strong> en el elemento. Verás un
          botón rápido <strong>💵 Stablecoin · $1.00</strong> — tócalo y presiona Save.
          Como pagaste $1.00 por USDC y recibiste $1.00 por USDC, la ganancia
          es efectivamente $0. El elemento desaparece de la lista y nada cambia en
          tu Year Summary.
        </p>

        <p>
          <strong>¿Qué pasa si el wallet de destino está marcado como estafa?</strong><br />
          Ese es un problema aparte — significa que tu USDC pudo haber sido enviado a un estafador
          (un truco común llamado "address poisoning"). La transferencia igual ocurrió y
          el rastreador sigue estando correcto. Lamentablemente, los tokens probablemente se perdieron. Para
          fines fiscales, establece el cost basis en $1.00 como arriba — la pérdida de los fondos
          puede ser deducible como pérdida por robo según tu jurisdicción, así que toma
          nota de ello y habla con tu contador.
        </p>`,
  },
  {
    id: "faq-borrowed-money",
    q: "Pedí dinero prestado a través de Aave — ¿cómo funciona eso en el bookkeeping?",
    a: `<p>
          Gran pregunta, y confunde a la gente todo el tiempo. La respuesta corta:
          <strong>el dinero prestado no es ingreso</strong>, y el rastreador ya lo sabe.
        </p>

        <p>
          <strong>Cuando pides prestado a Aave:</strong><br />
          Depositas colateral (digamos, ETH) y el protocolo te presta USDC contra él.
          Ese USDC llega a tu wallet como una transferencia entrante — pero es un
          <em>préstamo</em>, no una compra ni un regalo. El rastreador clasifica esto como un
          <strong>aumento de pasivo</strong> y lo omite por completo al construir tu
          cost basis. Nunca aparecerá como un lot de compra en "Still in Wallet" porque
          no lo compraste — lo debes devolver.
        </p>

        <p>
          <strong>¿Dónde aparece?</strong><br />
          En la página de Bookkeeping, desplázate hacia abajo a la sección <strong>🔷 DeFi Positions</strong>.
          Tu colateral (el ETH o USDC que depositaste) aparece en color teal marcado
          <em>AAVE</em>. Tu préstamo pendiente aparece en rojo marcado <em>DEBT</em>. Estos
          están separados de tus tenencias regulares de wallet a propósito — siguen
          reglas contables diferentes.
        </p>

        <p>
          <strong>Cuando pagas el préstamo:</strong><br />
          El USDC que envías de vuelta a Aave también se maneja automáticamente — se clasifica
          como un <strong>pago de pasivo</strong>. El rastreador consume el lot de costo de
          ese USDC (estás devolviendo algo que pediste prestado) pero no registra ninguna ganancia
          ni pérdida gravable, porque pagar un préstamo no es una venta.
        </p>

        <p>
          <strong>¿Qué hay del interés que estoy pagando?</strong><br />
          Aave cobra interés aumentando lentamente la cantidad que debes — el saldo de tu debt token
          crece con el tiempo. El rastreador rastrea esto, y el interés acumulado aparece
          en tu tin de DeFi Positions. Si el interés de Aave es deducible de impuestos depende de
          cómo usaste el préstamo (inversión vs. uso personal) y de tu ley fiscal local — habla
          con tu contador sobre eso.
        </p>

        <p>
          <strong>¿Qué pasa si me liquidan?</strong><br />
          Si el valor de tu colateral cae demasiado y Aave liquida tu posición, una
          porción de tu colateral se incauta para pagar parte de la deuda. Esto se trata
          como una <em>disposición</em> de tu colateral — lo que significa que puede ser un evento gravable.
          El rastreador mostrará esos eventos en la página de bookkeeping para que puedas darles
          tratamiento contable.
        </p>`,
  },
  {
    id: "faq-reconciliation",
    q: "¿Qué es la vista de Reconciliation?",
    a: `<p>
          La vista de Reconciliation es una herramienta de auditoría integrada que se ubica al final de tu
          página de Bookkeeping. Compara dos vistas independientes de tu portafolio lado a lado:
        </p>

        <ul>
          <li><strong>Lo que el tin cree que tienes</strong> — las monedas que quedan en tus lots FIFO de "Still in Wallet", calculadas a partir de cada transacción que hayas importado.</li>
          <li><strong>Lo que tus wallets y exchanges realmente muestran</strong> — saldos en vivo obtenidos directamente de tus wallets conectados y de las cargas de CSV de exchanges.</li>
        </ul>

        <p>
          Para cada moneda, muestra la diferencia tanto en cantidad como en valor estimado en dólares,
          y marca la gravedad con un color:
        </p>

        <ul>
          <li>✅ <strong>Balanced</strong> — dentro del 1%. Estás bien.</li>
          <li>⚠️ <strong>Over</strong> — tu saldo en vivo es mayor de lo que el tin espera. Usualmente significa que hay una entrada que el rastreador aún no conoce.</li>
          <li>🔴 <strong>Under</strong> — tu saldo en vivo es menor de lo esperado. Usualmente significa que no se subió un CSV, o que las monedas se movieron a algún lugar aún no conectado.</li>
          <li>🔴 <strong>Missing</strong> — el tin muestra monedas que deberías tener, pero el wallet muestra cero. Vale la pena investigar.</li>
          <li>⬜ <strong>Untracked</strong> — monedas que aparecen en tu wallet pero que no tienen ningún historial de transacciones en el sistema.</li>
        </ul>

        <p>
          <strong>¿Qué pasa si no puedo explicar una discrepancia?</strong><br />
          Haz clic en cualquier fila para expandirla. Verás la última fecha de transacción conocida, un desglose
          de qué wallets y exchanges están contribuyendo al saldo en vivo, y dos opciones:
        </p>

        <ul>
          <li><strong>Add a note</strong> — anota lo que crees que pasó para que lo recuerdes después.</li>
          <li><strong>Flag for support</strong> — marca esta casilla y a Donnie se le notificará directamente. Revisará tus datos y te dará seguimiento personalmente.</li>
        </ul>

        <p>
          Las causas más comunes de una discrepancia son un archivo CSV faltante, un exchange que
          aún no se ha conectado, o un hardware wallet que no se está rastreando. En la mayoría
          de los casos, subir los datos faltantes lo resuelve de inmediato.
        </p>

        <p>
          <em>Nota: la columna estimada Δ USD usa tu cost basis promedio como estimación de
          precio, no el precio actual de mercado. Es una guía aproximada, no una valoración en vivo.</em>
        </p>`,
  },
  {
    id: "faq-kraken-export",
    q: "¿Cómo exporto mi historial de Kraken?",
    a: `<p>
          Kraken ofrece dos exportaciones de CSV — asegúrate de tomar la correcta:
        </p>
        <ol style="margin: 0.75rem 0 0.75rem 1.25rem; line-height: 1.8;">
          <li>Inicia sesión en tu cuenta de Kraken</li>
          <li>Ve a <strong>Account</strong> → <strong>History</strong></li>
          <li>Haz clic en <strong>Ledgers</strong> (no Trades)</li>
          <li>Establece tu rango de fechas y haz clic en <strong>Export</strong></li>
          <li>Sube el CSV descargado a tu tin de Kraken aquí</li>
        </ol>
        <p>
          La exportación de <em>Ledgers</em> contiene cada depósito, retiro, intercambio y recompensa de
          staking en un solo archivo. La exportación de <em>Trades</em> solo cubre operaciones spot y no
          se importará correctamente.
        </p>`,
  },
  {
    id: "faq-pnl",
    q: "¿Qué es el número de P&L junto a Market Value?",
    a: `<p>
          El número que se muestra en verde o rojo junto a tu Market Value en el tile de Portfolio es tu <strong>ganancia o pérdida no realizada</strong> — cuánto estás arriba o abajo en las monedas que tienes actualmente.
        </p>

        <p>
          <strong>Cómo se calcula:</strong><br />
          Es la diferencia entre dos números:
        </p>

        <ul>
          <li><strong>Market Value</strong> — lo que valen tus monedas en este momento a los precios actuales (obtenido en vivo de la blockchain y de los saldos de exchange).</li>
          <li><strong>Cost Basis</strong> — lo que originalmente pagaste por las monedas que aún tienes, calculado usando coincidencia FIFO (first in, first out) en todas tus transacciones importadas.</li>
        </ul>

        <p>
          <strong>P&amp;L = Market Value − Cost Basis</strong>
        </p>

        <p>
          Si está en <span style="color: #86efac; font-weight: 600;">verde</span>, tu portafolio vale más de lo que pagaste — estás sentado sobre ganancias no realizadas. Si está en <span style="color: #fca5a5; font-weight: 600;">rojo</span>, tu valor de mercado actual está por debajo de lo que pagaste — lo tienes con una pérdida.
        </p>

        <p>
          <strong>"No realizada" significa que aún no has vendido.</strong> No ha ocurrido ningún evento fiscal. La ganancia o pérdida solo se vuelve real (y potencialmente gravable) cuando vendes, intercambias o dispones de las monedas de algún otro modo.
        </p>

        <p>
          Esta es la misma metodología de cost basis que se usa en la página de Bookkeeping bajo "Still in Wallet". Cuanto más completo sea tu historial de transacciones (cargas de CSV, wallets conectados), más preciso será este número.
        </p>`,
  },
  {
    id: "faq-sync",
    q: "¿Con qué frecuencia debo sincronizar mi portafolio?",
    a: `<p>
          Depende de qué tan actuales quieras que sean tus números. Esta es una guía práctica:
        </p>

        <ul>
          <li>
            <strong>Después de cada carga de CSV</strong> — cada vez que importes un nuevo archivo de exchange, presiona Sync justo después. Esto asegura que el tile de Portfolio refleje tus últimos saldos calculados de inmediato.
          </li>
          <li>
            <strong>Antes de tomar decisiones</strong> — si estás por intercambiar, rebalancear, o simplemente quieres ver dónde estás parado, sincroniza primero para que los números estén frescos.
          </li>
          <li>
            <strong>Semanalmente está bien para la mayoría de la gente</strong> — el tile de portfolio busca darte un panorama general, no un seguimiento tick por tick. Una vez por semana mantiene las cosas razonablemente al día sin ningún esfuerzo extra.
          </li>
        </ul>

        <p>
          <strong>Lo que realmente hace el botón Sync:</strong><br />
          Ejecuta tres cosas en secuencia:
        </p>
        <ol style="line-height: 1.9; margin: 0.5rem 0 1rem 1.25rem;">
          <li><strong>Recalcula los saldos de exchange</strong> — escribe un snapshot fresco a partir de todas tus transacciones de CSV importadas para que el tile de Portfolio muestre números actuales.</li>
          <li><strong>Actualiza los valores de wallets on-chain</strong> — obtiene los últimos saldos de tus wallets EVM conectados (Ethereum, Polygon, Avalanche, Arbitrum), wallets de Sui y wallets de Solana.</li>
          <li><strong>Reconstruye el motor de bookkeeping</strong> — vuelve a ejecutar el cálculo de cost basis FIFO en cada transacción que hayas importado, de cada fuente. Esto es lo que mantiene precisa la página de Bookkeeping después de una nueva carga de CSV. Si una moneda aparecía en "Needs Attention" porque faltaba un registro de compra, sincronizar después de subir el CSV correcto lo resolverá.</li>
        </ol>

        <p>
          <strong>Lo que no hace:</strong><br />
          Sincronizar no obtiene datos nuevos de tu exchange. Solo recalcula con base en lo que ya importaste. Si hiciste nuevas operaciones o depósitos, sube un CSV fresco primero, y luego sincroniza.
        </p>`,
  },
  {
    id: "faq-unauthorized",
    q: "¿Por qué mi importación de CSV dice \"Unauthorized\"?",
    a: `<p>
          Este error significa que la app no pudo verificar tu identidad cuando intentaste subir el archivo. Casi nunca es un problema con el CSV en sí. Estas son todas las causas conocidas:
        </p>

        <ol style="line-height: 2; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Tu sesión expiró.</strong> La causa más común. Si dejaste la pestaña abierta un rato sin actividad, tu sesión de login expiró. Cierra sesión, vuelve a iniciar sesión e intenta la carga de nuevo.
          </li>
          <li>
            <strong>Iniciaste sesión en la cuenta equivocada.</strong> Si tienes varias cuentas (una personal y una de negocios, por ejemplo), asegúrate de haber iniciado sesión en la correcta antes de subir.
          </li>
          <li>
            <strong>Interferencia del modo demo.</strong> Si estabas navegando el demo y luego iniciaste sesión, la sesión a veces se puede confundir. Cierra sesión por completo, borra las cookies de tu navegador para este sitio, y vuelve a iniciar sesión desde cero.
          </li>
          <li>
            <strong>El navegador bloqueó la cookie.</strong> Algunos navegadores en modo de privacidad estricto o con ciertas extensiones bloquean las cookies de sesión. Prueba con un navegador diferente o desactiva la protección contra rastreo para este sitio.
          </li>
          <li>
            <strong>Abriste la página de carga en una pestaña nueva.</strong> Las cookies de sesión pueden comportarse de manera diferente entre pestañas si abriste una pestaña nueva en lugar de navegar dentro de la app. Regresa a la app principal y navega hasta la carga desde ahí.
          </li>
          <li>
            <strong>El servidor se reinició a mitad de la sesión.</strong> Ocasionalmente, un despliegue o reinicio del servidor invalidará las sesiones activas. Cierra sesión y vuelve a iniciar sesión para obtener una sesión fresca.
          </li>
        </ol>

        <p>
          <strong>La solución en casi todos los casos:</strong> cierra sesión, vuelve a iniciar sesión e intenta de nuevo. Si el error persiste después de eso, usa la opción Flag for Support en la página de Reconciliation y Donnie lo investigará directamente.
        </p>`,
  },
  {
    id: "faq-earned-symbols",
    q: "¿Qué significan los símbolos ⚡ 🪂 🎓 ∞ junto a la antigüedad de mi moneda?",
    a: `<p>
          La columna <strong>Days</strong> en tu tin de exchange muestra hace cuánto adquiriste por última vez una moneda — lo que importa para determinar si una venta futura se gravaría como una ganancia de capital a corto o a largo plazo.
        </p>

        <p>
          Cuando una moneda fue <em>ganada o recibida</em> en lugar de comprada directamente, aparece un símbolo junto a la antigüedad (o en su lugar) para hacerte saber cómo ingresó:
        </p>

        <ul style="line-height: 2; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>⚡ Recompensa de staking</strong> — la moneda se ganó mediante staking, no se compró. La antigüedad que se muestra es la fecha de tu última compra real; el ingreso por staking no reinicia el reloj.</li>
          <li><strong>🪂 Airdrop</strong> — la moneda se recibió como un airdrop. La antigüedad refleja cuándo se recibió el airdrop.</li>
          <li><strong>🎓 Recompensa de aprendizaje</strong> — ganada a través de un programa de aprende y gana, como Coinbase Earn.</li>
          <li><strong>∞ Origen desconocido</strong> — no se encontró ningún registro de compra. La moneda probablemente se ganó, se regaló o se transfirió desde una fuente que el rastreador aún no ha visto.</li>
        </ul>

        <p>
          <strong>¿Por qué el staking no reinicia el reloj?</strong><br />
          El ingreso por staking llega como diminutos microdepósitos de manera regular. Si cada uno reiniciara tu temporizador del periodo de tenencia, una moneda que compraste hace años podría parecer tener solo unos días de antigüedad solo porque ganó una fracción de centavo de la noche a la mañana. Eso la descalificaría injustamente del tratamiento de ganancias de capital a largo plazo. El rastreador ignora intencionalmente el ingreso por staking al calcular el valor de Days para que se conserve la fecha original de tu compra.
        </p>

        <p>
          <strong>¿Ganar una moneda cambia mi situación fiscal?</strong><br />
          Sí — las monedas recibidas mediante staking, airdrops o programas de aprende y gana generalmente se tratan como <em>ingreso ordinario</em> al momento de la recepción (según su valor justo de mercado de ese día), no como una compra. Habla con tu contador sobre cómo reportarlas correctamente.
        </p>`,
  },
  {
    id: "faq-staked-coins",
    q: "¿Por qué mi tin de exchange muestra más monedas que mi saldo disponible?",
    a: `<p>
          La columna <strong>Coins</strong> en tu tin de exchange muestra tus tenencias <em>totales</em> — el saldo líquido más cualquier moneda que tengas bloqueada en staking. Tu exchange puede mostrar solo tu saldo "disponible", que excluye las monedas en staking.
        </p>

        <p>
          Por ejemplo: si tienes 0.11 ETH disponibles y 0.208 ETH en staking, el rastreador muestra 0.318 ETH porque todo es tuyo — solo está temporalmente bloqueado ganando recompensas.
        </p>

        <p>
          La línea <strong>🔒 Staked</strong> directamente debajo de la cantidad de monedas muestra la porción bloqueada por separado para que puedas ver exactamente cuánto es líquido frente a cuánto está en staking de un vistazo.
        </p>

        <p>
          <strong>¿Por qué importa esto para los impuestos?</strong><br />
          Las monedas en staking siguen siendo tu propiedad — solo que no puedes gastarlas hasta que termine el periodo de desbloqueo. Su cost basis y periodo de tenencia se mantienen desde cuando las compraste originalmente, así que el rastreador las mantiene en tu total en lugar de tratarlas como si ya no existieran.
        </p>`,
  },
  {
    id: "faq-account-identity",
    q: "¿Cómo está vinculada mi cuenta a mi dirección de correo electrónico?",
    a: `<p>
          Tu cuenta de Almstins tiene una única identidad verdadera: un ID permanente y único que nunca cambia. Tu dirección de correo electrónico es la llave que la desbloquea. No importa cómo inicies sesión — correo y contraseña, Google o GitHub — mientras el método de inicio de sesión pueda confirmar la misma dirección de correo, aterrizas en la misma cuenta cada vez.
        </p>

        <p>
          <strong>Cómo funciona paso a paso:</strong>
        </p>

        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>El primer inicio de sesión crea tu cuenta.</strong> En el momento en que inicias sesión por primera vez, el sistema crea un ID permanente vinculado a tu dirección de correo y aprovisiona una bóveda de datos privada (tu "tenant") solo para ti.
          </li>
          <li>
            <strong>Capa 1 — coincidencia de correo.</strong> Cada inicio de sesión posterior verifica si ese correo ya existe. Si te registraste con Google y luego intentas con GitHub, y ambos proveedores confirman el mismo correo, el sistema te reconoce y te lleva directo a tu bóveda existente. No se crea ninguna cuenta duplicada.
          </li>
          <li>
            <strong>Capa 2 — respaldo por ID del proveedor.</strong> En casos raros, un proveedor no devuelve ningún correo (por ejemplo, un usuario de GitHub con un correo privado antes de configurar los scopes adecuados). Cuando eso pasa, el sistema recurre a comparar el ID numérico de cuenta de tu proveedor contra nuestros registros. Si ya hemos visto ese ID de GitHub antes, te reunimos con tu cuenta automáticamente. Este es el respaldo — es seguro porque tu ID numérico de GitHub es único y solo tú puedes iniciar sesión con él.
          </li>
        </ol>

        <p>
          <strong>Qué significa esto en la práctica:</strong> puedes iniciar sesión desde un navegador nuevo, un dispositivo nuevo o un proveedor de OAuth nuevo y tus wallets, transacciones e historial fiscal estarán todos esperándote — porque tu dirección de correo es lo que une todo.
        </p>`,
  },
  {
    id: "faq-research-page",
    q: "¿Qué es la página de Research?",
    a: `<p>
          La página de Research es una herramienta de investigación dedicada para entender todo tu historial de transacciones en cada exchange y wallet que tengas conectado. Piensa en ella como un centro de mando — puedes buscar, identificar y resolver dudas sobre de dónde vinieron tus monedas y a dónde fueron.
        </p>

        <p>
          <strong>La página tiene dos paneles:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>
            <strong>Needs Attention (izquierda).</strong> Este panel muestra automáticamente las transacciones que están sin resolver — transferencias salientes sin ningún depósito coincidente en tu historial, y depósitos entrantes cuyo origen es desconocido. También muestra cualquier par de transferencias que el motor de coincidencia haya marcado para tu revisión. Nada aquí requiere que actúes de inmediato, pero trabajar a través de ello te da un panorama más limpio y completo de tus tenencias.
          </li>
          <li>
            <strong>Search Results (derecha).</strong> Un panel de búsqueda flexible te permite buscar transacciones por palabra clave, símbolo de moneda, rango de fechas o nota. También puedes hacer clic en cualquier fila del panel Needs Attention y el sistema rellena la búsqueda por ti — así investigar un depósito misterioso está a un clic de distancia.
          </li>
        </ul>

        <p>
          Los <strong>chips de símbolo</strong> corren a lo largo de la parte superior de la tarjeta de búsqueda. Hacer clic en una moneda carga al instante cada transacción de ese símbolo — una forma rápida de auditar un solo activo en todas tus fuentes a la vez.
        </p>

        <p>
          El botón <strong>Re-run Matching</strong> en la parte superior te permite activar el motor de coincidencia de transferencias manualmente en cualquier momento. Esto es útil después de importar nuevos archivos CSV para que cualquier transacción recién subida se compare de inmediato con tu historial existente.
        </p>

        <p>
          <strong>Búsqueda de direcciones.</strong> Pega cualquier dirección de blockchain en el campo de búsqueda y la página la identificará — mostrando si pertenece a uno de tus wallets rastreados, a un exchange conocido o a una dirección que tú mismo etiquetaste. Si aún no está en tu cuenta, puedes agregarla como un wallet rastreado y darle una etiqueta ahí mismo. También puedes marcar una dirección como perteneciente a un exchange específico, para que cada vez que aparezca en futuras transacciones se reconozca de inmediato en lugar de mostrarse como desconocida.
        </p>

        <p>
          La página de Research no cambia ninguno de tus datos de transacciones en bruto — solo muestra información y te permite etiquetar o confirmar relaciones entre los registros.
        </p>`,
  },
  {
    id: "faq-transfer-matching",
    q: "¿Cómo funciona la coincidencia de transferencias?",
    a: `<p>
          Cuando mueves monedas entre dos cuentas que te pertenecen — por ejemplo, retirando de Coinbase y depositando en Kraken — cada plataforma registra solo su mitad del movimiento. Tus importaciones de CSV mostrarán una transacción saliente en un lado y una transacción entrante en el otro, sin ningún enlace obvio entre ellas.
        </p>

        <p>
          El motor de coincidencia de transferencias encuentra automáticamente estos pares y los enlaza, para que tu portafolio no se cuente doble y tu historial cuente una historia coherente.
        </p>

        <p>
          <strong>Cómo califica una posible coincidencia:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Hash de transacción (100 pts) —</strong> si el retiro y el depósito comparten el mismo hash on-chain, es una coincidencia segura. No se necesitan más señales.</li>
          <li><strong>Dirección conocida (50 pts) —</strong> si la dirección de destino del retiro ya está registrada como perteneciente al exchange receptor, el motor otorga un crédito fuerte.</li>
          <li><strong>Coincidencia de monto (hasta 40 pts) —</strong> el monto recibido se compara con el monto enviado menos una comisión de red razonable. Los montos dentro del 1% entre sí obtienen el máximo. Los montos dentro del 2% aún obtienen crédito parcial.</li>
          <li><strong>Tiempo (hasta 30 pts) —</strong> el depósito debe llegar después del retiro. Los pares dentro de una hora obtienen el máximo; los pares dentro de 72 horas obtienen crédito parcial. Un depósito que llega antes del retiro se descalifica automáticamente.</li>
          <li><strong>Bono de monto exacto (10 pts) —</strong> se otorga cuando los montos enviado y recibido son idénticos hasta la moneda, común en transferencias en la misma red sin comisión.</li>
        </ul>

        <p>
          <strong>Qué pasa con el puntaje:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>90 pts o más —</strong> el par se empareja automática y silenciosamente. No se requiere acción.</li>
          <li><strong>60–89 pts —</strong> el par se empareja automáticamente pero se marca para que puedas revisarlo en la página de Research.</li>
          <li><strong>35–59 pts —</strong> el par aparece como una sugerencia en el panel Needs Attention. Puedes confirmarlo o rechazarlo con un clic.</li>
          <li><strong>Por debajo de 35 pts —</strong> el par no se registra. Ambas transacciones permanecen en el grupo de no resueltas.</li>
        </ul>

        <p>
          <strong>Tus datos en bruto nunca se modifican.</strong> Cada fila de CSV que subes se almacena exactamente como se importó y nunca cambia. Las coincidencias se almacenan por separado como anotaciones que enlazan dos IDs de transacción. Si rechazas una coincidencia o si el motor cometió un error, puedes descartarla y los registros originales quedan intactos.
        </p>

        <p>
          <strong>Las etiquetas de dirección se construyen automáticamente.</strong> Cuando se hace una coincidencia de confianza media o superior, el motor registra la conexión entre las dos cuentas. Las futuras importaciones de esas mismas fuentes se benefician de inmediato — la dirección ya es conocida, así que las coincidencias obtienen mayor puntaje y se resuelven más rápido.
        </p>

        <p>
          El motor se ejecuta automáticamente cada vez que importas un nuevo CSV, y también puedes activarlo manualmente desde la página de Research usando el botón Re-run Matching.
        </p>`,
  },
  {
    id: "faq-cost-basis-history",
    q: "¿Por qué el cost basis solo llega un año hacia atrás?",
    a: `<p>
          Para mostrarte cuánto valía una transacción en dólares estadounidenses el día en que ocurrió, Almstins busca el precio histórico de ese activo en CoinGecko — una de las fuentes de datos de precios más confiables de la industria. Esa búsqueda es lo que llena las cifras en dólares que ves junto a tus transacciones.
        </p>

        <p>
          <strong>El nivel gratuito tiene un límite de 365 días.</strong> El API público de CoinGecko solo permite consultas de precios históricos de hasta un año atrás. Pide un precio de hace dos años en el plan gratuito y la solicitud se rechaza. Esta es una restricción deliberada — CoinGecko cobra por un acceso más profundo porque mantener años de datos de precios limpios y con marca de tiempo en miles de activos es genuinamente costoso.
        </p>

        <p>
          <strong>Qué significa esto en la práctica:</strong> si importaste transacciones de 2021 o 2022, Almstins aún puede rastrear los montos y movimientos correctamente — solo que puede no ser capaz de adjuntar un valor histórico en dólares a esas filas más antiguas automáticamente. Cualquier exchange que haya incluido un valor en USD en su exportación de CSV (Crypto.com y Coinbase ambos lo hacen) ya tendrá la cifra correcta almacenada sin importar la antigüedad.
        </p>

        <p>
          <strong>Cómo desbloquear el historial completo:</strong> actualizar a una API key de CoinGecko Pro elimina la restricción de 365 días por completo y permite que Almstins ponga precio a cada transacción hasta el inicio del historial de operaciones de cada activo. Si manejas un portafolio grande con actividad significativa anterior a 2024, este es el camino recomendado. Contacta al administrador de tu cuenta o agrega <code>COINGECKO_API_KEY</code> a tu entorno para habilitarlo.
        </p>

        <p>
          <strong>¿Qué hay de la lista Needs Attention?</strong> Para los depósitos que son más antiguos que 2024 y que vinieron de exchanges que desde entonces han abandonado el mercado de EE. UU. — como Binance.US o Bittrex — puede que no haya ninguna transacción de contraparte coincidente disponible. Para esos casos, Almstins te permite etiquetar la transacción manualmente para explicar su origen. Una vez etiquetada, se elimina de la lista Needs Attention automáticamente. El límite de 2024 es intencional: cubre el periodo en que ocurrió la mayoría de las salidas de exchanges impulsadas por la regulación, mientras mantiene visibles los depósitos recientes sin explicar para que nada pase desapercibido.
        </p>`,
  },
  {
    id: "faq-annotate",
    q: "¿Cómo etiqueto una disposición — regalo, venta o moneda perdida?",
    a: `<p>
          No toda transacción saliente es una venta. La cripto puede salir de tu wallet como un regalo, una donación caritativa, un intercambio o una pérdida — y cada uno de esos se trata de manera diferente para fines fiscales. Almstins te permite etiquetar cualquier transacción con su tipo de disposición para que tus registros sean precisos y tu preparador de impuestos tenga todo lo que necesita.
        </p>

        <p><strong>Cómo anotar una transacción:</strong></p>
        <ol style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Ve a la página de <strong>Research</strong>.</li>
          <li>Encuentra la transacción en el panel <strong>Needs Attention</strong> o búscala en el panel derecho.</li>
          <li>Haz clic en el botón <strong>📝 Add note</strong> al final de la tarjeta de la transacción.</li>
          <li>Elige un tipo de disposición del menú desplegable y, opcionalmente, agrega una nota de texto libre.</li>
          <li>Haz clic en <strong>Save</strong>.</li>
        </ol>

        <p>La nota y la categoría se escriben directamente sobre el registro de la transacción, así que la siguen a todas partes donde aparezca — Bookkeeping, Research y cualquier exportación futura.</p>

        <p><strong>Tipos de disposición disponibles:</strong></p>
        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Sell</strong> — una venta directa por fiat o stablecoin. Aplica ganancia o pérdida de capital.</li>
          <li><strong>Trade (crypto → crypto)</strong> — intercambiar una criptomoneda por otra. También es una disposición gravable en EE. UU. — la ganancia o pérdida se calcula al momento del intercambio.</li>
          <li><strong>Gift out</strong> — cripto enviada a otra persona como regalo. No es un evento gravable para el remitente al momento del regalo, pero el destinatario hereda tu cost basis. Los regalos por encima del límite de exclusión anual ($18,000 en 2024) pueden requerir una declaración de impuesto sobre donaciones.</li>
          <li><strong>Gift in</strong> — cripto recibida como regalo. No es ingreso gravable. Tu cost basis es el cost basis original del donante.</li>
          <li><strong>Lost / stolen</strong> — monedas que son permanentemente inaccesibles. Que esto sea deducible como pérdida depende de tu jurisdicción y de cuándo ocurrió. Consulta a un profesional de impuestos.</li>
          <li><strong>Donation</strong> — cripto enviada a una organización benéfica registrada. Si se tuvo por más de un año, puedes deducir el valor justo de mercado al momento de la donación sin reconocer una ganancia de capital. Si se tuvo por menos de un año, la deducción se limita a tu cost basis.</li>
          <li><strong>Other / explained</strong> — para cualquier cosa que no encaje en las categorías anteriores. Usa la nota de texto libre para describirlo.</li>
        </ul>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>⚠️ Esto no es asesoría fiscal.</strong> Almstins te ayuda a organizar y etiquetar tu historial de transacciones — no presenta declaraciones ni proporciona orientación legal o fiscal. El tratamiento fiscal de las cripto varía según la jurisdicción y las circunstancias individuales. Siempre consulta a un profesional de impuestos calificado antes de tomar decisiones con base en estos datos.
        </p>`,
  },
  {
    id: "faq-custodial-address",
    q: "Si un exchange envía cripto desde una dirección, ¿esa dirección me pertenece?",
    a: `<p>
          No necesariamente. Cuando un exchange como Venmo, Coinbase o Kraken te envía cripto, la transacción se origina desde <em>su</em> wallet — no el tuyo. Los exchanges juntan los fondos de miles de usuarios en hot wallets compartidos. La dirección en el campo "From" pertenece a la infraestructura del exchange, no a tu cuenta personal.
        </p>

        <p>
          Hay dos formas fundamentalmente diferentes de tener cripto:
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Custodial (cuentas de exchange)</strong> — el exchange tiene tus private keys. Tienes un saldo en su sistema y ellos mueven los fondos en tu nombre. Las direcciones on-chain les pertenecen a ellos. Venmo, Coinbase, Kraken y Gemini funcionan todos de esta manera.</li>
          <li><strong>Self-custody (tu propio wallet)</strong> — tú tienes las private keys. La dirección es tuya y solo tuya. Nadie más puede enviar desde ella. MetaMask, los hardware wallets (Ledger, Trezor) y herramientas similares funcionan de esta manera.</li>
        </ul>

        <p>
          Esto importa al usar la búsqueda de direcciones de la página de Research. Si pegas una dirección de una transacción de exchange, verás la actividad de <em>ese exchange</em> — todas las transferencias dentro y fuera de su grupo compartido — no solo tu historial personal. Para rastrear tus propios fondos con precisión, usa las direcciones de los wallets que controlas personalmente.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Tip:</strong> Si recibiste cripto a través de Venmo y luego la vendiste, tu transacción se registra en el ledger interno de Venmo. La dirección on-chain es solo su backend — rastrearla no mostrará tu saldo personal.
        </p>`,
  },
  {
    id: "faq-address-labels",
    q: "¿Cómo funciona el Address Book?",
    a: `<p>
          Cuando el dinero se mueve en una blockchain, se mueve entre direcciones — largas cadenas de letras y números como <code style="font-size: 0.82em; background: rgba(255,255,255,0.08); padding: 0.1rem 0.35rem; border-radius: 4px;">0x794a61…</code>. Por sí solas, esas direcciones no significan nada. El Address Book es cómo las conviertes en nombres como <strong>"Aave V3 Pool · Ethereum"</strong> o <strong>"Crypto.com Deposit"</strong> — para que en todas partes donde aparezca una dirección en tu historial, veas un nombre en su lugar.
        </p>

        <p>
          El Address Book vive en la página de <strong>Addresses</strong>. Estos <em>no</em> son wallets que posees — son contrapartes: exchanges, protocolos DeFi, bridges o wallets de otras personas que aparecen en tu historial de transacciones.
        </p>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Cómo se llena el libro</h2>

        <p>Hay tres formas en que una dirección termina etiquetada:</p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Contratos pre-cargados</strong> — direcciones de protocolos DeFi bien conocidos (Aave V3 en Ethereum, Polygon y Avalanche) vienen pre-etiquetadas. No necesitas agregarlas tú mismo.</li>
          <li><strong>Entrada manual</strong> — escribe o pega una dirección, dale un nombre, elige una categoría (Exchange, DeFi Protocol, Personal Wallet, Bridge, etc.) y opcionalmente una cadena. Presiona Save.</li>
          <li><strong>📷 Scan Screenshot</strong> — algunos exchanges (como Crypto.com) no te dejan copiar las direcciones de wallet. Toma una captura de pantalla de la dirección en tu teléfono o computadora, súbela con el botón Scan Screenshot, y Claude Vision lee la dirección de la imagen y rellena el formulario por ti automáticamente.</li>
        </ul>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Cómo se conecta con las transacciones misteriosas</h2>

        <p>
          Cada transacción en tu historial tiene una <strong>dirección de origen</strong> y una <strong>dirección de destino</strong>. Cuando una de esas direcciones está en tu Address Book, Almstins muestra el nombre en lugar del hex en bruto — en el cajón de la transacción, en el panel Needs Attention y en cualquier lugar donde aparezcan direcciones en tu historial.
        </p>

        <p>
          Esto es especialmente útil para los elementos de <strong>Needs Attention</strong> — transacciones que no se pudieron clasificar automáticamente. Si la dirección de la contraparte está etiquetada como "Aave V3 Pool · Polygon", sabes de inmediato que esto fue un depósito o retiro de DeFi en lugar de una transferencia desconocida misteriosa. Ese contexto te ayuda a decidir la clasificación correcta rápidamente.
        </p>

        <p style="background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 0.5rem;">
          <strong>Tip:</strong> Cuantas más direcciones etiquetes, menos transacciones misteriosas tendrás. Empieza con las direcciones de depósito de tus exchanges — esas son la fuente más común de transferencias sin resolver.
        </p>

        <h2 style="font-size: 1rem; margin: 1.25rem 0 0.5rem;">Etiquetas comunitarias</h2>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Cada vez que guardas una etiqueta, se registra un voto comunitario silencioso en segundo plano.</li>
          <li>Cuando 3 usuarios etiquetan de forma independiente la misma dirección de la misma manera, se convierte en una <strong>etiqueta global</strong> visible para todos en la plataforma.</li>
          <li>Si 5 usuarios luego coinciden en un nombre diferente, la etiqueta global se corrige automáticamente.</li>
          <li>Tu etiqueta personal siempre tiene prioridad sobre una etiqueta comunitaria si no coinciden.</li>
        </ul>`,
  },
  {
    id: "faq-recognized-tokens",
    q: "¿Qué tokens reciben precio y se reconocen automáticamente?",
    a: `<p>
          Almstins mantiene una lista de tokens conocidos y verificados. Los tokens en esta lista obtienen un precio en vivo, aparecen correctamente en tus páginas de Vault y Bookkeeping, y nunca se marcan como posible spam — sin importar en qué wallet aparezcan.
        </p>

        <p><strong>Tokens reconocidos actualmente:</strong></p>

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
          Las variantes wrapped y bridged (WETH, WBTC, WAVAX, etc.) se mapean automáticamente a su activo subyacente para el precio — así que tus tokens wrapped muestran el valor de mercado correcto sin ninguna configuración manual.
        </p>

        <p style="background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 0.5rem;">
          <strong>¿No ves tu token?</strong> Cualquier token que no esté en esta lista aparecerá sin precio en tu Vault. Esto es intencional — los contratos no verificados son un vector común de airdrops de spam. Si tienes un token legítimo que falta, usa la opción <em>Flag for Support</em> y se revisará para agregarlo.
        </p>`,
  },
  {
    id: "faq-health-alerts",
    q: "¿Cómo funcionan las alertas de health factor de Aave?",
    a: `<p>
          Si tienes un préstamo activo de Aave, tu <strong>health factor</strong> es el número más importante que debes vigilar. Mide qué tan seguramente tu colateral cubre tu deuda. Cuando cae demasiado cerca de 1.0, Aave puede liquidar tu colateral para pagar el préstamo — lo que usualmente sucede a un mal precio para ti.
        </p>

        <p>
          Almstins revisa tu health factor cada 30 minutos y te envía un correo en el momento en que cruza un umbral que tú estableces. Tú eliges:
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li><strong>Dirección</strong> — alerta cuando el health factor cae <em>por debajo</em> de tu umbral (lo más común) o sube <em>por encima</em> de él.</li>
          <li><strong>Umbral</strong> — el número que activa la alerta. Un valor de 1.5 es un nivel razonable de advertencia temprana; mucha gente establece una segunda alerta en 1.2 como advertencia final.</li>
        </ul>

        <p>
          Para establecer una alerta, abre cualquier posición DeFi de Aave en tu página de Vault y haz clic en la píldora <strong>🔔 Set Alert</strong> junto a tu health factor. Una vez activa, la píldora se pone amarilla y muestra tu configuración actual — por ejemplo, <strong>🔔 HF &lt; 1.5</strong>.
        </p>

        <p>
          Las alertas se envían a tu <strong>correo de alertas</strong>, que puede ser diferente del correo de login de tu cuenta. Puedes establecerlo o cambiarlo en el menú <strong>Account</strong> en la parte superior de cualquier página. Si no se ha establecido un correo de alertas, la píldora te pedirá que agregues uno antes de que la alerta pueda activarse.
        </p>

        <p style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Límite de frecuencia:</strong> Para evitar saturar la bandeja de entrada, las alertas se envían como máximo una vez cada 4 horas por wallet, incluso si tu health factor permanece por debajo del umbral todo el tiempo. Una vez que la situación se resuelve y el health factor se recupera, el reloj se reinicia.
        </p>`,
  },
  {
    id: "faq-reconciliation-delta",
    q: "¿Por qué mi reconciliación mensual muestra un delta incluso cuando nada salió mal?",
    a: `<p>
          La chequera mensual trabaja en <strong>montos en dólares</strong> — el saldo inicial, las entradas, las salidas y el saldo final están todos en USD. Eso significa que incluso un mes perfectamente limpio con cero transacciones faltantes mostrará un delta, porque el valor en dólares de tus monedas cambia con el mercado cada día.
        </p>

        <p>
          <strong>Ejemplo:</strong> Abres enero con $10,000 en Bitcoin. No compras nada, no vendes nada y no mueves nada. Pero Bitcoin sube 20% durante el mes. Tu saldo final es $12,000. La fórmula de la chequera dice:
        </p>

        <blockquote style="background: rgba(255,255,255,0.05); border-left: 3px solid #e8a020; padding: 0.75rem 1rem; margin: 0.75rem 0; border-radius: 0 8px 8px 0;">
          Cierre esperado = $10,000 + $0 − $0 = $10,000<br />
          Cierre real = $12,000<br />
          Delta = +$2,000
        </blockquote>

        <p>
          Ese delta de $2,000 no es un problema. Es apreciación no realizada — exactamente lo que quieres ver. La chequera basada en dólares no puede distinguir entre "las monedas aparecieron de la nada" y "las monedas que ya tenías se volvieron más valiosas".
        </p>

        <p>
          <strong>La forma correcta de verificar si faltan datos es contar monedas, no dólares.</strong>
        </p>

        <p>
          Si tenías 0.10 BTC al inicio del mes, no compraste nada, no vendiste nada y sigues teniendo 0.10 BTC al final — los libros cuadran perfectamente sin importar el precio. Una reconciliación por cantidad de monedas es inmune a los movimientos del mercado porque el precio no afecta cuántas monedas posees.
        </p>

        <p>
          <strong>Cómo usar esto en la práctica:</strong>
        </p>

        <ul style="line-height: 1.9; margin: 0.75rem 0 0.75rem 1.25rem;">
          <li>Un <strong>delta en dólares</strong> en un mes tranquilo es casi siempre apreciación o depreciación de precio. Normal.</li>
          <li>Una <strong>discrepancia en el conteo de monedas</strong> — donde tu cantidad esperada y tu cantidad real no coinciden — siempre significa que algo falta: una transacción no se importó, una transferencia perdió un lado, o un exchange aún no está conectado.</li>
          <li>La <strong>vista de Reconciliation</strong> en la página de Bookkeeping trabaja en cantidades de monedas exactamente por esta razón. Úsala para encontrar huecos en los datos. Usa la chequera mensual para ver las tendencias de flujo de efectivo a lo largo del tiempo.</li>
          <li>Si tu delta en dólares es grande y <em>negativo</em> en un mes en que los precios estuvieron estables o al alza, eso vale la pena investigar — sugiere que salieron monedas de tu portafolio sin un registro de transacción coincidente.</li>
        </ul>

        <p>
          La chequera mensual también rastrea por separado las <strong>mitades de transferencias sin coincidencia</strong> — transacciones clasificadas como transferencias que no tienen contraparte coincidente en tus datos. Esas se marcan con una advertencia y se desglosan por activo para que puedas rastrear exactamente qué transacción desapareció.
        </p>`,
  },
  {
    id: "faq-api-public",
    q: "¿Puedo llamar a las verificaciones de seguridad de Almstins desde mi propio script o agente?",
    a: `<p>
          Sí. Tres endpoints están abiertos al público sin necesidad de iniciar sesión:
        </p>
        <ul>
          <li><strong>GET /api/wallet-check?address=</strong> — verifica una dirección cripto contra listas negras, sanciones, vínculos con la dark web, tokens honeypot, antigüedad de la cartera y más. También acepta POST con cuerpo JSON.</li>
          <li><strong>GET /api/dapp-check?url=</strong> — comprueba una URL o dominio de dApp contra MetaMask, ScamSniffer, GoPlus, URLScan y otras bases de datos de phishing.</li>
          <li><strong>GET /api/verify/lookup?address=</strong> — indica si una dirección tiene un publicador verificado en Almstins Verify y qué dominio la publicó.</li>
        </ul>
        <p>
          Los tres devuelven JSON e incluyen cabeceras CORS, por lo que pueden llamarse desde un navegador, un script o un agente de IA. Las llamadas sin autenticación están limitadas a 10 solicitudes por minuto por IP. Para aumentarlo a 60 por minuto, genera una clave de API desde la sección <strong>Claves de API</strong> al final del <a href="/dashboard/verify">panel de Verify</a> y pásala en la cabecera <code>X-Api-Key</code>.
        </p>
        <p>
          La documentación completa de solicitudes/respuestas, definiciones de campos y códigos de error está en <a href="/api-docs">almstins.com/api-docs</a>.
        </p>`,
  },
  {
    id: "faq-verify-self-send",
    q: "¿Cómo demuestro que soy dueño de una dirección en Almstins Verify?",
    a: `<p>
          El método de auto-envío funciona sin un sitio web ni conexión de wallet. En el panel de Verify, registra tu dirección y luego envía cualquier transacción saliente desde ella — incluso una cantidad mínima a ti mismo. Almstins observa la cadena pública y marca la dirección como Verificada una vez que detecta actividad después de emitir el desafío.
        </p>
        <p>
          Nada se conecta a Almstins y nada se firma para nosotros. La única prueba que cuenta es enviar <em>desde</em> la dirección, lo cual solo puede hacer quien tenga la clave privada. Una vez verificada, cada dirección obtiene un código QR descargable que puedes imprimir, agregar a una factura o poner en una página de pago para que los clientes confirmen que la dirección es tuya antes de pagar.
        </p>
        <p>
          Una dirección solo puede ser reclamada por una cuenta. Si intentas reclamar una dirección que ya está verificada por otra cuenta, la verificación falla. El escáner público en <a href="/verify/scan">almstins.com/verify/scan</a> muestra si una dirección está verificada y por quién antes de que se muevan los fondos.
        </p>
        <p>
          La prueba de auto-envío está disponible para direcciones de Ethereum, Polygon, Avalanche, Bitcoin, Litecoin y Solana.
        </p>`,
  },
  {
    id: "faq-verify-domain",
    q: "Tengo un sitio web. ¿Puedo verificar mis direcciones usando mi dominio en lugar de enviar una transacción?",
    a: `<p>
          Sí. En el panel de Verify, abre el panel Prove para cualquier destino de dirección y cambia a la pestaña Dominio. Ingresa tu dominio y Almstins genera un pequeño archivo JSON con un token de desafío único. Súbelo a tu servidor web en <code>/.well-known/almstins-verify.json</code> y haz clic en Verificar. Almstins obtiene el archivo, verifica que el desafío coincida y adjunta tu dominio como el publicador verificado de esa dirección.
        </p>
        <p>
          Si prefieres DNS en lugar de un archivo, también puedes agregar un registro TXT a tu dominio. El panel muestra ambas opciones una al lado de la otra — usa la que sea más fácil con tu configuración de hosting.
        </p>
        <p>
          Una dirección verificada por dominio muestra "verificada por tudominio.com" en el escáner público en lugar de solo "verificada." Esta es la señal más sólida para empresas — vincula la dirección a un dominio que demuestras controlar.
        </p>`,
  },
  {
    id: "faq-verify-exchange",
    q: "Gestiono un exchange o servicio de pagos. ¿Puedo publicar todas nuestras direcciones de depósito como verificadas?",
    a: `<p>
          Sí, a través de la ruta de Entidad Verificada en el panel de Verify. Funciona en dos pasos:
        </p>
        <ol>
          <li><strong>Verifica tu dominio.</strong> Sube el archivo de desafío de Almstins a <code>/.well-known/almstins-verify.json</code> en tu dominio (o agrega el registro TXT DNS). Almstins lo obtiene y confirma que controlas el dominio.</li>
          <li><strong>Conecta un endpoint de dirección en vivo.</strong> Una vez verificado tu dominio, pega un endpoint HTTPS en ese mismo dominio y una API key de solo lectura. Almstins llama al endpoint periódicamente, lee tu lista actual de direcciones y las refleja como "verificadas por tudominio.com" en el escáner público.</li>
        </ol>
        <p>
          Tu endpoint solo necesita devolver un array JSON de objetos de dirección — Almstins se encarga del polling y la replicación. El endpoint debe estar en el mismo dominio (o subdominio) que verificaste, para que la raíz de confianza sea tu dominio, no una afirmación tomada como verdad.
        </p>
        <p>
          Los exchanges no pueden usar el método de auto-envío porque las direcciones de depósito son controladas por la plataforma — el exchange mismo tiene las claves privadas, no el usuario. La ruta de dominio más endpoint existe específicamente para este caso: una institución que avala sus propias direcciones publicándolas desde infraestructura que demuestra controlar.
        </p>
        <p>
          La API key se almacena cifrada y solo se usa para obtener la lista de direcciones. Almstins nunca almacena ni transmite valor en tu nombre. Esta es una integración de solo lectura, consistente con la arquitectura sin custodia.
        </p>`,
  },
  {
    id: "faq-tron-safety",
    q: "¿El verificador de wallets funciona para direcciones TRON?",
    a: `<p>
          Sí. Las direcciones TRON (que comienzan con <strong>T</strong>, 34 caracteres) reciben verificaciones de seguridad completas:
        </p>
        <ul>
          <li><strong>Lista negra de GoPlus</strong> — cruzada con la base de datos global de GoPlus Security usando la cadena TRON, que cubre direcciones de estafas, phishing y drenadores reportadas en TRON.</li>
          <li><strong>Reportes comunitarios de Chainabuse</strong> — cualquier reporte de fraude enviado por la comunidad vinculado a la dirección.</li>
          <li><strong>Antigüedad del wallet</strong> — las direcciones creadas en los últimos 30 días se marcan; los wallets muy nuevos son una señal común en estafas de ingeniería social.</li>
          <li><strong>Tenencias de tokens TRC-20</strong> — la pestaña Holdings muestra el saldo de TRX y los principales tokens TRC-20 de la dirección (USDT, USDC y otros).</li>
        </ul>
        <p>
          TRON es una de las cadenas más comunes para fraudes cripto y operaciones de estafa, especialmente USDT (TRC-20). Si alguien te da una dirección TRON y te pide enviar USDT, verifícala primero.
        </p>
        <p>
          <strong>Una advertencia importante que el verificador siempre muestra:</strong> una dirección TRON solo puede recibir activos nativos de TRON (TRX, USDT-TRC20, etc.). Enviar ETH, BTC, SOL o cualquier token EVM a una dirección TRON significa que esos fondos se pierden permanentemente. El verificador muestra esta advertencia en cada resultado de TRON.
        </p>`,
  },
  {
    id: "faq-chain-recognition",
    q: "El verificador reconoció mi dirección de XRP / Dogecoin / Cardano / Cosmos pero dice que no hay datos — ¿por qué?",
    a: `<p>
          El verificador de wallets puede detectar direcciones de varias cadenas más allá de Ethereum, Bitcoin, Solana, Litecoin, Sui y TRON. Cuando pegas una dirección de XRP, Dogecoin, Cardano o Cosmos, identifica a qué cadena pertenece y muestra la insignia de cadena correcta — así al menos sabes que pegaste el tipo correcto de dirección.
        </p>
        <p>
          Las verificaciones completas de bases de datos de seguridad (listas negras, reportes de estafas, antigüedad del wallet, tenencias de tokens) aún no están disponibles para esas cuatro cadenas. Ampliar la cobertura de seguridad a ellas está en el roadmap.
        </p>
        <p>
          Lo más importante que la etiqueta evita: pegar una dirección de Dogecoin y que el verificador reporte "dirección inválida" — lo que podría hacerte pensar que escribiste algo mal cuando la dirección es perfectamente válida. Saber a qué cadena pertenece una dirección también ayuda a evitar el error de envío entre cadenas descrito más abajo.
        </p>`,
  },
  {
    id: "faq-wallet-error",
    q: "Un tin de wallet muestra un error y un ref code — ¿qué significa eso?",
    a: `<p>
          La app no pudo recuperar los datos de saldo de este wallet — usualmente un problema temporal de red o de servicio. No podemos confirmar tu saldo actual hasta que se restablezca la conexión. Usa Try again, o revisa un block explorer directamente para una confirmación en tiempo real.
        </p>

        <p>
          <strong>Qué es el ref code:</strong><br />
          El código corto que ves (por ejemplo <code style="font-size: 0.85em; background: rgba(255,255,255,0.08); padding: 0.1rem 0.4rem; border-radius: 4px;">FA5B-1K2M9</code>) es un ID de incidente único generado en el momento en que ocurrió el error. Codifica qué wallet falló y cuándo, de modo que si contactas a soporte, podemos encontrar la falla exacta en los logs sin necesidad de hacerte una docena de preguntas.
        </p>

        <p>
          <strong>Qué hacer primero — intenta de nuevo:</strong><br />
          Haz clic en el botón <strong>Try again</strong> directamente en el tin. La mayoría de los errores son transitorios (el API ascendente estuvo brevemente inaccesible) y se resuelven en el siguiente intento. Si el saldo carga correctamente, ya está.
        </p>

        <p>
          <strong>Si el error sigue volviendo:</strong><br />
          Ya se ha enviado una alerta automáticamente — no necesitas reportarlo manualmente. Si quieres dar seguimiento, escribe a <a href="mailto:hello@almstins.com">hello@almstins.com</a> e incluye el ref code. Ese código es la forma más rápida de rastrear exactamente qué falló.
        </p>

        <p style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); border-radius: 10px; padding: 0.9rem 1rem; margin-top: 1rem;">
          <strong>Nota:</strong> El ref code es de seleccionar con un clic — tócalo o haz clic en él una vez para resaltar todo el código, luego cópialo antes de contactarnos.
        </p>`,
  },
  {
    id: "faq-ai-chat",
    q: "¿Qué es el Asistente de Portafolio y qué puedo preguntarle?",
    a: `<p>
          El Asistente de Portafolio es un botón de chat flotante (etiquetado como <strong>✦ Ask AI</strong>) en las páginas de Research y Bookkeeping. Te permite hacer preguntas en lenguaje natural sobre los datos de tu propio portafolio — tus tenencias, transacciones recientes, costo base y más — sin tener que buscar manualmente en el libro mayor.
        </p>

        <p><strong>Preguntas de ejemplo:</strong></p>
        <ul>
          <li>"¿Cuál es mi mayor tenencia por valor?"</li>
          <li>"¿Cuánto ETH he recibido este año?"</li>
          <li>"¿Qué transacciones siguen sin clasificar?"</li>
          <li>"¿Cuánto pagué en promedio por SOL?"</li>
        </ul>

        <p>
          <strong>Lo que no puede hacer:</strong> El asistente no da consejos financieros ni fiscales, no puede hacer cambios en tus datos y no tiene acceso a la cuenta de ningún otro usuario. Responde preguntas sobre lo que muestran los datos — las decisiones son tuyas.
        </p>

        <p><strong>Límites mensuales de preguntas por plan:</strong></p>
        <ul>
          <li><strong>Free</strong> — 5 preguntas por mes</li>
          <li><strong>Starter</strong> — 30 preguntas por mes</li>
          <li><strong>Pro</strong> — 150 preguntas por mes</li>
          <li><strong>Unlimited</strong> — sin límite</li>
        </ul>

        <p>
          Los límites se reinician automáticamente el primero de cada mes. El indicador en el botón Ask AI muestra cuántas preguntas te quedan este mes. Si alcanzas el límite, el campo de entrada es reemplazado por un enlace de actualización.
        </p>

        <p>
          <strong>Privacidad:</strong> Cada pregunta envía un resumen de tu historial de transacciones y tenencias actuales a Anthropic (Claude Haiku) para generar la respuesta. El resumen está limitado únicamente a tu cuenta — los datos de ningún otro usuario son incluidos. Anthropic no conserva las entradas de la API más allá de la solicitud inmediata. Las preguntas no son almacenadas ni revisadas por Almstins.
        </p>`,
  },
];
