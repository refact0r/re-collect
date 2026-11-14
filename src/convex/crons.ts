import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('sweep abandoned uploads', { hours: 24 }, internal.r2.sweepUploads, {});
crons.interval('poll discovery sources', { hours: 6 }, internal.discovery.pollAll, {});

export default crons;
