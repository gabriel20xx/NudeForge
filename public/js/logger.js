/**
 * Frontend logging utility with consistent formatting
 * Format: [TIMESTAMP] [LEVEL] [MODULE] Message
 */

class FrontendLogger {
    static formatTimestamp() {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toTimeString().split(' ')[0];
        return `${date} ${time}`;
    }

    static formatMessage(level, module, message, ...args) {
        const timestamp = this.formatTimestamp();
        const prefix = `[${timestamp}] [${level.toUpperCase()}] [${module.toUpperCase()}]`;
        
        if (args.length > 0) {
            return [prefix, message, ...args];
        }
        return [prefix, message];
    }

    static debug(module, message, ...args) {
        const formatted = this.formatMessage('DEBUG', module, message, ...args);
        console.debug(...formatted);
    }

    static info(module, message, ...args) {
        const formatted = this.formatMessage('INFO', module, message, ...args);
        console.log(...formatted);
    }

    static warn(module, message, ...args) {
        const formatted = this.formatMessage('WARN', module, message, ...args);
        console.warn(...formatted);
    }

    static error(module, message, ...args) {
        const formatted = this.formatMessage('ERROR', module, message, ...args);
        console.error(...formatted);
    }

    static success(module, message, ...args) {
        const formatted = this.formatMessage('SUCCESS', module, message, ...args);
        console.log(...formatted);
    }
}

// Make it available globally
window.Logger = FrontendLogger;
