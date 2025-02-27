/**
 * Utility for debug logging
 */
const Debug = (function () {
    const ENABLED = true;
    const LOG_LEVEL = 'debug'; // 'info', 'debug', 'warn', 'error', 'none'

    const LEVELS = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        none: 4
    };

    function shouldLog(level) {
        return ENABLED && LEVELS[level] >= LEVELS[LOG_LEVEL];
    }

    function formatMessage(msg) {
        if (typeof msg === 'object') {
            try {
                return JSON.stringify(msg);
            } catch (e) {
                return String(msg);
            }
        }
        return msg;
    }

    function debug(...args) {
        if (shouldLog('debug')) {
            console.debug('[DEBUG]', ...args.map(formatMessage));
        }
    }

    function info(...args) {
        if (shouldLog('info')) {
            console.info('[INFO]', ...args.map(formatMessage));
        }
    }

    function warn(...args) {
        if (shouldLog('warn')) {
            console.warn('[WARN]', ...args.map(formatMessage));
        }
    }

    function error(...args) {
        if (shouldLog('error')) {
            console.error('[ERROR]', ...args.map(formatMessage));
        }
    }

    // Public API
    return {
        debug,
        info,
        warn,
        error
    };
})();
