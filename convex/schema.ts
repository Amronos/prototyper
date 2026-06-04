import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	threadImageGenerationStatuses: defineTable({
		threadId: v.string(),
		isGenerating: v.boolean(),
		updatedAt: v.number()
	}).index('by_threadId', ['threadId'])
});
