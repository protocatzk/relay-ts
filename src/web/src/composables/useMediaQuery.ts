import { onBeforeUnmount, ref } from 'vue';

/**
 * Reactive `matchMedia` result.
 *
 * Used for layout decisions that cannot be expressed in CSS alone (for example
 * default-open accordion groups). CSS media queries stay the primary tool.
 */
export function useMediaQuery(query: string) {
  const media = window.matchMedia(query);
  const matches = ref(media.matches);

  function update(): void {
    matches.value = media.matches;
  }

  media.addEventListener('change', update);
  onBeforeUnmount(() => media.removeEventListener('change', update));

  return matches;
}
