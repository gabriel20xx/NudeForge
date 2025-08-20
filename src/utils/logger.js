// Stub logger delegating to shared implementation if available.
let shared;
try { shared = require("../../../NudeShared/logger.js"); } catch(e) {
    shared = { debug(){}, info(){}, warn(){}, error(){}, success(){} };
}
module.exports = shared;

