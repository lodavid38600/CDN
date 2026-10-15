<script setup>
import { onMounted, ref, watch } from 'vue';

// Zone modifiable sur place (contenteditable) : n'écrase pas le contenu pendant la saisie.
const props = defineProps({
  modelValue: { type: String, default: '' },
  tag: { type: String, default: 'div' },
  rich: Boolean,
  placeholder: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);
const el = ref(null);
let focused = false;

const read = () => (props.rich ? el.value.innerHTML : el.value.innerText.replace(/\n+$/, ''));
const write = (v) => {
  if (props.rich) el.value.innerHTML = v || '';
  else el.value.innerText = v || '';
};
onMounted(() => write(props.modelValue));
watch(() => props.modelValue, (v) => { if (!focused && el.value && v !== read()) write(v); });

function onPaste(e) {
  if (props.rich) return; // le HTML collé est nettoyé à l'enregistrement
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
}
function onKey(e) {
  if (!props.rich && e.key === 'Enter') {
    e.preventDefault();
    el.value.blur();
  }
}
</script>

<template>
  <component
    :is="tag" ref="el" class="editable" :class="{ rich }" contenteditable="true" :data-placeholder="placeholder" spellcheck="true"
    @focus="focused = true" @blur="focused = false; emit('update:modelValue', read())" @input="emit('update:modelValue', read())"
    @paste="onPaste" @keydown="onKey"
  />
</template>

<style scoped>
.editable { outline: none; border-radius: 4px; transition: box-shadow 0.12s; min-height: 1em; }
.editable:hover { box-shadow: 0 0 0 1px var(--border); }
.editable:focus { box-shadow: 0 0 0 2px var(--accent); }
.editable:empty::before { content: attr(data-placeholder); color: var(--muted); }
</style>
