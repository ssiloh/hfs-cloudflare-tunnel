'use strict';{
    const { h, React } = HFS
    const ko = /^ko/i.test(navigator.language || '')
    const T = ko ? {
        button: '터널', tooltip: 'Cloudflare 퀵 터널', title: 'Cloudflare 퀵 터널',
        status: { stopped: '꺼짐', starting: '시작 중…', downloading: 'cloudflared 받는 중…', online: '연결됨', retrying: '다시 연결 중…', error: '오류' },
        start: '터널 시작', stop: '중지', restart: '새 주소로 다시 시작', copy: '복사', copied: '주소를 복사했습니다', open: '열기',
        waiting: '주소를 받는 중입니다…', none: '터널을 시작하면 https://….trycloudflare.com 주소가 생깁니다.',
        warn: '이 주소를 아는 사람은 누구나 인터넷에서 이 HFS에 접속할 수 있습니다. 공유 폴더의 권한을 확인하세요. 주소는 터널을 다시 시작할 때마다 바뀝니다.',
        target: '연결 대상', log: '기록', since: '연결 시각', newUrl: '터널 주소가 생겼습니다: ', copyTip: '주소 복사',
    } : {
        button: 'Tunnel', tooltip: 'Cloudflare Quick Tunnel', title: 'Cloudflare Quick Tunnel',
        status: { stopped: 'Off', starting: 'Starting…', downloading: 'Downloading cloudflared…', online: 'Online', retrying: 'Reconnecting…', error: 'Error' },
        start: 'Start tunnel', stop: 'Stop', restart: 'Restart with a new address', copy: 'Copy', copied: 'Address copied', open: 'Open',
        waiting: 'Waiting for the address…', none: 'Start the tunnel to get an https://….trycloudflare.com address.',
        warn: 'Anyone who knows this address can reach this HFS from the internet. Check the permissions of your shared folders. The address changes on every restart.',
        target: 'Target', log: 'Log', since: 'Online since', newUrl: 'Tunnel address: ', copyTip: 'Copy address',
    }

    // shared status, polled while an admin has the page open: fast while connecting, slow otherwise
    const store = { s: null, subs: new Set(), timer: 0, lastUrl: '' }
    function poll() {
        clearTimeout(store.timer)
        HFS.customRestCall('cftunnel_status').then(s => {
            const fresh = s.url && s.url !== store.lastUrl
            store.lastUrl = s.url || ''
            store.s = s
            store.subs.forEach(f => f(s))
            if (fresh) {
                HFS.toast(T.newUrl + s.url, 'success')
                if (document.querySelector('.cftunnel-dialog')) navigator.clipboard?.writeText(s.url).catch(() => {})
            }
            const busy = ['starting', 'downloading', 'retrying'].includes(s.status)
            store.timer = setTimeout(poll, busy ? 1500 : 8000)
        }, () => { store.timer = setTimeout(poll, 15000) })
    }
    function useTunnel() {
        const [s, setS] = React.useState(store.s)
        React.useEffect(() => { store.subs.add(setS); return () => store.subs.delete(setS) }, [])
        return s
    }
    const shortUrl = u => u.replace(/^https:\/\//, '')

    HFS.onEvent('appendMenuBar', () => h(MenuButton))

    function MenuButton() {
        const { username } = HFS.useSnapState()
        const [ok, setOk] = React.useState(false)
        React.useEffect(() => {
            HFS.customRestCall('cftunnel_allowed').then(r => {
                setOk(!!r?.ok)
                if (r?.ok) poll(); else clearTimeout(store.timer)
            }, () => setOk(false))
        }, [username])
        const s = useTunnel()
        if (!ok) return null
        const online = s?.url
        const copy = e => {
            e.stopPropagation()
            navigator.clipboard.writeText(s.url).then(() => HFS.toast(T.copied, 'success'))
        }
        return h('span', { className: 'cft-menu' + (online ? ' online' : '') },
            h(HFS.Btn, { icon: '☁️', label: online ? shortUrl(s.url) : T.button + (s && s.status !== 'stopped' ? ' · ' + (T.status[s.status] || '') : ''),
                tooltip: online ? s.url : T.tooltip, onClick: open }),
            online ? h(HFS.Btn, { icon: '📋', label: '', tooltip: T.copyTip, onClick: copy }) : null)
    }

    function open() {
        HFS.dialogLib.newDialog({ title: T.title, className: 'cftunnel-dialog', Content })
    }

    function Content() {
        const s = useTunnel()
        const [busy, setBusy] = React.useState(false)
        React.useEffect(() => { poll() }, [])
        const act = name => {
            setBusy(true)
            HFS.customRestCall('cftunnel_' + name).then(() => poll(), e => HFS.toast(String(e?.message || e), 'error')).finally(() => setBusy(false))
        }
        if (!s) return h('div', { className: 'cft' }, '…')
        const running = ['starting', 'downloading', 'online', 'retrying'].includes(s.status)
        const copy = () => navigator.clipboard.writeText(s.url).then(() => HFS.toast(T.copied, 'success'))
        return h('div', { className: 'cft' },
            h('div', { className: 'cft-status ' + s.status }, h('span', { className: 'dot' }), T.status[s.status] || s.status),
            s.url ? h('div', { className: 'cft-url' },
                h('a', { href: s.url, target: '_blank', rel: 'noreferrer' }, s.url),
                h('button', { type: 'button', onClick: copy }, T.copy))
                : h('div', { className: 'cft-hint' }, running ? T.waiting : T.none),
            s.error ? h('div', { className: 'cft-error' }, s.error) : null,
            h('div', { className: 'cft-actions' },
                running
                    ? [h('button', { key: 'stop', type: 'button', disabled: busy, onClick: () => act('stop') }, T.stop),
                       h('button', { key: 'restart', type: 'button', disabled: busy, onClick: () => act('restart') }, T.restart)]
                    : h('button', { type: 'button', className: 'primary', disabled: busy, onClick: () => act('start') }, T.start)),
            h('div', { className: 'cft-warn' }, T.warn),
            h('div', { className: 'cft-meta' }, T.target + ': ' + s.target + (s.since ? ' · ' + T.since + ' ' + new Date(s.since).toLocaleTimeString() : '')),
            s.log?.length ? h('details', { className: 'cft-log' }, h('summary', null, T.log), h('pre', null, s.log.join('\n'))) : null,
        )
    }
}
