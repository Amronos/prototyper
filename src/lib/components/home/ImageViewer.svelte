<script lang="ts">
	type Props = {
		alt: string;
		src: string;
		onClose: () => void;
	};

	let { alt, src, onClose }: Props = $props();

	type ActionState = 'idle' | 'busy' | 'done' | 'error';

	let downloadState = $state<ActionState>('idle');
	let copyState = $state<ActionState>('idle');

	let dialogElement = $state<HTMLDivElement | null>(null);

	function deriveFileName() {
		try {
			const url = new URL(src);
			const last = url.pathname.split('/').filter(Boolean).pop();
			if (last && /\.[a-z0-9]+$/i.test(last)) {
				return decodeURIComponent(last);
			}
		} catch {
			// Ignore malformed URLs and fall back to a generated name.
		}
		return 'image.png';
	}

	async function fetchBlob() {
		const response = await fetch(src, { mode: 'cors' });
		if (!response.ok) {
			throw new Error(`Failed to fetch image (${response.status})`);
		}
		return await response.blob();
	}

	async function handleDownload() {
		if (downloadState === 'busy') {
			return;
		}

		downloadState = 'busy';
		try {
			const blob = await fetchBlob();
			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = deriveFileName();
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(objectUrl);
			downloadState = 'done';
		} catch {
			// Fall back to opening the image directly so the user can save it manually.
			window.open(src, '_blank', 'noopener,noreferrer');
			downloadState = 'error';
		} finally {
			setTimeout(() => {
				downloadState = 'idle';
			}, 2000);
		}
	}

	async function toPngBlob(blob: Blob) {
		if (blob.type === 'image/png') {
			return blob;
		}

		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('Canvas context unavailable');
		}
		context.drawImage(bitmap, 0, 0);
		bitmap.close();

		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result) {
					resolve(result);
				} else {
					reject(new Error('Failed to encode image'));
				}
			}, 'image/png');
		});
	}

	async function handleCopy() {
		if (copyState === 'busy') {
			return;
		}

		copyState = 'busy';
		try {
			if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
				throw new Error('Clipboard image copy unsupported');
			}
			const blob = await fetchBlob();
			const pngBlob = await toPngBlob(blob);
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
			copyState = 'done';
		} catch {
			try {
				await navigator.clipboard.writeText(src);
				copyState = 'done';
			} catch {
				copyState = 'error';
			}
		} finally {
			setTimeout(() => {
				copyState = 'idle';
			}, 2000);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	$effect(() => {
		dialogElement?.focus();
	});

	const downloadLabel = $derived(
		downloadState === 'busy'
			? 'Downloading...'
			: downloadState === 'done'
				? 'Downloaded'
				: downloadState === 'error'
					? 'Opened in tab'
					: 'Download'
	);

	const copyLabel = $derived(
		copyState === 'busy'
			? 'Copying...'
			: copyState === 'done'
				? 'Copied'
				: copyState === 'error'
					? 'Copy failed'
					: 'Copy'
	);
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={dialogElement}
	class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
	role="dialog"
	aria-modal="true"
	aria-label={alt || 'Image viewer'}
	tabindex="-1"
	onclick={handleBackdropClick}
>
	<div class="flex max-h-full max-w-5xl flex-col items-center gap-4">
		<div class="flex w-full items-center justify-end gap-2">
			<button
				type="button"
				onclick={handleCopy}
				class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
				</svg>
				{copyLabel}
			</button>
			<button
				type="button"
				onclick={handleDownload}
				class="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-medium text-white backdrop-blur transition hover:bg-white/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="7 10 12 15 17 10"></polyline>
					<line x1="12" y1="15" x2="12" y2="3"></line>
				</svg>
				{downloadLabel}
			</button>
			<button
				type="button"
				onclick={onClose}
				aria-label="Close image viewer"
				class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>

		<img {src} {alt} class="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl" />
	</div>
</div>
