import { concatHex, encodeAbiParameters, encodeFunctionData, keccak256, pad, parseAbi, stringToHex, toHex } from 'viem'

/**
 * EntryPoint v0.8 `Eip7702Support.INITCODE_EIP7702_MARKER`, 20 byte'a sıfır-dolgulu.
 *
 * BİLEREK ÇİFT TANIM: aynı sabit `server/sponsor.ts`'te de var. İstemci `server/`'ı import
 * ETMEMELİ (eklenti backend kodunu paketlemek zorunda kalmasın), bu yüzden burada kopyalanıyor.
 * `test/client/gasless.test.ts`'teki byte-eşitlik testi ikisinin sessizce ayrışmasını engeller —
 * bu sabiti değiştirirsen server/sponsor.ts'tekini de değiştir.
 */
export const EIP7702_INITCODE_MARKER = ('0x7702' + '00'.repeat(18)) as `0x${string}`

const u128 = (x: bigint) => pad(toHex(x), { size: 16 })

/** accountGasLimits = verificationGasLimit(16) | callGasLimit(16) — SIRA önemli. */
export function packAccountGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): `0x${string}` {
    return concatHex([u128(verificationGasLimit), u128(callGasLimit)])
}

/** gasFees = maxPriorityFeePerGas(16) | maxFeePerGas(16) — SIRA önemli. */
export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): `0x${string}` {
    return concatHex([u128(maxPriorityFeePerGas), u128(maxFeePerGas)])
}

const ACCOUNT_ABI = parseAbi(['function execute(address target, uint256 value, bytes data)'])
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 amount)'])

/**
 * Bootstrap op'unun callData'sı. Backend TEK bir çağrı ve TAM OLARAK MaxUint256 dayatır —
 * batch'e kullanıcının aksiyonunu eklemek reddedilir (aynı op içinde approve'u geri alan bir
 * yolcu çağrı deposit drenajına yol açardı).
 */
export function buildApproveCallData(ats: string, paymaster: string): `0x${string}` {
    const inner = encodeFunctionData({
        abi: ERC20_ABI,
        args: [paymaster as `0x${string}`, 2n ** 256n - 1n],
    })
    return encodeFunctionData({ abi: ACCOUNT_ABI, args: [ats as `0x${string}`, 0n, inner] })
}

/**
 * Rastgele bir hedefe rastgele bir çağrı — hesabın `execute`'una sarılmış. NORMAL modun
 * callData'sı budur; bootstrap'ın aksine backend içeriği KISITLAMAZ (`assertBootstrapCallDataSafe`
 * yalnız bootstrap dalında çağrılır, bkz. server/sponsor.ts).
 */
export function buildExecuteCallData(to: string, value: bigint, data: `0x${string}`): `0x${string}` {
    return encodeFunctionData({ abi: ACCOUNT_ABI, args: [to as `0x${string}`, value, data] })
}

/**
 * ÇAPRAZ-ZİNCİR ONBOARDING — kaynak zincirdeki (BSC) toplayıcıya izin veren op'un callData'sı.
 *
 * NEDEN AYRI BİR ADIM: çapraz-zincir yolunda `ATSGasCollector` kullanıcının ATS'sini
 * `transferFrom` ile çeker, yani kullanıcının BSC'de toplayıcıya izin vermesi gerekir. Bu izin
 * `approve(paymaster, ...)`'dan FARKLI bir harcayıcıya gider, dolayısıyla bootstrap op'una
 * SIĞDIRILAMAZ: bootstrap callData'sı byte düzeyinde tam olarak "paymaster'a sınırsız approve"
 * olmak ZORUNDA (deposit drenajı savunması).
 *
 * SIFIR NATIVE: bu op'un kendisi de gasless'tır. Sıra şudur ve hiçbir adımda BNB gerekmez —
 *   1) BSC'de bootstrap op'u: `buildApproveCallData(ats, paymaster)` → ücret postOp'ta ATS
 *   2) BSC'de normal op:      bu fonksiyon                            → ücret peşin ATS
 * Bundan sonra kullanıcı herhangi bir hedef zincirde işlem yapabilir; tahsilat BSC'de olur.
 *
 * `amount` SINIRSIZ VERİLMEMELİ: paymaster'dan farklı olarak toplayıcı hot-key'le tetiklenir
 * (`isCollector`), yani izin kullanıcının kabul ettiği toplam gaz bütçesi kadar olmalıdır.
 */
export function buildCollectorApproveCallData(ats: string, collector: string, amount: bigint): `0x${string}` {
    const inner = encodeFunctionData({ abi: ERC20_ABI, args: [collector as `0x${string}`, amount] })
    return encodeFunctionData({ abi: ACCOUNT_ABI, args: [ats as `0x${string}`, 0n, inner] })
}

// --- batch callData + swap/bridge komisyonu ---------------------------------------------

/**
 * Hesabın batch ucu. Selector `0x34fcd5be` — 2026-08-17'de BSC'de delege kontratının
 * (`0x268D193D…245A`) bytecode'unda DOĞRULANDI. Aynı bytecode'da `execute(bytes32,bytes)`
 * (ERC-7821) ve `executeBatch(address[],uint256[],bytes[])` varyantları YOK; yanlış varyantı
 * seçmek op'u zincirde revert'e düşürürdü ve bunu ancak gerçek bir gönderim gösterirdi.
 *
 * Tuple ALAN SIRASI (target, value, data) da kontratın kendi `Call` struct'ıdır — sıra
 * oynarsa ABI çözümü sessizce KAYAR (hedef adres value sanılır).
 */
const BATCH_ABI = parseAbi(['function executeBatch((address target, uint256 value, bytes data)[] calls)'])
const ERC20_TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount)'])

export interface BatchCall {
    to: string
    /** Verilmezse 0. Komisyon çağrısı HARİÇ (o her zaman 0), kullanıcı çağrıları serbesttir. */
    value?: bigint | number | string
    data?: `0x${string}`
}

const toCallTuple = (c: BatchCall) => ({
    target: c.to as `0x${string}`,
    value: c.value === undefined || c.value === null ? 0n : BigInt(c.value),
    data: (c.data && c.data !== '0x' ? c.data : '0x') as `0x${string}`,
})

/**
 * Komisyonsuz düz batch. BOŞ LİSTE REDDEDİLİR: hiçbir şey yapmayan ama gaz yakan (ve
 * çapraz-zincirde İADESİZ ücretlendirilen) bir op, sessizce göndermeye değmez.
 */
export function buildBatchCallData(calls: BatchCall[]): `0x${string}` {
    if (!Array.isArray(calls) || calls.length === 0) {
        throw new Error('buildBatchCallData: en az bir çağrı gerekli (boş batch gaz yakar, iş yapmaz)')
    }
    return encodeFunctionData({ abi: BATCH_ABI, args: [calls.map(toCallTuple)] })
}

/**
 * SWAP/BRIDGE KOMİSYONU — belge "Swap ve Bridge Komisyonu" §05.
 *
 * `sponsor()` TAM OLARAK `calls[0]`'a bakar; beş alan da zorunludur:
 *   target = ATS kontratı | value = 0 | `transfer(address,uint256)` | alıcı = commissionTreasury
 *   | tutar = `/quote`'un döndürdüğü `commissionAts` — **BİREBİR**, `>=` değil.
 * Birebir eşitlik bilinçli: tutar fiyat kilidiyle dondurulmuştur. Fazlası kullanıcı zararı,
 * eksiği operatör zararıdır.
 *
 * SIRA NEDEN DAYATILIYOR: komisyon başta olmasaydı, **ATS satan** bir swap komisyondan önce
 * çalışıp bakiyeyi tüketebilir, komisyon transferi revert eder ve op TÜMDEN düşerdi — tanısı
 * zor bir başarısızlık. Komisyonu başa çivilemek bunu imkânsız kılar.
 *
 * YALNIZ BSC'DE ÇAĞRILIR (`status.collection === 'local'`). Spoke zincirlerde komisyon zaten
 * BSC tahsilatının içindedir; op'a bir transfer eklemek ÇİFT ÖDEME olur (§02).
 *
 * `commission === 0n` ise sıradan bir batch üretilir — komisyon kapalıyken callData
 * bugünküyle bit-bit aynı kalır (backend şu an `commissionAts: "0"` dönüyor).
 */
export function buildCommissionBatchCallData(p: {
    ats?: string
    treasury?: string
    commission: bigint | number | string
    calls: BatchCall[]
}): `0x${string}` {
    const commission = BigInt(p.commission)
    if (commission < 0n) throw new Error('buildCommissionBatchCallData: komisyon negatif olamaz')
    if (commission === 0n) return buildBatchCallData(p.calls)
    if (!p.ats) throw new Error('buildCommissionBatchCallData: ats kontrat adresi gerekli')
    // §06.2: hazine adresi bir YAPILANDIRMADIR, kontrat sabiti değil — Safe `setTreasury` ile
    // değişebilir. Gömülü/bayat adresle kurulan her BSC komisyon op'u `commission-missing` ile
    // reddedilir ve kullanıcı görünürde sebepsiz bir hata görür. Eksikse burada, imzadan ÖNCE dur.
    if (!p.treasury) {
        throw new Error(
            'buildCommissionBatchCallData: treasury gerekli — her /paymaster/status çağrısında ' +
                'budget.commissionTreasury YENİDEN okunmalı (gömülü/bayat adres commission-missing verir)'
        )
    }
    const transfer = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        args: [p.treasury as `0x${string}`, commission],
    })
    return buildBatchCallData([{ to: p.ats, value: 0n, data: transfer }, ...(p.calls ?? [])])
}

export interface GasParams {
    callGasLimit: bigint
    verificationGasLimit: bigint
    preVerificationGas: bigint
    paymasterVerificationGasLimit: bigint
    paymasterPostOpGasLimit: bigint
    maxFeePerGas: bigint
}

export interface PackedUserOp {
    sender: `0x${string}`
    nonce: `0x${string}`
    initCode: `0x${string}`
    callData: `0x${string}`
    accountGasLimits: `0x${string}`
    preVerificationGas: `0x${string}`
    gasFees: `0x${string}`
    paymasterAndData: `0x${string}`
    signature: `0x${string}`
}

/** `paymasterAndDataPrefix`'in beklenen uzunluğu: paymaster(20) | pmVerifGas(16) | pmPostOpGas(16). */
const PAYMASTER_AND_DATA_PREFIX_BYTES = 52

/**
 * KRİTİK: `paymasterAndDataPrefix` backend'in İMZALADIĞI 52 byte'tır. Paymaster gaz limitlerini
 * burada yeniden paketlemek yasak — `ATSPaymaster.getHash` bu dilimi imzaya dahil ediyor, tek bir
 * byte oynarsa imza sessizce geçersiz olur (zincirde AA34).
 *
 * Uzunluk burada DENETLENİR (52 byte değilse throw) — sessizce yanlış bir dilimi kabul edip
 * zincirde ancak AA34 ile ortaya çıkacak bir hataya izin vermek yerine, çağıranın hatasını burada,
 * erken ve isimli bir mesajla yakalıyoruz.
 */
export function assembleUserOp(p: {
    sender: string
    nonce: bigint
    initCode: `0x${string}`
    callData: `0x${string}`
    verificationGasLimit: bigint
    callGasLimit: bigint
    preVerificationGas: bigint
    maxPriorityFeePerGas: bigint
    maxFeePerGas: bigint
    paymasterAndDataPrefix: `0x${string}`
    paymasterData: `0x${string}`
    signature: `0x${string}`
}): PackedUserOp {
    const prefixBytes = (p.paymasterAndDataPrefix.length - 2) / 2
    if (prefixBytes !== PAYMASTER_AND_DATA_PREFIX_BYTES) {
        throw new Error(
            `paymasterAndDataPrefix tam olarak ${PAYMASTER_AND_DATA_PREFIX_BYTES} byte olmalı (backend'in imzaladığı ` +
                `paymaster|pmVerificationGasLimit|pmPostOpGasLimit dilimi), ${prefixBytes} byte geldi`
        )
    }
    return {
        sender: p.sender as `0x${string}`,
        nonce: toHex(p.nonce),
        initCode: p.initCode,
        callData: p.callData,
        accountGasLimits: packAccountGasLimits(p.verificationGasLimit, p.callGasLimit),
        preVerificationGas: toHex(p.preVerificationGas),
        gasFees: packGasFees(p.maxPriorityFeePerGas, p.maxFeePerGas),
        paymasterAndData: concatHex([p.paymasterAndDataPrefix, p.paymasterData]),
        signature: p.signature,
    }
}

// --- EntryPoint v0.8 userOpHash (yerel hesap, RPC'siz) --------------------------------------
//
// GERÇEK BULGU (task-5): bootstrap'ta (initCode = EIP7702_INITCODE_MARKER, sender HENÜZ delege
// DEĞİL) EntryPoint'in `getUserOpHash(op)` view fonksiyonunu doğrudan zincire `eth_call` ile
// sormak HER ZAMAN "sender has no code" ile REVERT eder — hangi zincirde olursa olsun, hardhat'a
// özgü bir kısıtlama DEĞİL. Neden: EntryPoint'in `Eip7702Support._getEip7702InitCodeHashOverride`
// fonksiyonu 7702-işaretli bir initCode gördüğünde delege adresini sender'ın GÜNCEL kodundan
// (`extcodecopy`) okur; ama bu kod ancak aynı type-4 işlemin `authorizationList`'i uygulandıktan
// SONRA var olur — yani tam olarak `relayUserOp`'un göndereceği o işlemin İÇİNDE, işlem henüz
// gönderilmeden ÖNCE değil. Bir `eth_call` her zaman "önce" durumunu görür.
//
// Sonuç: istemci hiçbir zaman `entryPoint.getUserOpHash(op)`'u ilk-kez-kullanıcı bootstrap'ı için
// çağıramaz — kullanıcı imzalayacağı digest'i asla ALAMAZ, dolayısıyla bu projenin can alıcı
// özelliği (native'siz + delegesiz ilk işlem) client/gasless.ts'te tamamen İŞLEVSİZDİ. Bu, task-5
// öncesi hiçbir testin fark etmemesinin nedeni: hepsi delegasyonu `hardhat_setCode` ile taklit
// ediyordu, yani sender'ın kodu `getUserOpHash` çağrıldığında ZATEN vardı.
//
// DÜZELTME: delege adresi zaten off-chain BİLİNİYOR (kullanıcının imzaladığı authorization'ın
// `address` alanı == `cfg.delegate`) — bu yüzden hash'i HİÇ zincire sormadan, EntryPoint v0.8'in
// tam algoritmasını (`UserOperationLib.hash` + `Eip7702Support._getEip7702InitCodeHashOverride` +
// standart EIP-712 `toTypedDataHash`) burada birebir yeniden üretiyoruz. Doğruluğu, gerçek
// EntryPoint'e bir `eth_call` STATE OVERRIDE'ı (sender'ın kodu geçici olarak delegeye ayarlanmış
// gibi simüle edilip, hiçbir şey zincire YAZILMADAN okunan) ile bit-bit eşleştiği doğrulanarak,
// AYRICA gerçek bir type-4 işlemin ecrecover doğrulamasından geçtiği (bkz.
// test/hardhat/ats.gasless.first-user.test.ts) kanıtlandı.

const PACKED_USEROP_TYPEHASH = keccak256(
    stringToHex(
        'PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)'
    )
)
const EIP712_DOMAIN_TYPEHASH = keccak256(
    stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
)
// EntryPoint v0.8 constructor'ı: `EIP712(DOMAIN_NAME, DOMAIN_VERSION)` — DOMAIN_NAME="ERC4337",
// DOMAIN_VERSION="1" (sabit, sözleşme koduna gömülü).
const DOMAIN_NAME_HASH = keccak256(stringToHex('ERC4337'))
const DOMAIN_VERSION_HASH = keccak256(stringToHex('1'))

export interface UserOpHashParams {
    chainId: bigint
    entryPoint: `0x${string}`
    /**
     * `op.initCode === EIP7702_INITCODE_MARKER` ise ZORUNLU: bootstrap'ta uygulanacak delege
     * adresi (authorization.address / cfg.delegate ile aynı olmalı). Aksi halde (normal initCode
     * ya da initCode='0x') YOK SAYILIR.
     */
    eip7702Delegate?: `0x${string}`
}

/** Marker'ın byte uzunluğu — EntryPoint initCode'un İLK 20 byte'ına bakar, tamamına değil. */
const EIP7702_INITCODE_MARKER_BYTES = 20

/**
 * `Eip7702Support._isEip7702InitCode` ile aynı kural: initCode en az 2 byte VE ilk 20 byte'ı
 * (sıfır-dolgulu) `0x7702` işaretçisi. TAM eşitlik ARAMAZ — `0x7702` gibi kısa bir initCode da,
 * marker + ek ilklendirme verisi de 7702 sayılır. Tam-eşitlik kontrolü burada sessiz bir hash
 * ayrışması üretirdi (yerel hesap ile zincirinki farklı çıkardı).
 */
function isEip7702InitCode(initCode: string): boolean {
    if ((initCode.length - 2) / 2 < 2) return false
    const head = initCode.slice(2, 2 + EIP7702_INITCODE_MARKER_BYTES * 2).toLowerCase()
    // Kısa initCode'lar EntryPoint tarafında sıfırla doldurulup bytes20'ye cast edilir.
    return head.padEnd(EIP7702_INITCODE_MARKER_BYTES * 2, '0') === EIP7702_INITCODE_MARKER.slice(2).toLowerCase()
}

/**
 * EntryPoint v0.8 `getUserOpHash(op)` ile BİT-BİT AYNI değeri, zincire hiç dokunmadan hesaplar.
 * Bootstrap dışı (initCode='0x' ya da normal factory initCode) durumlarda da doğrudur — yalnızca
 * 7702-işaretli initCode için `eip7702Delegate` gerektirir (bkz. dosyanın üstündeki not).
 */
export function computeUserOpHash(op: PackedUserOp, params: UserOpHashParams): `0x${string}` {
    let hashInitCode: `0x${string}`
    if (isEip7702InitCode(op.initCode)) {
        if (!params.eip7702Delegate) {
            throw new Error('computeUserOpHash: initCode EIP-7702 işaretçisi ama eip7702Delegate verilmedi')
        }
        // Eip7702Support._getEip7702InitCodeHashOverride — İKİ dal da uygulanmalı:
        //   length <= 20 -> keccak256(delegate)
        //   length  > 20 -> keccak256(delegate || initCode[20:])
        // Bu istemci bugün yalnız ham marker üretiyor, ama >20 dalı EntryPoint v0.8'in belgelenmiş
        // 7702-hesap ilklendirme yolu (EntryPoint.initEip7702Sender). Eksik bırakılırsa cüzdan o
        // yolu kullandığı an HER kullanıcı imzası yanlış digest üzerinden atılır -> zincirde AA24.
        const tail = op.initCode.slice(2 + EIP7702_INITCODE_MARKER_BYTES * 2)
        hashInitCode = keccak256((params.eip7702Delegate + tail) as `0x${string}`)
    } else {
        hashInitCode = keccak256(op.initCode)
    }
    const hashCallData = keccak256(op.callData)
    const hashPaymasterAndData = keccak256(op.paymasterAndData)

    const structHash = keccak256(
        encodeAbiParameters(
            [
                { type: 'bytes32' },
                { type: 'address' },
                { type: 'uint256' },
                { type: 'bytes32' },
                { type: 'bytes32' },
                { type: 'bytes32' },
                { type: 'uint256' },
                { type: 'bytes32' },
                { type: 'bytes32' },
            ],
            [
                PACKED_USEROP_TYPEHASH,
                op.sender,
                BigInt(op.nonce),
                hashInitCode,
                hashCallData,
                op.accountGasLimits,
                BigInt(op.preVerificationGas),
                op.gasFees,
                hashPaymasterAndData,
            ]
        )
    )

    const domainSeparator = keccak256(
        encodeAbiParameters(
            [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
            [EIP712_DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, params.chainId, params.entryPoint]
        )
    )

    return keccak256(concatHex(['0x1901', domainSeparator, structHash]))
}

// --- zincir adres defteri ---------------------------------------------------------------

export interface ChainAddresses {
    paymaster: `0x${string}`
    ats: `0x${string}`
    /** EIP-7702 delegesi (Simple7702Account). */
    delegate: `0x${string}`
    entryPoint: `0x${string}`
}

export const ENTRYPOINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' as const

/**
 * 7702 delegesi CREATE2 ile, constructor argümanı OLMADAN deploy edilir (bkz.
 * deploy/04_Simple7702Account.ts) → initcode ve salt her ağda aynı, dolayısıyla ADRES de aynı.
 * Tek sabit yeterli; ağ başına ayrı alan tutmak sessiz bir tutarsızlık kaynağı olurdu.
 */
export const EIP7702_DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A' as const

/**
 * DEFTER YALNIZ CANLI ZİNCİRLERİ İÇERİR. Yeni bir ağ ancak paymaster'ı deploy edilip
 * yapılandırıldıktan (bounds + signer + updater + rate + deposit) SONRA buraya eklenir —
 * erken eklenen bir satır, istemciyi var olmayan bir kontrata imza göndermeye yönlendirir.
 *
 * 2026-08-12 FİLO YENİLEMESİ: backend same-chain paymaster'ların YENİ NESLİNİ dağıttı
 * (runtime 17524; eski nesil 16192). Eski adreslerin EntryPoint deposit'i her zincirde
 * 0'a indi — eski adresi tutmak `buildApproveCallData`'nın iznini ÖLÜ kontrata gönderirdi.
 * Yeni adresler /health'ten alınıp ZİNCİRDE doğrulandı: entryPoint() = v0.8, owner() =
 * 0xb42f545b… (eski filoyla aynı sahip), ats() = bu tablodaki ATS. Ethereum (1) istisna:
 * orada hâlâ eski nesil canlı. Aşağıdaki tarihli type-4 kanıt notları ESKİ filoya aittir;
 * tarihçe olarak duruyorlar. Tablo atsConfig.ATS_CHAINS ile birebir aynı olmak zorunda
 * (atsConfig.test.js kilitli).
 */
export const CHAIN_ADDRESSES: Record<number, ChainAddresses> = {
    42161: {
        paymaster: '0x89e6FA55fC0e29dFCdf1bbfA50c9c0BcC216c74c',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    // Base: eski filo 2026-07-25'te gerçek bir type-4 işlemle kanıtlandı (tx 0x6bad04e9…70bc).
    8453: {
        paymaster: '0xBcD8538fC26e9957101B467aD6B97c2792692B63',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    // BSC hub'dır: ödeme aracı makbuz DEĞİL, köprünün kilitlediği GERÇEK ATS.
    // Eski filo 2026-07-25'te gerçek type-4 işlemle kanıtlandı (tx 0x06ad0cc6…819b) — BSC'nin
    // 7702 desteği (Pascal) böylece sahada doğrulanmış oldu.
    56: {
        paymaster: '0x004e1f5aB1B7bf85412B11628Ca7A8C73Cd8ad53',
        ats: '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    // Polygon: eski filo 2026-07-25'te kanıtlandı (tx 0x2288b083…1d4a). DİKKAT: yeni paymaster
    // adresi Base ve Celo'nunkiyle AYNI — hata değil, deployer nonce'ları denk geldi
    // (hardhat-deploy nonce tabanlı CREATE kullanır). Farklı zincirler.
    137: {
        paymaster: '0xBcD8538fC26e9957101B467aD6B97c2792692B63',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    // Ethereum L1: köprünün DÖRDÜNCÜ spoke'u olarak 2026-07-25'te eklendi, ATSOFT adresi
    // diğer spoke'lardan FARKLI (deployer nonce'ı farklıydı). Gerçek type-4 işlemle kanıtlandı
    // (tx 0x0830d0b0…324d). UYARI: L1 gaz fiyatı oynaktır — paymaster'ın maxGasCost tavanı
    // 0.0005 ETH, gaz sıçradığında op'lar reddedilir (fail-closed, zarar yok).
    // 2026-08-13: Ethereum de yeni nesle geçti (filo yenilemesinin son halkası).
    // Zincirde doğrulandı: yeni pm runtime 8761 bayt (eski 8095), ats()/owner()/
    // entryPoint() aynı, EntryPoint deposit 0.0034 ETH — ESKİ adresin deposit'i
    // 0.0, yani ÖLÜ. Paymaster adresi bootstrap approve'un spender'ı olduğu için
    // bayat adresle Ethereum'da gerçek gaz yakılıp allowance hiç yükselmiyordu.
    1: {
        paymaster: '0xfc5ab2451c28a2E92A2Ea90e126e1f890c75Df9e',
        ats: '0x20bE3d6D519c5825715afa003Ea857f750dEC1c8',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    // ---- 2026-07-27'de eklenen köklü ağlar ----
    // ESKİ filoda beşinde de paymaster AYNI adrese çıkmıştı; YENİ filoda her birinin adresi
    // ayrı (yalnız Celo, Polygon/Base ile paylaşıyor). ATSOFT beşinde de aynı adreste.
    // Her ağ eski filoda gerçek bir type-4 işlemle kanıtlanmıştı: native'i SIFIR olan taze
    // bir EOA tek işlemde hem delege oldu hem gazı ATS ile ödedi.
    10: {
        // Optimism, eski kanıt tx 0xe7498201…d929. RPC NOTU: mainnet.optimism.io PENDING
        // nonce'u 0 döndürüyor, işlem gönderiminde kullanma (bkz. hardhat.config.ts).
        // DİKKAT: yeni paymaster'ın EntryPoint deposit'i 2026-08-12'de 0 ölçüldü —
        // doldurulana kadar op'lar AA31 ile düşebilir (backend'e bildirildi).
        paymaster: '0xb5F03d9d3BB48AbDf2964F0E41186fFEe12C0A7e',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    100: {
        // Gnosis, eski kanıt tx 0x0b74c67f…b9dc. Gaz parası xDAI; borsada listeli olmadığı
        // için keeper fiyatı 1.00 USD SABİT alır (bkz. tasks/paymaster.ts PEGGED_USD).
        // DİKKAT: bu adres OP'nin REMOTE paymaster'ıyla aynı (farklı zincir, farklı kontrat).
        paymaster: '0xAcdA4ed33E1296799cBEc4501f13fd7292E1132b',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    42220: {
        // Celo, eski kanıt tx 0x0c3e46f5…9dca. forno.celo.org yük dengeli: makbuz görüldükten
        // hemen sonraki durum okuması GERİDE kalmış düğüme düşebiliyor.
        paymaster: '0xBcD8538fC26e9957101B467aD6B97c2792692B63',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    5000: {
        // Mantle, eski kanıt tx 0x7b314b47…74c2.
        paymaster: '0x063d4e5Ee1C60489509cD5b93DD9190713d6E2C3',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
    25: {
        // Cronos, eski kanıt tx 0x19d4c900…83c6. LayerZero'nun endpoint adresi bu ağda FARKLI
        // (0x3a73033c…, çoğu ağda 0x1a44…728c) — köprü tarafını ilgilendirir.
        paymaster: '0x4A275c4D99bf3747A459362DF44D3FcC413d4dD5',
        ats: '0xE2D977DC010F15BDDAA656141890e3e00E16D012',
        delegate: EIP7702_DELEGATE,
        entryPoint: ENTRYPOINT_V08,
    },
}

/** Bilinmeyen zincirde SESSİZ undefined dönmez: çağıran `undefined` adrese imza göndermesin. */
export function addressesFor(chainId: number): ChainAddresses {
    const a = CHAIN_ADDRESSES[chainId]
    if (!a) {
        throw new Error(`zincir desteklenmiyor: ${chainId} (destekli: ${Object.keys(CHAIN_ADDRESSES).join(', ')})`)
    }
    return a
}

export interface GaslessClientOptions {
    baseUrl: string
    chainId: number
}

const gasToStrings = (g: GasParams) => ({
    callGasLimit: g.callGasLimit.toString(),
    verificationGasLimit: g.verificationGasLimit.toString(),
    preVerificationGas: g.preVerificationGas.toString(),
    paymasterVerificationGasLimit: g.paymasterVerificationGasLimit.toString(),
    paymasterPostOpGasLimit: g.paymasterPostOpGasLimit.toString(),
    maxFeePerGas: g.maxFeePerGas.toString(),
})

/**
 * Backend'in `code` alanını taşır — cüzdan Türkçe METNE bakmasın.
 *
 * `status` de taşınır: kodsuz hatalarda karar HTTP durumundan verilir ve 4xx ile 5xx AYRI
 * şeylerdir (`atsBlocker`: 5xx -> "sunucu hatası, sonra dene", 4xx -> geçici). Durumu
 * düşürmek her kodsuz hatayı 4xx saymak demekti; 2026-08-10'da `/relay` nginx'ten **504**
 * dönerken ekranda jenerik "geçici bir sorun" yazıyordu.
 */
export class GaslessError extends Error {
    readonly code?: string
    readonly status?: number
    constructor(message: string, code?: string, status?: number) {
        super(message)
        this.code = code
        this.status = status
    }
}

export interface QuoteResponse {
    atsFee: string
    atsFeeFormatted: string
    validUntil: number
    note: string
    atsFeeCrosschain?: string
    atsFeeCrosschainFormatted?: string
    quoteId?: string
    quoteExpiresAt?: number
    /**
     * KİLİTLENEN gerçek komisyon (ATS-wei) — `/sponsor` BSC'de `calls[0]`'ı BUNUNLA birebir
     * doğrular. `/status`'ün `budget.commissionAts`'i batch'i KURMAK içindir (callData henüz
     * yokken `/quote`'a verilemez — tavuk-yumurta); ikisi yalnız keeper tam o anda `setRate`
     * yazdıysa ayrışır.
     *
     * Komisyon KAPALIYKEN backend bu alanı HİÇ göndermez (2026-08-17'de canlı ölçüldü) —
     * `undefined` "komisyon yok" demektir, hata değil.
     */
    commissionAts?: string
    commissionTreasury?: string
}

export interface StatusResponse {
    chainId: number
    mode?: 'normal' | 'bootstrap' | 'crosschain'
    ready: boolean
    blocker?: string
    /**
     * Hedef zincirde kod var mı. `runSponsoredOp` op'un `authorization` taşıyıp taşımayacağına
     * BUNA bakarak karar verir — "bizim delegemiz mi" sorusunu `delegation` yanıtlar.
     */
    delegated: boolean
    /**
     * `'foreign'`: hesap BAŞKA bir 7702 uygulamasına bağlı. `blocker: 'foreign-delegation'`
     * eşlik eder ve bootstrap/crosschain sponsorluğu mümkün DEĞİLDİR — yeni bir authorization
     * göndermek de çözmez, sunucu onu da reddeder. Eski sunucular bu alanı göndermez.
     */
    delegation?: 'none' | 'ours' | 'foreign'
    /**
     * KOMİSYON BÖLGESİ — belge "Swap ve Bridge Komisyonu" §02'nin TEK yetkili kaynağı.
     *
     * `'local'` (BSC): komisyon op'un İÇİNE, `calls[0]`'a konur.
     * `'src'`  (dokuz spoke): komisyon BSC tahsilatının içindedir; op'a bir şey EKLENMEZ.
     *
     * `chainId !== 56` gibi istemcide tutulan bir kuralla DEĞİŞTİRİLEMEZ: bu alan tahsilatın
     * nerede yapıldığını sunucunun kendi yapılandırmasından söyler. 2026-08-17'de canlı
     * doğrulandı (56 → "local", 137 → "src"). `mode` ile karıştırma — o, hedef zincirdeki
     * sponsorluk şeklini anlatır (bkz. atsConfig.isCrosschainCollection notu).
     */
    collection?: 'local' | 'src'
    nextSteps: Array<{
        chainId: number
        action: 'approve-paymaster' | 'approve-collector'
        sponsored: true
        suggestedAmount?: string
    }>
    budget: {
        srcBalance: string
        srcAllowance: string
        minChargeAts: string
        /**
         * Batch'i KURMAK için gereken komisyon tahmini (ATS-wei). Kilitlenen gerçek tutar
         * `/quote`'un `commissionAts`'idir; ikisi ayrışırsa batch yeni tutarla kurulup quote
         * tekrarlanır (§04).
         *
         * Komisyon kapalıyken `"0"` döner ve davranış komisyonsuz hâlle bit-bit aynıdır.
         */
        commissionAts?: string
        /**
         * Komisyonun gideceği hazine. YAPILANDIRMADIR, kontrat sabiti DEĞİL — Safe `setTreasury`
         * ile değişir. HER `/status` çağrısında yeniden okunmalı; başka hiçbir uçtan gelmez.
         * Komisyon kapalıyken alan hiç gönderilmez (2026-08-17 canlı ölçüm).
         */
        commissionTreasury?: string
    }
}

export class GaslessClient {
    constructor(
        private readonly opts: GaslessClientOptions,
        // EKLENTI FARKI: satici surumu `fetchImpl: typeof fetch = fetch` yaziyor. Native fetch
        // `this === globalThis` bekler; alan olarak tutulup `this.fetchImpl(...)` ile cagirilinca
        // `this` instance'a baglanir ve tarayici service worker'inda "TypeError: Illegal
        // invocation" atar. Node/undici toleransli oldugu icin yalniz tarayicida gorunur
        // (2026-07-24'te canlida "Ucret hesaplanamadi" olarak yasandi). Sarmalayici sart.
        private readonly fetchImpl: typeof fetch = (...args) => fetch(...args)
    ) {}

    // EKLENTI FARKI: satici surumu durum kodundan ONCE `res.json()` cagiriyor. Backend'in
    // onundeki CDN 502/503/524'te govde HTML olur; `res.json()` SyntaxError atar ve durum kodu
    // TAMAMEN kaybolur (kullanici "Unexpected token <" gorur, hata eslemesi hic calismaz).
    // Once text, sonra korumali parse.
    private parse(status: number, ok: boolean, raw: string): any {
        let json: any = null
        try { json = raw ? JSON.parse(raw) : null } catch { /* JSON degil; asagida ele alinir */ }
        if (!ok) throw new GaslessError(json?.error || `HTTP ${status}`, json?.code, status)
        if (json === null) throw new GaslessError(`backend gecersiz yanit dondu (HTTP ${status})`, undefined, status)
        return json
    }

    private async post(path: string, body: unknown): Promise<any> {
        const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
        return this.parse(res.status, res.ok, await res.text())
    }

    private async get(path: string): Promise<any> {
        const res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, { method: 'GET' })
        return this.parse(res.status, res.ok, await res.text())
    }

    // EKLENTI FARKI: satici SDK'sinda yok. Zincir basina yetkili paymaster adresini dondurur;
    // `assertSponsorConsistent`in allowlist'ini tazelemek icin kullanilir (bkz. spec 4.4).
    health(): Promise<{ ok: boolean; chains: Array<{ chainId: number; paymaster: string; bootstrapRemainingToday: number }> }> {
        return this.get('/health')
    }

    /**
     * Ekranda "en fazla ~X ATS" göstermek için.
     *
     * `sender` VERİLMELİDİR: backend fiyat kilidini (`quoteId`) yalnız sender bilindiğinde
     * üretir. Kilit olmadan `/sponsor` fiyatı yeniden okur ve gösterilen ile tahsil edilen
     * ayrışabilir — çapraz-zincirde bunun iade yolu YOKTUR.
     */
    quote(gas: GasParams, sender?: string, callData?: `0x${string}`): Promise<QuoteResponse> {
        return this.post('/paymaster/quote', {
            chainId: this.opts.chainId,
            gas: gasToStrings(gas),
            ...(sender ? { sender } : {}),
            // KOMİSYONLU OP'TA ZORUNLU (§07): `callData` olmadan üretilen kilit `/sponsor`'dan
            // `commission-quote-required` ya da `commission-lock-missing` ile döner — ve bu
            // HER ZİNCİRDE olur, spoke dahil (komisyon kapısı mod seçiminden ÖNCE çalışır).
            // Kilit `callData`'ya çivilenir; batch değişirse `quoteId` de yenilenmeli.
            ...(callData ? { callData } : {}),
        })
    }

    sponsor(req: {
        sender: string
        nonce: bigint
        initCode?: `0x${string}`
        callData: `0x${string}`
        gas: GasParams
        maxPriorityFeePerGas: bigint
        authorization?: unknown
        quoteId?: string
        /**
         * ZİNCİR-KANITLI TAHSİLAT MAKBUZU — yalnız çapraz-zincir YENİDEN DENEMESİNDE.
         *
         * Çapraz-zincirde ücret imzadan ÖNCE tahsil edilir; `/relay` düşerse para gitmiştir.
         * `quoteId` bunu kilit ömrü boyunca (~120 sn) kapatır. Daha sonra tekrar denerken ilk
         * `/sponsor` yanıtındaki `settlementId` ve `atsFee`'yi BURADAN geri gönder: sunucu
         * ödemeyi zincirden doğrular, İKİNCİ KEZ TAHSİL ETMEZ ve yeniden imzalar.
         *
         * Op'un HER alanı ilk istekle birebir aynı olmalı (sender, nonce, callData, gaz) —
         * aksi halde `settlement-mismatch`.
         */
        settlement?: { id: string; atsAmount: string }
    }) {
        return this.post('/paymaster/sponsor', {
            chainId: this.opts.chainId,
            sender: req.sender,
            nonce: toHex(req.nonce),
            initCode: req.initCode ?? '0x',
            callData: req.callData,
            gas: gasToStrings(req.gas),
            maxPriorityFeePerGas: req.maxPriorityFeePerGas.toString(),
            ...(req.authorization === undefined ? {} : { authorization: req.authorization }),
            ...(req.quoteId ? { quoteId: req.quoteId } : {}),
            ...(req.settlement ? { settlement: req.settlement } : {}),
        })
    }

    /**
     * "Bu kullanıcı şu an ne yapabilir." HER İŞLEMDE ÇAĞIRMA — uç 9-10 zincir okuması yapar.
     * Ağ değişince ve onboarding sonrası yeterli.
     */
    status(sender: string): Promise<StatusResponse> {
        return this.get(`/paymaster/status?chainId=${this.opts.chainId}&sender=${sender}`)
    }

    relay(userOp: PackedUserOp, authorization?: unknown) {
        return this.post('/paymaster/relay', {
            chainId: this.opts.chainId,
            userOp,
            ...(authorization === undefined ? {} : { authorization }),
        })
    }
}
