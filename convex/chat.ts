import { createThread, listMessages, syncStreams, vStreamArgs } from '@convex-dev/agent';
import { vStreamDelta, vStreamMessage } from '@convex-dev/agent/validators';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, mutation, query, type ActionCtx } from './_generated/server';
import { buildThreadSummary, buildThreadTitle } from './chatConstants';
import { assertThreadAccess, getAuthenticatedIdentity } from './chatHelpers';

export const listChatThreads = query({
	args: {},
	returns: v.array(
		v.object({
			id: v.string(),
			title: v.string(),
			summary: v.string(),
			createdAt: v.number()
		})
	),
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return [];
		}

		const { page } = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
			userId: identity.tokenIdentifier,
			order: 'desc',
			paginationOpts: {
				cursor: null,
				numItems: 100
			}
		});

		return page.map((thread) => ({
			id: thread._id,
			title: thread.title?.trim() || buildThreadTitle(thread.summary ?? ''),
			summary: thread.summary?.trim() || '',
			createdAt: thread._creationTime
		}));
	}
});

export const createChatThread = mutation({
	args: {
		prompt: v.string()
	},
	returns: v.object({
		id: v.string(),
		title: v.string(),
		summary: v.string(),
		createdAt: v.number()
	}),
	handler: async (ctx, args) => {
		const identity = await getAuthenticatedIdentity(ctx);
		const prompt = args.prompt.trim();
		const title = buildThreadTitle(prompt);
		const summary = buildThreadSummary(prompt);
		const threadId = await createThread(ctx, components.agent, {
			userId: identity.tokenIdentifier,
			title,
			summary
		});
		const thread = await ctx.runQuery(components.agent.threads.getThread, {
			threadId
		});
		if (!thread) {
			throw new Error('Failed to create chat thread.');
		}

		return {
			id: thread._id,
			title: thread.title?.trim() || buildThreadTitle(thread.summary ?? ''),
			summary: thread.summary?.trim() || '',
			createdAt: thread._creationTime
		};
	}
});

export const deleteChatThread = action({
	args: {
		threadId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await assertThreadAccess(ctx, args.threadId);
		const fileIds = await collectThreadFileIds(ctx, args.threadId);
		await ctx.runMutation(internal.chat.deleteThreadImageGenerationStatus, {
			threadId: args.threadId
		});

		await ctx.runAction(components.agent.threads.deleteAllForThreadIdSync, {
			threadId: args.threadId
		});
		await deleteUnreferencedFiles(ctx, fileIds);

		return null;
	}
});

export const deleteThreadImageGenerationStatus = internalMutation({
	args: {
		threadId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const status = await ctx.db
			.query('threadImageGenerationStatuses')
			.withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
			.first();
		if (status) {
			await ctx.db.delete(status._id);
		}

		return null;
	}
});

export const listThreadMessages = query({
	args: {
		threadId: v.string(),
		streamArgs: vStreamArgs
	},
	returns: v.object({
		messages: v.array(
			v.object({
				id: v.string(),
				role: v.union(v.literal('user'), v.literal('assistant')),
				text: v.string(),
				order: v.number(),
				stepOrder: v.number(),
				status: v.string()
			})
		),
		streams: v.optional(
			v.union(
				v.object({
					kind: v.literal('list'),
					messages: v.array(vStreamMessage)
				}),
				v.object({
					kind: v.literal('deltas'),
					deltas: v.array(vStreamDelta)
				})
			)
		)
	}),
	handler: async (ctx, args) => {
		await assertThreadAccess(ctx, args.threadId);

		const { page } = await listMessages(ctx, components.agent, {
			threadId: args.threadId,
			excludeToolMessages: true,
			paginationOpts: {
				cursor: null,
				numItems: 200
			}
		});

		const messages = page
			.flatMap((message) => {
				const role = message.message?.role;
				if (role !== 'user' && role !== 'assistant') {
					return [];
				}

				const text = typeof message.text === 'string' ? message.text.trim() : '';
				if (!text) {
					return [];
				}

				return [
					{
						id: message._id,
						role,
						text,
						order: message.order,
						stepOrder: message.stepOrder,
						status: message.status
					}
				];
			})
			.reverse();

		const streams = await syncStreams(ctx, components.agent, {
			threadId: args.threadId,
			streamArgs: args.streamArgs
		});

		return streams ? { messages, streams } : { messages };
	}
});

export const getThreadImageGenerationStatus = query({
	args: {
		threadId: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await assertThreadAccess(ctx, args.threadId);

		const status = await ctx.db
			.query('threadImageGenerationStatuses')
			.withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
			.first();

		return status?.isGenerating ?? false;
	}
});

export const updateThreadFromPrompt = mutation({
	args: {
		threadId: v.string(),
		prompt: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const { thread } = await assertThreadAccess(ctx, args.threadId);
		const prompt = args.prompt.trim();
		if (!prompt) {
			return null;
		}

		const patch: { summary?: string; title?: string } = {
			summary: buildThreadSummary(prompt)
		};
		if (!thread.title?.trim()) {
			patch.title = buildThreadTitle(prompt);
		}

		await ctx.runMutation(components.agent.threads.updateThread, {
			threadId: args.threadId,
			patch
		});

		return null;
	}
});

export const setThreadImageGenerationStatus = internalMutation({
	args: {
		threadId: v.string(),
		isGenerating: v.boolean()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existingStatus = await ctx.db
			.query('threadImageGenerationStatuses')
			.withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
			.first();

		if (existingStatus) {
			await ctx.db.patch(existingStatus._id, {
				isGenerating: args.isGenerating,
				updatedAt: Date.now()
			});
			return null;
		}

		await ctx.db.insert('threadImageGenerationStatuses', {
			threadId: args.threadId,
			isGenerating: args.isGenerating,
			updatedAt: Date.now()
		});

		return null;
	}
});

async function collectThreadFileIds(ctx: ActionCtx, threadId: string) {
	const fileIds = new Set<string>();
	let cursor: string | null = null;

	while (true) {
		const { page, continueCursor, isDone } = await listMessages(ctx, components.agent, {
			threadId,
			excludeToolMessages: false,
			paginationOpts: {
				cursor,
				numItems: 100
			}
		});
		for (const message of page) {
			for (const fileId of message.fileIds ?? []) {
				fileIds.add(fileId);
			}
		}
		if (isDone) {
			break;
		}
		cursor = continueCursor;
	}

	return [...fileIds];
}

async function deleteUnreferencedFiles(ctx: ActionCtx, fileIds: string[]) {
	const filesToDelete: Array<{ fileId: string; storageId: Id<'_storage'> }> = [];
	for (const fileId of fileIds) {
		const file = await ctx.runQuery(components.agent.files.get, { fileId });
		if (file && file.refcount === 0) {
			filesToDelete.push({
				fileId,
				storageId: file.storageId as Id<'_storage'>
			});
		}
	}
	if (filesToDelete.length === 0) {
		return;
	}

	const deletedFileIds = new Set(
		await ctx.runMutation(components.agent.files.deleteFiles, {
			fileIds: filesToDelete.map((file) => file.fileId)
		})
	);
	for (const file of filesToDelete) {
		if (deletedFileIds.has(file.fileId)) {
			await ctx.storage.delete(file.storageId);
		}
	}
}
