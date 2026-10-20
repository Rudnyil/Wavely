import crypto from 'node:crypto';

/** A deterministic abstract cover (no text, no scripts) for tracks without an uploaded image. */
export function generatedCover(id) {
  const h = crypto.createHash('sha256').update(id).digest();
  const hue1 = Math.round((h[0] / 255) * 360);
  const hue2 = (hue1 + 40 + Math.round((h[1] / 255) * 120)) % 360;
  const shapes = [];
  for (let i = 0; i < 4; i += 1) {
    const cx = Math.round((h[2 + i * 3] / 255) * 640);
    const cy = Math.round((h[3 + i * 3] / 255) * 640);
    const r = 90 + Math.round((h[4 + i * 3] / 255) * 190);
    const hue = (hue1 + i * 37) % 360;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${hue} 80% ${55 + i * 5}%)" opacity="0.35"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue1} 70% 38%)"/><stop offset="1" stop-color="hsl(${hue2} 75% 22%)"/>`
    + `</linearGradient></defs><rect width="640" height="640" fill="url(#g)"/>${shapes.join('')}</svg>`;
}
