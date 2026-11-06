import { defineStore } from 'pinia'
import { ref } from 'vue'
import { withStorageList, CURRENT_TRANSACTIONS } from '../utils/txStorage'

export const useTransactionStore = defineStore('transaction', () => {
    const transactions = ref([])
    const isMinimized = ref(false)

    const initListener = () => {
        chrome.storage.local.get('current_transactions', (result) => {
            if (result.current_transactions) {
                transactions.value = result.current_transactions
            }
        })

        chrome.storage.onChanged.addListener((changes) => {
            if (changes.current_transactions) {
                transactions.value = changes.current_transactions.newValue || []
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
        if (remaining.length === 0) isMinimized.value = false
    }

    const clearTransaction = async (id) => {
        const remaining = await withStorageList(CURRENT_TRANSACTIONS,
            list => list.filter(t => t.id !== id))

        transactions.value = remaining
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