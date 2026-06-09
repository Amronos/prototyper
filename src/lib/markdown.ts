function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
	return escapeHtml(value).replaceAll('`', '&#96;');
}

function renderInlineMarkdown(value: string) {
	return escapeHtml(value)
		.replace(
			/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
			(_match, alt: string, url: string) =>
				`<img src="${escapeAttribute(url)}" alt="${escapeAttribute(alt)}" loading="lazy" />`
		)
		.replace(
			/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
			(_match, label: string, url: string) =>
				`<a href="${escapeAttribute(url)}" rel="noreferrer" target="_blank">${label}</a>`
		)
		.replace(/`([^`\n]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
}

function renderBlock(block: string) {
	const lines = block.split('\n');
	if (lines.length === 0) {
		return '';
	}

	if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
		return `<ul>${lines
			.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
			.join('')}</ul>`;
	}

	if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
		return `<ol>${lines
			.map((line) => `<li>${renderInlineMarkdown(line.replace(/^\s*\d+\.\s+/, ''))}</li>`)
			.join('')}</ol>`;
	}

	if (lines.every((line) => /^\s*>\s?/.test(line))) {
		return `<blockquote><p>${lines
			.map((line) => renderInlineMarkdown(line.replace(/^\s*>\s?/, '')))
			.join('<br>')}</p></blockquote>`;
	}

	const headingMatch = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.*)$/) : null;
	if (headingMatch) {
		const level = headingMatch[1].length;
		return `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`;
	}

	return `<p>${lines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`;
}

function renderTextBlocks(value: string) {
	const trimmed = value.trim();
	if (!trimmed) {
		return '';
	}

	return trimmed
		.split(/\n{2,}/)
		.map((block) => renderBlock(block))
		.join('');
}

export function renderMarkdown(markdown: string) {
	const normalized = markdown.replaceAll('\r\n', '\n');
	const codeBlockPattern = /```([\w-]+)?\n?([\s\S]*?)```/g;

	let html = '';
	let cursor = 0;
	let match = codeBlockPattern.exec(normalized);

	while (match) {
		html += renderTextBlocks(normalized.slice(cursor, match.index));
		const language = match[1] ? ` class="language-${escapeAttribute(match[1])}"` : '';
		const code = escapeHtml(match[2].replace(/\n$/, ''));
		html += `<pre><code${language}>${code}</code></pre>`;
		cursor = match.index + match[0].length;
		match = codeBlockPattern.exec(normalized);
	}

	html += renderTextBlocks(normalized.slice(cursor));
	return html || '<p></p>';
}
