'use node';

import { Agent } from '@convex-dev/agent';
import { openai } from '@ai-sdk/openai';
import { v } from 'convex/values';

import { api, components } from './_generated/api';
import { action } from './_generated/server';
import { PROJECT_OVERVIEW_PROMPT } from './chatConstants';
import { assertThreadAccess } from './chatHelpers';

const chatAgent = new Agent(components.agent, {
	name: 'Prototyper',
	languageModel: openai.chat('gpt-5.2'),
	instructions: PROJECT_OVERVIEW_PROMPT
});

export const sendMessage = action({
	args: {
		threadId: v.string(),
		prompt: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error('OPENAI_API_KEY is not configured in Convex.');
		}

		const prompt = args.prompt.trim();
		if (!prompt) {
			throw new Error('Message cannot be empty.');
		}

		await assertThreadAccess(ctx, args.threadId);
		await ctx.runMutation(api.chat.updateThreadFromPrompt, {
			threadId: args.threadId,
			prompt
		});
		await chatAgent.generateText(ctx, { threadId: args.threadId }, { prompt });

		return null;
	}
});
