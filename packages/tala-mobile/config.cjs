/** A production cutover must be an explicit release decision, never an ordinary build. */
exports.applicationId = (env = {}) => env.TALA_ANDROID_APPLICATION_ID || 'com.hiraia.tala.next';
