/**
 * Aktif agi degistirmenin TEK govdesi.
 *
 * Eskiden yalnizca ag secim popup'inda duruyordu. Artik token secme ekranlari da
 * ag degistiriyor (kullanici baska bir zincirdeki token'i secince) ve bu akisin
 * yan etkilerin TAMAMINI yapmasi gerekiyor. Kopyalanan bir `setCurrentNetwork`
 * cagrisi, RPC'si erisilemeyen zincirde sessizce yanlis agda islem hazirlardi.
 *
 * Donus degeri: calisan bir RPC'ye yerlesildi mi. `false` ise cagiran akisi
 * SURDURMEMELI (kullaniciya uyari zaten gosterildi).
 */
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { findFastestRPC } from './testRPC'
import { chainVm, rpcUrlsOf } from './vm'
import { chainSupportsFlow } from './chainKind'
import { accountSupportsChain } from './accountKind'

export async function applyNetworkChange(chain, t, { flow } = {}) {
    const network = networkStore()
    const crypto = cryptoStore()

    // AKIS KAPISI — setCurrentNetwork'ten ONCE.
    //
    // Bu fonksiyon "aktif agi degistiren tek govde" olarak tasarlandi ama akisa
    // bakmiyordu: Kopru ekranindaki zincir secicisi buraya TON gonderince aktif ag
    // TON oluyor ve kullanici hicbir TON korumasi olmayan bir kopru ekraninda
    // kaliyordu. Ana ekrandaki `v-if` bu yolu hic gormuyordu.
    //
    // Kapi YALNIZCA acikca bir akis verildiginde calisir. Baslikta ag degistirip
    // TON'a gecmek P1'de gelen MESRU bir akistir; varsayilan fail-open olmasaydi bu
    // duzeltme TON'u tumden erisilemez yapardi (chainSupportsFlow, chainKind.js).
    //
    // Reddedilen gecis YARIM BIRAKILMAZ: setCurrentNetwork'e hic dokunulmaz, dolayisiyla
    // "ekranda TON yaziyor ama yukte Ethereum tokeni" durumu olusamaz ve dapp'lere
    // yanlis bir CHAIN_CHANGED yayinlanmaz.
    if (!chainSupportsFlow(chain, flow)) {
        alert(t('network.flowUnsupported', { name: chain?.name || '' }))
        return false
    }

    // HESAP KAPISI — akis kapisiyla ayni yerde, ayni sebeple.
    //
    // TON ifadesiyle ice aktarilmis bir hesabin EVM anahtari HIC URETILMEMISTIR.
    // O hesapla Ethereum'a gecmek, imzalayacak anahtari olmayan bir agda islem
    // hazirlamak demektir - kullanici bunu ancak "imzala"ya bastiginda ogrenir.
    const { active_account } = await chrome.storage.local.get('active_account')
    if (!accountSupportsChain(active_account, chain)) {
        alert(t('network.accountChainUnsupported', { name: chain?.name || '' }))
        return false
    }

    await network.setCurrentNetwork(chain)

    // RPC HIZ TESTI YALNIZCA EVM'DE. Kapi `chainVm(chain) === 'evm'`: TON ve Solana
    // dallari AYNI ariza modunu iki ayri dalda ayri ayri buldu, tek kapiya indirildi.
    //
    // TON: `rpc` listesi TASARIM GEREGI bostur (zincire erisim kendi backend
    // proxy'mizden gider). Bu blok TON'da da calisinca findFastestRPC([]) null
    // donuyor, `reachable` false oluyor ve HER TON gecisinde "hicbir dugum yanit
    // vermedi" uyarisi atiliyordu. Uyari yalnizca yanlis degil, GORUNUR HASAR
    // veriyordu: alert() senkrondur ve ana is parcacigini kilitler; setCurrentNetwork'un
    // tetikledigi Vue guncellemesi mikro-gorevde sirada bekledigi icin DOM daha
    // boyanamadan doniyordu. Kullanici TON'a gectigi halde eski EVM arayuzune bakiyor,
    // swap/bridge dugmeleri duruyordu. Uyari kapatilinca popup odagi kaybedip
    // kapaniyor, tekrar acilinca ag zaten TON oldugundan dogru gorunuyordu -
    // bildirilen "gir cik yapinca duzeliyor".
    //
    // Solana: kayitta `rpc` alani HIC YOK (bkz. vm.js), yani eski `chain.rpc.map(...)`
    // dogrudan TypeError atiyordu; zincir degismis oluyor ama asagidaki eski-token
    // temizligi ve CHAIN_CHANGED bildirimi HIC calismiyordu.
    //
    // Neden `isTon` degil de chainVm: tek alana bakan kontrol otekini yanlis
    // siniflandirir (TON kaydi `kind` tasir, Solana kaydi `vm`). chainVm ikisini de
    // EVM DISI sayar, dolayisiyla tek kapi ikisini de disarida birakir.
    //
    // Bu zincirlerin erisilebilirligi bu fonksiyonun sorusu degil; asagidaki temizlik
    // ve CHAIN_CHANGED bildirimi HER durumda calisir.
    let reachable = true
    if (chainVm(chain) === 'evm') {
        // setCurrentNetwork rpc'yi zaten yeni zincirin ilk RPC'sine cekti; bu yalnizca
        // en hizlisina yukseltir. Null gelirse dogru zincirdeki mevcut RPC'de kalinir.
        // rpcUrlsOf: `rpc` hem dizi hem nesne olabiliyor (repairNetworkData mirasi).
        const rpc = await findFastestRPC(rpcUrlsOf(chain))

        if (rpc?.url) {
            network.setRpc(rpc.url, chain.chainId)
        } else {
            // findFastestRPC hicbir RPC yanit vermezse null doner. Eskiden `rpc.url`
            // dogrudan okunuyor, TypeError yakalanmadan dusuyor ve kullanici hicbir sey
            // gormuyordu: ag adi degismis gorunuyor ama veriler yuklenmiyordu.
            reachable = false
            alert(t('network.rpcUnreachable', { name: chain.name }))
        }
    }

    // Onceki zincirde secilmis token'lar yeni zincirde YOK: birakilirsa kullanici
    // farkinda olmadan yanlis zincirin adresine islem kurar.
    crypto.bridge.amount = 0
    crypto.bridge.inToken = null
    crypto.bridge.outToken = null
    crypto.bridge.toChain = null

    crypto.swap.inToken = null
    crypto.swap.outToken = null

    // Notify connected dapps about the chain change (EIP-1193)
    chrome.runtime.sendMessage({ type: 'CHAIN_CHANGED', chainId: chain.chainId }).catch(() => {})

    return reachable
}
