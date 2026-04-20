// ===== Lightweight Markdown Renderer =====

/**
 * Converts a markdown string to safe HTML.
 * Supports: code blocks (```), inline code (`), bold (**), italic (*),
 * headers (#), lists (- / 1.), line breaks, and links.
 */
export function renderMarkdown(md: string): string {
  if (!md) return '';

  // Store code blocks before escaping so their content is preserved
  const codeBlocks: string[] = [];

  // Extract fenced code blocks BEFORE escaping
  let processed = md.replace(/```(\w*)\s*\n?([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
    codeBlocks.push(buildCodeBlock(lang, code.trim()));
    return placeholder;
  });

  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const placeholder = `%%INLINECODE_${inlineCodes.length}%%`;
    inlineCodes.push(`<code class="inline-code">${escapeForMd(code)}</code>`);
    return placeholder;
  });

  // Now escape the remaining text for safety
  processed = escapeForMd(processed);

  // Bold: **text**
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*
  processed = processed.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>');

  // Headers: # H1, ## H2, ### H3
  processed = processed.replace(/^### (.+)$/gm, '<h4 class="md-heading">$1</h4>');
  processed = processed.replace(/^## (.+)$/gm, '<h3 class="md-heading">$1</h3>');
  processed = processed.replace(/^# (.+)$/gm, '<h2 class="md-heading">$1</h2>');

  // Unordered lists: - item
  processed = processed.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>');
  processed = processed.replace(/((?:<li class="md-li">.*<\/li>\n?)+)/g, '<ul class="md-list">$1</ul>');

  // Ordered lists: 1. item
  processed = processed.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  processed = processed.replace(/((?:<li class="md-oli">.*<\/li>\n?)+)/g, '<ol class="md-list">$1</ol>');

  // Links: [text](url)
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');

  // Line breaks (double newline = paragraph, single = <br>)
  processed = processed.replace(/\n\n/g, '</p><p>');
  processed = processed.replace(/\n/g, '<br>');

  // Wrap in paragraph
  processed = `<p>${processed}</p>`;

  // Clean up empty paragraphs
  processed = processed.replace(/<p>\s*<\/p>/g, '');

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`%%CODEBLOCK_${i}%%`, block);
  });

  // Restore inline codes
  inlineCodes.forEach((code, i) => {
    processed = processed.replace(`%%INLINECODE_${i}%%`, code);
  });

  return processed;
}

function buildCodeBlock(lang: string, code: string): string {
  const escaped = escapeForMd(code);
  const langLabel = lang ? `<div class="code-lang">${escapeForMd(lang)}</div>` : '';
  return `</p><div class="code-block-wrapper">${langLabel}<button class="code-copy-btn" data-copy>Copy</button><pre class="code-block"><code>${escaped}</code></pre></div><p>`;
}

function escapeForMd(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
