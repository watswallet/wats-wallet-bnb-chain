// solanaSimFixtures.js -- simulateTransaction yanit fixture'lari.
//
// Bu dosyada IKI AYRI tur veri vardir; birbirine KARISTIRILMAZ:
//
// (1) SENTETIK bolum (dosyanin basindan 'GERCEK YAKALAMA' basligina kadar; CANLI_
//     oneki TASIMAYAN tum disari aktarimlar): yanitlar olculmus yanit sekline gore
//     ELLE kurulmustur, canli yakalama DEGILDIR. Sekil (alan adlari, indeks sirasi,
//     `amount` dizesi, `loadedAddresses`) D2 tasarim belgesi 1.3'teki canli
//     olcumlerden alindi; adresler ve bakiyeler uydurmadir (tam uzunlukta gecerli
//     base58, gercek bir hesaba ait degil). balanceDelta.test.js ve simulateTx.test.js
//     YALNIZ bu bolumu kullanir.
//
// (2) GERCEK YAKALAMA bolumu (dosyanin sonu, CANLI_* adlari; Gorev 34 Step 4a,
//     2026-11-16): uretim vekilinden alinmis GERCEK simulateTransaction yanitlari
//     (SOL/USDC transferi, iki Jupiter v0+ALT takasi, hatali durable nonce). Ayrinti
//     o bolumun basliginda.

// ---------------------------------------------------------------------------
// SENTETIK ADRESLER
// ---------------------------------------------------------------------------
export const USER = '59epESRaQafEpGvezt91Ds6siTfMTzx8EDqRcjLFyAH'
export const RECIPIENT = '9cuqYYmHLkLhGCdUtN4YFb6bEuH1Kisx3Ai6oUAUK6n'
export const USER_USDC_ATA = 'E6Arrf6zGv29i8LJmqz5HJy7jbrMuJP3Q6sFeXxcQVh'
export const OTHER_OWNER = 'JZRtAmShD5hcA438eWriEePf8quV6Lr9dxZzkxH5RrG'
export const OTHER_USDC_ATA = 'P2guUsnQ9FP4amzF8AtWtu9i66hxFZkkqdEeCjszcRB'
export const USER_WSOL_ACCT = 'TVwvnz7yCyLKWDCyVkNWRQPfoD2LVxsK8VVhChHah3Q'
export const USER_WSOL_ACCT2 = 'XyCkSPy48GtU75r3VLHgGk767MkcCRXus9JMZ9UGugB'
export const ALT_WRITABLE = 'YXAq7jnveTCHrWLzuvgTZAJeEMMCTU38vTMcY77PBmn'
export const ALT_READONLY = 'czRrRr8dacskJS3poQbzatJMknxrKBxxjQEHiqwbXiH'
export const PROGRAM = 'hTgsjxULWnZCkMkegtXXc4ZPaXnoJgAd6VeMpfhrFmG'
export const SYSTEM_PROGRAM = '11111111111111111111111111111111'
// Bunlar gercek, herkesce bilinen mint adresleridir (USDC ve wSOL).
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

// ---------------------------------------------------------------------------
// YANIT KURUCULARI (alan sirasi olculmus yanittaki ile ayni)
// ---------------------------------------------------------------------------
export const tokenBalance = (accountIndex, mint, owner, amount, decimals) => ({
    accountIndex,
    mint,
    owner,
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    uiTokenAmount: {
        amount: String(amount),
        decimals,
        uiAmount: Number(amount) / 10 ** decimals,
        uiAmountString: String(Number(amount) / 10 ** decimals),
    },
})

// `simulateTransaction` JSON-RPC `result` nesnesi.
export const simResult = (value) => ({ context: { apiVersion: '2.0.0', slot: 400000000 }, value })

const baseValue = {
    err: null,
    logs: [],
    unitsConsumed: 150,
    accounts: null,
    returnData: null,
    innerInstructions: null,
    loadedAddresses: { writable: [], readonly: [] },
    replacementBlockhash: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 400000150 },
    preTokenBalances: [],
    postTokenBalances: [],
}

// ---------------------------------------------------------------------------
// 1) System Transfer: USER -> RECIPIENT, 1_000_000 lamport, USER ucret odeyen.
//    Anahtar sirasi: [USER, RECIPIENT, SYSTEM_PROGRAM]. fee 5000.
// ---------------------------------------------------------------------------
export const SYSTEM_TRANSFER_ACCOUNT_KEYS = [USER, RECIPIENT, SYSTEM_PROGRAM]
export const SYSTEM_TRANSFER_SIM = simResult({
    ...baseValue,
    fee: 5000,
    preBalances: [10_000_000, 2_000_000, 1],
    postBalances: [8_995_000, 3_000_000, 1],
})

// ---------------------------------------------------------------------------
// 2) USDC TransferChecked (1 USDC = 1_000_000, 6 decimals): USER'in ATA'si
//    -> baska birinin ATA'si. Anahtar sirasi: [USER, USER_USDC_ATA,
//    OTHER_USDC_ATA, USDC_MINT, TOKEN_PROGRAM].
// ---------------------------------------------------------------------------
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const USDC_TRANSFER_ACCOUNT_KEYS = [USER, USER_USDC_ATA, OTHER_USDC_ATA, USDC_MINT, TOKEN_PROGRAM]
export const USDC_TRANSFER_SIM = simResult({
    ...baseValue,
    fee: 5000,
    preBalances: [10_000_000, 2_039_280, 2_039_280, 1_461_600, 1],
    postBalances: [9_995_000, 2_039_280, 2_039_280, 1_461_600, 1],
    preTokenBalances: [
        tokenBalance(1, USDC_MINT, USER, 4_883_921, 6),
        tokenBalance(2, USDC_MINT, OTHER_OWNER, 2_734_645_916_275, 6),
    ],
    postTokenBalances: [
        tokenBalance(1, USDC_MINT, USER, 3_883_921, 6),
        tokenBalance(2, USDC_MINT, OTHER_OWNER, 2_734_646_916_275, 6),
    ],
})

// 2b) Ayni islem, kullanici ALICI tarafta (USER_USDC_ATA +1 USDC alir).
export const USDC_RECEIVE_SIM = simResult({
    ...baseValue,
    fee: 5000,
    preBalances: [10_000_000, 2_039_280, 2_039_280, 1_461_600, 1],
    postBalances: [10_000_000, 2_039_280, 2_039_280, 1_461_600, 1],
    preTokenBalances: [
        tokenBalance(1, USDC_MINT, USER, 4_883_921, 6),
        tokenBalance(2, USDC_MINT, OTHER_OWNER, 2_734_645_916_275, 6),
    ],
    postTokenBalances: [
        tokenBalance(1, USDC_MINT, USER, 5_883_921, 6),
        tokenBalance(2, USDC_MINT, OTHER_OWNER, 2_734_644_916_275, 6),
    ],
})

// ---------------------------------------------------------------------------
// 3) v0 + adres arama tablosu (ALT): statik 3 anahtar + 1 writable + 1 readonly
//    yuklu adres. preBalances 5 uzunlugunda (static, writable, readonly sirasi).
// ---------------------------------------------------------------------------
export const V0_STATIC_KEYS = [USER, RECIPIENT, PROGRAM]
export const V0_ALT_SIM = simResult({
    ...baseValue,
    fee: 5000,
    preBalances: [10_000_000, 1, 1, 7_000_000, 1],
    postBalances: [9_995_000, 1, 1, 7_000_000, 1],
    loadedAddresses: { writable: [ALT_WRITABLE], readonly: [ALT_READONLY] },
})

// ===========================================================================
// GERCEK YAKALAMA (Gorev 34 Step 4a, 2026-11-16) -- SENTETIK BOLUMLE KARISTIRMA
// ===========================================================================
// Kaynak: uretim vekili POST https://api.extension.watswallet.com/solana/rpc,
// simulateTransaction { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true,
// commitment: 'processed' } (simulateTx.js SIM_OPTIONS ile ayni). Islemler IMZASIZDIR,
// hicbiri gonderilmedi. Adresler herkese acik, fonlu borsa sicak cuzdanlaridir (gercek
// zincir verisi, uydurma DEGIL); bakiyeler yakalama anindaki degerlerdir ve degisir --
// bu yuzden bu yanitlari kullanacak bir test canliya GITMEMELI, yalniz bu SABIT
// yanitlar uzerinde calismalidir. DURUM (2026-11-16): repoda CANLI_* disari
// aktarimlarini import eden HICBIR test yok (yalniz bu dosyada geciyorlar); Gorev 34
// dogrulugu repoya girmeyen gecici bir testle (scratchpad fikstur.poc.test.js) sinandi.
// Jupiter islemleri lite-api.jup.ag/swap/v1 (quote + swap) ile alindi (userPublicKey =
// asagidaki kullanici); v0 + adres arama tablosu (ALT) tasirlar.
// `sim` = JSON-RPC `result` (context + value). `value`dan yalniz logs, innerInstructions,
// accounts, returnData, loadedAccountsDataSize BOYUT icin atildi; yanittaki TUM alan adlari
// `fields`te. `beklenen` = bu yanitla simulateTx'in dondurdugu sonuc (yakalama aninda
// dalin kendi kodu ile hesaplandi). `pipeline` = parseDappTransaction + decodeInstructions +
// loadTokenAccountContext (canli) + buildTxPreview + kilit tablosu sonucu (yalniz bilgi).
//
// TOKEN DIZISI OLCUMU (patron karari Constraint 23(b)): basarili her yakalamada
// preTokenBalances/postTokenBalances DIZIDIR ve her kayit `owner` + `programId` tasir
// (Token-2022 kayitlari dahil); `fee`, preBalances/postBalances, loadedAddresses VAR.
// Basarisiz (err dolu) simulasyonda da token dizileri dizi olarak gelir.
export const CANLI_YAKALAMA = Object.freeze({
    tarih: '2026-11-16',
    kaynak: 'POST /solana/rpc (uretim vekili) simulateTransaction sigVerify:false replaceRecentBlockhash:true',
    // Fonlu, herkese acik sicak cuzdan (ucreti odeyen ve imzaci).
    user: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
    // Transfer alicisi (USDC ATA'si zincirde var).
    alici: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
})

// 1) Legacy System Transfer: user -> alici 1_000_000 lamport (0.001 SOL).
export const CANLI_SOL_TRANSFER = {
    base64Tx: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAED41ZKVgwQ9BCW4J3frtjk8TxkxqX/xtkoYEEzy+7JQEca1O3+/9cNJYCUzQXX70l9wsvVIv8sMBgnOl06/p9lWwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAgIAAQwCAAAAQEIPAAAAAAA=',
    version: 'legacy',
    staticAccountKeys: [
        'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
        '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
        '11111111111111111111111111111111',
    ],
    fields: [
        'accounts',
        'err',
        'fee',
        'innerInstructions',
        'loadedAccountsDataSize',
        'loadedAddresses',
        'logs',
        'postBalances',
        'postTokenBalances',
        'preBalances',
        'preTokenBalances',
        'replacementBlockhash',
        'returnData',
        'unitsConsumed',
    ],
    sim: {
        context: {
            apiVersion: '4.4.1',
            slot: 470085818,
        },
        value: {
            err: null,
            fee: 5000,
            preBalances: [36926572291671, 4267944573, 1],
            postBalances: [36926571286671, 4268944573, 1],
            preTokenBalances: [],
            postTokenBalances: [],
            loadedAddresses: {
                readonly: [],
                writable: [],
            },
            unitsConsumed: 150,
            replacementBlockhash: {
                blockhash: '2WxxneLBTjak9m9usZiQE58Pyq8Cs5FedD56G7bGPBsg',
                lastValidBlockHeight: 448100903,
            },
        },
    },
    beklenen: {
        ok: true,
        solDeltaLamports: -1005000n,
        feeLamports: 5000n,
        tokenDeltas: [],
        tokensUnreadable: false,
        partial: false,
    },
    pipeline: {
        hasUnknown: false,
        hasRedFlag: false,
        rowKinds: [
            'systemTransfer',
        ],
        korImzaKutusu: false,
    },
}

// 2) Legacy USDC TransferChecked: 1 USDC (1_000_000, 6 decimals), user ATA -> alici ATA.
export const CANLI_USDC_TRANSFER = {
    base64Tx: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAIF41ZKVgwQ9BCW4J3frtjk8TxkxqX/xtkoYEEzy+7JQEd7n3Djj6M+EsUGPGDkAAh7EypWUYGB/hDBT4BgfP9tsbv9pLIVEsQbTrOZ9jk7MS24dLPCB7Ph+AcohMLXE/F0xvp6877brTo9ZfNqq8l0MbG75MLS9uDkfKYCA0UvXWEG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQQEAgMBAAoMQEIPAAAAAAAG',
    version: 'legacy',
    staticAccountKeys: [
        'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
        '9KaA7vEBUdRCcBWxfuMjxYwKfvu8Us3Cg5gkhVFt2LNk',
        'DeqZejBFrRwWraY4g4besYmibTY1QcV1Fcg6VfoEvn4T',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ],
    fields: [
        'accounts',
        'err',
        'fee',
        'innerInstructions',
        'loadedAccountsDataSize',
        'loadedAddresses',
        'logs',
        'postBalances',
        'postTokenBalances',
        'preBalances',
        'preTokenBalances',
        'replacementBlockhash',
        'returnData',
        'unitsConsumed',
    ],
    sim: {
        context: {
            apiVersion: '4.4.1',
            slot: 470085819,
        },
        value: {
            err: null,
            fee: 5000,
            preBalances: [36926572291671, 2039280, 101833008, 563050488434, 240130698],
            postBalances: [36926572286671, 2039280, 101833008, 563050488434, 240130698],
            preTokenBalances: [
                {
                    accountIndex: 1,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '4883921',
                        decimals: 6,
                        uiAmount: 4.883921,
                        uiAmountString: '4.883921',
                    },
                },
                {
                    accountIndex: 2,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '94581319838',
                        decimals: 6,
                        uiAmount: 94581.319838,
                        uiAmountString: '94581.319838',
                    },
                },
            ],
            postTokenBalances: [
                {
                    accountIndex: 1,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '5883921',
                        decimals: 6,
                        uiAmount: 5.883921,
                        uiAmountString: '5.883921',
                    },
                },
                {
                    accountIndex: 2,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '94580319838',
                        decimals: 6,
                        uiAmount: 94580.319838,
                        uiAmountString: '94580.319838',
                    },
                },
            ],
            loadedAddresses: {
                readonly: [],
                writable: [],
            },
            unitsConsumed: 105,
            replacementBlockhash: {
                blockhash: 'HvivpLmx5vSSRYscfgL62vpvZr4wTtAgP5XbHJQv1U3i',
                lastValidBlockHeight: 448100904,
            },
        },
    },
    beklenen: {
        ok: true,
        solDeltaLamports: -5000n,
        feeLamports: 5000n,
        tokenDeltas: [
            {
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                delta: -1000000n,
                decimals: 6,
            },
        ],
        tokensUnreadable: false,
        partial: false,
    },
    pipeline: {
        hasUnknown: false,
        hasRedFlag: false,
        rowKinds: [
            'tokenTransfer',
        ],
        korImzaKutusu: false,
    },
}

// 3) Jupiter SOL -> USDC takasi (v0 + ALT, 0.01 SOL girdi). Kullanicinin ONCEDEN var olan wSOL
//    hesabi islemde kapatilir (CloseAccount -> kullanici): SOL farki brut +6.13 SOL, wSOL -6.14;
//    net lamport esdegeri = -(10_000_000 + ucret) + 2_039_280 (kapanan hesabin kira iadesi).
export const CANLI_JUPITER_SOL_USDC = {
    base64Tx: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAHCuNWSlYMEPQQluCd367Y5PE8ZMal/8bZKGBBM8vuyUBHu/2kshUSxBtOs5n2OTsxLbh0s8IHs+H4ByiEwtcT8XTPaEln3/SsiC0CE0jObV5S7uDtzhwHm4bB2/itjuPuEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAEedVb8jHAbu50xW7OaBUH/bGy3qP0jlECsc2iVrwTjwbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpNZtjiLgkUYJsu4O7lCF6+WWGCGKfgWNPCiRJ3mtQnHaCRl5O14WI3iAqgtVQXuCVNuD9VqJEjxLu1wDbTc/Kl7Q/+if11/ZKdMCbHylYed5LCas238ndUUsyGqezjOXo7jpZozKO3V0IWnDF7zPz+o48oWCg2Sq36gTfGr/u9mwGBAAFAsQxAQAEAAkD+ikDAAAAAAADAgACDAIAAACAlpgAAAAAAAYBAgERBRkGAAIBBRAFCQUPAAsMCgIBBgYNEA4RBQcIJOUXy5d6460qAQAAAM0BZAABgJaYAAAAAAC30QoAAAAAADIAAAYDAgAAAQkBaqnD6zW9JDo+H+KAaN7anlH5OQXEZKvnbsMiY28t+NkDgIWEBRB/gnGH',
    version: 0,
    staticAccountKeys: [
        'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
        'DeqZejBFrRwWraY4g4besYmibTY1QcV1Fcg6VfoEvn4T',
        'ExddG34jGRAqmPi6PwjoYDbrVhNdznz3ykJvmcbuv2wk',
        '11111111111111111111111111111111',
        'ComputeBudget111111111111111111111111111111',
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        '4cG31VNF9TzFinNc7BmnjhFvGjxkY3sCETVMtMgbrhPs',
        '9mYEd71VzXZoa8a3B3Zw5TG6C3N7qLRGnw2JdtocsrrS',
        'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',
    ],
    altResolved: {
        tables: [
            '8BNMiq1CM4g3zZbhbWQHn27631FPAJLGMF2c52y3Vs5i',
        ],
        writable: [
            '2Y7HATmn9aJBcxCskE5V2U2epmjvkZmB51zTJBbhj4cU',
            '8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo',
            'ATRsNGv2nDw7hSMfkUTBoVUDsFDwN7po7KbecyiGWNB4',
        ],
        readonly: [
            'So11111111111111111111111111111111111111112',
            'Sysvar1nstructions1111111111111111111111111',
            'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi',
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            'J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv',
        ],
    },
    quote: {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '10000000',
        outAmount: '709047',
        otherAmountThreshold: '705502',
        slippageBps: 50,
    },
    fields: [
        'accounts',
        'err',
        'fee',
        'innerInstructions',
        'loadedAccountsDataSize',
        'loadedAddresses',
        'logs',
        'postBalances',
        'postTokenBalances',
        'preBalances',
        'preTokenBalances',
        'replacementBlockhash',
        'returnData',
        'unitsConsumed',
    ],
    sim: {
        context: {
            apiVersion: '4.4.1',
            slot: 470085883,
        },
        value: {
            err: null,
            fee: 21231,
            preBalances: [36926572291671, 101833008, 6145887580, 1, 1, 6986116527, 240130698, 1503360, 0, 6711053, 2039285, 19432681, 20040560929741, 1924448070030, 0, 25305375, 563050488434, 57633714493],
            postBalances: [36932708158020, 101833008, 0, 1, 1, 6986116527, 240130698, 1503360, 0, 6711053, 2039285, 19432681, 20040570929741, 1924448070030, 0, 25305375, 563050488434, 57633714493],
            preTokenBalances: [
                {
                    accountIndex: 1,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '94581319838',
                        decimals: 6,
                        uiAmount: 94581.319838,
                        uiAmountString: '94581.319838',
                    },
                },
                {
                    accountIndex: 2,
                    mint: 'So11111111111111111111111111111111111111112',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '6143848300',
                        decimals: 9,
                        uiAmount: 6.1438483,
                        uiAmountString: '6.1438483',
                    },
                },
                {
                    accountIndex: 10,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: '8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '2694681214853',
                        decimals: 6,
                        uiAmount: 2694681.214853,
                        uiAmountString: '2694681.214853',
                    },
                },
                {
                    accountIndex: 12,
                    mint: 'So11111111111111111111111111111111111111112',
                    owner: '8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '20040533709087',
                        decimals: 9,
                        uiAmount: 20040.533709087,
                        uiAmountString: '20040.533709087',
                    },
                },
            ],
            postTokenBalances: [
                {
                    accountIndex: 1,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '94582028840',
                        decimals: 6,
                        uiAmount: 94582.02884,
                        uiAmountString: '94582.02884',
                    },
                },
                {
                    accountIndex: 10,
                    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    owner: '8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '2694680505851',
                        decimals: 6,
                        uiAmount: 2694680.505851,
                        uiAmountString: '2694680.505851',
                    },
                },
                {
                    accountIndex: 12,
                    mint: 'So11111111111111111111111111111111111111112',
                    owner: '8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '20040543709087',
                        decimals: 9,
                        uiAmount: 20040.543709087,
                        uiAmountString: '20040.543709087',
                    },
                },
            ],
            loadedAddresses: {
                readonly: [
                    'So11111111111111111111111111111111111111112',
                    'Sysvar1nstructions1111111111111111111111111',
                    'BiSoNHVpsVZW2F7rx2eQ59yQwKxzU5NvBcmKshCSUypi',
                    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                    'J1to1yufRnoWn81KYg1XkTWzmKjnYSnmE2VY8DGUJ9Qv',
                ],
                writable: [
                    '2Y7HATmn9aJBcxCskE5V2U2epmjvkZmB51zTJBbhj4cU',
                    '8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo',
                    'ATRsNGv2nDw7hSMfkUTBoVUDsFDwN7po7KbecyiGWNB4',
                ],
            },
            unitsConsumed: 63160,
            replacementBlockhash: {
                blockhash: 'Fcty8yjNyuwCGsf75rtYSbgGupSRxQBGKvr1MsA476TC',
                lastValidBlockHeight: 448100968,
            },
        },
    },
    beklenen: {
        ok: true,
        solDeltaLamports: 6135866349n,
        feeLamports: 21231n,
        tokenDeltas: [
            {
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                delta: 709002n,
                decimals: 6,
            },
            {
                mint: 'So11111111111111111111111111111111111111112',
                delta: -6143848300n,
                decimals: 9,
            },
        ],
        tokensUnreadable: false,
        partial: false,
    },
    pipeline: {
        hasUnknown: true,
        hasRedFlag: false,
        rowKinds: [
            'systemTransfer',
            'walletPrep',
            'unknownProgram',
            'closeAccount',
        ],
        korImzaKutusu: false,
    },
}

// 4) Jupiter SOL -> PYUSD takasi (v0 + ALT). PYUSD Token-2022 mint'i: transferFeeConfig
//    uzantisi VAR ama ucret 0 bps (yakalama aninda getMultipleAccounts jsonParsed ile okundu);
//    sifirdan farkli transfer ucretli mint OLCULMEDI.
export const CANLI_JUPITER_SOL_PYUSD = {
    base64Tx: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAFC+NWSlYMEPQQluCd367Y5PE8ZMal/8bZKGBBM8vuyUBHIlmBQOXAH6ioKEEGtdrnhDdLJ2YL2gzj++NLXJr22uLCMThBCQfOMIde1/JkJEd/m6uPJTNIsxnvh6kDotbtWs9oSWff9KyILQITSM5tXlLu4O3OHAebhsHb+K2O4+4T1Y0lTOM4aNYFtvyV3ypCSCLHbB8MDF0AXoFWEsHsWa3tRRHg2n7GbSzotXp/N6eRismxFyzukzi1YTaZgoDt9QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwZGb+UhFzL/7K26csOb57yM5bvF9xJrLEObOkAAAAAEedVb8jHAbu50xW7OaBUH/bGy3qP0jlECsc2iVrwTjwbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCptD/6J/XX9kp0wJsfKVh53ksJqzbfyd1RSzIap7OM5eh/KgFrEfxBXxGfmc1nUfZX6EfGTbpuFnwXCWyp5qZSfAUHAAUCBg4BAAYCAAMMAgAAAICWmAAAAAAACQEDAREIGREAAwUIEwgKCBIJEQ8ADBATAw4FDQEEAgsl5RfLl3rjrSoBAAAALwEAZAABgJaYAAAAAAAnzwoAAAAAADIAAAkDAwAAAQkBwlHAMhHdNtqD8csR1nFM9+otZ0ILJ3Sdyjrlsd0ijL8EJygvMAUmLS4sMg==',
    version: 0,
    staticAccountKeys: [
        'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
        '3K62BKMPXw4XWLjvGqN79qESpKsd77RVRGUW6fYam7Wh',
        'E53dAe8Vf2bcLMJ8mHu6uh7iUuD8L4UccworaZ7XMzvM',
        'ExddG34jGRAqmPi6PwjoYDbrVhNdznz3ykJvmcbuv2wk',
        'FNcfqXwF9dorYdEEchFmuxmUQ8iiK1Wk2vQiJ81Y28Qc',
        'GyCiBiqNsjwyHgbHYDXJzzGCsgPzFrSDnW4EheXJPtZA',
        '11111111111111111111111111111111',
        'ComputeBudget111111111111111111111111111111',
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',
    ],
    altResolved: {
        tables: [
            'E5YPrwXTW7iFPCPtamx5pcU9jdxHKnqZFmsf3do9sXsc',
        ],
        writable: [
            '8YW7kG5nZGL36mEHgJSdzvrhHXPV9x9R85NHHFtcoJK9',
            '9Vh6fqJjDkqSTZ8bDXseVxGb2yQEMkEhhtte2anQCHSf',
            'BoupoyPJU1EgwRUhKw78dQKjPrv26SYgtmtXas9axdT8',
            'EQcD4Wcp9fk1vnPT1q8r3KrPd3euTn3zuwjRtuEvDjTc',
        ],
        readonly: [
            'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
            'So11111111111111111111111111111111111111112',
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
            'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
            '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
        ],
    },
    quote: {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
        inAmount: '10000000',
        outAmount: '708391',
        otherAmountThreshold: '704850',
        slippageBps: 50,
    },
    fields: [
        'accounts',
        'err',
        'fee',
        'innerInstructions',
        'loadedAccountsDataSize',
        'loadedAddresses',
        'logs',
        'postBalances',
        'postTokenBalances',
        'preBalances',
        'preTokenBalances',
        'replacementBlockhash',
        'returnData',
        'unitsConsumed',
    ],
    sim: {
        context: {
            apiVersion: '4.4.1',
            slot: 470085972,
        },
        value: {
            err: null,
            fee: 5000,
            preBalances: [36926572291671, 70407360, 70407360, 6145887580, 70407360, 2196220, 1, 1, 6986116527, 240130698, 6711053, 0, 6437421, 2164561, 462894372973, 523015236, 1924448070030, 70228638, 82851581, 2078412093],
            postBalances: [36932708174251, 70407360, 70407360, 0, 70407360, 2196220, 1, 1, 6986116527, 240130698, 6711053, 0, 6437421, 2164561, 462904372973, 523015236, 1924448070030, 70228638, 82851581, 2078412093],
            preTokenBalances: [
                {
                    accountIndex: 3,
                    mint: 'So11111111111111111111111111111111111111112',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '6143848300',
                        decimals: 9,
                        uiAmount: 6.1438483,
                        uiAmountString: '6.1438483',
                    },
                },
                {
                    accountIndex: 5,
                    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                    uiTokenAmount: {
                        amount: '14166312236',
                        decimals: 6,
                        uiAmount: 14166.312236,
                        uiAmountString: '14166.312236',
                    },
                },
                {
                    accountIndex: 13,
                    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                    owner: '9Vh6fqJjDkqSTZ8bDXseVxGb2yQEMkEhhtte2anQCHSf',
                    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                    uiTokenAmount: {
                        amount: '622048296',
                        decimals: 6,
                        uiAmount: 622.048296,
                        uiAmountString: '622.048296',
                    },
                },
                {
                    accountIndex: 14,
                    mint: 'So11111111111111111111111111111111111111112',
                    owner: '9Vh6fqJjDkqSTZ8bDXseVxGb2yQEMkEhhtte2anQCHSf',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '462892326196',
                        decimals: 9,
                        uiAmount: 462.892326196,
                        uiAmountString: '462.892326196',
                    },
                },
            ],
            postTokenBalances: [
                {
                    accountIndex: 5,
                    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                    owner: 'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
                    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                    uiTokenAmount: {
                        amount: '14167020627',
                        decimals: 6,
                        uiAmount: 14167.020627,
                        uiAmountString: '14167.020627',
                    },
                },
                {
                    accountIndex: 13,
                    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                    owner: '9Vh6fqJjDkqSTZ8bDXseVxGb2yQEMkEhhtte2anQCHSf',
                    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                    uiTokenAmount: {
                        amount: '621339905',
                        decimals: 6,
                        uiAmount: 621.339905,
                        uiAmountString: '621.339905',
                    },
                },
                {
                    accountIndex: 14,
                    mint: 'So11111111111111111111111111111111111111112',
                    owner: '9Vh6fqJjDkqSTZ8bDXseVxGb2yQEMkEhhtte2anQCHSf',
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                        amount: '462902326196',
                        decimals: 9,
                        uiAmount: 462.902326196,
                        uiAmountString: '462.902326196',
                    },
                },
            ],
            loadedAddresses: {
                readonly: [
                    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
                    'So11111111111111111111111111111111111111112',
                    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
                    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                ],
                writable: [
                    '8YW7kG5nZGL36mEHgJSdzvrhHXPV9x9R85NHHFtcoJK9',
                    '9Vh6fqJjDkqSTZ8bDXseVxGb2yQEMkEhhtte2anQCHSf',
                    'BoupoyPJU1EgwRUhKw78dQKjPrv26SYgtmtXas9axdT8',
                    'EQcD4Wcp9fk1vnPT1q8r3KrPd3euTn3zuwjRtuEvDjTc',
                ],
            },
            unitsConsumed: 55558,
            replacementBlockhash: {
                blockhash: '99gykuRi4966VnTp88qq59tMLBun5bEjpkNG6qWH1JoY',
                lastValidBlockHeight: 448101057,
            },
        },
    },
    beklenen: {
        ok: true,
        solDeltaLamports: 6135882580n,
        feeLamports: 5000n,
        tokenDeltas: [
            {
                mint: 'So11111111111111111111111111111111111111112',
                delta: -6143848300n,
                decimals: 9,
            },
            {
                mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
                delta: 708391n,
                decimals: 6,
            },
        ],
        tokensUnreadable: false,
        partial: false,
    },
    pipeline: {
        hasUnknown: true,
        hasRedFlag: false,
        rowKinds: [
            'systemTransfer',
            'walletPrep',
            'unknownProgram',
            'closeAccount',
        ],
        korImzaKutusu: false,
    },
}

// 5) Durable nonce bicimi: ilk talimat AdvanceNonceAccount (nonce hesabi rastgele uretilmis,
//    zincirde YOK -- gercek bir nonce hesabi bulunamadi) + System Transfer. replaceRecentBlockhash
//    ile istek reddedilmez; program hatasi doner (err dolu), token dizileri yine dizi.
export const CANLI_DURABLE_NONCE_YOK_HESAP = {
    base64Tx: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAIF41ZKVgwQ9BCW4J3frtjk8TxkxqX/xtkoYEEzy+7JQEca1O3+/9cNJYCUzQXX70l9wsvVIv8sMBgnOl06/p9lW6CSf2qRSswwt6mrq7GgASVdKu9clLN8FveEZkhG5xK7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGp9UXGSxWjuCKhF9z0peIzwNcMUWyGrNE2AYuqUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgMDAgQABAQAAAADAgABDAIAAABAQg8AAAAAAA==',
    version: 'legacy',
    staticAccountKeys: [
        'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE',
        '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S',
        'Booo7GmqbrNArtT8DogRMeq3879wd9fsDB64PWCqevdx',
        '11111111111111111111111111111111',
        'SysvarRecentB1ockHashes11111111111111111111',
    ],
    fields: [
        'accounts',
        'err',
        'fee',
        'innerInstructions',
        'loadedAccountsDataSize',
        'loadedAddresses',
        'logs',
        'postBalances',
        'postTokenBalances',
        'preBalances',
        'preTokenBalances',
        'replacementBlockhash',
        'returnData',
        'unitsConsumed',
    ],
    sim: {
        context: {
            apiVersion: '4.4.1',
            slot: 470085820,
        },
        value: {
            err: {
                InstructionError: [
                    0,
                    'InvalidAccountData',
                ],
            },
            fee: 5000,
            preBalances: [36926572291671, 4267944573, 0, 1, 42706560],
            postBalances: [36926572286671, 4267944573, 0, 1, 42706560],
            preTokenBalances: [],
            postTokenBalances: [],
            loadedAddresses: {
                readonly: [],
                writable: [],
            },
            unitsConsumed: 150,
            replacementBlockhash: {
                blockhash: '3UAJFhqgRzbMKLeFKJZBJH5JMDc5Tkg911EEJDf3bYHG',
                lastValidBlockHeight: 448100905,
            },
        },
    },
    beklenen: {
        ok: false,
        reason: 'program_error',
    },
    // hasDurableNonce yakalama aninda kaydedilmemisti (txPreview.js buildTxPreview bu bayragi
    // uretir). Ham yakalama DEGISTIRILMEDEN, 2026-11-16 kapanis duzeltme turunda AG ISTEGI
    // OLMADAN yeniden uretildi: parseDappTransaction(base64Tx) + decodeInstructions +
    // loadTokenAccountContext (token talimati yok -> rpc 0 cagri, ctx bos) + buildTxPreview ->
    // { hasUnknown:false, hasRedFlag:false, hasDurableNonce:true, rowKinds:['systemTransfer'] }.
    // AdvanceNonceAccount (ilk talimat) satir URETMEZ; ekrana hasDurableNonce uyarisi tasir.
    pipeline: {
        hasUnknown: false,
        hasRedFlag: false,
        hasDurableNonce: true,
        rowKinds: [
            'systemTransfer',
        ],
        korImzaKutusu: false,
    },
}
