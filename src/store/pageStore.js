import { defineStore } from "pinia"
import { ref } from "vue"

export const pageStore = defineStore('pageStore', () => {
    const currentPage = ref('')
    const redirect = ref(null)
    const data = ref(null)

    return { currentPage, redirect, data }
})