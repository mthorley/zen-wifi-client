'use strict'

class AppError extends Error {
    get name() {
        return this.constructor.name;
    }
}

class AuthError extends AppError {
    constructor(message, sc, options = {}) {
        super();
        this.message = message;
        this.statusCode = sc;
        for (const [key, value] of Object.entries(options)) {
            this[key] = value;
        }
    }
}

module.exports = {
    AppError,
    AuthError
}
