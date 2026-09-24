import { isEvm } from './chainKind'
import { isSameChainId } from './vm'

/**
 * Kullanici EVM DISI bir agda (GRAM/TON, Solana) dururken bir EVM dapp'i
 * baglanmak isterse: onay ekranindaki tek tus hangi EVM zincirine goturmeli?
 *
 * NEDEN VAR: bu kapi bir donem kullaniciyi TUMDEN cikmaza sokuyordu.
 * `eth_requestAccounts` aktif ag EVM disiysa onay penceresi ACILMADAN
 * reddediliyordu (dappFunctions.js), yani cuzdan hicbir sey gostermiyor;
 * kullanici sorunun aktif ag oldugunu HICBIR YERDEN ogrenemiyordu. Ekran artik
 * aciliyor ve cikisi gosteriyor -- gosterebilmesi icin de "nereye" sorusunun
 * TEK ve test edilebilir bir cevabi olmali.
 *
 * SAF: chrome'a, pinia'ya, aga DOKUNMAZ. Zincir listesi PARAMETRE, cunku
 * cagiranlar farkli listeler tasiyor (LISTED_CHAINS testnet filtresinden gecer,
 * ALL_CHAINS gecmez) ve bu karar listenin hangisi oldugunu bilmek zorunda degil.
 *
 * SIRA BIR KARARDIR, bu yuzden tek yerde:
 *   0) BU DAPP'IN kendi zinciri (`dapps[hostname].chainId`). Cevap zaten diskte
 *      duruyordu: kayit hem baglantida (ConnectDapp.vue) hem her ag degisiminde
 *      (background.js) yaziliyor. Bu katman onu OKUMUYORDU ve sonucu su idi --
 *      TON'dan baglanan kullanici dapp'in istedigi zincire degil cuzdanin GLOBAL
 *      son EVM zincirine dusuyor, dapp hemen ardindan `wallet_switchEthereumChain`
 *      gonderiyor ve kullanici ARKA ARKAYA IKI onay ekrani goruyordu.
 *   1) Kullanicinin EN SON bulundugu EVM zinciri (store/network.js hatirlar).
 *      BSC kullanicisini her seferinde Ethereum'a atmak, dapp'in hemen ardindan
 *      `wallet_switchEthereumChain` gondermesine ve kullanicinin ARKA ARKAYA IKI
 *      onay ekrani gormesine yol acardi.
 *   2) Ethereum -- bu kod tabaninin her yerdeki varsayilani
 *      (bkz. handleGetChainId'in kayit yokken dondugu "0x1").
 *   3) Listedeki ILK EVM kaydi. Ethereum bir VARSAYILANDIR, GARANTI degil:
 *      liste veri dosyasindan geliyor ve testnet filtresinden geciyor.
 *   4) Hicbiri yoksa `null` -- cagiran dugmeyi GOSTERMEZ. Calismayacagini
 *      bildigimiz bir tusu cizmek, kapali kapiyi "arizali" gibi gosterir.
 *
 * KARSILASTIRMA `isSameChainId` ILE: chainId bu kod tabaninda hem sayi, hem
 * metin ('137'), hem hex ('0x89') dolasir. Kati `===` hatirlanan degeri hicbir
 * zaman eslestiremez ve 1. adim SESSIZCE olu kalirdi -- gorunur belirti yok,
 * yalnizca kullanici her seferinde yanlis zincire gider.
 *
 * PARAMETRE SIRASI ONCELIK SIRASI DEGILDIR: `dappChainId` en SONDA durur (mevcut
 * cagiranlar ve testleri bozulmasin diye) ama ONCELIGI en YUKSEKTIR. Ters
 * cevirmeyin -- "son parametre son care olsun" sezgisi burada YANLIS.
 *
 * @param {number|string|null|undefined} lastEvmChainId hatirlanan son EVM zinciri
 * @param {Array<object>} chains zincir kayitlari
 * @param {number|string|null|undefined} dappChainId bu dapp'in en son bagli oldugu
 *   zincir (`dapps[hostname].chainId`; diskte HEX tutulur, isSameChainId cozer)
 * @returns {object|null} zincir kaydi, yoksa null
 */
export function evmReturnChain(lastEvmChainId, chains, dappChainId = null) {
    if (!Array.isArray(chains) || chains.length === 0) return null

    // EVM KONTROLU BURADA DA SART (ayni gerekce asagida): bayat ya da bozuk bir
    // dapp kaydi EVM disi bir kimlik tasiyabilir ve TON'da takilmis kullaniciya
    // "TON'a gec" dugmesi gostermek, kapiyi tam da kapali oldugu yere acmaktir.
    if (dappChainId !== null && dappChainId !== undefined && dappChainId !== '') {
        const dappZinciri = chains.find((c) => isSameChainId(c?.chainId, dappChainId) && isEvm(c))
        if (dappZinciri) return dappZinciri
    }

    // EVM KONTROLU HATIRLANAN DEGERDE DE SART. Bu fonksiyonun var olma sebebi
    // kullanicinin EVM disi bir agda olmasi; hatirlanan degere korumasiz
    // guvenen bir surum, TON'da takilmis kullaniciya "TON'a gec" dugmesi
    // gosterirdi. (Yazici tarafi zaten yalniz EVM yaziyor -- bu, o yazicinin
    // bozulmasina karsi ikinci katman.)
    if (lastEvmChainId !== null && lastEvmChainId !== undefined && lastEvmChainId !== '') {
        const hatirlanan = chains.find((c) => isSameChainId(c?.chainId, lastEvmChainId) && isEvm(c))
        if (hatirlanan) return hatirlanan
    }

    const ethereum = chains.find((c) => isSameChainId(c?.chainId, 1) && isEvm(c))
    if (ethereum) return ethereum

    return chains.find((c) => isEvm(c)) ?? null
}
