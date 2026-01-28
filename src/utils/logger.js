// Colorful, emoji-prefixed logger for worker and PDF logs (CommonJS, no ESM-only deps)
const util = require('util');

const SCOPE_STYLES = {
  Worker: {
    emoji: '🟩',
    color: '\x1b[32m', // green
  },
  PDF: {
    emoji: '🟨',
    color: '\x1b[33m', // yellow
  },
  default: {
    emoji: '⬜',
    color: '\x1b[37m', // white
  },
};

function getScopeStyle(scope) {
  if (!scope) return SCOPE_STYLES.default;
  return SCOPE_STYLES[scope] || SCOPE_STYLES.default;
}

function colorize(line, color) {
  const reset = '\x1b[0m';
  return color + line + reset;
}

function formatPrefix(level, scope) {
  const style = getScopeStyle(scope);
  const emoji = style.emoji;
  if (scope) return `${emoji} [${scope}]`;
  return `${emoji}`;
}

function log(level, scope, ...args) {
  const ts = new Date().toISOString();
  const style = getScopeStyle(scope);
  const prefix = formatPrefix(level, scope);
  const designVersion = process.env.DESIGN_VERSION || 'v2';
  let msg = args.map(a => {
    if (typeof a === 'string') return a;
    // Pretty-print objects as multi-line JSON
    try {
      return '\n' + JSON.stringify(a, null, 2);
    } catch (e) {
      return util.inspect(a, { depth: 4, colors: false });
    }
  }).join(' ');
  const line = `${ts} [${level}] ${prefix} [designVersion: ${designVersion}] ${msg}`;
  const colored = colorize(line, style.color);
  if (level === 'error') return console.error(colored);
  if (level === 'warn') return console.warn(colored);
  return console.log(colored);
}

function createLogger(scope) {
  return {
    error: (...args) => log('error', scope, ...args),
    warn: (...args) => log('warn', scope, ...args),
    info: (...args) => log('info', scope, ...args),
    debug: (...args) => {
      if ((process.env.LOG_LEVEL || '').toLowerCase() === 'debug') {
        log('debug', scope, ...args);
      }
    },
  };
}

const logger = createLogger('Worker');
logger.createLogger = createLogger;

module.exports = logger;
