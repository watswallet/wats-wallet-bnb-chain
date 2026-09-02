<template>
    <button 
        class="absolute left-3 top-2.25 z-40 p-1.5 -ml-1.5 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 dark:text-white dark:hover:bg-white/10 dark:hover:text-white transition-colors duration-300 cursor-pointer" 
        @click="pageStore().currentPage = props.page"
        :title="$t('back.tooltip')"
    >
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">
            <path fill="currentColor" d="m7.85 13l2.85 2.85q.3.3.288.7t-.288.7q-.3.3-.712.313t-.713-.288L4.7 12.7q-.3-.3-.3-.7t.3-.7l4.575-4.575q.3-.3.713-.287t.712.312q.275.3.288.7t-.288.7L7.85 11H19q.425 0 .713.288T20 12t-.288.713T19 13z"/>
        </svg>
    </button>
</template>

<script setup>
import { pageStore } from '../store/pageStore'

const props = defineProps(['page'])
</script>