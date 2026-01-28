function parseIntEnv(name) {
  const v = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) ? v : null;
}

function normalizeHexColor(input) {
  const v = (input || '').trim();
  if (!v) return '';
  // Accept #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
  return '';
}

/**
 * Returns qrcode rendering options (width/margin/color) with a simple style preset.
 *
 * Supported styles via QR_STYLE:
 * - classic: black modules on white background (default)
 * - dark:    white modules on black background (inverted)
 * - transparent: black modules on transparent background
 *
 * Explicit QR_DARK_COLOR / QR_LIGHT_COLOR envs override style defaults.
 */
function getQrRenderOptions({ defaultWidth }) {
  const width = parseIntEnv('QR_PNG_WIDTH') ?? defaultWidth;
  const margin = parseIntEnv('QR_MARGIN') ?? 8;

  const style = (process.env.QR_STYLE || 'classic').trim().toLowerCase();

  let styleDark = '#000000';
  let styleLight = '#ffffff';

  if (style === 'dark' || style === 'inverted' || style === 'reference') {
    styleDark = '#ffffff';
    styleLight = '#000000';
  } else if (style === 'transparent' || style === 'alpha') {
    styleDark = '#000000';
    styleLight = '#00000000';
  }

  const envDark = normalizeHexColor(process.env.QR_DARK_COLOR);
  const envLight = normalizeHexColor(process.env.QR_LIGHT_COLOR);

  return {
    width,
    margin,
    color: {
      dark: envDark || styleDark,
      light: envLight || styleLight,
    },
  };
}

function getPdfQrRenderOptions({ defaultWidth }) {
  const width = parseIntEnv('QR_PDF_PNG_WIDTH') ?? parseIntEnv('QR_PNG_WIDTH') ?? defaultWidth;
  const margin = parseIntEnv('QR_MARGIN') ?? 8;

  // Default for PDF embedding: transparent so it blends with certificate background.
  const style = (process.env.QR_STYLE || 'transparent').trim().toLowerCase();

  let styleDark = '#000000';
  let styleLight = '#ffffff';

  if (style === 'dark' || style === 'inverted' || style === 'reference') {
    styleDark = '#ffffff';
    styleLight = '#000000';
  } else if (style === 'transparent' || style === 'alpha') {
    styleDark = '#000000';
    styleLight = '#00000000';
  }

  const envDark = normalizeHexColor(process.env.QR_DARK_COLOR);
  const envLight = normalizeHexColor(process.env.QR_LIGHT_COLOR);

  return {
    width,
    margin,
    color: {
      dark: envDark || styleDark,
      light: envLight || styleLight,
    },
  };
}

module.exports = {
  getQrRenderOptions,
  getPdfQrRenderOptions,
};
