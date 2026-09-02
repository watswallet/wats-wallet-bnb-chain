import { defineStore } from "pinia"
import { ref, watch } from "vue"
import { ALL_NETWORKS, nextNetworkFilter } from '../utils/networkFilter'
import { networkStore } from './network'

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

    const filter = ref(ALL_NETWORKS)
    const chosen = ref(false)
    const setFilter = (value) => { filter.value = value; chosen.value = true }

    // Baslikta ag degistirildiginde kapsam da o zincire atlar. Aksi halde ag
    // secici bozukmus gibi duruyordu: kullanici zinciri degistiriyor ama liste
    // ayni kaliyordu. Ilk yukleme (null -> zincir) bir DEGISIM sayilmaz.
    //
    // Izleyici Home.vue'dan buraya tasindi: artik Home mount edilmemisken de
    // (or. kullanici dogrudan Swap'ta ag degistirirken) kapsam guncel kalir.
    //
    // `chosen`a DOKUNMAZ: ag secmek, kapsam sorusuna verilmis bir cevap degildir.
    watch(() => network.currentNetwork?.chainId, (nextId, prevId) => {
        filter.value = nextNetworkFilter(filter.value, prevId, nextId)
    })

    return { filter, setFilter, chosen }
})
