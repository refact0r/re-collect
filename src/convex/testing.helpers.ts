/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import workpool from '@convex-dev/workpool/test';
import schema from './schema';

// Test-only; the second dot in the file name keeps Convex from deploying it.

// A convex-test backend with every workpool registered, so any function that
// queues work (tagging, captures, embeddings) can run
export function newTest() {
	const t = convexTest(schema, import.meta.glob('./**/*.ts'));
	for (const pool of ['taggingPool', 'screenshotPool', 'embeddingPool']) workpool.register(t, pool);
	return t;
}

export type Test = ReturnType<typeof newTest>;
