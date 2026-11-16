import { defineApp } from 'convex/server';
import r2 from '@convex-dev/r2/convex.config.js';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';
import workpool from '@convex-dev/workpool/convex.config.js';

const app = defineApp();
app.use(r2);
app.use(rateLimiter);
app.use(workpool, { name: 'screenshotPool' });
app.use(workpool, { name: 'taggingPool' });
app.use(workpool, { name: 'embeddingPool' });
app.use(workpool, { name: 'variantPool' });

export default app;
