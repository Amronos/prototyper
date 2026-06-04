export const PROJECT_OVERVIEW_PROMPT = `You are Prototyper, a tool that discuss specifications of a product with non-technical users and converts the discussion into a sensible engineering plan alongside an initial image.`;

export function buildThreadTitle(prompt: string) {
	const normalized = prompt.trim().replace(/\s+/g, ' ');
	if (!normalized) {
		return '';
	}

	return normalized.length > 60 ? `${normalized.slice(0, 57).trimEnd()}...` : normalized;
}

export function buildThreadSummary(prompt: string) {
	const normalized = prompt.trim().replace(/\s+/g, ' ');
	if (!normalized) {
		return '';
	}

	return normalized.length > 140 ? `${normalized.slice(0, 137).trimEnd()}...` : normalized;
}
