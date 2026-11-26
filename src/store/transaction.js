import { defineStore } from 'pinia'
import { ref } from 'vue'
import { withStorageList, CURRENT_TRANSACTIONS } from '../utils/txStorage'

export const useTransactionStore = defineStore('transaction', () => {
    const transactions = ref([])
    const isMinimized = ref(false)

    // Depodan gelen listede ONCEKI listede olmayan bir kart id'si varsa panel bir kez
    // balona kucultulur: onaylanan islemin tam ekran katmani kullaniciyi cuzdanda
    // tutuyordu. Yalniz YENI id kucultur; ayni kartin durum guncellemesi, kullanicinin
    // elle actigi paneli tekrar kapatmaz. Gorunum degismez (mevcut balon).
    let bilinenIdler = new Set()
    const uygula = (liste) => {
        const yeniVar = liste.some(t => !bilinenIdler.has(t.id))
        bilinenIdler = new Set(liste.map(t => t.id))
        transactions.value = liste
        if (yeniVar) isMinimized.value = true
    }

    const initListener = () => {
        chrome.storage.local.get('current_transactions', (result) => {
            if (result.current_transactions) {
                uygula(result.current_transactions)
            }
        })

        chrome.storage.onChanged.addListener((changes) => {
            if (changes.current_transactions) {
                uygula(changes.current_transactions.newValue || [])
            }
        })
    }

    // Bellekteki liste DEĞİL, depodan taze okunan liste filtrelenir. Eski anlık
    // görüntüyü geri yazmak, background'ın bu arada yazdığı durum/txHash
    // güncellemesini eziyordu.
    //
    // `scope` (gizli mod, C-I3): hangi tamamlanmis kayitlarin silinecegi. Dizi/Set ise
    // yalniz o id'ler, fonksiyon ise yalniz true dondurdugu kayitlar. ARAYUZ her zaman
    // GORUNEN tarafin id'lerini verir; boylece bir tarafta "temizle"ye basmak obur
    // tarafin (ozellikle basarisiz) kartlarini silmez. Verilmezse ESKI davranis: tum
    // tamamlanmis kayitlar. Suren/kuyruktaki kayit hicbir kosulda silinmez.
    const clearTransactions = async (scope) => {
        const inScope = scope === undefined ? () => true
            : typeof scope === 'function' ? scope
            : (t) => new Set(scope).has(t.id)
        const remaining = await withStorageList(CURRENT_TRANSACTIONS,
            list => list.filter(t => t.status === 'processing' || t.status === 'queued' || !inScope(t)))

        transactions.value = remaining
        bilinenIdler = new Set(remaining.map(t => t.id))
        if (remaining.length === 0) isMinimized.value = false
    }

    const clearTransaction = async (id) => {
        const remaining = await withStorageList(CURRENT_TRANSACTIONS,
            list => list.filter(t => t.id !== id))

        transactions.value = remaining
        bilinenIdler = new Set(remaining.map(t => t.id))
        if (remaining.length === 0) isMinimized.value = false
    }

    const minimize = () => {
        isMinimized.value = true
    }

    const maximize = () => {
        isMinimized.value = false
    }

    return { transactions, isMinimized, initListener, clearTransactions, clearTransaction, minimize, maximize }
})