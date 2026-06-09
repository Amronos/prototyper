<script lang="ts">
	import { tick } from 'svelte';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';

	import {
		mergeStreamedChatMessages,
		sortChatMessages,
		streamToChatMessage
	} from '$lib/agent-streaming';
	import { authState, signIn, signOut } from '$lib/auth';
	import AppSidebar from '$lib/components/home/AppSidebar.svelte';
	import ChatPanel from '$lib/components/home/ChatPanel.svelte';
	import type { ChatMessage, ChatThread } from '$lib/components/home/types.js';
	import { api } from '../../convex/_generated/api.js';

	type PendingMessage = {
		message: ChatMessage;
		replaceAfterMessageCount: number;
	};

	let errorMessage = $state<string | null>(null);
	let isDeletingThreadId = $state<string | null>(null);
	let isDraftThread = $state(false);
	let pendingMessagesByThreadId = $state<Record<string, PendingMessage>>({});
	let selectedThreadId = $state<string | null>(null);
	let streamCursorsByThreadId = $state<Record<string, Record<string, number>>>({});
	let streamDeltasByThreadId = $state<Record<string, Record<string, StreamDelta[]>>>({});
	let streamedMessagesByThreadId = $state<Record<string, ChatMessage[]>>({});

	const convex = useConvexClient();
	const threadsQuery = useQuery(api.chat.listChatThreads, () =>
		$authState.isAuthenticated ? {} : 'skip'
	);
	const messagesQuery = useQuery(api.chat.listThreadMessages, () =>
		$authState.isAuthenticated && selectedThreadId ? { threadId: selectedThreadId } : 'skip'
	);
	const streamListQuery = useQuery(api.chat.syncThreadStreams, () =>
		$authState.isAuthenticated && selectedThreadId
			? {
					threadId: selectedThreadId,
					streamArgs: { kind: 'list' as const, startOrder: 0 }
				}
			: 'skip'
	);
	const imageGenerationStatusQuery = useQuery(api.chat.getThreadImageGenerationStatus, () =>
		$authState.isAuthenticated && selectedThreadId ? { threadId: selectedThreadId } : 'skip'
	);

	const threads = $derived.by<ChatThread[]>(() => threadsQuery.data ?? []);
	const messages = $derived.by<ChatMessage[]>(() => messagesQuery.data?.messages ?? []);
	const isGeneratingImage = $derived.by<boolean>(() => imageGenerationStatusQuery.data ?? false);
	const activeStreams = $derived.by<StreamMessage[]>(() => {
		const streams = streamListQuery.data;
		return streams?.kind === 'list' ? streams.messages : [];
	});
	const streamDeltasQuery = useQuery(api.chat.syncThreadStreams, () => {
		if (!$authState.isAuthenticated || !selectedThreadId || activeStreams.length === 0) {
			return 'skip';
		}

		const cursors = streamCursorsByThreadId[selectedThreadId] ?? {};
		return {
			threadId: selectedThreadId,
			streamArgs: {
				kind: 'deltas' as const,
				cursors: activeStreams.map((stream) => ({
					streamId: stream.streamId,
					cursor: cursors[stream.streamId] ?? 0
				}))
			}
		};
	});
	const streamedMessages = $derived.by<ChatMessage[]>(() =>
		selectedThreadId ? (streamedMessagesByThreadId[selectedThreadId] ?? []) : []
	);
	const displayedMessages = $derived.by<ChatMessage[]>(() => {
		if (!selectedThreadId) {
			return messages;
		}

		const mergedMessages = mergeStreamedChatMessages(messages, streamedMessages);
		const pendingMessage = pendingMessagesByThreadId[selectedThreadId];
		if (!pendingMessage) {
			return mergedMessages;
		}

		return [...mergedMessages, pendingMessage.message];
	});
	const isSendingMessage = $derived.by(
		() => selectedThreadId !== null && selectedThreadId in pendingMessagesByThreadId
	);

	$effect(() => {
		if (!$authState.isAuthenticated) {
			isDraftThread = false;
			pendingMessagesByThreadId = {};
			selectedThreadId = null;
			streamCursorsByThreadId = {};
			streamDeltasByThreadId = {};
			streamedMessagesByThreadId = {};
			return;
		}

		if (!threadsQuery.data || threadsQuery.error) {
			return;
		}

		if (selectedThreadId && threads.some((thread) => thread.id === selectedThreadId)) {
			return;
		}

		selectedThreadId = null;
		if (isDraftThread) {
			return;
		}

		selectedThreadId = threads[0]?.id ?? null;
	});

	$effect(() => {
		if (!selectedThreadId) {
			return;
		}

		const pendingMessage = pendingMessagesByThreadId[selectedThreadId];
		if (!pendingMessage) {
			return;
		}

		if (messages.length <= pendingMessage.replaceAfterMessageCount) {
			return;
		}

		const remainingPendingMessages = { ...pendingMessagesByThreadId };
		delete remainingPendingMessages[selectedThreadId];
		pendingMessagesByThreadId = remainingPendingMessages;
	});

	$effect(() => {
		if (!selectedThreadId) {
			return;
		}

		const streamIds = new Set(activeStreams.map((stream) => stream.streamId));
		if (streamIds.size > 0) {
			return;
		}

		if (
			!streamCursorsByThreadId[selectedThreadId] &&
			!streamDeltasByThreadId[selectedThreadId] &&
			!streamedMessagesByThreadId[selectedThreadId]
		) {
			return;
		}

		const remainingCursors = { ...streamCursorsByThreadId };
		const remainingDeltas = { ...streamDeltasByThreadId };
		const remainingMessages = { ...streamedMessagesByThreadId };
		delete remainingCursors[selectedThreadId];
		delete remainingDeltas[selectedThreadId];
		delete remainingMessages[selectedThreadId];
		streamCursorsByThreadId = remainingCursors;
		streamDeltasByThreadId = remainingDeltas;
		streamedMessagesByThreadId = remainingMessages;
	});

	$effect(() => {
		const threadId = selectedThreadId;
		const streams = activeStreams;
		const streamDeltas = streamDeltasQuery.data;
		if (!threadId || !streamDeltas || streamDeltas.kind !== 'deltas') {
			return;
		}

		const currentThreadDeltas = streamDeltasByThreadId[threadId] ?? {};
		const nextThreadDeltas: Record<string, StreamDelta[]> = { ...currentThreadDeltas };
		const currentThreadCursors = streamCursorsByThreadId[threadId] ?? {};
		const nextThreadCursors: Record<string, number> = { ...currentThreadCursors };
		let hasNewDelta = false;

		for (const delta of streamDeltas.deltas) {
			const cursor = nextThreadCursors[delta.streamId] ?? 0;
			if (delta.start < cursor) {
				continue;
			}

			nextThreadDeltas[delta.streamId] = [...(nextThreadDeltas[delta.streamId] ?? []), delta];
			nextThreadCursors[delta.streamId] = delta.end;
			hasNewDelta = true;
		}

		if (!hasNewDelta) {
			return;
		}

		streamDeltasByThreadId = {
			...streamDeltasByThreadId,
			[threadId]: nextThreadDeltas
		};
		streamCursorsByThreadId = {
			...streamCursorsByThreadId,
			[threadId]: nextThreadCursors
		};

		void rebuildStreamedMessages(threadId, streams, nextThreadDeltas);
	});

	function toErrorMessage(error: unknown) {
		if (error instanceof Error) return error.message;
		if (typeof error === 'string') return error;
		if (!error || typeof error !== 'object') return 'Something went wrong.';

		const record = error as Record<string, unknown>;
		if (record.error) return toErrorMessage(record.error);
		if (typeof record.message === 'string') return record.message;

		return 'Something went wrong.';
	}

	function addPendingMessage(threadId: string, prompt: string) {
		pendingMessagesByThreadId = {
			...pendingMessagesByThreadId,
			[threadId]: {
				message: {
					id: `optimistic:${threadId}`,
					role: 'user',
					text: prompt,
					order: nextMessageOrder(),
					stepOrder: 0,
					status: 'pending'
				},
				replaceAfterMessageCount: messages.length
			}
		};
	}

	function nextMessageOrder() {
		return Math.max(0, ...messages.map((message) => message.order)) + 1;
	}

	async function rebuildStreamedMessages(
		threadId: string,
		streams: StreamMessage[],
		deltasByStreamId: Record<string, StreamDelta[]>
	) {
		const messages = await Promise.all(
			streams.map((stream) => streamToChatMessage(stream, deltasByStreamId[stream.streamId] ?? []))
		);
		const visibleMessages = messages.filter((message) => message !== null);

		streamedMessagesByThreadId = {
			...streamedMessagesByThreadId,
			[threadId]: sortChatMessages(visibleMessages)
		};
	}

	function clearPendingMessage(threadId: string) {
		if (!(threadId in pendingMessagesByThreadId)) {
			return;
		}

		const remainingPendingMessages = { ...pendingMessagesByThreadId };
		delete remainingPendingMessages[threadId];
		pendingMessagesByThreadId = remainingPendingMessages;
	}

	async function openNewThread() {
		if (!$authState.isAuthenticated) {
			await signIn();
			return;
		}

		errorMessage = null;
		isDraftThread = true;
		selectedThreadId = null;
	}

	async function deleteThread(threadId: string) {
		if (!$authState.isAuthenticated || isDeletingThreadId) {
			return;
		}

		errorMessage = null;
		isDeletingThreadId = threadId;

		try {
			await convex.action(api.chat.deleteChatThread, { threadId });

			if (selectedThreadId === threadId) {
				isDraftThread = false;
				selectedThreadId = threads.find((thread) => thread.id !== threadId)?.id ?? null;
			}

			clearPendingMessage(threadId);
			streamCursorsByThreadId = Object.fromEntries(
				Object.entries(streamCursorsByThreadId).filter(([id]) => id !== threadId)
			);
			streamDeltasByThreadId = Object.fromEntries(
				Object.entries(streamDeltasByThreadId).filter(([id]) => id !== threadId)
			);
			streamedMessagesByThreadId = Object.fromEntries(
				Object.entries(streamedMessagesByThreadId).filter(([id]) => id !== threadId)
			);
		} catch (error) {
			errorMessage = toErrorMessage(error);
		} finally {
			isDeletingThreadId = null;
		}
	}

	async function sendMessage(prompt: string) {
		if (!$authState.isAuthenticated) {
			await signIn();
			return;
		}

		errorMessage = null;
		let threadId = selectedThreadId;

		try {
			if (!threadId) {
				const thread = await convex.mutation(api.chat.createChatThread, { prompt });
				threadId = thread.id;
				isDraftThread = false;
				selectedThreadId = threadId;
				await tick();
			}

			if (threadId in pendingMessagesByThreadId) {
				return;
			}

			addPendingMessage(threadId, prompt);
			await convex.action(api.chatActions.sendMessage, {
				threadId,
				prompt
			});
			if (selectedThreadId !== threadId) {
				clearPendingMessage(threadId);
			}
		} catch (error) {
			if (threadId) {
				clearPendingMessage(threadId);
			}
			errorMessage = toErrorMessage(error);
		}
	}
</script>

<svelte:head>
	<title>Prototyper</title>
</svelte:head>

<div class="flex h-screen overflow-hidden bg-[#f3f4f6] text-slate-900">
	<AppSidebar
		hasThreadLoadError={Boolean(threadsQuery.error)}
		isAuthenticated={$authState.isAuthenticated}
		isLoadingThreads={$authState.isLoading || threadsQuery.isLoading}
		onCreateThread={() => void openNewThread()}
		deletingThreadId={isDeletingThreadId}
		onDeleteThread={(threadId) => void deleteThread(threadId)}
		onSelectThread={(threadId) => {
			isDraftThread = false;
			selectedThreadId = threadId;
		}}
		onSignIn={() => void signIn()}
		onSignOut={() => void signOut()}
		{selectedThreadId}
		threadIdsWithPendingMessages={Object.keys(pendingMessagesByThreadId)}
		{threads}
	/>

	<main class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
		{#if errorMessage}
			<div class="shrink-0 border-b border-red-200 bg-red-50 px-8 py-3 text-sm text-red-700">
				{errorMessage}
			</div>
		{/if}

		<ChatPanel
			hasActiveThread={selectedThreadId !== null}
			isAuthenticated={$authState.isAuthenticated}
			{isGeneratingImage}
			isLoadingMessages={$authState.isAuthenticated &&
				selectedThreadId !== null &&
				messagesQuery.isLoading}
			{isSendingMessage}
			messages={displayedMessages}
			onSendMessage={sendMessage}
		/>
	</main>
</div>
