<script lang="ts">
	import type { StyleCount, StylePair } from '$lib/atlas.js';

	let { styles, pairs }: { styles: StyleCount[]; pairs: StylePair[] } = $props();

	const W = 900;
	const H = 620;
	const MIN_COUNT = 2;

	interface SimNode {
		name: string;
		count: number;
		hue: number | null;
		r: number;
		x: number;
		y: number;
		vx: number;
		vy: number;
	}

	interface SimLink {
		source: number;
		target: number;
		weight: number;
	}

	const graph = $derived.by(() => {
		let shown = styles.filter((s) => s.count >= MIN_COUNT);
		if (shown.length < 8) shown = styles;
		const index = new Map(shown.map((s, i) => [s.name, i]));
		const nodes: SimNode[] = shown.map((s, i) => {
			// deterministic golden-angle spiral seeding, big nodes near the center
			const angle = i * 2.399963;
			const radius = 40 + 8 * Math.sqrt(i) * 6;
			return {
				name: s.name,
				count: s.count,
				hue: s.hue,
				r: 5 + Math.sqrt(s.count) * 3,
				x: W / 2 + Math.cos(angle) * radius,
				y: H / 2 + (Math.sin(angle) * radius * H) / W,
				vx: 0,
				vy: 0
			};
		});
		const links: SimLink[] = [];
		for (const pair of pairs) {
			const source = index.get(pair.a);
			const target = index.get(pair.b);
			if (source !== undefined && target !== undefined) {
				links.push({ source, target, weight: pair.count });
			}
		}
		return { nodes, links };
	});

	let simNodes = $state<SimNode[]>([]);
	let hovered = $state<string | null>(null);

	const neighbors = $derived.by(() => {
		const map = new Map<string, Set<string>>();
		for (const link of graph.links) {
			const a = graph.nodes[link.source].name;
			const b = graph.nodes[link.target].name;
			if (!map.has(a)) map.set(a, new Set());
			if (!map.has(b)) map.set(b, new Set());
			map.get(a)!.add(b);
			map.get(b)!.add(a);
		}
		return map;
	});

	// Small force simulation: pairwise repulsion, springs on co-occurrence
	// links, and gravity toward the center. Runs until alpha decays.
	$effect(() => {
		const { nodes, links } = graph;
		simNodes = nodes;
		let alpha = 1;
		let raf = 0;

		function tick() {
			for (const node of nodes) {
				node.vx = 0;
				node.vy = 0;
			}
			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					const a = nodes[i];
					const b = nodes[j];
					let dx = b.x - a.x;
					let dy = b.y - a.y;
					let d2 = dx * dx + dy * dy;
					if (d2 < 1) {
						// nudge coincident nodes apart deterministically
						dx = (i - j) * 0.1;
						dy = 0.1;
						d2 = dx * dx + dy * dy;
					}
					const force = (2200 * (a.r + b.r)) / d2;
					const d = Math.sqrt(d2);
					const fx = (dx / d) * force;
					const fy = (dy / d) * force;
					a.vx -= fx;
					a.vy -= fy;
					b.vx += fx;
					b.vy += fy;
				}
			}
			for (const link of links) {
				const a = nodes[link.source];
				const b = nodes[link.target];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
				const rest = 100 + a.r + b.r;
				const strength = 0.02 + 0.012 * Math.min(link.weight, 5);
				const force = (d - rest) * strength;
				const fx = (dx / d) * force;
				const fy = (dy / d) * force;
				a.vx += fx;
				a.vy += fy;
				b.vx -= fx;
				b.vy -= fy;
			}
			for (const node of nodes) {
				node.vx += (W / 2 - node.x) * 0.006;
				node.vy += (H / 2 - node.y) * 0.01;
				node.x += node.vx * alpha;
				node.y += node.vy * alpha;
				node.x = Math.max(node.r + 8, Math.min(W - node.r - 8, node.x));
				node.y = Math.max(node.r + 12, Math.min(H - node.r - 26, node.y));
			}
			simNodes = [...nodes];
			alpha *= 0.97;
			if (alpha > 0.01) raf = requestAnimationFrame(tick);
		}

		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	function nodeFill(node: SimNode): string {
		return node.hue !== null ? `oklch(68% 0.13 ${node.hue})` : 'oklch(45% 0 0)';
	}

	function isDimmed(name: string): boolean {
		if (hovered === null || hovered === name) return false;
		return !(neighbors.get(hovered)?.has(name) ?? false);
	}

	function linkDimmed(link: SimLink): boolean {
		if (hovered === null) return false;
		return simNodes[link.source]?.name !== hovered && simNodes[link.target]?.name !== hovered;
	}
</script>

<svg
	viewBox="0 0 {W} {H}"
	role="img"
	aria-label="map of styles in the library, connected when they appear on the same item"
	onmouseleave={() => (hovered = null)}
>
	{#each graph.links as link, i (i)}
		{@const a = simNodes[link.source]}
		{@const b = simNodes[link.target]}
		{#if a && b}
			<line
				x1={a.x}
				y1={a.y}
				x2={b.x}
				y2={b.y}
				class="link"
				class:dimmed={linkDimmed(link)}
				style:stroke-width={0.5 + Math.min(link.weight, 5) * 0.7}
				style:opacity={linkDimmed(link) ? 0.04 : 0.1 + Math.min(link.weight, 5) * 0.09}
			/>
		{/if}
	{/each}
	{#each simNodes as node (node.name)}
		<a
			href="/search?q={encodeURIComponent(node.name)}"
			class="node"
			class:dimmed={isDimmed(node.name)}
			onmouseenter={() => (hovered = node.name)}
			onfocus={() => (hovered = node.name)}
			onblur={() => (hovered = null)}
		>
			<circle cx={node.x} cy={node.y} r={node.r} fill={nodeFill(node)} />
			<text x={node.x} y={node.y + node.r + 13} class:big={node.count >= 8}>
				{node.name}
			</text>
		</a>
	{/each}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--border);
		background: var(--bg-1);
	}

	.link {
		stroke: var(--txt-3);
		transition: opacity 150ms ease;
	}

	.node {
		cursor: pointer;
		transition: opacity 150ms ease;
	}

	.node.dimmed {
		opacity: 0.15;
	}

	.node:hover circle,
	.node:focus-visible circle {
		stroke: var(--txt-1);
		stroke-width: 1.5;
	}

	.node:focus-visible {
		outline: none;
	}

	.node text {
		fill: var(--txt-3);
		font-size: 11px;
		text-anchor: middle;
		pointer-events: none;
	}

	.node text.big {
		fill: var(--txt-2);
		font-size: 13px;
	}

	.node:hover text {
		fill: var(--txt-1);
	}
</style>
