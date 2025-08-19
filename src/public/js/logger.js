// Lightweight client-side logger to avoid 404 and offer consistent formatting
// Provides: log, info, warn, error, debug (no-op gated by localStorage flag)
// Enable debug: localStorage.setItem('clientDebug','1')
// Disable debug: localStorage.removeItem('clientDebug')
/* eslint-disable no-console */
(function(global){
  const PREFIX = '[NudeForge]';
  const isDebug = () => typeof localStorage !== 'undefined' && localStorage.getItem('clientDebug');
  function ts(){ return new Date().toISOString(); }
  function format(level, args){ return [ts(), PREFIX, level+':', ...args]; }
  const api = {
    log: (...a)=> console.log(...format('LOG', a)),
    info: (...a)=> console.info(...format('INFO', a)),
    warn: (...a)=> console.warn(...format('WARN', a)),
    error: (...a)=> console.error(...format('ERR', a)),
    debug: (...a)=> { if(isDebug()) console.debug(...format('DBG', a)); }
  };
  global.ClientLogger = api;
})(window);
