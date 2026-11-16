/**
 * A damped spring (unit mass) from 0 to 1 as a CSS linear() easing, sampled each
 * frame until it settles; its duration (ms) is how long that takes
 */
export function spring(stiffness: number, damping: number) {
	const points = [0];
	let x = 0;
	let v = 0;
	while (points.length < 120) {
		for (let i = 0; i < 8; i++) {
			v += (stiffness * (1 - x) - damping * v) / 480;
			x += v / 480;
		}
		points.push(Math.round(x * 1000) / 1000);
		if (Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.02) break;
	}
	points[points.length - 1] = 1;
	return { duration: Math.round((points.length - 1) * (1000 / 60)), easing: `linear(${points})` };
}
