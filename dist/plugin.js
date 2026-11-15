'use strict';
// HFS plugin: expose HFS on the internet with a Cloudflare Quick Tunnel (https://*.trycloudflare.com),
// no account, domain or port forwarding needed.

exports.version = 1
exports.description = "Start a Cloudflare Quick Tunnel (free *.trycloudflare.com address) for this HFS with one click"
exports.apiRequired = 12.0
exports.repo = "ssiloh/hfs-cloudflare-tunnel"
exports.changelog = [{ version: 1, message: "First release" }]

exports.config = {
    autoStart: { type: 'boolean', defaultValue: false, label: "Start the tunnel together with HFS" },
    readOnly: {
        type: 'boolean', defaultValue: true, label: "Visitors from the tunnel can only browse and download",
        helperText: "Blocks upload, delete, rename, move, new folder, comments, the admin panel and other plugins' APIs for requests that come through the tunnel (login stays possible, to see protected folders). Local access is not affected.",
    },
    cloudflaredPath: {
        type: 'real_path', label: "cloudflared (optional)", fileMask: 'cloudflared*',
        helperText: "Leave empty to use cloudflared from PATH, or let the plugin download it automatically (Windows / Linux).",
    },
    target: {
        label: "Local address (optional)",
        helperText: "What the tunnel points to. Empty = this HFS (http://127.0.0.1:<port>).",
    },
    protocol: {
        type: 'select', label: "Protocol", defaultValue: 'auto',
        options: { "Automatic": 'auto', "HTTP/2 (if UDP/QUIC is blocked)": 'http2', "QUIC": 'quic' },
    },
}
exports.configDialog = { sx: { maxWidth: '36em' } }

exports.init = async api => {
    const fs = require('fs')
    const fsp = require('fs/promises')
    const path = require('path')
    const { spawn } = require('child_process')

    const cfg = k => api.getConfig(k)
    const state = { status: 'stopped', url: '', error: '', since: 0, log: [] }
    let child = null
    let wanted = false // user wants it running (restart on unexpected exit)
    let retry = 0
    let retryTimer = null

    const log = line => {
        state.log.push(new Date().toLocaleTimeString() + '  ' + line)
        if (state.log.length > 60) state.log.splice(0, state.log.length - 60)
    }

    // ------------------------------------------------------------ security
    // cloudflared connects to HFS from 127.0.0.1, so without this every internet visitor would look like
    // "localhost" and get HFS's passwordless localhost admin. Requests that came through Cloudflare carry
    // Cf-Connecting-Ip: we make HFS see that address instead.
    const isLoopback = ip => /^(::1|127\.|::ffff:127\.)/.test(String(ip || ''))
    const viaTunnel = ctx => isLoopback(ctx.socket?.remoteAddress) && !!(ctx.get('cf-connecting-ip') || ctx.get('cf-ray'))
    // read-only mode: only these HFS APIs are allowed for tunnel visitors (browsing + login)
    const READ_APIS = new Set(['get_file_list', 'get_file_details', 'get_folder_size', 'get_folder_size_partial',
        'get_notifications', 'login', 'loginSrp1', 'loginSrp2', 'logout', 'refresh_session'])
    function readOnlyAllows(ctx) {
        const p = ctx.path
        if (p.startsWith('/~/api/')) return READ_APIS.has(decodeURIComponent(p.slice(7).split('/')[0]))
        if (p === '/~/admin' || p.startsWith('/~/admin/')) return false
        return ['GET', 'HEAD', 'OPTIONS'].includes(ctx.method) // uploads are PUT/POST to a folder
    }
    function middleware(ctx) {
        if (!viaTunnel(ctx)) return
        const real = ctx.get('cf-connecting-ip').trim() || '0.0.0.0'
        try { ctx.request.ip = real } catch {}
        ctx.state.viaCloudflareTunnel = true
        if (cfg('readOnly') !== false && !readOnlyAllows(ctx)) {
            ctx.status = 403
            ctx.type = 'text/plain'
            ctx.body = 'Read-only: this action is not available through the public tunnel'
            if (typeof ctx.stop === 'function') ctx.stop()
            else return true
        }
    }

    // ------------------------------------------------------------ permissions
    function isAdmin(account, seen = new Set()) {
        if (!account || seen.has(account.username)) return false
        seen.add(account.username)
        return account.admin || (account.belongs || []).some(g => isAdmin(api.getAccount(g), seen))
    }
    function isLocalAdmin(ctx) {
        if (viaTunnel(ctx) || api.getHfsConfig?.('localhost_admin') === false) return false
        return isLoopback(ctx.socket?.remoteAddress)
    }
    function check(ctx) {
        if (!isLocalAdmin(ctx) && !isAdmin(ctx.state.account)) throw "not allowed"
    }

    // ------------------------------------------------------------ cloudflared binary
    const DOWNLOADS = {
        'win32-x64': 'cloudflared-windows-amd64.exe', 'win32-ia32': 'cloudflared-windows-386.exe',
        'linux-x64': 'cloudflared-linux-amd64', 'linux-arm64': 'cloudflared-linux-arm64', 'linux-arm': 'cloudflared-linux-arm',
    }
    const localBin = () => path.join(api.storageDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')

    function works(bin) {
        return new Promise(resolve => {
            const p = spawn(bin, ['--version'], { stdio: 'ignore', windowsHide: true })
            p.on('error', () => resolve(false))
            p.on('exit', code => resolve(code === 0))
        })
    }

    async function findBinary() {
        const custom = cfg('cloudflaredPath')
        if (custom) return custom
        if (fs.existsSync(localBin())) return localBin()
        if (await works('cloudflared')) return 'cloudflared'
        const name = DOWNLOADS[process.platform + '-' + process.arch]
        if (!name) throw "cloudflared not found: install it and set its path in the plugin options"
        state.status = 'downloading'
        log('downloading ' + name + ' from github.com/cloudflare/cloudflared')
        const res = await fetch('https://github.com/cloudflare/cloudflared/releases/latest/download/' + name)
        if (!res.ok) throw "cloudflared download failed: HTTP " + res.status
        await fsp.mkdir(api.storageDir, { recursive: true })
        const tmp = localBin() + '.part'
        await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()))
        await fsp.chmod(tmp, 0o755)
        await fsp.rename(tmp, localBin())
        log('cloudflared downloaded')
        return localBin()
    }

    function targetUrl() {
        const t = String(cfg('target') || '').trim()
        if (t) return t
        const port = Number(api.getHfsConfig('port'))
        if (port > 0) return 'http://127.0.0.1:' + port
        const https = Number(api.getHfsConfig('https_port'))
        if (https > 0) return 'https://127.0.0.1:' + https
        throw "HFS has no http/https port to expose"
    }

    // ------------------------------------------------------------ tunnel process
    async function start() {
        wanted = true
        clearTimeout(retryTimer)
        if (child) return view()
        state.error = ''
        state.url = ''
        state.status = 'starting'
        try {
            const bin = await findBinary()
            const target = targetUrl()
            const args = ['tunnel', '--no-autoupdate', '--url', target]
            if (target.startsWith('https:')) args.push('--no-tls-verify')
            if (cfg('protocol') && cfg('protocol') !== 'auto') args.push('--protocol', cfg('protocol'))
            if (!wanted) return view() // stopped while downloading
            log('starting: cloudflared ' + args.join(' '))
            state.status = 'starting'
            const p = child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
            const onData = d => {
                for (const line of String(d).split(/\r?\n/)) {
                    if (!line.trim()) continue
                    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(line)?.[0]
                    if (url && !state.url) {
                        state.url = url
                        api.log('Cloudflare tunnel: ' + url)
                        log('address: ' + url)
                    }
                    if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(line)) {
                        state.status = 'online'
                        state.since ||= Date.now()
                        retry = 0
                    }
                    if (/\bERR\b|error/i.test(line)) log(line.replace(/^\S+\s+/, '').slice(0, 300))
                    if (/failed to request quick Tunnel|config file.*(found|exists)/i.test(line)) state.error = line.replace(/^\S+\s+\S+\s+/, '').slice(0, 300)
                }
            }
            p.stdout.on('data', onData)
            p.stderr.on('data', onData)
            p.on('error', e => { state.error = "cannot run cloudflared: " + e.message; log(state.error) })
            p.on('exit', code => {
                if (child === p) child = null
                state.status = 'stopped'
                state.since = 0
                state.url = ''
                log('cloudflared exited (' + code + ')')
                if (wanted) { // unexpected: retry with backoff, up to ~5 minutes apart
                    const wait = Math.min(300, 5 * 2 ** retry++) * 1000
                    state.status = 'retrying'
                    log('restarting in ' + wait / 1000 + 's')
                    retryTimer = setTimeout(() => wanted && start().catch(() => {}), wait)
                }
            })
            api.setError('')
        }
        catch (e) {
            child = null
            wanted = false
            state.status = 'error'
            state.error = String(e?.message || e)
            log(state.error)
            api.setError("Cloudflare tunnel: " + state.error)
        }
        return view()
    }

    function stop() {
        wanted = false
        clearTimeout(retryTimer)
        if (child) { const p = child; child = null; p.kill() }
        state.status = 'stopped'
        state.url = ''
        state.since = 0
        return view()
    }

    const view = () => ({ status: state.status, url: state.url, error: state.error, since: state.since, log: state.log.slice(-30),
        target: (() => { try { return targetUrl() } catch (e) { return String(e) } })() })

    if (cfg('autoStart')) start().catch(() => {})

    return {
        middleware,
        frontend_js: 'main.js',
        frontend_css: 'style.css',
        customRest: {
            cftunnel_allowed(_p, ctx) {
                try { check(ctx); return { ok: true } } catch { return { ok: false } }
            },
            cftunnel_status(_p, ctx) { check(ctx); return view() },
            cftunnel_start(_p, ctx) { check(ctx); return start() },
            cftunnel_stop(_p, ctx) { check(ctx); return stop() },
            async cftunnel_restart(_p, ctx) { check(ctx); stop(); return start() },
        },
        unload() {
            wanted = false
            clearTimeout(retryTimer)
            if (child) { const p = child; child = null; p.kill() }
        },
    }
}
