// Nettoyage du HTML saisi dans l'éditeur (liste blanche de balises, aucun attribut sauf href sûr).
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'H3', 'A', 'SPAN', 'DIV']);

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1 || !ALLOWED.has(child.tagName)) {
        if (child.nodeType === 1 && !['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) {
          walk(child);
          child.replaceWith(...child.childNodes);
        } else child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const ok = child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:|\/)/i.test(attr.value.trim());
        if (!ok) child.removeAttribute(attr.name);
      }
      if (child.tagName === 'A') child.setAttribute('rel', 'noopener');
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

/** Texte brut + segments gras pour l'export PowerPoint. */
export function htmlToRuns(html) {
  const doc = new DOMParser().parseFromString(`<div>${sanitizeHtml(html)}</div>`, 'text/html');
  const paragraphs = [];
  const blockTags = new Set(['P', 'DIV', 'LI', 'H3']);
  const visit = (node, style, para) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (child.textContent) para.runs.push({ text: child.textContent, ...style });
      } else if (child.nodeType === 1) {
        if (child.tagName === 'BR') para.runs.push({ text: '\n', ...style });
        else if (blockTags.has(child.tagName)) {
          const p = { runs: [], bullet: child.tagName === 'LI' };
          paragraphs.push(p);
          visit(child, { ...style, bold: style.bold || child.tagName === 'H3' }, p);
        } else if (child.tagName === 'UL' || child.tagName === 'OL') visit(child, style, para);
        else visit(child, { bold: style.bold || ['STRONG', 'B'].includes(child.tagName), italic: style.italic || ['EM', 'I'].includes(child.tagName) }, para);
      }
    }
  };
  const first = { runs: [] };
  paragraphs.push(first);
  visit(doc.body.firstChild, {}, first);
  return paragraphs.filter((p) => p.runs.some((r) => r.text.trim()));
}
