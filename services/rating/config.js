// Keep the rating pipeline available, but paused during the private beta.
// At public release, set MADPLUS_RATING_ENABLED=true and redeploy/restart.
const PAUSED_REASON = 'Mad+ ratings are paused until the public release.';

function isRatingEnabled() {
    return String(process.env.MADPLUS_RATING_ENABLED || '').trim().toLowerCase() === 'true';
}

module.exports = { isRatingEnabled, PAUSED_REASON };
