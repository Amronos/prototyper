import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import type { StreamDelta, StreamMessage } from '@convex-dev/agent/validators';

type StreamChatMessage = {
	id: string;
	role: 'assistant' | 'user';
	text: string;
	order: number;
	stepOrder: number;
	status: 'streaming' | 'success' | 'failed';
};

function getDeltaParts<T>(deltas: StreamDelta[]) {
	return deltas.toSorted((a, b) => a.start - b.start).flatMap((delta) => delta.parts as T[]);
}

function joinText(parts: UIMessage['parts']) {
	return parts
		.filter((part) => part.type === 'text')
		.map((part) => part.text)
		.filter(Boolean)
		.join(' ');
}

function streamStatusToMessageStatus(status: StreamMessage['status']) {
	switch (status) {
		case 'finished':
			return 'success' as const;
		case 'aborted':
			return 'failed' as const;
		case 'streaming':
		default:
			return 'streaming' as const;
	}
}

async function readChunkedUIMessage(stream: StreamMessage, parts: UIMessageChunk[]) {
	const baseMessage: UIMessage = {
		id: `stream:${stream.streamId}`,
		role: 'assistant',
		parts: []
	};
	const partsStream = new ReadableStream<UIMessageChunk>({
		start(controller) {
			for (const part of parts) {
				controller.enqueue(part);
			}
			controller.close();
		}
	});

	let message = baseMessage;
	for await (const nextMessage of readUIMessageStream({
		message: baseMessage,
		stream: partsStream
	})) {
		message = nextMessage;
	}

	return message;
}

function readTextParts(deltas: StreamDelta[]) {
	return getDeltaParts<Record<string, unknown>>(deltas)
		.flatMap((part) => {
			if (part.type === 'text-delta' && typeof part.text === 'string') {
				return [part.text];
			}
			if (part.type === 'text' && typeof part.text === 'string') {
				return [part.text];
			}
			return [];
		})
		.join('');
}

export async function streamToChatMessage(
	stream: StreamMessage,
	deltas: StreamDelta[]
): Promise<StreamChatMessage | null> {
	const text =
		stream.format === 'UIMessageChunk'
			? joinText((await readChunkedUIMessage(stream, getDeltaParts<UIMessageChunk>(deltas))).parts)
			: readTextParts(deltas);

	if (!text.trim()) {
		return null;
	}

	return {
		id: `stream:${stream.streamId}`,
		role: 'assistant',
		text,
		order: stream.order,
		stepOrder: stream.stepOrder,
		status: streamStatusToMessageStatus(stream.status)
	};
}

export function sortChatMessages<T extends { order: number; stepOrder: number }>(messages: T[]) {
	return messages.toSorted((a, b) => a.order - b.order || a.stepOrder - b.stepOrder);
}

export function mergeStreamedChatMessages<
	T extends { order: number; stepOrder: number; status: string }
>(messages: T[], streamingMessages: T[]) {
	return sortChatMessages([...messages, ...streamingMessages]).reduce<T[]>((merged, message) => {
		const last = merged.at(-1);
		if (!last || last.order !== message.order || last.stepOrder !== message.stepOrder) {
			return [...merged, message];
		}

		if (
			(last.status === 'pending' || last.status === 'streaming') &&
			message.status !== 'pending'
		) {
			return [...merged.slice(0, -1), message];
		}

		return merged;
	}, []);
}
