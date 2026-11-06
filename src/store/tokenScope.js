import { defineStore } from "pinia"
import { ref, computed, watch } from "vue"
import { ALL_NETWORKS, nextNetworkFilter, privateModeScope } from '../utils/networkFilter'
import { networkStore } from './network'
import { privacyStore } from './privacy'

/**
 * Token listelerinin PAYLASILAN ag kapsami.
 *
 * Filtre eskiden Home.vue'nun kendi ref'iydi. Kullanici ana ekranda bir zincir
 * (ya da "tum aglar") secip Gonder / Ice Aktar / Swap / Bridge'e gidince o secim
 * kayboluyor ve ekran yine aktif aga donuyordu: ayni soruya iki ekranda iki farkli
 * cevap. Kapsam artik tek yerde durur, butun token secme ekranlari onu okur.
 *
 * OTURUM ICI: kalici degil. Popup kapanip acilinca varsayilan "tum aglar"a doner
 * ve ilk ag degisiminde aktif zincire atlar (bkz. nextNetworkFilter). Diske
 * yazmak, kullanicinin gunler once biraktigi bir filtreyi acilista geri getirip
 * "tokenlerim kayboldu" gorunumu uretirdi.
 *
 * `chosen`: kullanici pill'e DOKUNDU MU. `filter` tek basina bunu ayirt edemiyordu
 * — acilistaki "tum aglar" ile kullanicinin ACIKCA sectigi "tum aglar" ayni
 * degerdi — ve tek zincirli ekranlar (swapFrom) sorulmamis bir varsayilanla
 * aciliyordu. Bu bayrak `effectiveScope` disinda kullanilmaz ve OLU FLAG DEGILDIR:
 * silinirse Polygon'daki swap secicisi yine TUM AGLAR kapsaminda acilir.
 */
export const tokenScopeStore = defineStore('tokenScopeStore', () => {
    const network = networkStore()
    const privacy = privacyStore()

    // HAM kapsam: kullanicinin (ya da ag degisiminin) yazdigi deger. Ozel modda "Tum aglar" gorunumu
    // yoktur (gizli-mod cok-ag spec 4.7): ham deger 'all' iken `filter` ETKIN AGIN kimligini okutur;
    // ham deger store'a yeniden YAZILMAZ, yani normal moda donuste oldugu gibi durur. Yazma yolu
    // ham degere gider (`filter = x` ve `setFilter(x)`), bu yuzden eski yazicilar degismeden calisir.
    const rawFilter = ref(ALL_NETWORKS)
    const filter = computed({
        get: () => (privacy.active
            ? privateModeScope(rawFilter.value, network.currentNetwork?.chainId)
            : rawFilter.value),
        set: (value) => { rawFilter.value = value },
    })
    const chosen = ref(false)
    const setFilter = (value) => { rawFilter.value = value; chosen.value = true }

    // Baslikta ag degistirildiginde kapsam da o zincire atlar. Aksi halde ag
    // secici bozukmus gibi duruyordu: kullanici zinciri degistiriyor ama liste
    // ayni kaliyordu. Ilk yukleme (null -> zincir) bir DEGISIM sayilmaz.
    //
    // Izleyici Home.vue'dan buraya tasindi: artik Home mount edilmemisken de
    // (or. kullanici dogrudan Swap'ta ag degistirirken) kapsam guncel kalir.
    //
    // `chosen`a DOKUNMAZ: ag secmek, kapsam sorusuna verilmis bir cevap degildir.
    watch(() => network.currentNetwork?.chainId, (nextId, prevId) => {
        rawFilter.value = nextNetworkFilter(rawFilter.value, prevId, nextId)
    })

    return { filter, setFilter, chosen }
})
