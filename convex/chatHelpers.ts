import type { UserIdentity } from 'convex/server';

import { components } from './_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';

type AnyCtx = ActionCtx | MutationCtx | QueryCtx;

export async function getAuthenticatedIdentity(ctx: AnyCtx): Promise<UserIdentity> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Authentication required.');
	}

	return identity;
}

export async function assertThreadAccess(ctx: AnyCtx, threadId: string) {
	const identity = await getAuthenticatedIdentity(ctx);
	const thread = await ctx.runQuery(components.agent.threads.getThread, {
		threadId
	});

	if (!thread) {
		throw new Error('Chat thread not found.');
	}

	if (thread.userId !== identity.tokenIdentifier) {
		throw new Error('You are not allowed to access this chat thread.');
	}

	return { identity, thread };
}
