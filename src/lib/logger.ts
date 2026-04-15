/**
 * Minimal structured logger. Emits JSON on stdout/stderr so logs are parseable
 * by whatever ingestion pipeline is in front of the app (Vercel, Datadog, etc.).
 *
 * Never log raw user content (transcripts, prompt bodies, tokens). Log ids,
 * counts, durations, and error messages — not payloads.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown>;

function emit(level: Level, message: string, fields?: LogFields) {
    const line = {
        level,
        message,
        timestamp: new Date().toISOString(),
        ...fields,
    };
    const out = JSON.stringify(line);
    if (level === 'error' || level === 'warn') {
        console.error(out);
    } else {
        console.log(out);
    }
}

export const log = {
    debug(message: string, fields?: LogFields) {
        if (process.env.NODE_ENV !== 'production') emit('debug', message, fields);
    },
    info(message: string, fields?: LogFields) {
        emit('info', message, fields);
    },
    warn(message: string, fields?: LogFields) {
        emit('warn', message, fields);
    },
    error(message: string, fields?: LogFields) {
        emit('error', message, fields);
    },
};
