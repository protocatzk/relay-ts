<script setup lang="ts">
import ModalDialog from '@/src/components/ModalDialog.vue';
import { useUnsavedDialog } from '@/src/composables/useUnsavedChanges';

const { state, stay, discard } = useUnsavedDialog();
</script>

<template>
  <ModalDialog :open="state.open" :title="state.title" size="sm" @close="stay">
    <p>{{ state.message }}</p>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="stay">Bleiben</button>
      <button type="button" class="btn btn-danger" @click="discard">Verwerfen</button>
    </template>
  </ModalDialog>
</template>
