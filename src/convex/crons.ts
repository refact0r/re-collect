import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('sweep abandoned uploads', { hours: 24 }, internal.r2.sweepUploads, {});
crons.interval('sweep old login attempts', { hours: 24 }, internal.sessions.sweepLoginAttempts, {});
crons.interval('poll discovery sources', { hours: 6 }, internal.discovery.pollAll, {});
crons.interval(
	'expire discovery candidates',
	{ hours: 24 },
	internal.discovery.expireCandidates,
	{}
);

export default crons;
