// SAF KATMANI EKRANA BAGLAYAN TELLER — kaynak uzerinden kilitlenir.
//
// NEDEN BOYLE BIR TEST: bu depoda bilesen (mount) testi YOK. Saf yardimcilar
// (nativeToken / swapTokenState / swapGuard / effectiveScope) kendi testleriyle iyi
// kilitli, ama onlari ekrana baglayan UC TEL hicbir seyle ortulu degildi. Dogrulama
// turunda mutasyon calistirildi: `ensureSwapInToken()` cagrisi ile `activeScope`
// computed'i SILINDI — yani kullanicinin bildirdigi IKI hata da koda geri geldi — ve
// testlerin TAMAMI yesil kaldi. Bir daha sessizce geri gelmesin diye buradalar.
//
// Kirilgan olduklarinin farkindayiz: bicimsel bir yeniden duzenleme bunlari kizartabilir.
// O yuzden esnek regex'ler kullaniliyor ve her testin mesaji NE yapilmasi gerektigini
// soyluyor. Alternatif — hatanin sessizce geri donmesi — kat kat pahali.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const SWAP = read('components/Swap.vue')
const SWAP_FROM = read('components/swap/swapFrom.vue')
const PILL = read('components/NetworkScopePill.vue')

/**
 * `anchor` iceren satirdan baslar, kapanisi SATIR BASINDA olan ilk `})` satirinda biter.
 * Dosya sonuna kadar dilimlemek SAHTE GECISE yol acar: baska bir blokta duran ayni cagri
 * testi kor birakir — onMounted testi tam olarak bu yuzden bir mutasyonu kacirmisti.
 */
const block = (source, anchor) => {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((l) => l.includes(anchor))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^\}\)/.test(l))
  return lines.slice(start, end < 0 ? undefined : end)
    // YORUMLAR ATILIR. Aksi halde kilit SAHTE olur: bir dal aramasi, dalin KENDISI
    // silinmis olsa bile hemen ustundeki aciklama satirina uyup yesil kaliyordu
    // (mutasyonla olculdu: dal silindi, tum suite yesil gecti).
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join(String.fromCharCode(10))
}

describe('(A) native varsayilan gercekten baglanmis', () => {
  it('onMounted tohumu cagirir', () => {
    // `ensureSwapInToken` yalniz tanimlanip cagrilmazsa buton yine bos gelir.
    expect(block(SWAP, 'onMounted(async')).toMatch(/ensureSwapInToken\s*\(\s*\)/)
  })

  it('inToken bosaldiginda da tohum kosar (ag degisimi yolu)', () => {
    // applyNetworkChange once agi degistirir, `crypto.swap.inToken = null` yazimi IKI await
    // sonra gelir; yalniz chainId izleyicisine baglamak tohumu sildirirdi.
    expect(block(SWAP, 'watch(() => crypto.swap.inToken')).toMatch(/ensureSwapInToken\s*\(\s*\)/)
  })

  it('varsayilan token AGDAN sorulmaz — Swap.vue findToken/axios tasimaz', () => {
    expect(SWAP).not.toMatch(/\bfindToken\s*\(/)
    expect(SWAP).not.toMatch(/from\s+['"]axios['"]/)
  })

  // `config.api` bir donem TUMDEN yasakliydi. O yasak, korumak istedigi seyin
  // (varsayilan tokenin agdan sorulmasi) YERINE GECEN kolay bir vekildi ve TON
  // takasi geldiginde YANLIS POZITIF uretti: TON'un teklif ucu ve TON istemcisi
  // mesru olarak o adresi kullaniyor.
  //
  // Koruma AMACINA gore yeniden yazildi: tohumlama yolu (ensureSwapInToken) aga
  // DOKUNMAMALI. Asil kusur oydu - ad ucuncu tarafin mulkiyetinde oldugu icin
  // Polygon'da 404 donuyor ve inToken SESSIZCE undefined kaliyordu.
  it('tohumlama yolu AGA DOKUNMAZ', () => {
    const seed = block(SWAP, 'const ensureSwapInToken')
    expect(seed).not.toMatch(/config\.api/)
    expect(seed).not.toMatch(/fetch\s*\(|sendMessage/)
  })

  // config.api YALNIZCA TON yollarinda gecmeli: EVM kolu bugun hicbir yerde
  // dogrudan sunucuya cikmiyor ve cikmaya baslarsa bu test onu gorunur kilar.
  it('config.api yalnizca TON yollarinda kullanilir', () => {
    const hits = SWAP.split('\n').filter((l) => l.includes('config.api'))
    expect(hits.length).toBeGreaterThan(0)
    for (const line of hits) {
      expect(line, line.trim()).toMatch(/apiBase|getTonClient/)
    }
  })
})

describe('(B) token secici aktif zincir kapsaminda acilir', () => {
  it('swapFrom pill i TURETILMIS kapsama baglar, ham store filtresine degil', () => {
    const tag = block(SWAP_FROM, '<NetworkScopePill')
    expect(tag).toMatch(/:model-value="activeScope"/)
    expect(tag).not.toMatch(/:model-value="scope\.filter"/)
  })

  it('activeScope effectiveScope uzerinden turer (kendi kurali yazilmamis)', () => {
    expect(SWAP_FROM).toMatch(/effectiveScope\s*\(/)
  })
})

describe('kapsam mandali: gorunen degere basmak bir SECIM degildir', () => {
  // Kosulsuz emit iki tuzak uretiyordu: (1) `chosen` mandali kalkip "kapsam sorulmadi"
  // varsayilanini oturum boyunca oldurmek, (2) swapFrom'da gorunen degeri onaylamanin
  // Home'un portfoy toplamini sessizce daraltmasi.
  it('secim mevcut degere esitse emit EDILMEZ', () => {
    expect(block(PILL, 'const select =')).toMatch(
      /String\(value\)\s*===\s*String\(props\.modelValue\)[\s\S]{0,40}return/)
  })
})

describe('native gaz kontrolu tek kapidan gecer', () => {
  // '0x0' elle yazilmis kiyasta YOKTU ve varsayilan girdi tokeni tam olarak onu tasiyor:
  // native takas ERC20 dalina dusuyor, "miktar + gaz" yerine yalniz "gaz" denetleniyordu.
  it('isNativeAsset kullanilir, elle ZeroAddress kiyasi YAPILMAZ', () => {
    expect(SWAP).toMatch(/const\s+isNativeIn\s*=\s*isNativeAsset\(/)
    expect(SWAP).not.toMatch(/ethers\.ZeroAddress/)
  })
})

describe('yabanci zincir tokeni ekranda ASILI KALMAZ', () => {
  // Saf katman "bu token bu zincire ait degil" diyor; o karari EKRANA baglayan tek
  // yer `ensureSwapInToken`. Bu dal silinirse yeni kural kullaniciyi BOS BUTONLA
  // birakir — sessiz regresyon tam olarak orada olur.
  it('KESIN sebeplerin IKISI de tohumlanir', () => {
    const fn = block(SWAP, 'const ensureSwapInToken')
    expect(fn).toMatch(/reason === 'chain-mismatch'/)
    expect(fn).toMatch(/reason === 'foreign-asset'/)
    expect(fn).toMatch(/reconcileSwapToken\(\s*null/)
  })

  // Sebep KORUNMALI: sabit bir literal yazmak (or. hep 'chain-mismatch') yanlis metni
  // bastirir ve kullaniciyi var olmayan bir ag degisimi aramaya yonlendirir. Mutasyonla
  // olculdu: literal'e cevirmek tum suiti yesil biraktiyordu.
  it('tohumdan sonra SEBEP korunur, sabit literal yazilmaz', () => {
    const fn = block(SWAP, 'const ensureSwapInToken')
    expect(fn).toMatch(/tokenNotice\.value\s*=\s*seeded\.token\s*\?\s*reason\s*:/)
  })

  // SUPHE tokeni DUSURMEZ: tohum daline girerse kullanicinin secimi silinir ve ayni
  // adresi paylasan cok zincirli tokenlerde (USDe, WETH) CALISAN bir takas olur.
  it("'chain-suspect' tohum daline GIRMEZ", () => {
    const fn = block(SWAP, 'const ensureSwapInToken')
    const seedBranch = fn.slice(fn.indexOf("reason === 'chain-mismatch'"))
    expect(seedBranch).not.toMatch(/chain-suspect/)
  })

  // Uyari BAYAT KALMAZ: kullanici dogru tokeni sectikten sonra sebep gecerliligini yitirir.
  it('kullanici tokeni degistirince uyari temizlenir', () => {
    expect(block(SWAP, 'watch(() => crypto.swap.inToken')).toMatch(/tokenNotice\.value\s*=\s*null/)
  })

  // 'foreign-asset' "baska bir agda" DEGIL, "cuzdanin desteklemedigi bir agda"
  // demektir; ayni metni basmak kullaniciyi yanlis yone gonderir.
  it('sablon foreign-asset icin AYRI metin basar', () => {
    expect(SWAP).toMatch(/tokenNotice === 'foreign-asset'/)
    expect(SWAP).toMatch(/swap\.tokenForeignAsset/)
  })

  it('i18n paritesi: iki dilde de uyari metinleri DOLU', () => {
    for (const locale of ['tr', 'en']) {
      const dict = JSON.parse(read(`i18n/locales/${locale}.json`))
      for (const key of ['tokenForeignAsset', 'tokenChainMismatch', 'tokenChainSuspect']) {
        expect(typeof dict.swap[key], `${locale}.${key}`).toBe('string')
        expect(dict.swap[key].length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })
})
