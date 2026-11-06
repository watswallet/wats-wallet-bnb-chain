import { Contract, Interface, Transaction, getAddress, isAddress, keccak256, ZeroAddress } from 'ethers'
import { DEPOSIT_EXECUTION_PROBE_GAS_CAP, depositGasWithHeadroom } from '@silentswap/chains'
import { depositPlanFromQuote, atsCallsFromPlan, expiresAtMs, assertQuoteMatches, CANONICAL_GATEWAY, RETIRED_GATEWAYS } from './silentswap'
import { PAYOUT_CHAIN_ID } from './silentswapConfig'
import { QUOTE_MIN_REMAINING_MS } from './privateConstants'
import { resolveAtsBlocker } from '../atsBlocker'

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
]
const defaultErc20 = (address, runner) => new Contract(address, ERC20_ABI, runner)

// SDK'nin yedek gaz tahminleri: deposit'in estimateGas'i approve'dan ONCE revert
// eder (sdk/dist/client.js resolveDepositGas). Gateway zincirinde 500k, digerlerinde
// 800k; approve icin 60k (izin sifirlama gerekirse iki approve).
const DEPOSIT_GAS_GATEWAY = 500000n
const DEPOSIT_GAS_OTHER = 800000n
const APPROVE_GAS = 60000n

// QUOTE_MIN_REMAINING_MS (yatirma baslarken ve imzadan once tekliften en az kalmasi gereken sure) importsuz
// privateConstants.js'te yasar: popup da okur ve bu dosyayi (yurutucu) paketine cekmemeli (T25 M3).
// SDK de approve makbuzunu 120 sn bekler (sdk/dist/client.js): takili bir approve global islem
// kuyrugunu (ve cevabi) sonsuza dek tutmasin.
const APPROVE_WAIT_MS = 120000

// Gizli akislarin HICBIR tek RPC istegi bu sureyi asmaz (Chrome, cevabi 30 sn'den gec gelen bir fetch'te
// servis calisanini sonlandirir: takili dugum "temiz hata" yerine ani olum olurdu). Sinir iki yerde
// uygulanir: arka plan saglayiciyi bu istek zaman asimiyla kurar (FetchRequest.timeout) ve yurutucu her
// on-imza RPC adimini ayrica bu sureyle sarar (rpc). Yayin denemesi ve makbuz sorgusu da ayni sureyi kullanir.
export const PRIVATE_RPC_TIMEOUT_MS = 15000

// Ag/saglayici hatasi disinda anlami olan ethers hata kodlari: bunlar saglayici kesintisi DEGILDIR ve
// oldugu gibi yukari gider (zincirde revert, bakiye yetmez, nonce, kullanici reddi).
const NOT_PROVIDER_CODES = new Set(['CALL_EXCEPTION', 'INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'REPLACEMENT_UNDERPRICED', 'ACTION_REJECTED'])

// On-imza RPC adimini sinirlar. `steps`: adimin ardisik kac istek icerdigi (approve gonderimi nonce +
// tahmin + ucret + gonderim); her istek ayrica saglayicinin kendi zaman asimiyla sinirlidir. Zaman asimi
// ve ag hatasi PRIVATE_PROVIDER_DOWN olur (hicbir sey gonderilmedi, ticket yeniden denenebilir).
async function rpc(promise, steps = 1) {
    try {
        return await withDeadline(Promise.resolve(promise), PRIVATE_RPC_TIMEOUT_MS * steps)
    } catch (e) {
        if (NOT_PROVIDER_CODES.has(e?.code) || /^PRIVATE_[A-Z_]+$/.test(String(e?.message))) throw e
        throw Object.assign(new Error('PRIVATE_PROVIDER_DOWN'), { cause: e })
    }
}

// Agir rota siniri (R5): ATS ucret teklifi op'un callGasLimit'ini bildirir; SDK'nin desteklenen yatirma sinirini
// (DEPOSIT_EXECUTION_PROBE_GAS_CAP) asiyorsa true. Eksik ya da bozuk deger false'tur (sinir atlanir, yurutucu ayrica denetler).
export function depositGasExceedsCap(callGas) {
    try {
        if (callGas === undefined || callGas === null || callGas === '') return false
        return BigInt(callGas) > DEPOSIT_EXECUTION_PROBE_GAS_CAP
    } catch {
        return false
    }
}

export function assertQuoteFresh(quote, now = Date.now(), marginMs = 0) {
    // Fail-closed: suresi eksik, sayi olmayan ya da pozitif olmayan teklif "hic dolmaz"
    // sayilmaz; taze oldugu kanitlanamayan teklifle para gonderilmez.
    const exp = expiresAtMs(quote?.expiresAt)
    if (exp === null || exp - marginMs <= now) throw new Error('PRIVATE_QUOTE_EXPIRED')
}

async function assertSourceFunds(wallet, plan, erc20) {
    if (plan.approval) {
        const balance = await rpc(erc20(plan.approval.token, wallet.provider).balanceOf(wallet.address))
        if (balance < plan.approval.amount) throw new Error('PRIVATE_INSUFFICIENT_BALANCE')
    } else if ((await rpc(wallet.provider.getBalance(wallet.address))) < plan.deposit.value) {
        throw new Error('PRIVATE_INSUFFICIENT_BALANCE')
    }
}

async function assertNativeGas(wallet, plan) {
    const [balance, fee] = await rpc(Promise.all([wallet.provider.getBalance(wallet.address), wallet.provider.getFeeData()]), 2)
    const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n
    const depositGas = plan.chainId === Number(PAYOUT_CHAIN_ID) ? DEPOSIT_GAS_GATEWAY : DEPOSIT_GAS_OTHER
    const units = depositGas + (plan.approval ? APPROVE_GAS * 2n : 0n)
    if (balance < plan.deposit.value + units * gasPrice) throw new Error('PRIVATE_INSUFFICIENT_GAS')
}

// Doldurulmus islem (gasLimit + ucret alanlari) icin bakiye: `value` + gasLimit x ucret tavani (yatirmada
// deposit.value, iadede 0n). Ucret alani yoksa (beklenmeyen) fail-closed: hesaplanamayan butceyle imzalanmaz.
async function assertPopulatedGas(wallet, value, populated) {
    const price = populated?.maxFeePerGas ?? populated?.gasPrice
    if (typeof price !== 'bigint' || typeof populated.gasLimit !== 'bigint') throw new Error('PRIVATE_FAILED')
    const balance = await rpc(wallet.provider.getBalance(wallet.address))
    if (balance < value + populated.gasLimit * price) throw new Error('PRIVATE_INSUFFICIENT_GAS')
}

// Izin HER ZAMAN tam tutar: harcayicinin erisimi karttaki tutara ESIT olmali. USDT (Ethereum) gibi
// tokenlar sifir olmayan izni dogrudan degistirmeye izin vermez: once 0. Mevcut izin tutardan BUYUKSE
// (onceki basarisiz/suresi dolmus bir siparisten kalan) da ayni yol izlenir: o artik harcayicinin tutari
// asan erisimidir ve kartta gorunmez (T24 M2-m2).
async function ensureExactAllowance(wallet, approval, erc20) {
    if (!approval) return
    const token = erc20(approval.token, wallet)
    const current = await rpc(token.allowance(wallet.address, approval.spender))
    if (current === approval.amount) return
    if (current > 0n) await waitApprove(await rpc(token.approve(approval.spender, 0n), 2))
    await waitApprove(await rpc(token.approve(approval.spender, approval.amount), 2))
}

// ATS yolu icin harcayicinin kaynak token uzerindeki MEVCUT izni (bigint); approval yoksa (native kaynak) null.
// Okuma ayni rpc() sarmalayicisidir ve BASARISIZ okuma izin bilinmiyor demektir: her hata (CALL_EXCEPTION dahil)
// PRIVATE_PROVIDER_DOWN olur, hicbir sey gonderilmedi (ATS ucret teklifi ve yurutme fail-closed).
export async function readApprovalAllowance({ provider, owner, approval, erc20 = defaultErc20 }) {
    if (!approval) return null
    try {
        return BigInt(await rpc(erc20(approval.token, provider).allowance(owner, approval.spender)))
    } catch (e) {
        if (e?.message === 'PRIVATE_PROVIDER_DOWN') throw e
        throw Object.assign(new Error('PRIVATE_PROVIDER_DOWN'), { cause: e })
    }
}

// Imzadan ONCE, SDK placeOrder gibi, yatirmayi NIHAI gasLimit ile eth_call ile dener (deposit-gas.js
// basligi: tahmin zamaninda basarili rota yayin limitinde revert edebilir ve kullanici gazi yakar).
// Revert PRIVATE_UNSUPPORTED; ag/zaman asimi PRIVATE_PROVIDER_DOWN (rpc).
async function assertDepositSimulates(wallet, plan, populated) {
    try {
        await rpc(wallet.provider.call({
            from: wallet.address, to: plan.deposit.to, data: plan.deposit.data, value: plan.deposit.value, gasLimit: populated.gasLimit,
        }))
    } catch (e) {
        if (e?.code === 'CALL_EXCEPTION') throw Object.assign(new Error('PRIVATE_UNSUPPORTED'), { cause: e })
        throw e
    }
}

// Imzalanan BAYTLAR beklenen islemle (yatirmada sabitlenen plan, iadede refund(ticket) cagrisi) esit olmali
// (T24 M2-I4): hedef, calldata, deger, zincir ve gonderen. Karttaki islemle imzali islemin ayri olmasi ana
// kritik hatadir; populateTransaction ya da bir refactor bunu sessizce yeniden acamaz. Ek olarak imzali baytlar
// DOLDURULMUS islemin turunde (tur bos birakildiysa ethers'in cikarabilecegi turlerde), ayni gasLimit ve
// nonce'ta olmali (bakiye butcesi assertPopulatedGas'ta bunlarla hesaplandi) ve EIP-7702 yetki listesi (tur 4)
// ya da blob (tur 3) tasimamali: bes alanli esitlik yetmez, imzali islem baska bir turde yeniden kodlanmis
// olabilir (T24 M8). Kayit ve yayindan ONCE, fail-closed. `errorCode`: yatirmada PRIVATE_QUOTE_MISMATCH,
// iadede PRIVATE_REFUND_NOT_ALLOWED; yatirma ve iade ayni koruyucuyu kullanir (T25 M1).
const SIGNED_TX_TYPES = [0, 1, 2]
function assertSignedTransaction(signed, expected, populated, errorCode) {
    const refuse = (cause) => Object.assign(new Error(errorCode), cause ? { cause } : {})
    let tx
    let filled
    let allowedTypes
    try {
        tx = Transaction.from(signed)
        // Doldurulmus islem, imzalayanin (ethers Signer.signTransaction) kurdugu ayni kodlamayla okunur.
        const { from: _from, ...rest } = populated
        filled = Transaction.from(rest)
        allowedTypes = (filled.type === null ? filled.inferTypes() : [filled.type]).filter((t) => SIGNED_TX_TYPES.includes(t))
    } catch (e) {
        throw refuse(e)
    }
    const ok = typeof tx.to === 'string' && getAddress(tx.to) === getAddress(expected.to)
        && String(tx.data).toLowerCase() === String(expected.data).toLowerCase()
        && tx.value === expected.value
        && tx.chainId === BigInt(expected.chainId)
        && typeof tx.from === 'string' && getAddress(tx.from) === getAddress(expected.from)
        && allowedTypes.includes(tx.type)
        && (!tx.authorizationList || tx.authorizationList.length === 0)
        && tx.gasLimit === filled.gasLimit
        && tx.nonce === filled.nonce
    if (!ok) throw refuse()
}

// Zaman asimi ya da revert: izin zaten teklif tutariyla sinirli, yatirma HIC gonderilmedi.
async function waitApprove(tx) {
    try {
        await tx.wait(1, APPROVE_WAIT_MS)
    } catch (e) {
        // Asil hata cause'ta kalir (zaman asimi mi revert mi): isleyici loglar, arayuze gitmez.
        throw Object.assign(new Error('PRIVATE_FAILED'), { cause: e })
    }
}

// Yayin hatasinin metin parcalari (ethers hatayi katmanlar: asil dugum mesaji info.error'da olabilir).
const errorTexts = (e) => [e?.message, e?.shortMessage, e?.info?.error?.message, e?.error?.message]
    .filter((t) => typeof t === 'string').join(' | ')
const ALREADY_KNOWN_RE = /already known|known transaction|already imported/i
const INSUFFICIENT_FUNDS_RE = /insufficient funds/i
// "transaction underpriced" replacement'i de kapsar. Taban ucret retleri (base fee) dugumun islemi
// KABUL ETMEDIGINI soyler: onlari belirsiz saymak siparisi sonsuza dek acik birakirdi (T14 M4).
const DEFINITIVE_RE = /insufficient funds|nonce too low|transaction underpriced|intrinsic gas too low|exceeds block gas limit|max fee per gas less than block base fee|fee cap less than block base fee/i
const DEFINITIVE_CODES = new Set(['INSUFFICIENT_FUNDS', 'NONCE_EXPIRED', 'REPLACEMENT_UNDERPRICED'])
const NONCE_TOO_LOW_RE = /nonce too low/i

// Belirsiz yayin sonucunda AYNI imzali bayt en fazla iki kez daha gonderilir: hash ayni oldugu icin
// tekrar zararsizdir (kabul ya da "already known" = gitti). Aralik dugumun toparlanmasina yeter.
const BROADCAST_ATTEMPTS = 3
const REBROADCAST_DELAY_MS = 1500
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Yayin hatasini siniflar. Imzali islemin hash'i zaten kayitli: hata her zaman hash'i tasir.
//  - kesin ret (dugum islemi KABUL ETMEDI): definitive:true + eslenen kod
//  - gerisi (ag, zaman asimi, sunucu, bilinmeyen): islem gitmis OLABILIR -> definitive:false
function broadcastError(e, hash, unconfirmedCode) {
    const text = errorTexts(e)
    const definitive = DEFINITIVE_CODES.has(e?.code) || DEFINITIVE_RE.test(text)
    const insufficient = e?.code === 'INSUFFICIENT_FUNDS' || INSUFFICIENT_FUNDS_RE.test(text)
    const err = new Error(!definitive ? unconfirmedCode : insufficient ? 'PRIVATE_INSUFFICIENT_GAS' : 'PRIVATE_FAILED')
    err.hash = hash
    err.definitive = definitive
    err.cause = e
    return err
}

export const isNonceTooLow = (e) => e?.code === 'NONCE_EXPIRED' || NONCE_TOO_LOW_RE.test(errorTexts(e))
// Arka plan uzlastirmasi (ham bayti yeniden yayinlar) ayni siniflamayi kullanir: "already known" zararsizdir, gerisi loglanir.
export const isAlreadyKnown = (e) => ALREADY_KNOWN_RE.test(errorTexts(e))

// Her yayin denemesinin (ve makbuz sorgusunun) suresi: takili bir RPC global islem kuyrugunu
// (ethers varsayilani 300 sn) dakikalarca tutmasin ve hicbir tek istek PRIVATE_RPC_TIMEOUT_MS'yi (15 sn)
// asmasin. Zaman asimi BELIRSIZ sayilir; sonraki deneme AYNI imzali bayti yeniden gonderir (hash ayni
// oldugu icin zararsiz). Tum yayin evresi boylece sinirlidir: 3 deneme x 15 sn + aradaki beklemeler +
// (yalniz belirsiz denemeden sonra "nonce too low" gelirse) tek makbuz sorgusu, en fazla 15 sn daha.
// Imzali bayt kalicidir (siparis kaydinda rawDepositTx): calisan oldurulurse uzlastirma ayni bayti yayinlar.
const BROADCAST_ATTEMPT_TIMEOUT_MS = PRIVATE_RPC_TIMEOUT_MS

// `promise` ms icinde bitmezse TIMEOUT hatasiyla reddeder. Gec gelen sonuc yutulur (yakalanmamis ret yok).
function withDeadline(promise, ms) {
    let timer
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('yayin zaman asimi'), { code: 'TIMEOUT' })), ms)
    })
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// "nonce too low" belirsiz bir denemeden SONRA gelirse bu islemin kendisi madenlenmis olabilir:
// makbuz bir kez sorgulanir. Donus: 1 (madenlendi), 0 (zincirde basarisiz) ya da null (makbuz yok /
// sorgu hata verdi: belirsiz kalir ve yoklama karar verir).
async function receiptStatusOf(provider, hash) {
    try {
        const receipt = await withDeadline(Promise.resolve(provider.getTransactionReceipt(hash)), BROADCAST_ATTEMPT_TIMEOUT_MS)
        if (receipt && (receipt.status === 1 || receipt.status === 0)) return receipt.status
    } catch {
        // makbuz okunamadi: belirsiz
    }
    return null
}

// Imzali bayti yayinlar; donus: tx cevabi ya da null ("already known" ya da madenlendi: cevap yok).
// Yalniz BELIRSIZ sonuc tekrarlanir. Onceki bir deneme belirsiz bittiyse "nonce too low" bu islemin
// KENDISININ madenlendigi anlamina gelebilir: kesin ret sayilmaz; makbuz bir kez sorgulanir
// (status 1 = gitti, status 0 = zincirde basarisiz = kesin ret, makbuz yok = belirsiz kalir).
async function broadcastWithRetry(provider, signed, hash, sleep, unconfirmedCode = 'PRIVATE_DEPOSIT_UNCONFIRMED') {
    let ambiguous = null
    let receiptChecked = false
    for (let attempt = 0; attempt < BROADCAST_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(REBROADCAST_DELAY_MS)
        try {
            return await withDeadline(Promise.resolve(provider.broadcastTransaction(signed)), BROADCAST_ATTEMPT_TIMEOUT_MS)
        } catch (e) {
            // Dugum "zaten biliyorum" derse ayni imzali islem havuzdadir: basaridir.
            if (isAlreadyKnown(e)) return null
            const err = broadcastError(e, hash, unconfirmedCode)
            const nonceAfterAmbiguous = err.definitive && ambiguous && isNonceTooLow(e)
            if (err.definitive && !nonceAfterAmbiguous) throw err
            if (nonceAfterAmbiguous && !receiptChecked) {
                receiptChecked = true
                const status = await receiptStatusOf(provider, hash)
                if (status === 1) return null
                if (status === 0) {
                    // Zincirde status-0 makbuzu: kesin ret, ve cagirana KART metni icin soylenir
                    // (canli status-0 makbuzuyla ayni ONCHAIN_FAILED karti; cevap kodu degismez).
                    err.onchainFailed = true
                    throw err
                }
            }
            ambiguous = ambiguous || err
        }
    }
    throw ambiguous
}

// Yatirmayi gonderir. NATIVE gazda sira: approve (gerekirse, izin tam tutara esitlenir) -> tahmin ->
// doldur -> nihai gasLimit ile eth_call benzetimi -> imzala -> imzali baytlari plana karsi dogrula ->
// hash'i imzali bayttan hesapla -> onSubmitted(hash, imzaliBayt) (KAYIT) -> YAYINLA. Kayit yazilamazsa hicbir sey
// yayinlanmaz (para gitmedi, ticket kullanilabilir); yayin sonucu belirsiz kalsa bile hash
// kayitlidir ve ayni ticket bir daha gonderilmez (spec 9.2). ATS'te op relay edildigi anda
// onSubmitted cagrilir (kayit relay'den sonra).
// `expected`: saklanan istek beklentileri ({ sourceChainId, sourceAsset, payoutUsdc,
// outputToken, outputAddress }); outputToken secilen teslim tokenidir ({ chainId, address, symbol, decimals };
// chainId ZORUNLU, eski `outputAsset` dizgesi artik yoktur). inputAddress IMZALAYAN
// cuzdandan eklenir, boylece SDK'nin teklife kendisinin yazdigi inputAddress ilk kez anlam kazanir.
// `atsAllowanceRaw` (yalniz ATS kolu): ATS ucret teklifinde okunup kayda DONDURULMUS artik izin (bigint). Ucret teklifi ile
// imzalanan op AYNI cagri listesini gormeli; bu yuzden verilirse yurutme aninda izin yeniden okunmaz. undefined/null ise
// (ucret teklifi hic cagrilmamis) izin cuzdan saglayicisindan o anda okunur. Native kol bunu kullanmaz (ensureExactAllowance).
// `now` yalniz testler icindir: verilmezse suresi her kontrolde GERCEK saatle olculur
// (approve onayi bekletirse teklif o sirada dolmus olabilir). `sleep` yalniz testler icindir
// (yayin tekrarlari arasindaki bekleme).
export async function executePrivateDeposit({ quote, wallet, gas = 'native', atsExecute, onSubmitted, erc20 = defaultErc20, now, expected, sleep = defaultSleep, atsAllowanceRaw }) {
    const clock = () => (now === undefined ? Date.now() : now)
    // Hicbir sey gonderilmeden once: geri cagri yoksa kayit da yoktur, yatirma hic baslamaz.
    if (typeof onSubmitted !== 'function') throw new Error('PRIVATE_FAILED')
    assertQuoteFresh(quote, clock(), QUOTE_MIN_REMAINING_MS)
    if (gas === 'ats' && typeof atsExecute !== 'function') throw new Error('PRIVATE_UNSUPPORTED')
    // Imzalanacak islem saklanan beklentilere ve IMZALAYAN cuzdana sabitlenir (fail-closed:
    // beklenti yoksa dogrulanamaz, gonderilmez).
    if (!expected || typeof expected !== 'object') throw new Error('PRIVATE_UNSUPPORTED')
    // Imzalayan anahtar teklifin istendigi adres olmali (SDK placeOrder'in assertAdapterAddress
    // korumasi): aksi halde siparis kullanicinin kontrol etmedigi bir imzaciya baglanirdi ve iade
    // order.signer'a gider. Kod PRIVATE_QUOTE_MISMATCH; geri kalan sabitleme Task 13'un kontroludur.
    const q = quote?.inputAddress
    if (typeof q !== 'string' || !isAddress(q) || q.toLowerCase() !== String(wallet.address).toLowerCase()) {
        throw new Error('PRIVATE_QUOTE_MISMATCH')
    }
    assertQuoteMatches(quote, { ...expected, inputAddress: wallet.address })
    const plan = depositPlanFromQuote(quote)
    if (gas !== 'ats') {
        // Saglayici baska bir aga bakiyorsa imza yanlis zincirin tahminiyle/nonce'uyla atilirdi.
        const network = await rpc(wallet.provider.getNetwork())
        if (Number(network.chainId) !== plan.chainId) throw new Error('PRIVATE_QUOTE_MISMATCH')
    }
    await assertSourceFunds(wallet, plan, erc20)

    if (gas === 'ats') {
        // Native deger (deposit.value) ATS ile ODENMEZ: op hesaptan bu degeri gonderir. Kapsam
        // yukaridaki assertSourceFunds + assertQuoteMatches'te: value yalniz native kaynakta
        // (approval yok) sifirdan buyuk olabilir ve orada native bakiye value'yu karsilamali;
        // token kaynakta value sifir olmak zorundadir (bridge.value pini). Yani ucret tahsil
        // edildikten sonra value yuzunden revert eden op buraya ulasmaz (B:M8).
        // Op relay edildigi anda (executeAtsTransfer onRelayed) yatirma zincire gitmistir: kayit
        // sonuc dogrulamasindan ONCE yazilir. Aksi halde relay'den sonra makbuz/dogrulama hatasi
        // (atsExecute firlatir) hash'i kaybettirirdi ve siparis yetim kalirdi (Task 7 incelemesi M1).
        // Yalniz 'transfer' op'u yatirmadir; bootstrap (kurulum) op'unun hash'i yatirma degildir.
        // `unconfirmed` (relay success:false ama islem hash'i var) da kaydedilir: islem calismis
        // olabilir, siparis yoklamasi karar verir (B:I1).
        // `attempted`: kayda verilen hash (hata yolunda hata ona eklenir); `recorded`: yalniz
        // onSubmitted BASARIYLA bittikten sonra atanir (T11 M7).
        let attempted = null
        let recorded = null
        let recording = null
        const record = (h) => {
            if (recording) return
            attempted = h
            // async sarmal: onSubmitted'in SENKRON firlatmasi da reddedilmis sozdur (B:M4).
            recording = (async () => {
                await onSubmitted(h)
                recorded = h
            })()
            recording.catch(() => {}) // atsExecute surerken yakalanmamis ret uyarisi olmasin; asagida await edilir
        }
        // Kayit yazimi bitene dek bekler; hata varsa hash'i tasir (cagiran hash'i hata yolundan okur).
        const settled = async () => {
            try {
                await recording
            } catch (e) {
                if (e && typeof e === 'object' && !e.hash) e.hash = attempted
                throw e
            }
        }
        // Cagri listesi op relay edilmeden ONCE secilir: izin okunamazsa hicbir sey gonderilmez (PRIVATE_PROVIDER_DOWN).
        const allowanceRaw = typeof atsAllowanceRaw === 'bigint'
            ? atsAllowanceRaw
            : await readApprovalAllowance({ provider: wallet.provider, owner: wallet.address, approval: plan.approval, erc20 })
        let r
        try {
            r = await atsExecute({
                chainId: plan.chainId,
                calls: atsCallsFromPlan(plan, allowanceRaw),
                onRelayed: ({ txHash, kind } = {}) => { if (kind === 'transfer' && txHash) record(txHash) },
            })
        } catch (e) {
            // Hata yukari gitmeden kayit yazimi bitmeli: cagiran hata yolunda hash'i okur.
            if (recording) await settled()
            // Hash'siz ama op'un calismis OLABILECEGI red (nonce ilerledi, yeniden deneme hakki bitti):
            // yatirma gitmis olabilir, ticket yeniden gonderilebilir kalmamali (son inceleme I1).
            if (!recording && e && e.opMayHaveRun) throw new Error('PRIVATE_DEPOSIT_UNCONFIRMED')
            throw e
        }
        // Yalniz ZINCIR islem hash'i kabul edilir. userOp hash'i (r.hash) deposit hash'i DEGILDIR:
        // raporlanir ve yoklanirsa siparis hic bulunamazdi (B:M8). Hash yoksa yatirma gitmis
        // olabilir ama izlenemez: belirsiz hatasi (hash'siz), cagiran ticket'i bellekte tuketilmis tutar.
        const hash = attempted || r?.txHash
        if (!hash) throw new Error('PRIVATE_DEPOSIT_UNCONFIRMED')
        record(hash)
        await settled()
        return { hash: recorded, wait: null }
    }

    await assertNativeGas(wallet, plan)
    await ensureExactAllowance(wallet, plan.approval, erc20)

    // SDK'nin yatirma guvenlikleri (sdk/dist/client.js, deposit-gas.js): tahmin approve'dan
    // SONRA yapilir (once yapilirsa yatirma revert eder), desteklenen sinirin ustundeki rota
    // reddedilir, gasLimit tahmine %25 pay ekler.
    const estimate = await rpc(wallet.estimateGas(plan.deposit), 2)
    if (estimate > DEPOSIT_EXECUTION_PROBE_GAS_CAP) throw new Error('PRIVATE_UNSUPPORTED')
    const populated = await rpc(wallet.populateTransaction({ ...plan.deposit, gasLimit: depositGasWithHeadroom(estimate) }), 2)
    // Gercek butce: yedek tahminli on kontrol (assertNativeGas) approve'u korur; yatirma ise gasLimit =
    // tahmin + %25 ve doldurulan ucretle gider. Bakiye ikisinin arasindaysa dugum yayinda "insufficient
    // funds" der ve ticket yanardi: bu yuzden IMZA VE KAYITTAN once yeniden olculur (T14 M3).
    await assertPopulatedGas(wallet, plan.deposit.value, populated)
    // Nihai gasLimit ile eth_call: revert eden yatirma imzalanmaz (T24 M2-m5).
    await assertDepositSimulates(wallet, plan, populated)
    // Approve onayi ve tahmin turlari sirasinda teklif doldu ya da dolmak uzereyse para gondermeden
    // dur: izin yalniz teklif tutaridir ve yeni teklifte yeniden kullanilir. Kontrol IMZADAN hemen once.
    assertQuoteFresh(quote, clock(), QUOTE_MIN_REMAINING_MS)
    const signed = await wallet.signTransaction(populated)
    // Imzalanan baytlar plana esit degilse HICBIR sey kaydedilmez ya da yayinlanmaz (T24 M2-I4).
    assertSignedTransaction(signed, { to: plan.deposit.to, data: plan.deposit.data, value: plan.deposit.value, chainId: plan.chainId, from: wallet.address }, populated, 'PRIVATE_QUOTE_MISMATCH')
    const hash = keccak256(signed)

    // KAYIT yayindan ONCE: yazilamazsa hicbir sey gitmedi, ticket kullanilabilir kalir. Ham imzali bayt
    // hash ile AYNI yazimda kalicilasir (ikinci arguman): servis calisani yayin sirasinda olurse
    // uzlastirma ayni bayti yeniden yayinlayabilir; bayt yalnizca burada vardir (T24 M2-I1).
    try {
        await onSubmitted(hash, signed)
    } catch (e) {
        throw Object.assign(new Error('PRIVATE_FAILED'), { cause: e })
    }

    const tx = await broadcastWithRetry(wallet.provider, signed, hash, sleep)
    return { hash, wait: () => (tx ? tx.wait() : wallet.provider.waitForTransaction(hash, 1)) }
}

const REFUND_IFACE = new Interface(['function refund(bytes32 ticket)'])
const GATEWAY_ADDRESS_RE = /^(0x)?[0-9a-fA-F]{40}$/

// Iade hedefi: sunucudan gelen gateway NORMALIZE edilir ve kanonik gateway'e ya da yalniz-iade emekli
// listesine ESIT olmali. Esitlik asil guvenlik denetimidir; harf boyutu (EIP-55 saglama toplami) bir sey
// eklemez ve kacak bir saglama toplami mesru iadeyi reddetmemeli: iade kullanicinin kacis yoludur (T25 M2-m3).
// Onekli ya da onekesiz 40 hane kabul edilir; sifir adres hicbir listede degildir.
function refundTarget(gateway, retiredGateways) {
    if (typeof gateway !== 'string' || !GATEWAY_ADDRESS_RE.test(gateway)) throw new Error('PRIVATE_REFUND_NOT_ALLOWED')
    const to = getAddress(('0x' + gateway.replace(/^0x/, '')).toLowerCase())
    if (to === ZeroAddress || (to !== CANONICAL_GATEWAY && !retiredGateways.includes(to))) throw new Error('PRIVATE_REFUND_NOT_ALLOWED')
    return to
}

// Iade cagrisi: TEK uretici. Native kol (sendRefund) ve ATS kolu (sendRefundAts) AYNI hedefi (refundTarget) ve
// AYNI calldata'yi kullanir; deger her zaman 0.
export function buildRefundCall({ gateway, ticket, retiredGateways = RETIRED_GATEWAYS }) {
    const to = refundTarget(gateway, retiredGateways)
    return { to, data: REFUND_IFACE.encodeFunctionData('refund', [ticket]), value: 0n }
}

// Iade cagrisi (spec 9.3). Kontrat odemeyi her zaman order.signer'a yapar; yine de KAYNAK hesaptan
// gonderilir: baska hesaptan gondermek o hesabi siparise baglar. Yatirmayla AYNI protokol: doldur ->
// imzala -> imzali bayti dogrula -> hash -> onSubmitted(hash, imzaliBayt) (KAYIT) -> YAYINLA. Kayit
// yazilamazsa hicbir sey yayinlanmaz; yayin sonucu belirsiz kalsa bile hash kayitlidir ve ayni siparis
// bir daha iade edilmez. Belirsiz sonuc PRIVATE_REFUND_UNCONFIRMED (hash ile), kesin ret PRIVATE_FAILED ya da
// PRIVATE_INSUFFICIENT_GAS (definitive:true). `sleep` ve `retiredGateways` yalniz testler icindir.
// NATIVE (BNB gazli) kol: yalniz PRIVATE_ORDER_ATS kapaliyken kullanilir; ATS acikken iade sendRefundAts ile gider.
export async function sendRefund({ wallet, gateway, ticket, onSubmitted, sleep = defaultSleep, retiredGateways = RETIRED_GATEWAYS }) {
    const { to, data } = buildRefundCall({ gateway, ticket, retiredGateways })
    // Hicbir sey gonderilmeden once: geri cagri yoksa kayit da yoktur, iade hic baslamaz.
    if (typeof onSubmitted !== 'function') throw new Error('PRIVATE_FAILED')
    // Saglayici baska bir aga bakiyorsa tahmin/nonce yanlis zincirden gelirdi.
    const network = await rpc(wallet.provider.getNetwork())
    if (Number(network.chainId) !== Number(PAYOUT_CHAIN_ID)) throw new Error('PRIVATE_REFUND_NOT_ALLOWED')
    const populated = await rpc(wallet.populateTransaction({ to, data }), 2)
    // Gaz yetmeyen iade imzalanmaz ve kaydedilmez (aksi halde dugum yayinda reddeder, kayit temizlenirdi).
    await assertPopulatedGas(wallet, 0n, populated)
    const signed = await wallet.signTransaction(populated)
    // Imzali baytlar refund(ticket) cagrisina esit olmali: hedef, calldata, deger 0, gateway zinciri, gonderen.
    assertSignedTransaction(signed, { to, data, value: 0n, chainId: PAYOUT_CHAIN_ID, from: wallet.address }, populated, 'PRIVATE_REFUND_NOT_ALLOWED')
    const hash = keccak256(signed)
    try {
        await onSubmitted(hash, signed)
    } catch (e) {
        throw Object.assign(new Error('PRIVATE_FAILED'), { cause: e })
    }
    const tx = await broadcastWithRetry(wallet.provider, signed, hash, sleep, 'PRIVATE_REFUND_UNCONFIRMED')
    return { hash, wait: () => (tx ? tx.wait() : wallet.provider.waitForTransaction(hash, 1)) }
}

// --- ATS ILE IADE (sahip karari 2026-10-30: gizli modda ag ucreti HICBIR yerde native coin ile odenmez) ---

// ATS ucret teklifi zaman siniri: teklif birkac RPC + bir bundler istegi yapar; takili bir istek global islem kuyrugunu
// (iade kuyrukta kosar) tutmasin. Zaman asimi PRIVATE_PROVIDER_DOWN, hicbir sey gonderilmedi.
const ATS_QUOTE_DEADLINE_MS = 40000

// Bu iade op'unun TOPLAM ATS maliyeti (insan birimi): transfer ucreti + (kurulum modunda) op1 ucreti. Gizli siparis komisyon
// tasimaz (opKind 'private'). Ucret okunamazsa null (fail-closed: bilinmeyen butceyle gonderilmez).
export function atsRefundRequired(quote) {
    const fee = Number(quote?.transferFee)
    if (!Number.isFinite(fee) || fee < 0) return null
    const ops = Number(quote?.opCount) || 1
    if (ops < 2) return fee
    const boot = Number(quote?.bootstrapFee ?? fee)
    return fee + (Number.isFinite(boot) ? boot : fee)
}

const atsShortfallError = (quote) => Object.assign(new Error('PRIVATE_INSUFFICIENT_ATS'), {
    atsNeeded: atsRefundRequired(quote),
    atsBalance: Number.isFinite(Number(quote?.atsBalance)) ? Number(quote.atsBalance) : null,
})

// Hicbir sey gonderilmeden onceki (ya da op'un HIC kabul edilmedigi) ATS hatasini iade koduna cevirir. Bilinmeyen hata oldugu
// gibi doner (privacyErrorCode: fetch hatasi PRIVATE_PROVIDER_DOWN, gerisi PRIVATE_FAILED).
function atsRefundFailure(e, quote) {
    const msg = typeof e?.message === 'string' ? e.message : ''
    if (/^PRIVATE_[A-Z_]+$/.test(msg)) return e
    if (e?.code === 'TIMEOUT') return Object.assign(new Error('PRIVATE_PROVIDER_DOWN'), { cause: e })
    if (msg === 'ATS not enabled for chain') return Object.assign(new Error('PRIVATE_UNSUPPORTED'), { cause: e })
    const decision = e?.decision || (typeof e?.code === 'string' || e?.status != null ? resolveAtsBlocker(e.code, { httpStatus: e.status }) : null)
    if (decision?.action === 'buy-ats') return Object.assign(atsShortfallError(quote), { cause: e })
    if (decision) return Object.assign(new Error('PRIVATE_ATS_UNAVAILABLE'), { cause: e })
    return e
}

// Iadeyi ATS 7702 op'u olarak gonderir: kullanici cagrisi YALNIZ refund(ticket) (gateway'e, deger 0) + paymaster'in ATS ucreti;
// KAYNAK hesaptan gider (msg.sender kaynak adres kalir). Native gaz KULLANILMAZ ve geri dusus YOKTUR. Op'u kuran/gonderen
// executeAtsTransfer'dir (yatirmanin kullandigi AYNI yol); burasi yalniz cagriyi kurar, bakiyeyi on-kontrol eder ve sonucu iade
// protokolune cevirir. Enjekte edilenler (arka plan baglar): atsQuote({chainId, calls}) -> quoteAtsTransfer ciktisi,
// atsExecute({chainId, calls, quoted, onRelayed}) -> executeAtsTransfer, onBeforeSend() (op'tan HEMEN once, kalici "iade suruyor"
// isareti; firlatirsa hicbir sey gonderilmez), onRecord(txHash) (op relay edilince; hicbir zaman firlatmamali).
//
// Donus: { hash, confirmed:true } (UserOperationEvent success=true dogrulandi). Hatalar:
//  - hicbir sey gonderilmedi (bakiye/kurulum/red): kod PRIVATE_INSUFFICIENT_ATS (atsNeeded, atsBalance) / PRIVATE_ATS_UNAVAILABLE /
//    PRIVATE_PROVIDER_DOWN ...; e.hash YOK, e.untracked YOK.
//  - relay edildi, zincirde op BASARISIZ (opSuccess false): PRIVATE_FAILED, e.hash, e.definitive true (iade OLMADI).
//  - relay edildi, sonuc dogrulanamadi: PRIVATE_REFUND_UNCONFIRMED, e.hash, e.definitive false.
//  - hash'siz ama op calismis OLABILIR (nonce ilerledi): PRIVATE_REFUND_UNCONFIRMED, e.untracked true.
export async function sendRefundAts({ wallet, gateway, ticket, atsQuote, atsExecute, onBeforeSend, onRecord, retiredGateways = RETIRED_GATEWAYS }) {
    const call = buildRefundCall({ gateway, ticket, retiredGateways })
    if (typeof atsQuote !== 'function' || typeof atsExecute !== 'function' || typeof onBeforeSend !== 'function' || typeof onRecord !== 'function') {
        throw new Error('PRIVATE_FAILED')
    }
    const chainId = Number(PAYOUT_CHAIN_ID)
    // Saglayici baska bir aga bakiyorsa fiyat/nonce yanlis zincirden gelirdi.
    const network = await rpc(wallet.provider.getNetwork())
    if (Number(network.chainId) !== chainId) throw new Error('PRIVATE_REFUND_NOT_ALLOWED')

    let quote
    try {
        quote = await withDeadline(Promise.resolve(atsQuote({ chainId, calls: [call] })), ATS_QUOTE_DEADLINE_MS)
    } catch (e) {
        throw atsRefundFailure(e, null)
    }
    const required = atsRefundRequired(quote)
    if (required === null) throw new Error('PRIVATE_ATS_UNAVAILABLE')
    // Bakiye yetmiyorsa ya da sunucu "ATS al" diyorsa: hicbir sey yazilmaz, siparis iade edilebilir kalir.
    if (Number(quote.atsBalance) < required) throw atsShortfallError(quote)
    if (!quote.ready) {
        if (quote.decision?.action === 'buy-ats') throw atsShortfallError(quote)
        throw Object.assign(new Error('PRIVATE_ATS_UNAVAILABLE'), { decision: quote.decision || null })
    }

    try {
        await onBeforeSend()
    } catch (e) {
        throw Object.assign(new Error('PRIVATE_FAILED'), { cause: e })
    }

    // Yatirmadaki kayit deseni: relay edilince hash kaydedilir (sonuc dogrulamasindan ONCE).
    let attempted = null
    let recording = null
    const record = (h) => {
        if (recording) return
        attempted = h
        recording = (async () => { await onRecord(h) })()
        recording.catch(() => {})
    }
    let r
    try {
        r = await atsExecute({
            chainId,
            calls: [call],
            quoted: quote,
            onRelayed: ({ txHash, kind } = {}) => { if (kind === 'transfer' && txHash) record(txHash) },
        })
    } catch (e) {
        if (!recording && e?.txHash) record(e.txHash)
        if (recording) await recording.catch(() => {})
        if (attempted) {
            const definitive = e?.opSuccess === false
            throw Object.assign(new Error(definitive ? 'PRIVATE_FAILED' : 'PRIVATE_REFUND_UNCONFIRMED'), { hash: attempted, definitive, cause: e })
        }
        // Hash'siz ama op'un calismis OLABILECEGI red (nonce ilerledi): ayni ticket bir daha gonderilmez.
        if (e?.opMayHaveRun) throw Object.assign(new Error('PRIVATE_REFUND_UNCONFIRMED'), { untracked: true, cause: e })
        throw atsRefundFailure(e, quote)
    }
    const hash = attempted || r?.txHash
    // Basarili donusun zincir hash'i olmali; yoksa op gitmis ama izlenemez.
    if (!hash) throw Object.assign(new Error('PRIVATE_REFUND_UNCONFIRMED'), { untracked: true })
    record(hash)
    await recording.catch(() => {})
    return { hash, confirmed: true }
}
