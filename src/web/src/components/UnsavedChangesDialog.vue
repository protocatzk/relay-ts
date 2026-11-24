<script setup lang="ts">
import ModalDialog from '@/src/components/ModalDialog.vue';
import { useUnsavedDialog } from '@/src/composables/useUnsavedChanges';

const { state, stay, discard } = useUnsavedDialog();
</script>

<template>
  <!-- Stacked above any view modal: the discard prompt must never be covered
       by the dialog that triggered it (#88). -->
  <ModalDialog
    :open="state.open"
    :title="state.title"
    size="sm"
    elevate
    @close="stay"
  >
    <p>{{ state.message }}</p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="stay">Bleiben</button>
      <button type="button" class="btn btn-danger" @click="discard">Verwerfen</button>
    </template>
  </ModalDialog>
</template>
