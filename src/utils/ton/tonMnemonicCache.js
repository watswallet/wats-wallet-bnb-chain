/**
 * Turetilmis TON ifadesi icin OTURUM bellegi onbellegi.
 *
 * Neden gerekli: `tonMnemonicFromSeed` gecerli bir TON ifadesi ARAR (ortalama
 * 125 deneme, ~70 ms). Adres bir kez turetilip diske yaziliyor, ama IMZALAMA
 * yolu ifadenin kendisini her seferinde yeniden uretir. Onbelleksiz her TON
 * islemi bu bedeli oder.
 *
 * DISKE YAZILMAZ. Turetilmis ifade bir SIRDIR; kalici depoya inmesi, ana
 * ifadenin yanina ikinci bir sir koymak olurdu. Service worker uyandiginda
 * onbellek bostur ve ilk turetme yeniden kosar — kabul edilen bedel.
 *
 * ANAHTAR ana ifadeyi ICERIR. Yalnizca index ile anahtarlansaydi, kullanici
 * kasa degistirdiginde BASKA bir kasanin ifadesi donerdi ve kullaniciya A
 * adresi gosterilirken B'nin anahtariyla imzalanirdi.
 */
import { tonMnemonicFromSeed } from './tonFromSeed'

const cache = new Map()

const anahtar = (masterMnemonic, index) => `${index} ${String(masterMnemonic).trim()}`

export async function cachedTonMnemonicFromSeed(masterMnemonic, index) {
    const k = anahtar(masterMnemonic, index)
    const hit = cache.get(k)
    if (hit !== undefined) return hit

    // Sonuc ONCE beklenir, SONRA yazilir: firlatan bir turetme onbeklege
    // girmemeli, yoksa gecici bir hata kalici bir kilide donusur.
    const phrase = await tonMnemonicFromSeed(masterMnemonic, index)
    cache.set(k, phrase)
    return phrase
}

/** Cuzdan kilitlendiginde cagrilir: sirlar bellekte kalmasin. */
export function clearTonMnemonicCache() {
    cache.clear()
}
