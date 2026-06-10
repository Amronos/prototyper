'use node';

import { Agent, createTool, storeFile } from '@convex-dev/agent';
import { openai } from '@ai-sdk/openai';
import {
	generateImage,
	stepCountIs,
	type GeneratedFile,
	type GenerateImageResult,
	type StepResult,
	type ToolSet
} from 'ai';
import { v } from 'convex/values';
import { z } from 'zod';

import { api, components, internal } from './_generated/api';
import { action } from './_generated/server';
import { PROJECT_OVERVIEW_PROMPT } from './chatConstants';
import { assertThreadAccess } from './chatHelpers';

const conceptImageCompositionSchema = z.enum(['square', 'landscape', 'portrait']);
type ConceptImageComposition = z.infer<typeof conceptImageCompositionSchema>;

const conceptImageInputSchema = z.object({
	prompt: z
		.string()
		.min(20)
		.describe(
			'A complete image prompt describing key features, environment, camera angle, style, etc.'
		),
	composition: conceptImageCompositionSchema
		.default('landscape')
		.describe('Best framing for the image.')
});
type ConceptImageInput = z.infer<typeof conceptImageInputSchema>;

const conceptImageSuccessSchema = z.object({
	fileId: z.string(),
	mediaType: z.string(),
	url: z.string()
});
type ConceptImageSuccess = z.infer<typeof conceptImageSuccessSchema>;

const conceptImageFailureSchema = z.object({
	error: z.string()
});
type ConceptImageFailure = z.infer<typeof conceptImageFailureSchema>;

type ConceptImageOutput = ConceptImageSuccess | ConceptImageFailure;
const conceptImageOutputSchema: z.ZodType<ConceptImageOutput> = z.union([
	conceptImageSuccessSchema,
	conceptImageFailureSchema
]);

const conceptImageTool = createTool<ConceptImageInput, ConceptImageOutput>({
	description: 'Generate an image by prompting an image generation model.',
	inputSchema: conceptImageInputSchema,
	outputSchema: conceptImageOutputSchema,
	execute: async (ctx, input) => {
		if (!ctx.threadId) {
			throw new Error('generateProductConceptImage requires a thread context.');
		}

		try {
			await ctx.runMutation(internal.chat.setThreadImageGenerationStatus, {
				threadId: ctx.threadId,
				isGenerating: true
			});

			const result: GenerateImageResult = await generateImage({
				model: openai.image('gpt-image-2'),
				prompt: input.prompt,
				size: compositionToSize(input.composition),
				providerOptions: {
					openai: {
						quality: 'medium',
						outputFormat: 'png',
						moderation: 'auto',
						user: ctx.userId
					}
				}
			});
			const image: GeneratedFile = result.image;
			const imageBuffer = Uint8Array.from(image.uint8Array).buffer;
			const { file } = await storeFile(
				ctx,
				components.agent,
				new Blob([imageBuffer], {
					type: image.mediaType
				})
			);

			return {
				fileId: file.fileId,
				mediaType: image.mediaType,
				url: file.url
			};
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : 'Image generation failed.'
			};
		} finally {
			await ctx.runMutation(internal.chat.setThreadImageGenerationStatus, {
				threadId: ctx.threadId,
				isGenerating: false
			});
		}
	},
	toModelOutput: (_ctx, options) => {
		const output = options.output;
		if (!isConceptImageSuccess(output)) {
			return {
				type: 'text',
				value: output.error
			};
		}

		return {
			type: 'content',
			value: [
				{
					type: 'text',
					text: `Image generated successfully. Exact image URL that can be attached as markdown: ${output.url}`
				},
				{
					type: 'image-url',
					url: output.url
				}
			]
		};
	}
});

const chatAgentTools = {
	generateProductConceptImage: conceptImageTool
} satisfies ToolSet;
type ChatAgentTools = typeof chatAgentTools;
type ChatStepResult = StepResult<ChatAgentTools>;

const chatAgent = new Agent<object, ChatAgentTools>(components.agent, {
	name: 'Prototyper',
	languageModel: openai.chat('gpt-5.2'),
	instructions: PROJECT_OVERVIEW_PROMPT,
	tools: chatAgentTools,
	stopWhen: stepCountIs(5)
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
		const steps: ChatStepResult[] = [];
		await chatAgent.streamText(
			ctx,
			{ threadId: args.threadId },
			{
				prompt,
				onStepFinish: (step) => {
					steps.push(step);
				}
			},
			{
				saveStreamDeltas: true
			}
		);
		await saveGeneratedConceptImages(ctx, args.threadId, steps);

		return null;
	}
});

function compositionToSize(composition: ConceptImageComposition) {
	switch (composition) {
		case 'portrait':
			return '1024x1536' as const;
		case 'square':
			return '1024x1024' as const;
		case 'landscape':
		default:
			return '1536x1024' as const;
	}
}

async function saveGeneratedConceptImages(
	ctx: Parameters<typeof chatAgent.saveMessage>[0],
	threadId: string,
	steps: ChatStepResult[]
) {
	for (const image of extractGeneratedConceptImages(steps)) {
		await chatAgent.saveMessage(ctx, {
			threadId,
			skipEmbeddings: true,
			metadata: {
				fileIds: [image.fileId]
			},
			message: {
				role: 'assistant',
				content: [
					{
						type: 'file',
						data: new URL(image.url),
						mediaType: image.mediaType
					}
				]
			}
		});
	}
}

function extractGeneratedConceptImages(steps: ChatStepResult[]): ConceptImageSuccess[] {
	return steps.flatMap((step) =>
		step.staticToolResults.flatMap((toolResult) => {
			if (toolResult.toolName !== 'generateProductConceptImage') {
				return [];
			}

			return isConceptImageSuccess(toolResult.output) ? [toolResult.output] : [];
		})
	);
}

function isConceptImageSuccess(output: ConceptImageOutput): output is ConceptImageSuccess {
	return 'url' in output;
}
