<script setup lang="ts">
import ModalDialog from '@/src/components/ModalDialog.vue';
import { useConfirmDialog } from '@/src/composables/useConfirm';

const { state, confirm, cancel } = useConfirmDialog();
</script>

<template>
  <ModalDialog :open="state.open" :title="state.title" size="sm" @close="cancel">
    <p class="confirm-message">{{ state.message }}</p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="cancel">{{ state.cancelLabel }}</button>
      <button
        type="button"
        class="btn"
        :class="state.tone === 'danger' ? 'btn-danger' : 'btn-primary'"
        @click="confirm"
      >
        {{ state.confirmLabel }}
      </button>
    </template>
  </ModalDialog>
</template>

<style scoped>
.confirm-message {
  white-space: pre-line;
  margin: 0;
}
</style>
