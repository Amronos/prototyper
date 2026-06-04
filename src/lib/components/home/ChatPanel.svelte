<script lang="ts">
	import { tick } from 'svelte';

	import { renderMarkdown } from '$lib/markdown';

	import type { ChatMessage } from './types.js';

	type Props = {
		hasActiveThread: boolean;
		isAuthenticated: boolean;
		isGeneratingImage: boolean;
		isLoadingMessages: boolean;
		isSendingMessage: boolean;
		messages: ChatMessage[];
		onSendMessage: (prompt: string) => Promise<void>;
	};

	let {
		hasActiveThread,
		isAuthenticated,
		isGeneratingImage,
		isLoadingMessages,
		isSendingMessage,
		messages,
		onSendMessage
	}: Props = $props();

	let draft = $state('');
	let messageListElement = $state<HTMLDivElement | null>(null);
	let composerElement = $state<HTMLTextAreaElement | null>(null);

	const MAX_COMPOSER_HEIGHT = 200;

	function resizeComposer() {
		const element = composerElement;
		if (!element) {
			return;
		}

		element.style.height = 'auto';
		element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
	}

	$effect(() => {
		void draft;
		resizeComposer();
	});

	$effect(() => {
		const scrollBehavior =
			messages.length > 0 && !isSendingMessage ? ('smooth' as const) : ('auto' as const);
		void tick().then(() => {
			messageListElement?.scrollTo({
				top: messageListElement.scrollHeight,
				behavior: scrollBehavior
			});
		});
	});

	async function submit() {
		const prompt = draft.trim();
		if (!prompt || isSendingMessage || isGeneratingImage) {
			return;
		}

		draft = '';
		await onSendMessage(prompt);
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) {
			return;
		}

		event.preventDefault();
		void submit();
	}
</script>

<section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f3f4f6]">
	<div bind:this={messageListElement} class="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
		{#if isAuthenticated && hasActiveThread && isLoadingMessages}
			<div class="mx-auto max-w-3xl text-sm text-slate-500">Loading messages...</div>
		{:else if isAuthenticated && hasActiveThread && (messages.length > 0 || isSendingMessage)}
			<div class="mx-auto flex max-w-3xl flex-col gap-4">
				{#each messages as message (message.id)}
					<div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
						<div
							class={`max-w-[85%] rounded-lg px-4 py-3 shadow-sm ${
								message.role === 'user'
									? 'bg-[#0d3b3b] text-white'
									: 'border border-slate-200 bg-white text-slate-900'
							}`}
						>
							{#if message.role === 'assistant'}
								<div class="markdown-body">
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html renderMarkdown(message.text)}
								</div>
							{:else}
								<p class="m-0 text-sm leading-6 whitespace-pre-wrap">{message.text}</p>
							{/if}
						</div>
					</div>
				{/each}

				{#if isGeneratingImage}
					<div class="flex justify-start">
						<div
							class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm"
						>
							Generating...
						</div>
					</div>
				{:else if isSendingMessage}
					<div class="flex justify-start">
						<div
							class="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm"
						>
							Thinking...
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div
		class="shrink-0 bg-linear-to-t from-[#f3f4f6] via-[#f3f4f6] to-transparent px-6 pt-3 pb-5 sm:px-8"
	>
		<div class="mx-auto max-w-3xl">
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<div
					class="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-[#0d3b3b] focus-within:ring-2 focus-within:ring-[#0d3b3b]/15"
				>
					<label class="sr-only" for="chat-message">Message</label>
					<textarea
						id="chat-message"
						bind:this={composerElement}
						bind:value={draft}
						onkeydown={handleComposerKeydown}
						rows="1"
						placeholder="Describe the product, constraints, or questions..."
						disabled={!isAuthenticated || isSendingMessage || isGeneratingImage}
						class="max-h-50 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
					></textarea>
					<button
						type="submit"
						disabled={!isAuthenticated || !draft.trim() || isSendingMessage || isGeneratingImage}
						class="inline-flex h-9 shrink-0 items-center rounded-xl bg-[#0d3b3b] px-4 text-sm font-semibold text-white transition hover:bg-[#114848] disabled:cursor-not-allowed disabled:bg-slate-300"
					>
						{isSendingMessage ? 'Sending...' : 'Send'}
					</button>
				</div>
			</form>
		</div>
	</div>
</section>
