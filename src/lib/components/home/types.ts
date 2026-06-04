export type ChatThread = {
	id: string;
	title: string;
	summary: string;
	createdAt: number;
};

export type ChatMessage = {
	id: string;
	role: 'assistant' | 'user';
	text: string;
};
