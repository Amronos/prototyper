<script lang="ts">
	import embLogo from '$lib/assets/emb-logo.svg';

	import type { ChatThread } from './types.js';

	type Props = {
		deletingThreadId: string | null;
		hasThreadLoadError: boolean;
		isAuthenticated: boolean;
		isLoadingThreads: boolean;
		onCreateThread: () => void;
		onDeleteThread: (threadId: string) => void;
		onSelectThread: (threadId: string) => void;
		onSignIn: () => void;
		onSignOut: () => void;
		selectedThreadId: string | null;
		threadIdsWithPendingMessages: string[];
		threads: ChatThread[];
	};

	let {
		deletingThreadId,
		hasThreadLoadError,
		isAuthenticated,
		isLoadingThreads,
		onCreateThread,
		onDeleteThread,
		onSelectThread,
		onSignIn,
		onSignOut,
		selectedThreadId,
		threadIdsWithPendingMessages,
		threads
	}: Props = $props();

	let contextMenu = $state<{ threadId: string; x: number; y: number } | null>(null);

	function closeContextMenu() {
		contextMenu = null;
	}

	function openThreadContextMenu(event: MouseEvent, threadId: string) {
		const menuWidth = 176;
		const menuHeight = 52;
		const padding = 8;

		contextMenu = {
			threadId,
			x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
			y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding))
		};
	}

	function handleThreadContextMenu(event: MouseEvent, threadId: string) {
		event.preventDefault();
		event.stopPropagation();
		openThreadContextMenu(event, threadId);
	}

	function stopClickPropagation(event: MouseEvent) {
		event.stopPropagation();
	}

	function handleMenuContextMenu(event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
	}

	function handleMenuKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeContextMenu();
			return;
		}

		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	function deleteThreadFromContextMenu() {
		if (!contextMenu) {
			return;
		}

		onDeleteThread(contextMenu.threadId);
		closeContextMenu();
	}

	function isThreadBusy(threadId: string) {
		return deletingThreadId === threadId || threadIdsWithPendingMessages.includes(threadId);
	}
</script>

<svelte:window
	onclick={closeContextMenu}
	oncontextmenu={closeContextMenu}
	onresize={closeContextMenu}
/>

<aside class="flex w-72 shrink-0 flex-col bg-[#0d3b3b] text-white">
	<div class="flex items-center gap-3 px-6 py-6">
		<div class="rounded-xl bg-white/10 p-2 ring-1 ring-white/15">
			<img src={embLogo} alt="EMB Global" class="h-9 w-auto object-contain" loading="eager" />
		</div>
		<div>
			<p class="text-base font-semibold tracking-tight">Prototyper</p>
		</div>
	</div>

	<nav class="mt-2 flex-1 overflow-y-auto px-6 py-2">
		{#if isAuthenticated}
			<button
				type="button"
				onclick={onCreateThread}
				aria-pressed={selectedThreadId === null}
				class={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
					selectedThreadId === null
						? 'bg-white text-[#0d3b3b]'
						: 'bg-white/10 text-white hover:bg-white/20'
				}`}
			>
				<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m-7-7h14" />
				</svg>
				New thread
			</button>
		{/if}

		<p class="mt-5 text-[11px] font-medium tracking-wide text-white/50 uppercase">Threads</p>

		{#if !isAuthenticated}
			<p class="mt-3 text-sm text-white/55">Sign in to load your chats.</p>
		{:else if isLoadingThreads}
			<p class="mt-3 text-sm text-white/55">Loading threads...</p>
		{:else if hasThreadLoadError}
			<p class="mt-3 text-sm text-red-100">Unable to load threads.</p>
		{:else if threads.length === 0}
			<p class="mt-3 text-sm text-white/55">No chat threads yet.</p>
		{:else}
			<div class="mt-3 flex flex-col gap-2">
				{#each threads as thread (thread.id)}
					<button
						type="button"
						onclick={() => onSelectThread(thread.id)}
						oncontextmenu={(event) => handleThreadContextMenu(event, thread.id)}
						aria-pressed={selectedThreadId === thread.id}
						class={`rounded-lg px-3 py-2.5 text-left transition ${
							selectedThreadId === thread.id
								? 'bg-white text-[#0d3b3b]'
								: 'bg-white/5 text-white/80 ring-1 ring-white/10 hover:bg-white/10'
						}`}
					>
						<span class="block text-sm font-medium">{thread.title}</span>
						<span
							class={`mt-0.5 block text-xs ${
								selectedThreadId === thread.id ? 'text-[#0d3b3b]/70' : 'text-white/50'
							}`}
						>
							{thread.summary || 'No messages yet.'}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</nav>

	{#if contextMenu}
		<div
			class="fixed z-50 min-w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
			style:left={`${contextMenu.x}px`}
			style:top={`${contextMenu.y}px`}
			onclick={stopClickPropagation}
			oncontextmenu={handleMenuContextMenu}
			onkeydown={handleMenuKeydown}
			role="menu"
			aria-label="Thread actions"
			tabindex="-1"
		>
			<button
				type="button"
				class={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
					isThreadBusy(contextMenu.threadId)
						? 'cursor-not-allowed text-slate-300'
						: 'text-red-600 hover:bg-red-50'
				}`}
				disabled={isThreadBusy(contextMenu.threadId)}
				onclick={deleteThreadFromContextMenu}
				role="menuitem"
			>
				{deletingThreadId === contextMenu.threadId ? 'Deleting...' : 'Delete thread'}
			</button>
		</div>
	{/if}

	<div class="border-t border-white/10 px-6 py-5">
		{#if isAuthenticated}
			<button
				type="button"
				onclick={onSignOut}
				class="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20"
			>
				Sign out
			</button>
		{:else}
			<button
				type="button"
				onclick={onSignIn}
				class="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#0d3b3b] transition hover:bg-white/90"
			>
				Sign in
			</button>
		{/if}
	</div>
</aside>
