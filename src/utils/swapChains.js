// Zincir basina swap yapilandirmasi.
//
// Tum adresler 2026-08-18'de zincirden IKI KEZ BAGIMSIZ dogrulandi (spec §9):
// getCode, router.factory() eslesmesi, V2'de havuz rezervi + getAmountsOut,
// V3'te quoter imzasi ve router bytecode selektoru. FEE degerleri getAmountsOut
// ciktisinin sabit-carpim formuluyle karsilastirilmasindan OLCULDU; FEE_TIERS
// factory.feeAmountTickSpacing'den OKUNDU. Tahmin yok — elle degistirmeyin,
// `npm run verify:routers` ile dogrulayin.
//
// INIT_CODE_HASH: SADECE zincir 1 ve 56'daki kayitlarda var (spec §3 — "as-is").
// getPairAddress (swap.js) factory.getPair() sifir donduğunde CREATE2 ile pair
// adresini hesaplamak icin bu alani kullaniyor; factory.getPair() gecici bir RPC
// hatasinda da sifir donebiliyor, yani bu geri dusus zincirden okumanin tek
// yedegi. Diger sekiz zincirde bu deger olculmedi/dogrulanmadi — BURAYA
// EKLEMEYIN, yalnizca eski DEX_CONFIG'ten tasinan bu bes kayit icin gecerli.

const CHAIN_CONFIG = {
  // Ethereum
  1: {
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    intermediates: [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
    ],
    dexes: [
      {
        NAME: 'UNISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        FACTORY_ADDRESS: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        QUOTER_ADDRESS: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        QUOTER_VERSION: 1,
        ROUTER_VARIANT: 'deadline',
        INIT_CODE_HASH: '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
      },
      {
        NAME: 'UNISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        FACTORY_ADDRESS: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
        FEE: 30,
        INIT_CODE_HASH: '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f',
      },
      {
        NAME: 'SUSHISWAP', VERSION: 2,
        ROUTER_ADDRESS: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        FACTORY_ADDRESS: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
        FEE: 30,
        INIT_CODE_HASH: '0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303',
      },
    ],
  },
  // BNB Smart Chain
  56: {
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    intermediates: [
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      '0x55d398326f99059fF775485246999027B3197955', // USDT
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
    ],
    dexes: [
      {
        NAME: 'PANCAKESWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
        FACTORY_ADDRESS: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
        QUOTER_ADDRESS: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
        FEE_TIERS: [100, 500, 2500, 10000],
        INIT_CODE_HASH: '0x6ce8eb472fa82df5469c6ab6d485f17c3ad13c8cd7af59b3d4a8026c5ce0f7e2',
      },
      {
        NAME: 'PANCAKESWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        FACTORY_ADDRESS: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
        FEE: 25,
        INIT_CODE_HASH: '0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5',
      },
    ],
  },
  // Optimism
  10: {
    wrappedNative: '0x4200000000000000000000000000000000000006', // WETH
    intermediates: [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC (yerli)
      '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
      '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
    ],
    dexes: [
      {
        NAME: 'UNISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        FACTORY_ADDRESS: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        QUOTER_ADDRESS: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        QUOTER_VERSION: 1,
        ROUTER_VARIANT: 'deadline',
      },
      {
        NAME: 'SUSHISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0x8c32Fd078B89Eccb06B40289A539D84A4aA9FDA6',
        FACTORY_ADDRESS: '0x9c6522117e2ed1fE5bdb72bb0eD5E3f2bdE7DBe0',
        QUOTER_ADDRESS: '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
      },
      {
        // SIG HAVUZ: ana ciftte en iyi teklifin %87.9 gerisinde (2026-08-18).
        // Likidite esigi (swapRoutes.poolTooShallow) bunu kotu fiyatta secilmekten korur.
        NAME: 'UNISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2',
        FACTORY_ADDRESS: '0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf',
        FEE: 30,
      },
    ],
  },
  // Polygon
  137: {
    wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WPOL
    intermediates: [
      '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WPOL
      '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT (zincirde USDT0)
      '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC (yerli)
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC.e (kopru; symbol() de "USDC" doner)
    ],
    dexes: [
      {
        NAME: 'UNISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        FACTORY_ADDRESS: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        QUOTER_ADDRESS: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        QUOTER_VERSION: 1,
        ROUTER_VARIANT: 'deadline',
      },
      {
        NAME: 'APESWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607',
        FACTORY_ADDRESS: '0xCf083Be4164828f00cAE704EC15a36D711491284',
        FEE: 20,
      },
      {
        NAME: 'QUICKSWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
        FACTORY_ADDRESS: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
        FEE: 30,
      },
      {
        NAME: 'UNISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0xedf6066a2b290C185783862C7F4776A2C8077AD1',
        FACTORY_ADDRESS: '0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C',
        FEE: 30,
      },
      {
        NAME: 'SUSHISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        FACTORY_ADDRESS: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
        FEE: 30,
      },
    ],
  },
  // Arbitrum One
  42161: {
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    intermediates: [
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC (yerli)
      '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT (zincirde USD₮0)
      '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // USDC.e (kopru)
    ],
    dexes: [
      {
        NAME: 'UNISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        FACTORY_ADDRESS: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
        QUOTER_ADDRESS: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        QUOTER_VERSION: 1,
        ROUTER_VARIANT: 'deadline',
      },
      {
        NAME: 'SUSHISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0x8A21F6768C1f8075791D08546Dadf6daA0bE820c',
        FACTORY_ADDRESS: '0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e',
        QUOTER_ADDRESS: '0x0524E833cCD057e4d7A296e3aaAb9f7675964Ce1',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
      },
      {
        NAME: 'UNISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        FACTORY_ADDRESS: '0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9',
        FEE: 30,
      },
      {
        // SIG HAVUZ: ana ciftte en iyi teklifin %72.5 gerisinde (2026-08-18).
        NAME: 'SUSHISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        FACTORY_ADDRESS: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
        FEE: 30,
      },
    ],
  },
  // Base
  8453: {
    wrappedNative: '0x4200000000000000000000000000000000000006', // WETH
    intermediates: [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC (yerli)
      '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // USDT
      '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', // USDbC (kopru)
    ],
    dexes: [
      {
        // DIKKAT: SwapRouter02 — exactInputSingle struct'inda deadline YOK.
        NAME: 'UNISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0x2626664c2603336E57B271c5C0b26F421741e481',
        FACTORY_ADDRESS: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
        QUOTER_ADDRESS: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'no-deadline',
        FEE_TIERS: [100, 200, 400, 500, 3000, 10000],
      },
      {
        NAME: 'PANCAKESWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
        FACTORY_ADDRESS: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
        QUOTER_ADDRESS: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
        FEE_TIERS: [100, 500, 2500, 10000],
      },
      {
        NAME: 'SUSHISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0xFB7eF66a7e61224DD6FcD0D7d9C3be5C8B049b9f',
        FACTORY_ADDRESS: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
        QUOTER_ADDRESS: '0xb1E835Dc2785b52265711e17fCCb0fd018226a6e',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
      },
      {
        NAME: 'UNISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        FACTORY_ADDRESS: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
        FEE: 30,
      },
      {
        // SIG HAVUZ: ana ciftte en iyi teklifin %16.7 gerisinde (2026-08-18).
        NAME: 'BASESWAP', VERSION: 2,
        ROUTER_ADDRESS: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86',
        FACTORY_ADDRESS: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB',
        FEE: 25,
      },
      {
        // SIG HAVUZ: ana ciftte en iyi teklifin %54.4 gerisinde (2026-08-18).
        NAME: 'SUSHISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
        FACTORY_ADDRESS: '0x71524B4f93c58fcbF659783284E38825f0622859',
        FEE: 30,
      },
    ],
  },
  // Celo — DIKKAT: native CELO ayni zamanda bir ERC20'dir, sarmalayici degildir.
  42220: {
    // Celo'nun native varligi KENDISI bir ERC20 (0x471EcE…a438). Zincirde ne bir
    // "wrap" ne de bir "unwrap" adimi vardir ve router'lar ETH giris/cikis
    // fonksiyonlari CIKARILARAK catallanmistir. 2026-08-18'de zincirden olculdu:
    //   - Ubeswap router 0xE3D8bd…6121 : swapExactETHForTokens YOK, swapExactTokensForETH YOK
    //   - SushiSwap router 0x1421bD…6842: ayni sekilde ikisi de YOK
    //   - CELO token 0x471EcE…a438      : withdraw(uint256) YOK
    // Bu bayrak aciksa motor native tarafi DUZ BIR ERC20 gibi isler:
    // swapExactTokensForTokens + approve, ve unwrap adimi hic uretilmez.
    // Bayrak olmadan quote calisir (havuzlar gercek) ama gonderim revert eder.
    nativeIsErc20: true,
    wrappedNative: '0x471EcE3750Da237f93B8E339c536989b8978a438', // CELO
    intermediates: [
      '0x471EcE3750Da237f93B8E339c536989b8978a438', // CELO
      '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', // USDT (zincirde USD₮)
      '0x765DE816845861e75A25fCA122bb6898B8B1282a', // Mento dolari (zincirde USDm)
      '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', // USDC
    ],
    dexes: [
      {
        // DIKKAT: SwapRouter02 — exactInputSingle struct'inda deadline YOK.
        NAME: 'UNISWAPV3', VERSION: 3,
        ROUTER_ADDRESS: '0x5615CDAb10dc425a742d643d949a7F474C01abc4',
        FACTORY_ADDRESS: '0xAfE208a311B21f13EF87E33A90049fC17A7acDEc',
        QUOTER_ADDRESS: '0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'no-deadline',
      },
      {
        NAME: 'UBESWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0xE3D8bd6Aed4F159bc8000a9cD47CffDb95F96121',
        FACTORY_ADDRESS: '0x62d5b84bE28a183aBB507E125B384122D2C25fAE',
        FEE: 30,
      },
      {
        // SIG HAVUZ: ana ciftte en iyi teklifin %11.5 gerisinde (2026-08-18).
        // FEE 17 OLCULDU (30 degil) — Celo Sushi dagitimi farkli ucret kullaniyor.
        NAME: 'SUSHISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x1421bDe4B10e8dd459b3BCb598810B1337D56842',
        FACTORY_ADDRESS: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
        FEE: 17,
      },
    ],
  },
  // Gnosis
  100: {
    wrappedNative: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', // WXDAI
    intermediates: [
      '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d', // WXDAI
      '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', // USDC
      '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', // USDT
    ],
    dexes: [
      {
        NAME: 'SUSHISWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        FACTORY_ADDRESS: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
        FEE: 30,
      },
      {
        NAME: 'HONEYSWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0x1C232F01118CB8B424793ae03F870aa7D0ac7f77',
        FACTORY_ADDRESS: '0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7',
        FEE: 30,
      },
      {
        NAME: 'SWAPRV2', VERSION: 2,
        ROUTER_ADDRESS: '0xE43e60736b1cb4a75ad25240E2f9a62Bff65c0C0',
        FACTORY_ADDRESS: '0x5D48C95AdfFD4B40c1AAADc4e08fc44117E02179',
        FEE: 25,
      },
    ],
  },
  // Mantle
  5000: {
    wrappedNative: '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8', // WMNT
    intermediates: [
      '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8', // WMNT
      '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', // USDT
      '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', // USDC
      '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', // USDe
    ],
    dexes: [
      {
        NAME: 'AGNIV3', VERSION: 3,
        ROUTER_ADDRESS: '0x319B69888b0d11cEC22caA5034e25FfFBDc88421',
        FACTORY_ADDRESS: '0x25780dc8Fc3cfBD75F33bFDAB65e969b603b2035',
        QUOTER_ADDRESS: '0xc4aaDc921E1cdb66c5300Bc158a313292923C0cb',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
        FEE_TIERS: [100, 500, 2500, 10000],
      },
      {
        NAME: 'FUSIONXV3', VERSION: 3,
        ROUTER_ADDRESS: '0x5989FB161568b9F133eDf5Cf6787f5597762797F',
        FACTORY_ADDRESS: '0x530d2766D1988CC1c000C8b7d00334c14B69AD71',
        QUOTER_ADDRESS: '0x90f72244294E7c5028aFd6a96E18CC2c1E913995',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
        FEE_TIERS: [100, 500, 2500, 10000],
      },
      {
        NAME: 'FUSIONXV2', VERSION: 2,
        ROUTER_ADDRESS: '0xDd0840118bF9CCCc6d67b2944ddDfbdb995955FD',
        FACTORY_ADDRESS: '0xE5020961fA51ffd3662CDf307dEf18F9a87Cce7c',
        FEE: 20,
      },
    ],
  },
  // Cronos
  25: {
    wrappedNative: '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23', // WCRO
    intermediates: [
      '0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23', // WCRO
      '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59', // USDC
      '0x66e428c3f67a68878562e79A0234c1F83c208770', // USDT
      '0xF2001B145b43032AAF5Ee2884e456CCd805F677D', // DAI
    ],
    dexes: [
      {
        NAME: 'CRONASWAPV2', VERSION: 2,
        ROUTER_ADDRESS: '0xcd7d16fB918511BF7269eC4f48d61D79Fb26f918',
        FACTORY_ADDRESS: '0x73A48f8f521EB31c55c0e1274dB0898dE599Cb11',
        FEE: 25,
      },
      {
        NAME: 'VVSV2', VERSION: 2,
        ROUTER_ADDRESS: '0x145863Eb42Cf62847A6Ca784e6416C1682b1b2Ae',
        FACTORY_ADDRESS: '0x3B44B2a187a7b3824131F8db5a74194D0a42Fc15',
        FEE: 30,
      },
      {
        NAME: 'MMFINANCEV2', VERSION: 2,
        ROUTER_ADDRESS: '0x145677FC4d9b8F19B5D56d1820c48e0443049a30',
        FACTORY_ADDRESS: '0xd590cC180601AEcD6eeADD9B7f2B7611519544f4',
        FEE: 17,
      },
      {
        NAME: 'VVSV3', VERSION: 3,
        ROUTER_ADDRESS: '0x88d6757C6303f94B11Bfd23087383e871B938780',
        FACTORY_ADDRESS: '0x40aB11c64E9fF5368F09343Ac860dAfA34e14C35',
        QUOTER_ADDRESS: '0xBA237da278b18C7b44D72a4036ed83bB5C4C4B36',
        QUOTER_VERSION: 2,
        ROUTER_VARIANT: 'deadline',
      },
      {
        NAME: 'CRODEX', VERSION: 2,
        ROUTER_ADDRESS: '0xeC0A7a0C2439E8Cb67b992b12ecd020Ea943c7Be',
        FACTORY_ADDRESS: '0xe9c29cB475C0ADe80bE0319B74AD112F1e80058F',
        FEE: 30,
      },
    ],
  },
}

export function isSwapSupported(chainId) {
  return Boolean(CHAIN_CONFIG[Number(chainId)])
}

export function getChainSwapConfig(chainId) {
  const cfg = CHAIN_CONFIG[Number(chainId)]
  if (!cfg) throw new Error(`Swap desteklenmeyen zincir: ${chainId}`)
  return cfg
}

export const getWrappedNative = (chainId) => getChainSwapConfig(chainId).wrappedNative
// Zincirin native varligi bir sarmalayici DEGIL, dogrudan ERC20 mu? (bugun yalniz Celo)
// true ise native taraf duz token gibi islenir: wrap/unwrap yok, ETH giris/cikis
// router fonksiyonu yok, approve gerekir.
export const isNativeErc20 = (chainId) => Boolean(getChainSwapConfig(chainId).nativeIsErc20)
export const getIntermediates = (chainId) => getChainSwapConfig(chainId).intermediates
export const getDexes = (chainId) => getChainSwapConfig(chainId).dexes

export { CHAIN_CONFIG }
