const assert = require('node:assert/strict');
const config = require('./config');
const { parseLapTime, validateLapTime } = require('./index');

const settings = config.reloadConfig();

assert.equal(parseLapTime('1:06.01'), 6601);
assert.equal(parseLapTime('01:06.01'), 6601);
assert.equal(validateLapTime(6601, settings), 6601);
assert.throws(() => validateLapTime(999, settings), /between/);
assert.throws(() => validateLapTime(1000001, settings), /between/);
assert.throws(() => parseLapTime('not-a-lap'), /Invalid time format/);

console.log('Aether lap-time validation tests passed');
