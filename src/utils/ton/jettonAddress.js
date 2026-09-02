// Jetton cuzdan adresi ve KALICI onbellegi.
//
// Bir jetton cuzdani adresi DETERMINISTIKTIR: sahip adresi + jetton master'dan turer
// ve ASLA DEGISMEZ. Bu yuzden bir kez okunup diske yazilir ve hic gecersizlestirilmez.
// Onbellek olmadan her bakiye yenilemesi jetton basina IKI proxy cagrisi ederdi.
//
// chainId ANAHTARIN PARCASIDIR. Mainnet (-239) ve testnet (-3) farkli sozlesmelerdir
// ve birinin adresi digerinde GECERSIZDIR. Bu ayrim olmadan testnet'te yapilan tek bir
// okuma, kullanicinin mainnet bakiyesini KALICI olarak yanlis adresten okuturdu.
//
// UYARI - karsilastirma: adres burada depo konvansiyonuyla (non-bounceable, ag bayrakli
// friendly dize - bkz. tonAddress.js:toFriendlyTon) saklanir. TON'da AYNI hesap farkli
// bayraklarla (bounceable/testOnly) FARKLI dize uretir. Bu deger ileride gecmisle
// (ornegin bir islemin "to" alaniyla) eslestirilecekse karsilastiran taraf ham dize
// esitligi KULLANMAMALI, Address.parse ile normallestirip karsilastirmali - aksi halde
// bicim farki yuzunden jetton gecmisi sessizce bos gorunur.
import { Address } from '@ton/core'
import { JettonMaster } from '@ton/ton'
import { TON_TESTNET_ID } from '../chainKind'
import { toFriendlyTon } from './tonAddress'

const CACHE_KEY = 'tonJettonWallets'

export function jettonWalletCacheKey({ chainId, owner, master }) {
    return `${Number(chainId)}:${owner}:${master}`
}

export async function getJettonWalletAddress({ client, owner, master, chainId, storage }) {
    const key = jettonWalletCacheKey({ chainId, owner, master })

    const stored = await storage.get(CACHE_KEY)
    const map = stored?.[CACHE_KEY] || {}
    if (map[key]) return map[key]

    // Hata YUTULMAZ: proxy dustugunde adres uydurmak bakiyeyi yanlis yerden okumaktan
    // da kotudur - GONDERIM de o adrese kurulur.
    const contract = client.open(JettonMaster.create(Address.parse(master)))
    const derived = await contract.getWalletAddress(Address.parse(owner))
    const value = toFriendlyTon(derived, { testnet: Number(chainId) === TON_TESTNET_ID })

    // KAYIP GUNCELLEME KORUMASI. getWalletAddress zincire cikan UZUN bir cagri; bu
    // fonksiyonun asil cagirani bakiyeleri Promise.allSettled ile PARALEL okuyacak
    // (bkz. plan), yani AYNI owner/chainId icin farkli master'lar es zamanli buraya
    // girebilir. Yukarida en basta okunan `map` o an dogruydu ama artik BAYAT olabilir:
    // baska bir es zamanli cagri kendi anahtarini coktan yazmis olabilir. Bayat kopyayi
    // spread'leyip yazarsak o kaydi SILERIZ. Ayni yaris tonIdentity.js:54-64'te vaults
    // icin belgelenmis ve ayni sekilde cozulmustu: turetme BITTIKTEN SONRA, yazmadan
    // hemen once TAZE bir kopya okunur ve mutasyon o kopya uzerinde yapilir.
    const freshStored = await storage.get(CACHE_KEY)
    const freshMap = freshStored?.[CACHE_KEY] || {}

    // Yazim yalnizca EKLEMEDIR: gecersizlestirme senaryosu yok.
    await storage.set({ [CACHE_KEY]: { ...freshMap, [key]: value } })
    return value
}
