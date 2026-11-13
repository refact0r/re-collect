import { readFile } from 'node:fs/promises';
const rs = JSON.parse(await readFile('out/results.json', 'utf8'));
for (const r of rs) {
	const t = r.tokens;
	console.log(`\n### ${r.url}  (load ${r.loadMs}ms, extract ${r.extractMs}ms, scanned ${t?.scanned})`);
	if (!t) { console.log('ERROR', r.error); continue; }
	console.log('roles   ', JSON.stringify(t.roles));
	console.log('fonts   ', t.fonts.map(f => `${f.family}${f.webfont ? '' : '(sys)'} ${Math.round(f.share*100)}% [${f.weights.join(',')}]`).join(' | '));
	console.log('truth   ', JSON.stringify(r.truth));
	console.log('sources ', t.fontSources.providers.join(','), '| files', t.fontSources.files.slice(0,5).join(', '), t.fontSources.googleFamilies.length ? '| gf ' + t.fontSources.googleFamilies.join(','):'', t.fontSources.typekitKits.length ? '| tk '+t.fontSources.typekitKits : '');
	const s = t.typeScale; const f = (x) => x ? `${x.size}/${x.lineHeight} w${x.weight} ls${x.letterSpacing}${x.transform?' '+x.transform:''} ${x.family}` : '-';
	console.log('type    ', `display ${f(s.display)} || h1 ${f(s.h1)} || h2 ${f(s.h2)} || body ${f(s.body)} || small ${f(s.small)}`);
	console.log('sizes   ', t.sizes.map(x => `${x.px}:${Math.round(x.share*100)}`).join(' '));
	const c = t.color;
	console.log('bg      ', c.background.map(x => `${x.value}:${Math.round(x.share*100)}`).join(' '), `media ${c.mediaCoverage} canvas ${c.canvasCoverage} dark ${c.isDark} theme-color ${c.metaThemeColor} scheme ${c.metaColorScheme}/${c.colorSchemeProp}`);
	console.log('text    ', c.text.map(x => `${x.value}:${Math.round(x.share*100)}`).join(' '), '| accent', c.accent.map(x => `${x.value}:${Math.round(x.share*100)}`).join(' '));
	console.log('vars    ', `${t.vars.count} total, ${t.vars.colorCount} color`, Object.entries(t.vars.color).slice(0,6).map(([k,v])=>`${k}=${v}`).join(' '), '| font', JSON.stringify(t.vars.font).slice(0,160));
	console.log('dark    ', `rules ${t.darkMode.mediaRules}, probe changed ${r.darkProbe?.changed}`);
	const l = t.layout;
	console.log('layout  ', `container ${l.containers.map(x=>x.px+':'+Math.round(x.share*100)).join(' ')} | radii ${l.radii.map(x=>x.px+':'+Math.round(x.share*100)).join(' ')} sharp ${l.sharpShare} pill ${l.pillShare} (n=${l.boxed}) | spacing ${l.spacing.slice(0,6).map(x=>x.px).join(',')} div4 ${l.spacingDiv4.div4} div8 ${l.spacingDiv4.div8} | grid ${l.grid} flex ${l.flex}`);
	console.log('shadows ', l.shadows.map(x => x.value.slice(0,60)).join(' || '));
	const m = t.motion;
	console.log('motion  ', `durations ${m.durations.map(x=>x.ms+':'+Math.round(x.share*100)).join(' ')} | easing ${m.easings.map(x=>x.value).join(' ; ')} | anim ${m.animatedElements} running ${m.runningAnimations} kf ${m.keyframes} rm ${m.reducedMotionRules}`);
	console.log('tech    ', t.tech.join(', '), t.generator ? `(gen: ${t.generator})` : '', `| sheets ${t.sheets.total}/${t.sheets.blocked} blocked | cmp ${t.cmp.sampledShare} | iconRuns ${t.iconFontRuns}`);
}
