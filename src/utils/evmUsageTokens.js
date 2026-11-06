// EVM kullanim yoklamasinin SABIT token listesi (evmUsageProbe.js icin).
//
// KULLANICI KARARI (2026-11-03, "bulunsun"): seed import'unda yalniz token almis, hic islem
// yapmamis bir hesap (nonce 0, yerli bakiye 0, ama ornegin USDT bakiyesi > 0) da KULLANILMIS
// sayilir ve cuzdana eklenir. Bu liste "hangi tokenlere bakilir" sorusunun TEK cevabidir.
//
// NEDEN SABIT LISTE (rastgele token taramasi DEGIL): herkes herhangi bir adrese bir airdrop/
// spam token yollayabilir. Bakiyeye bakilan tokenler bilinen, deger tasiyan varliklarla
// sinirli olmazsa, hic kullanilmamis bos hesaplar da "kullanilmis" gorunur ve cuzdana
// gereksiz hesap eklenirdi. Liste bu yuzden elle secilmis ve testle KILITLIDIR
// (evmUsageTokens.test.js): bir token eklemek/cikarmak bilincli bir karardir.
//
// KAYNAK (adres UYDURULMADI; hepsi depodaki veriden):
//   - Stabil coinler (USDT/USDC/DAI/USDC.e/USDbC/USDe/USDm): utils/swapChains.js
//     `intermediates` -- 2026-08-18'de zincirden iki kez bagimsiz dogrulanmis adresler.
//   - ATS (BSC): data/imported_tokens.json, yani cuzdanin varsayilan token tohumu
//     (utils/defaultTokenSeed.js'in sunucudan alip yazdigi liste ile ayni veri).
//   - Varsayilan tohumdaki USDT (Ethereum) de burada: stabil listesiyle ortusur.
// Sarmalanmis yerli tokenler (WETH/WBNB/WPOL...) YOK: yerli bakiye zaten
// eth_getBalance ile kontrol edilir.
//
// RPC MALIYETI: ag basina EN COK BIR ek cagri. Tum balanceOf'lar Multicall3.aggregate3
// (allowFailure=true) ile TEK eth_call'da sorulur (bkz. multicallBalances.js). Bu yuzden
// ag basina token sayisi kucuk tutulur (en cok 6).
//
// MULTICALL3: 0xcA11...CA11 tum EVM aglarinda ayni adreste. 10 agin hepsinde `eth_getCode`
// ile (genel RPC'ler, salt-okuma) kod varligi 2026-11-03'te dogrulandi (3808 bayt, hepsi
// ayni). Dogrulanmamis bir ag icin `usageTokenAddressesFor` bos doner ve o agda token
// yoklamasi ATLANIR (tek tek balanceOf ile cagri sinirini asmaktansa sinyal yok sayilir).

// Kanonik Multicall3 adresi (EIP-55).
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

// Multicall3 kodunun varligi eth_getCode ile dogrulanan zincirler (2026-11-03).
export const MULTICALL3_CHAIN_IDS = Object.freeze([1, 56, 10, 100, 42220, 5000, 8453, 25, 42161, 137])

// Ag basina ust sinir: tek eth_call'in gaz/boyut maliyetini ve test kilidini sinirlar.
export const MAX_USAGE_TOKENS_PER_CHAIN = 6

const tok = (symbol, address) => Object.freeze({ symbol, address })
const list = (...tokens) => Object.freeze(tokens)

export const EVM_USAGE_TOKENS = Object.freeze({
    // Ethereum
    1: list(
        tok('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
        tok('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
        tok('DAI', '0x6B175474E89094C44Da98b954EedeAC495271d0F')
    ),
    // BNB Smart Chain
    56: list(
        tok('ATS', '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'),
        tok('USDT', '0x55d398326f99059fF775485246999027B3197955'),
        tok('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')
    ),
    // Optimism
    10: list(
        tok('USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
        tok('USDT', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'),
        tok('DAI', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1')
    ),
    // Gnosis
    100: list(
        tok('USDC', '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83'),
        tok('USDT', '0x4ECaBa5870353805a9F068101A40E0f32ed605C6')
    ),
    // Celo
    42220: list(
        tok('USDT', '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e'),
        tok('USDm', '0x765DE816845861e75A25fCA122bb6898B8B1282a'), // Mento dolari
        tok('USDC', '0xcebA9300f2b948710d2653dD7B07f33A8B32118C')
    ),
    // Mantle
    5000: list(
        tok('USDT', '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE'),
        tok('USDC', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9'),
        tok('USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34')
    ),
    // Base
    8453: list(
        tok('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
        tok('USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'),
        tok('USDbC', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA')
    ),
    // Cronos
    25: list(
        tok('USDC', '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59'),
        tok('USDT', '0x66e428c3f67a68878562e79A0234c1F83c208770'),
        tok('DAI', '0xF2001B145b43032AAF5Ee2884e456CCd805F677D')
    ),
    // Arbitrum One
    42161: list(
        tok('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
        tok('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'),
        tok('USDC.e', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8')
    ),
    // Polygon
    137: list(
        tok('USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'),
        tok('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),
        tok('USDC.e', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174')
    ),
})

/**
 * Zincirin yoklanacak token ADRESLERI. Multicall3'u dogrulanmamis ya da listede olmayan
 * zincir icin bos dizi (o agda token yoklamasi atlanir). ASLA firlatmaz.
 *
 * @param {number|string} chainId
 * @returns {string[]}
 */
export function usageTokenAddressesFor(chainId) {
    const id = Number(chainId)
    if (!Number.isInteger(id) || !MULTICALL3_CHAIN_IDS.includes(id)) return []
    const tokens = EVM_USAGE_TOKENS[id]
    return tokens ? tokens.map((t) => t.address) : []
}
