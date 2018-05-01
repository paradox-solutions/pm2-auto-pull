// process.env.MODULE_DEBUG = process.NODE_ENV !== 'production';

const pmx = require('pmx');
const pm2 = require('pm2');
const pkg = require('./package.json');
const requestp = require('request-promise');
const debug = require('debug')(pkg.name);
const Promise = require('bluebird');

// promisified
const pm2List = Promise.promisify(pm2.list);
const pm2PullReload = Promise.promisify(pm2.pullAndReload);

// config
const conf = pmx.initModule();

async function notify(proc) {
    console.info(proc);
}

/**
 * Notifies a pm2 process, waits for a response, updates it and reload.
 *
 * @param proc
 */
async function pullProc(proc) {
    if(!proc.pm2_env || proc.pm2_env.versioning) {
        return;
    }

    debug('Check, pull and reload: %s', proc.name);

    // Check
    // TODO: Connect, notify and wait response
    await notify(proc);

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
        debug('App "%s" already at latest version (msg: %s)', proc.name, err.message);
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
    }

    setTimeout(start, Math.max(conf.interval, 1000));
}

/**
 * Module bootstrap
 */
pm2.connect(() => {
    console.log('pm2-auto-pull module connected to pm2');
    start();
});