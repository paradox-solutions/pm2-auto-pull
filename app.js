// process.env.MODULE_DEBUG = process.NODE_ENV !== 'production';
// process.env.DEBUG = 'pm2-auto-pull*';

const pmx = require('pmx');
const pm2 = require('pm2');
const requestp = require('request-promise');
const debug = require('debug')('pm2-auto-pull');
const Promise = require('bluebird');
const _ = require('lodash');

// promisified
const pm2List = Promise.promisify(pm2.list, {context: pm2});
const pm2PullReload = Promise.promisify(pm2.pullAndReload, {context: pm2});
const pm2Trigger = Promise.promisify(pm2.trigger, {context: pm2});

// config
const conf = pmx.initModule();

async function notify(proc) {
    if(!conf.notify) {
        return true;
    }

    try {
        debug('Notify process %s with event %s', proc.name, conf.notify_event);

        let response = await pm2Trigger(proc.name, conf.notify_event, null);
        let result = response[0].data.return;

        if(!('ready' in result)) {
            console.error("Notified and returned a non correct result");
            console.error(result);
            return true;
        }

        return result.ready;

    } catch(err) {
        console.error("Notified and returned error: " + err.message);
        console.info(proc);
        return true;
    }
}

/**
 * Notifies a pm2 process, waits for a response, updates it and reload.
 *
 * @param proc
 */
async function pullProc(proc) {
    // Ignore pm2 modules
    if(proc.name.startsWith('pm2-')) {
        debug('Ignored module: ' + proc.name);
        return;
    }

    // Ignore pm2 without versioning
    if(!_.get(proc, 'pm2_env.versioning')) {
        debug('Ignored not versioned process: ' + proc.name);
        return;
    }

    debug('Check, pull and reload: %s', proc.name);

    // Check
    let ready = await notify(proc);

    if(!ready) {
        console.info("Process is not ready for update: " + proc.name);
        return;
    }

    // Pull
    try {
        let meta = await pm2PullReload(proc.name);

        if(meta) {
            let rev = meta.rev;

            if(rev)
                console.log('Successfully pulled [App name: %s] [Commit id: %s] [Repo: %s] [Branch: %s]',
                    proc.name,
                    rev.current_revision,
                    meta.procs[0].pm2_env.versioning.repo_path,
                    meta.procs[0].pm2_env.versioning.branch
                );

            else {
                // Backward compatibility
                console.log('App "%s" succesfully pulled');
            }
        }

    } catch(err) {
        debug('App "%s" already at latest version', proc.name);
    }

}

/**
 * Iterate over all pm2 procs and checks them one by one.
 */
async function check() {
    let procs = await pm2List();

    for(let i = 0; i < procs.length; i++) {
        let proc = procs[i];
        await pullProc(proc);
    }
}

/**
 * Start function, checks and calls itself again.
 */
async function start() {
    try {
        await check();

    } catch(err) {
        console.error("Auto pull check error: " + err.message);
        console.error(err);
    }

    setTimeout(start, Math.max(conf.interval, 1000));
}

/**
 * Module bootstrap
 */
pm2.connect(() => {
    console.log('pm2-auto-pull module connected to pm2');
    debug('debug enabled');
    start();
});