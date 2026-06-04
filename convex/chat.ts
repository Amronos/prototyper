import { createThread, listMessages } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from './_generated/api';
import { mutation, query } from './_generated/server';
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

export const deleteChatThread = mutation({
	args: {
		threadId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await assertThreadAccess(ctx, args.threadId);

		await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
			threadId: args.threadId
		});

		return null;
	}
});

export const listThreadMessages = query({
	args: {
		threadId: v.string()
	},
	returns: v.array(
		v.object({
			id: v.string(),
			role: v.union(v.literal('user'), v.literal('assistant')),
			text: v.string()
		})
	),
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

		return page
			.flatMap((message) => {
				const role = message.message?.role;
				if ((role !== 'user' && role !== 'assistant') || typeof message.text !== 'string') {
					return [];
				}

				const text = message.text.trim();
				if (!text) {
					return [];
				}

				return [
					{
						id: message._id,
						role,
						text
					}
				];
			})
			.reverse();
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
